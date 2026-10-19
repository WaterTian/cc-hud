import { execFile } from 'node:child_process';
// Short per-call budget: both git invocations run concurrently and must fit
// comfortably inside the 2s render deadline even on a cold disk cache.
const GIT_TIMEOUT_MS = 800;
function git(cwd, args) {
    return new Promise(resolve => {
        try {
            execFile('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
        }
        catch {
            resolve(null);
        }
    });
}
// Workspace segment: last path component + git branch, `*` when the tree has
// uncommitted tracked changes. Branch is omitted outside a repo or on a
// detached HEAD (symbolic-ref prints nothing there) — the folder still shows.
// knownBranch: stdin already carries the branch for worktree sessions — skip
// the symbolic-ref call then.
export async function getWorkspace(cwd, knownBranch) {
    if (!cwd)
        return null;
    const name = cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
    const [branch, status] = await Promise.all([
        knownBranch ? Promise.resolve(knownBranch) : git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']),
        // --no-optional-locks: a statusline tick must never take index.lock and
        // race the session's own `git add` / `git commit`.
        git(cwd, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=no']),
    ]);
    if (!branch)
        return { name, branch: null, dirty: false };
    // A failed / timed-out status is unknown — never report it as a clean tree.
    return { name, branch, dirty: status === null ? null : status.length > 0 };
}
