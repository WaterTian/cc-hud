import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

// JSON GET for the detached refresher: native fetch first, curl as fallback.
//
// Why curl at all: Cloudflare's WAF 403s Node's TLS fingerprint on
// api.anthropic.com/api/oauth/* while letting curl through (verified
// 2026-07-23), and Node's fetch ignores HTTPS_PROXY whereas curl honors it —
// so curl is also the path that works behind a proxy. curl ships with macOS,
// Windows 10+, and Linux.

const DEFAULT_TIMEOUT_MS = 2000;

export interface ProxyConfig { proxy?: string }

// Proxy: environment first, then ~/.config/cc-hud/config.json { "proxy": "…" }
// for statusline processes whose environment doesn't carry one.
export function resolveProxy(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const v = env[k];
    if (v) return v;
  }
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.config', 'cc-hud', 'config.json'), 'utf8')) as ProxyConfig;
    if (typeof cfg?.proxy === 'string' && cfg.proxy) return cfg.proxy;
  } catch { /* no config */ }
  return null;
}

type NativeResult = { kind: 'ok'; data: unknown } | { kind: 'http'; status: number } | { kind: 'fail' };

async function fetchNative(url: string, headers: Record<string, string>, timeoutMs: number): Promise<NativeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers, signal: ctrl.signal });
    if (!resp.ok) return { kind: 'http', status: resp.status };
    return { kind: 'ok', data: await resp.json() };
  } catch {
    return { kind: 'fail' };
  } finally {
    clearTimeout(timer);
    timer.unref();
  }
}

// The request goes via a curl config on stdin so the token never appears in
// the argv list. Header values are restricted to a safe charset — a quote or
// newline would break out of the config syntax.
function fetchCurl(url: string, headers: Record<string, string>, timeoutMs: number): Promise<unknown | null> {
  const lines = [`url = "${url}"`];
  for (const [k, v] of Object.entries(headers)) {
    if (!/^[\w.\-~+/=:, ]+$/.test(v) || !/^[\w-]+$/.test(k)) return Promise.resolve(null);
    lines.push(`header = "${k}: ${v}"`);
  }
  lines.push('silent', 'fail', `max-time = ${Math.ceil(timeoutMs / 1000)}`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  const proxy = resolveProxy();
  if (proxy && !env.HTTPS_PROXY && !env.https_proxy) env.https_proxy = proxy;

  return new Promise(resolve => {
    try {
      const child = execFile(
        process.env.CC_HUD_CURL || 'curl',
        ['--config', '-'],
        { timeout: timeoutMs + 500, windowsHide: true, env },
        (err, stdout) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
        },
      );
      child.stdin?.on('error', () => { /* curl may exit before stdin flushes */ });
      child.stdin?.end(lines.join('\n'));
    } catch {
      resolve(null);
    }
  });
}

// Fallback to curl only where it can plausibly help: a transport failure
// (TLS, DNS, proxy, timeout) or a 403 (WAF fingerprinting). A 401/404/500 is
// the server's verdict — retrying through curl would just repeat it.
export async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown | null> {
  const r = await fetchNative(url, headers, timeoutMs);
  if (r.kind === 'ok') return r.data;
  if (r.kind === 'http' && r.status !== 403) return null;
  return fetchCurl(url, headers, timeoutMs);
}
