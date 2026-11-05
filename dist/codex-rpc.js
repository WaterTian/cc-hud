// One short-lived Codex process for configuration commands only. No threads,
// prompts, usage requests, credentials handling, or per-tick cc-hud process.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
const exec = promisify(execFile);
function command() {
    let executable = process.env.CC_HUD_CODEX || 'codex';
    if (process.platform === 'win32' && !/\.(?:exe|[cm]?js)$/i.test(executable)) {
        // npm's .cmd shim needs a shell; invoke its JS entry directly instead.
        try {
            const found = execFileSync('where.exe', [executable], { encoding: 'utf8', timeout: 2000, windowsHide: true });
            const paths = found.trim().split(/\r?\n/);
            const native = paths.find(p => /\.exe$/i.test(p));
            const wrapper = paths.find(p => /\.cmd$/i.test(p));
            if (native)
                executable = native;
            else if (wrapper) {
                const entry = join(dirname(wrapper), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
                if (existsSync(entry))
                    executable = entry;
                else
                    throw new Error();
            }
            else
                throw new Error();
        }
        catch {
            throw new Error('Codex executable not found. Set CC_HUD_CODEX to codex.exe or codex.js.');
        }
    }
    return /\.[cm]?js$/i.test(executable)
        ? { executable: process.execPath, prefix: [executable] }
        : { executable, prefix: [] };
}
export async function withCodex(home, use) {
    const cmd = command();
    let version;
    try {
        const { stdout } = await exec(cmd.executable, [...cmd.prefix, '--version'], { timeout: 3000, maxBuffer: 8192, windowsHide: true });
        const match = stdout.trim().match(/^codex-cli (\d+)\.(\d+)\.(\d+)([^\s]*)$/);
        if (!match)
            throw new Error();
        const [, major, minor, patch, prerelease] = match;
        if (+major === 0 && (+minor < 166 || (+minor === 166 && +patch === 0 && prerelease.startsWith('-'))))
            throw new Error();
        version = match[0];
    }
    catch {
        throw new Error('Codex CLI >= 0.166.0 is required; install or update Codex first.');
    }
    const child = spawn(cmd.executable, [...cmd.prefix, 'app-server', '--stdio'], {
        cwd: home, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    let nextId = 0;
    const pending = new Map();
    const fail = (message) => {
        for (const p of pending.values())
            p.reject(new Error(message));
        pending.clear();
    };
    child.on('error', () => fail('Could not start the Codex configuration service.'));
    child.on('exit', () => fail('Codex exited before the configuration request completed.'));
    child.stdin.on('error', () => fail('Codex configuration input closed.'));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
        let response;
        try {
            response = JSON.parse(line);
        }
        catch {
            return;
        }
        if (!response || typeof response !== 'object')
            return;
        const p = response.id == null ? undefined : pending.get(response.id);
        if (!p)
            return;
        pending.delete(response.id);
        // Do not log server error bodies: config errors may contain private values.
        if (response.error)
            p.reject(new Error('Codex rejected the configuration request. Check its config or retry if it changed concurrently.'));
        else
            p.resolve(response.result);
    });
    const request = (method, params) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
    const timer = setTimeout(() => {
        fail('Codex configuration timed out.');
        child.kill();
    }, 10_000);
    try {
        await request('initialize', { clientInfo: { name: 'cc_hud_setup', version: '1' } });
        child.stdin.write('{"method":"initialized"}\n');
        return await use(request, version);
    }
    finally {
        clearTimeout(timer);
        lines.close();
        child.stdin.end();
        child.kill();
        const forceKill = setTimeout(() => child.kill('SIGKILL'), 500);
        forceKill.unref();
        child.once('exit', () => clearTimeout(forceKill));
    }
}
