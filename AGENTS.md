# cc-hud — agent reference

Compact single-line status bar for Claude Code, plus a native Codex CLI footer
preset. This file is the machine-oriented
reference: exact commands with expected output, the runtime contract, every file,
process and endpoint the tool touches, and the invariants to keep when changing
it. The human tour is [README.md](README.md); maintainer notes (Chinese) are in
[CLAUDE.md](CLAUDE.md). Keep the three in sync when behaviour changes.

## What it renders

```
[Fable 5.1 · XHigh] █▊░░░░░░░░ 18% (1M) │ ◐ explore [haiku] │ 5h:1% (4.5h) │ 7d:35% (4.1d) │ Fable:51% │ spend:$12/$50 (3d) │ cc-hud · main*
```

| Segment | Source | Shown when |
| --- | --- | --- |
| `[Fable 5.1 · XHigh]` | `model.id` (fallback `display_name`), `effort.level` (fallback: transcript) | always; depth only when an effort is known |
| `█▊░░░░░░░░ 18%` | `context_window.used_percentage`, else derived from `current_usage` tokens ÷ `context_window_size` | always; `—%` until Claude Code reports usage (session start, right after `/compact`) |
| `(1M)` | `[1m]` suffix in `model.id`, or `context_window_size ≥ 1_000_000` | extended-context sessions |
| `◐ explore [haiku]` | transcript tail: `Agent` tool_use blocks without a matching `tool_result` | while a subagent runs (max 3 listed) |
| `5h:1% (4.5h)` / `7d:35% (4.1d)` | `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`); MiniMax quota on that backend | subscription sessions (absent for API-key sessions) |
| `Fable:51%` | OAuth usage endpoint, via the detached refresher's cache | official backend with rate limits; `~` prefix = cache older than 30 min |
| `spend:$12/$50 (3d)` | `rate_limits.spend_limit` | when the org sets a spend cap; bare `%` if dollar figures are absent |
| `one day:7%` | any other `rate_limits.<key>` with `used_percentage` | whenever Claude Code adds a window cc-hud has no slot for |
| `cc-hud · main*` | `workspace.current_dir` (fallback `cwd`), `worktree.branch` or `git symbolic-ref`, `git status --porcelain` | always; `*` = uncommitted tracked changes, `?` = status failed/timed out, no branch outside a repo |
| `¥13.44` | `CC_HUD_EXTRA_FILE` first line, else DeepSeek balance, else GLM balance | when one of those applies |

Colors: Catppuccin Mocha, ANSI 256. Percent colour steps at 50 / 70 / 85.

## Install for a user (inside Claude Code)

```
/plugin marketplace add WaterTian/cc-hud
/plugin install cc-hud@cc-hud
/reload-plugins
/cc-hud:setup
```

`/cc-hud:setup` is itself an agent-executed procedure ([commands/setup.md](commands/setup.md)):
it copies `scripts/launcher.cjs` to `<cfg>/bin/cc-hud-launcher.cjs` and sets
`statusLine.command` to `node "<cfg>/bin/cc-hud-launcher.cjs"` in `<cfg>/settings.json`
(`cfg` = `$CLAUDE_CONFIG_DIR` or `~/.claude`). It is idempotent and merges into
existing settings. The launcher resolves the newest marketplace-installed cc-hud on
every tick, so upgrades never need a re-setup.

**Verify** (works in any shell; `<cfg>` expanded, refresh spawning disabled):

```bash
echo '{"model":{"id":"claude-fable-5-1"},"context_window":{"used_percentage":13}}' \
  | CC_HUD_NO_REFRESH=1 node "<cfg>/bin/cc-hud-launcher.cjs" | sed 's/\x1b\[[0-9;]*m//g'
```

| Output | Meaning |
| --- | --- |
| `[Fable 5.1] █▎░░░░░░░░ 13%` | installed and wired |
| `[cc-hud] plugin not found — run /cc-hud:setup` | no marketplace install in `<cfg>/plugins/installed_plugins.json` — do the `/plugin` steps first |
| empty | `node` not on `PATH` for the status-line shell, or the launcher file is missing |

**Upgrade**: `/plugin marketplace update cc-hud` then `/reload-plugins`. There is no
`/plugin update` slash command; from a terminal use `claude plugin update cc-hud@cc-hud`.

**Uninstall**: remove the `statusLine` key from `<cfg>/settings.json`, delete
`<cfg>/bin/cc-hud-launcher.cjs`, run `claude plugin uninstall cc-hud@cc-hud`, and
optionally `rm -rf ~/.cache/cc-hud`.

