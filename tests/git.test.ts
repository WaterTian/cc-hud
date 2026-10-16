import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getWorkspace } from '../dist/git.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });

describe('getWorkspace', () => {
  let root: string;
  let repo: string;
  let plain: string;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'cc-hud-git-'));
    repo = join(root, 'my-repo');
    plain = join(root, 'plain');
    git(root, 'init', '-q', '-b', 'main', repo);
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'init');
    execFileSync('mkdir', ['-p', plain]);
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  it('returns null without a cwd', async () => {
    assert.equal(await getWorkspace(undefined), null);
  });

  it('reports folder, branch and a clean tree', async () => {
    assert.deepEqual(await getWorkspace(repo), { name: 'my-repo', branch: 'main', dirty: false });
  });

  it('flags tracked modifications as dirty, ignores untracked files', async () => {
    writeFileSync(join(repo, 'new.txt'), 'x');
    assert.equal((await getWorkspace(repo))!.dirty, false);
    writeFileSync(join(repo, 'a.txt'), 'changed');
    assert.equal((await getWorkspace(repo))!.dirty, true);
    git(repo, 'checkout', '-q', '--', 'a.txt');
  });

  it('gives folder only outside a repo', async () => {
    assert.deepEqual(await getWorkspace(plain), { name: 'plain', branch: null, dirty: false });
  });

  it('survives a missing directory', async () => {
    const r = await getWorkspace(join(root, 'nope'));
    assert.deepEqual(r, { name: 'nope', branch: null, dirty: false });
  });

  it('uses a known branch from stdin instead of asking git', async () => {
    const r = await getWorkspace(repo, 'feature/x');
    assert.equal(r!.branch, 'feature/x');
    assert.equal(r!.name, 'my-repo');
  });
});
