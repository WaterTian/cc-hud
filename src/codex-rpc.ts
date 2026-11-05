// One short-lived `codex app-server --stdio` for configuration commands only:
// initialize → config/read → config/batchWrite → re-read, then the process is
// terminated. No threads, prompts, usage requests or credentials handling, and
// no per-tick cc-hud process — Codex renders its own footer afterwards.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MIN_VERSION = '0.166.0';
const REQUEST_DEADLINE_MS = 10_000;

export type Request = (method: string, params: unknown) => Promise<unknown>;

// The user-level config layer (`~/.codex/config.toml` or $CODEX_HOME), the
// only one cc-hud writes, plus the effective `tui` table after all layers.
export interface UserLayer {
  file: string;
  version: string;
  tui: Record<string, unknown>;
  effectiveTui: Record<string, unknown>;
}

interface ConfigRead {
  config?: { tui?: Record<string, unknown> };
  layers?: { name?: { type?: string; file?: string; profile?: string }; version?: string; config?: { tui?: Record<string, unknown> } }[];
}

export async function readUserLayer(request: Request): Promise<UserLayer> {
  const result = (await request('config/read', { includeLayers: true })) as ConfigRead | null | undefined;
  const user = result?.layers?.find(l => l?.name?.type === 'user' && !l.name.profile);
  if (!user?.name?.file || !user.version) throw new Error('Codex did not return a supported user configuration layer.');
  return { file: user.name.file, version: user.version, tui: user.config?.tui ?? {}, effectiveTui: result?.config?.tui ?? {} };
}

// Codex owns TOML parsing and the atomic write, including removing a key for a
// JSON null; `expectedVersion` makes it reject a concurrent edit of the file.
export async function writeUserLayer(request: Request, layer: UserLayer, edits: { keyPath: string; value: unknown }[]): Promise<void> {
  await request('config/batchWrite', {
    filePath: layer.file,
    expectedVersion: layer.version,
    edits: edits.map(e => ({ ...e, mergeStrategy: 'replace' })),
  });
}

function command(): { executable: string; prefix: string[] } {
  let executable = process.env.CC_HUD_CODEX || 'codex';
  if (process.platform === 'win32' && !/\.(?:exe|[cm]?js)$/i.test(executable)) {
    // npm's .cmd shim needs a shell; invoke its JS entry directly instead.
    try {
      const found = execFileSync('where.exe', [executable], { encoding: 'utf8', timeout: 2000, windowsHide: true });
      const paths = found.trim().split(/\r?\n/);
      const native = paths.find(p => /\.exe$/i.test(p));
      const wrapper = paths.find(p => /\.cmd$/i.test(p));
      if (native) executable = native;
      else if (wrapper) {
        const entry = join(dirname(wrapper), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
        if (existsSync(entry)) executable = entry;
        else throw new Error();
      } else throw new Error();
    } catch { throw new Error('Codex executable not found. Set CC_HUD_CODEX to codex.exe or codex.js.'); }
  }
  return /\.[cm]?js$/i.test(executable)
    ? { executable: process.execPath, prefix: [executable] }
    : { executable, prefix: [] };
}

// `codex --version` → "codex-cli 0.166.0"; anything below MIN_VERSION (or a
// 0.166.0 pre-release) lacks the config API used here.
async function checkVersion(cmd: { executable: string; prefix: string[] }): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await exec(cmd.executable, [...cmd.prefix, '--version'], { timeout: 3000, maxBuffer: 8192, windowsHide: true }));
  } catch {
    const where = process.env.CC_HUD_CODEX ? `at CC_HUD_CODEX=${process.env.CC_HUD_CODEX}` : 'on PATH';
    throw new Error(`Codex CLI not found ${where}; install Codex or point CC_HUD_CODEX at its executable.`);
  }
  const match = stdout.trim().match(/^codex-cli (\d+)\.(\d+)\.(\d+)(\S*)$/);
  const [, major, minor, patch, prerelease] = match ?? [];
  const tooOld = !match || (+major === 0 && (+minor < 166 || (+minor === 166 && +patch === 0 && prerelease.startsWith('-'))));
  if (tooOld) throw new Error(`Codex CLI >= ${MIN_VERSION} is required (found ${match?.[0] ?? 'an unrecognised version'}); update Codex first.`);
  return match[0];
}

export async function withCodex<T>(home: string, use: (request: Request, version: string) => Promise<T>): Promise<T> {
  const cmd = command();
  const version = await checkVersion(cmd);

  const child = spawn(cmd.executable, [...cmd.prefix, 'app-server', '--stdio'], {
    cwd: home, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  let nextId = 0;
  let dead: string | null = null; // once set, every pending and future request fails with it
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const fail = (message: string) => {
    dead ??= message;
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
  };
  child.on('error', () => fail('Could not start the Codex configuration service.'));
  child.on('exit', () => fail('Codex exited before the configuration request completed.'));
  child.stdin.on('error', () => fail('Codex configuration input closed.'));

  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message: { id?: number; method?: string; error?: unknown; result?: unknown };
    try { message = JSON.parse(line); } catch { return; }
    // Only responses to our own requests: skip notifications and any
    // server-initiated request (both carry a `method`).
    if (!message || typeof message !== 'object' || 'method' in message || message.id == null) return;
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id);
    // Do not surface server error bodies: config errors may contain private values.
    if (message.error) p.reject(new Error('Codex rejected the configuration request. Check its config or retry if it changed concurrently.'));
    else p.resolve(message.result);
  });

  const request: Request = (method, params) => new Promise((resolve, reject) => {
    if (dead) return reject(new Error(dead));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });

  const deadline = setTimeout(() => {
    fail('Codex configuration timed out.');
    child.kill();
  }, REQUEST_DEADLINE_MS);
  try {
    await request('initialize', { clientInfo: { name: 'cc_hud_setup', version: '1' } });
    child.stdin.write('{"method":"initialized"}\n');
    return await use(request, version);
  } finally {
    clearTimeout(deadline);
    lines.close();
    child.stdin.end();
    child.kill();
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 500);
    forceKill.unref();
    child.once('exit', () => clearTimeout(forceKill));
  }
}