**Without the marketplace**: `npm i -g cc-hud` (or a source checkout + `npm run build`)
and point `statusLine.command` at `node "<absolute path>/dist/index.js"`; `/cc-hud:setup`
leaves such a command untouched.

## Runtime contract

The stdin contract below applies to `dist/index.js` (Claude) and to the npm
entry `dist/cli.js` with no arguments. Explicit CLI commands have ordinary
command output and nonzero exit codes on failure.

- **Input**: Claude Code's statusline JSON on stdin ([schema](https://code.claude.com/docs/en/statusline)).
  Fields read are typed in [src/types.ts](src/types.ts) (`StdinData`); everything else
  is ignored. Empty, malformed or non-object stdin renders the bare `[Claude]` line.
- **Output**: exactly one line on stdout, ANSI-256 coloured, then exit 0 — always, including
  on internal errors (the fallback line). A second line would corrupt the status bar.
- **Timing**: ~30 ms typical. Hard exit at 2 s (`setTimeout(...).unref()` in `src/index.ts`);
  git calls 800 ms each; inline third-party fetches 1.2 s. A slow source only drops its own segment.
- **No persistent state** in the process; one fresh process per tick.

## Files, processes, network

| Kind | What | When |
| --- | --- | --- |
| reads | `<transcript_path>` — last 64 KB only | every tick |
| reads | `<cfg>/plugins/installed_plugins.json` | every tick (launcher) |
| reads | `<cfg>/.credentials.json`, or macOS Keychain item `Claude Code-credentials` | refresher only; token used for one GET, never stored or refreshed |
| reads | `~/.config/cc-hud/config.json` `{ "proxy": "http://…" }` | refresher, when no proxy env var is set |
| reads | `$CC_HUD_EXTRA_FILE` first line | every tick, when set |
| writes | `~/.cache/cc-hud/claude-plan.json`, `ds-balance.json`, `glm-balance.json`, `mmx-quota.json` (`{ payload, ts, … }`, atomic tmp + rename) | on refresh / cache miss |
| writes | `<cfg>/bin/cc-hud-launcher.cjs`, `statusLine` in `<cfg>/settings.json` | `/cc-hud:setup` only |
| spawns | `git symbolic-ref`, `git --no-optional-locks status --porcelain` | every tick with a `current_dir` |
| spawns | `node dist/refresh.js claude` (detached, 8 s budget) | official backend, gauge cache > 5 min old, at most once per 30 s |
| spawns | `curl --config -` (token via stdin, never argv); `security find-generic-password` on macOS | refresher only |
| network | `GET https://api.anthropic.com/api/oauth/usage` (Bearer OAuth) | refresher only — **never inside a tick** |
| network | `GET api.deepseek.com/user/balance` · `open.bigmodel.cn` / `api.z.ai` `/api/biz/account/query-customer-account-report` · `api.minimaxi.com` / `api.minimax.io` `/v1/token_plan/remains` (Bearer `ANTHROPIC_AUTH_TOKEN`) | third-party backends, inline on a cache miss (≤ once per 5 min) |

Turn off all network on the official backend with `CC_HUD_NO_REFRESH=1`. Third-party
collectors have no switch; they only run when `ANTHROPIC_BASE_URL` matches their host.

## Environment variables

| Variable | Effect |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Claude Code's config dir (default `~/.claude`): credentials, `installed_plugins.json`, launcher location |
| `CC_HUD_NO_REFRESH=1` | Never spawn the refresher (no network at all on the official backend) |
| `CC_HUD_EXTRA_FILE=<path>` | Show the file's first line as the extra segment (beats DeepSeek / GLM) |
| `CC_HUD_CURL=<path>` | curl binary for proxied requests and the WAF fallback (default `curl`) |
| `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` / `all_proxy` | Refresher goes through curl only (native `fetch` ignores proxies, so it is skipped rather than leak the token) |
| `ANTHROPIC_BASE_URL` | Read-only: selects the backend by substring — `api.anthropic.com` / unset → official; `deepseek`; `bigmodel.cn` / `api.z.ai`; `minimax` (`minimaxi.com` → CN endpoint) |
| `ANTHROPIC_AUTH_TOKEN` | Read-only: bearer for the third-party balance / quota endpoints |

Boolean switches: `""`, `0`, `false` mean off; anything else means on (`src/env.ts`).

## Repository map

