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
| `src/cli.ts` | npm entry; no args imports the Claude entry, explicit setup/check/restore dispatches to Codex configuration |
| `src/codex.ts`, `src/codex-rpc.ts` | One-time native Codex footer setup/check/restore through its config API; no model or account calls |
| `src/codex-theme.ts`, `assets/cc-hud.tmTheme` | Optional native palette, one-time theme configuration and separate restore |
| `plugin.json`, `skills/codex-setup/` | Portable Codex plugin manifest and onboarding skill; existing `.claude-plugin/marketplace.json` is compatible with Codex |
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

Requires Codex CLI >=0.166.0. Install with `codex plugin marketplace add
WaterTian/cc-hud`, then `codex plugin add cc-hud@cc-hud`; start a new session
and run the plugin setup skill. Git marketplace update: `codex plugin
marketplace upgrade cc-hud`; installed plugin files refresh too.

The packaged command is `node dist/cli.js setup codex` (`check` / `restore`
are the other actions); npm users can use `cc-hud` directly. Only
`tui.status_line` is edited, using `config/read` and atomic
`config/batchWrite` with `expectedVersion`. JSON null removes an originally
absent key. The previous field and applied preset are stored with mode 600 in
`$CODEX_HOME/cc-hud-native.json`, never a copy of the full config. Later user
edits are not overwritten by repeat setup or restore.

`CC_HUD_CODEX` overrides the executable (also accepts npm `bin/codex.js`).
One temporary stdio app-server process is used per command, under a 10s
request deadline. It receives no thread, model, account, or usage requests;
stderr and private config values aren't logged. It is terminated on exit.
Normal Codex sessions use their own native data and rendering, without a
cc-hud process, hooks, MCP, or `-c` flags. The preset preserves the theme:
`model-with-reasoning`, `context-used`, `five-hour-limit`, `weekly-limit`,
`project-name`, `git-branch`. Codex's quota figures mean remaining usage;
Claude's mean used usage. Exact glyph/color/layout parity is not supported.

Optional palette: `cc-hud theme codex` installs the 2.5 KB
`assets/cc-hud.tmTheme` into `$CODEX_HOME/themes/` and sets `tui.theme`
and `tui.status_line_use_colors`. The previous preferences are saved to
`$CODEX_HOME/cc-hud-theme.json` (mode 600); `restore-theme codex` restores them
and retains the reusable theme file. Later user edits and edited assets are
not overwritten. Select `cc-hud` in `/theme` to apply to a running TUI.
This native theme affects code highlighting too. Footer colors identify
fields, without Claude's dynamic percentage thresholds. Plain footer setup
does not opt into a theme change.

`CC_HUD_CODEX_LIVE_TEST=1 npm test` opts into a real Codex config round-trip
with an isolated config and an offline provider; no auth/model requests.
`scripts/test.cjs` enumerates TS and CJS tests explicitly, including on
Windows, and enables type stripping on Node 22.6+.

## Invariants — keep these when changing code

1. **One stdout write per tick** — go through `emit()` in `src/index.ts`; never `console.log` elsewhere.
2. **No network inside a tick on the official backend** — `src/claude.ts` reads the cache; fetching belongs in `refreshClaudePlan()`. Inline collectors keep `INLINE_TIMEOUT_MS` (1.2 s) so the 2 s hard exit is never reached.
3. **Unknown is not zero** — missing usage renders `—%`, a failed `git status` renders `?`, a stale gauge gets `~`. Never collapse a failure into a reassuring value.
4. **Every IO in try/catch**, degrading to a shorter line. The process must exit 0 with one line even when everything fails.
5. **Free text is untrusted** — anything from stdin, the transcript, git or an API passes through `clean()` in `src/render.ts`.
6. **Zero dependencies, Node ≥ 18 at runtime** — Node built-ins only; no Node 22-only APIs in `src/`.
7. **`dist/` is committed** — run `npm test` (which builds) and commit `dist/` with the source change.
8. **Secrets stay out of argv and logs** — curl gets its config on stdin; tokens are never written to the cache.