| Path | Role |
| --- | --- |
| `src/index.ts` | Entry: stdin → collectors in parallel → `render()` → single stdout write; fallback line on any error |
| `src/cli.ts` | npm `cc-hud` bin: no args → Claude renderer (help on a TTY); `<action> codex` → Codex commands; `--help` / `--version` |
| `src/codex-rpc.ts` | One temporary `codex app-server --stdio`: version gate, JSON-RPC, `readUserLayer` / `writeUserLayer`, 10 s deadline, kill on exit |
| `src/codex.ts` | `setup` / `check` / `restore` of `tui.status_line`, single-field backup `cc-hud-native.json` |
| `src/codex-theme.ts`, `assets/cc-hud.tmTheme` | Optional theme: `tui.theme` + `tui.status_line_use_colors`, theme file install with hash-tracked refresh, separate backup / restore |
| `plugin.json`, `skills/codex-setup/` | Codex plugin manifest and onboarding skill (Claude Code also loads the skill; its description defers to `/cc-hud:setup`); the existing marketplace repo serves both |
| `scripts/test.cjs` | `npm test` runner: enumerates `tests/*.test.{ts,cjs}` explicitly and enables type stripping |
| `src/stdin.ts` | stdin JSON → `StdinData` (`{}` unless a plain object) |
| `src/types.ts` | `StdinData` (fields read), `RenderData` (what the renderer needs) |
| `src/render.ts` | Pure renderer: `RenderData` → one coloured line; strips control chars from free text |
| `src/model.ts` | Model id → display name + `(1M)` variant (`claude-opus-4-7[1m]` → `Opus 4.7`, `1M`) |
| `src/transcript.ts` | Transcript tail → running subagents + latest main-chain effort |
| `src/git.ts` | Folder · branch · dirty marker, 800 ms per git call |
| `src/claude.ts` | Top-model weekly gauge: tick reads cache; `refreshClaudePlan()` does the OAuth GET (refresher) |
| `src/refresh.ts` | Detached refresher entry: `node refresh.js claude`, 8 s budget |
| `src/cache.ts` | `~/.cache/cc-hud/<name>.json`; `serveCache` (detached discipline) and `cachedInline` (inline discipline); atomic writes |
| `src/http.ts` | `fetchJson` (refresher: proxy → curl only, else fetch then curl on transport failure / 403) and `fetchJsonNative` (collectors, 1.2 s) |
| `src/balance.ts` / `glm.ts` / `mmx.ts` | DeepSeek / GLM / MiniMax: backend detection + response parsing on top of `cachedInline` |
| `src/env.ts` | `envFlag()` boolean switch parsing |
| `scripts/launcher.cjs` | Stable-path launcher copied by setup; resolves the newest installed cc-hud each tick |
| `commands/setup.md` | The `/cc-hud:setup` procedure (executed by Claude) |
| `.claude-plugin/plugin.json`, `marketplace.json` | Plugin + marketplace manifests (version bumped together with `package.json`) |
| `dist/` | Compiled output — **committed**; CI fails if it drifts from `src/` |
| `tests/` | `node:test` unit + end-to-end tests (`tests/index.test.ts` runs the real `dist/index.js`) |
| `.github/workflows/ci.yml` | ubuntu / windows / macos × Node 22 / 24 suite, dist-sync check, Node 18 / 20 runtime smoke |

## Development

```bash
npm install
npm test             # tsc build + node --test (the .ts tests need Node ≥ 22.6; dist/ itself runs on ≥ 18)
npm run test:stdin   # build + render one sample line
```

Render any payload without touching caches or the network:

```bash
echo '{"model":{"id":"claude-opus-4-7[1m]"},"effort":{"level":"max"},"context_window":{"used_percentage":42}}' \
  | CC_HUD_NO_REFRESH=1 node dist/index.js | sed 's/\x1b\[[0-9;]*m//g'
# [Opus 4.7 · Max] ████▎░░░░░ 42% (1M)
```

Exercise the refresher and inspect its cache: `node dist/refresh.js claude && cat ~/.cache/cc-hud/claude-plan.json`.

Release: bump the version in `package.json`, `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, and root `plugin.json`; `npm test`; commit (title ends with `(vX.Y.Z)`);
tag `vX.Y.Z`; push branch + tag; `gh release create`; `npm publish` (package `cc-hud`).

## Codex native footer

Requires Codex CLI ≥ 0.166.0 (checked with `codex --version`; `CC_HUD_CODEX`
overrides the executable, npm's `bin/codex.js` is accepted). Install:
`codex plugin marketplace add WaterTian/cc-hud` → `codex plugin add cc-hud@cc-hud`
→ new session → run the plugin's setup skill. Update: `codex plugin marketplace
upgrade cc-hud` (installed plugin files refresh too).

Commands — `node dist/cli.js <action> codex` from the plugin dir or a checkout,
or the npm `cc-hud` bin: `setup`, `check` (exit 0 = active), `restore`, `theme`,
`restore-theme`; also `--help` / `--version`. Errors go to stderr with exit 1.
A failed command can leave a backup, an installed asset, or a saved user-layer
value (for example, when another layer overrides it); changes are not rolled
back automatically. With no arguments the bin is the Claude renderer when
stdin is a pipe and prints help on a TTY.

| Command | Reads / writes | Behaviour |
| --- | --- | --- |
| `setup codex` | `tui.status_line` in the user `config.toml`: `config/read` → `config/batchWrite` (`expectedVersion` guard) → re-read | Preset `model-with-reasoning`, `context-used`, `five-hour-limit`, `weekly-limit`, `project-name`, `git-branch`. Idempotent. Writes `$CODEX_HOME/cc-hud-native.json` `{ schema, previous, applied }` (mode 600) only when it first takes the field over; refreshes `applied` when a release changed the preset. A footer edited since, or overridden by another config layer, is reported — never overwritten. |
| `check codex` | read only | "Configured" iff both the user layer and the effective config equal the preset. No Codex spawn when `$CODEX_HOME` does not exist. |
| `restore codex` | writes `previous` back (JSON null removes a key that was absent), deletes the backup | Treats the current preset or the one previously applied as "ours"; anything else is a user edit and is left alone. |
| `theme codex` | `tui.theme = "cc-hud"`, `tui.status_line_use_colors = true`; installs `assets/cc-hud.tmTheme` → `$CODEX_HOME/themes/cc-hud.tmTheme` | Backup `$CODEX_HOME/cc-hud-theme.json` `{ schema, theme, colors, asset }`, even when the settings already match; `asset` is the sha256 of the file installed, so a newer release replaces a file cc-hud wrote but refuses a user-edited one (the message names the path to delete). The legacy theme name `cc-hud-mocha` counts as ours. |
| `restore-theme codex` | writes the saved theme / colors back, deletes the backup, keeps the theme file | |

Process model: one temporary `codex app-server --stdio` per command (cwd and
`CODEX_HOME` = the config dir), JSON-RPC over stdio: `initialize` → requests →
SIGTERM, SIGKILL after 500 ms; 10 s overall deadline. Server notifications and
server-initiated requests are ignored; server error bodies are never printed
(they can carry private config values). No thread, model, account or usage
requests. Normal Codex sessions run with no cc-hud process, hook, MCP or `-c`
flag.

Semantics: Codex's limit percentages are *remaining*, the Claude HUD's are
*used*; Codex controls separators and colors (no progress bar, no
usage-threshold colors); during `/compact` it can briefly show 0% used.

Tests: `tests/codex.test.ts` drives the CLI against
`tests/fixtures/fake-codex.cjs`, a stand-in app-server with hang / race /
write-error / version switches. `CC_HUD_CODEX_LIVE_TEST=1 npm test` adds a real
round-trip against an isolated `CODEX_HOME` with an offline provider (no auth
or model requests); it needs a local Codex ≥ 0.166.0.

## Invariants — keep these when changing code

1. **One stdout write per tick** — go through `emit()` in `src/index.ts`; never `console.log` elsewhere.
2. **No network inside a tick on the official backend** — `src/claude.ts` reads the cache; fetching belongs in `refreshClaudePlan()`. Inline collectors keep `INLINE_TIMEOUT_MS` (1.2 s) so the 2 s hard exit is never reached.
3. **Unknown is not zero** — missing usage renders `—%`, a failed `git status` renders `?`, a stale gauge gets `~`. Never collapse a failure into a reassuring value.
4. **Every IO in try/catch**, degrading to a shorter line. The process must exit 0 with one line even when everything fails.
5. **Free text is untrusted** — anything from stdin, the transcript, git or an API passes through `clean()` in `src/render.ts`.
6. **Zero dependencies, Node ≥ 18 at runtime** — Node built-ins only; no Node 22-only APIs in `src/`.
7. **`dist/` is committed** — run `npm test` (which builds) and commit `dist/` with the source change.
8. **Secrets stay out of argv and logs** — curl gets its config on stdin; tokens are never written to the cache.
