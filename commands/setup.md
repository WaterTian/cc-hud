---
name: setup
description: Configure cc-hud statusline in Claude Code settings
---

Configure cc-hud as the Claude Code statusline. Since v0.5.0, cc-hud uses a stable-path **launcher** so future plugin upgrades do **not** require re-running this setup — the launcher resolves whichever cc-hud version is currently installed on each tick.

Steps below are idempotent — safe to re-run.

## Step 1 — Resolve paths

Resolve Claude Code's config directory (`CLAUDE_CONFIG_DIR` when set, otherwise `~/.claude`), with backslashes normalized to forward slashes — Claude Code runs `statusLine.command` through Git Bash on Windows, where an unquoted `C:\Users\…` loses its backslashes:

```bash
node -e 'const o=require("os"),p=require("path");console.log((process.env.CLAUDE_CONFIG_DIR||p.join(o.homedir(),".claude")).replace(/\\/g,"/"))'
```

Call the output **CFG** (e.g. `/Users/me/.claude` or `C:/Users/me/.claude`). From it derive:

- Launcher source: `${CLAUDE_PLUGIN_ROOT}/scripts/launcher.cjs`
- Launcher destination (stable path): `<CFG>/bin/cc-hud-launcher.cjs`
- User settings: `<CFG>/settings.json`

## Step 2 — Install the launcher

Always overwrite (the launcher is a managed file):

1. `mkdir -p "<CFG>/bin"`
2. Read `${CLAUDE_PLUGIN_ROOT}/scripts/launcher.cjs` verbatim, then Write the **exact same content** to `<CFG>/bin/cc-hud-launcher.cjs`. Do not modify or annotate it.

The launcher reads `<CFG>/plugins/installed_plugins.json` on each tick and spawns the latest installed cc-hud's `dist/index.js`. Its contents stay valid across cc-hud versions, so this file rarely needs rewriting.

## Step 3 — Update `statusLine` in `<CFG>/settings.json`

Read `<CFG>/settings.json` (treat as `{}` if missing or unreadable). The target merged config:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"<CFG>/bin/cc-hud-launcher.cjs\"",
    "padding": 2
  }
}
```

Substitute `<CFG>` with the **absolute, forward-slash path** from Step 1 — do not leave `~`, `${HOME}` or `%USERPROFILE%` in the JSON. Keep the escaped inner quotes: the path is quoted so a space in the home directory (any OS) or a Windows drive path survives the shell.

Branch on the current `statusLine.command`:

- **Missing** → merge in the target. Tell user: `✓ statusLine registered (cc-hud launcher)`.
- **Already equals the target** (points at `cc-hud-launcher.cjs`, quoted, forward slashes) → leave untouched. Tell user: `✓ launcher already registered (idempotent skip)`.
- **Points at `cc-hud-launcher.cjs` but unquoted or with backslashes** (written by an older setup) → overwrite with the target. Tell user: `✓ statusLine command normalized (quoted path, forward slashes)`.
- **Points at `cc-hud-launcher.cjs` under a different config dir** (user changed `CLAUDE_CONFIG_DIR` since the last setup) → overwrite with the target. Tell user: `✓ statusLine moved to the current config dir`.
- **Direct cc-hud path** (contains `cc-hud` and `dist/index.js` or `dist\index.js`): migrate **only** the old version-pinned marketplace form, i.e. a path under `<CFG>/plugins/cache/`; any other `dist/index.js` path is a from-source checkout and must stay untouched. For a cache path, also check the launcher can resolve the install before replacing it:

  ```bash
  node -e 'process.exit(require("<CFG>/bin/cc-hud-launcher.cjs").findCcHudEntry() ? 0 : 1)'
  ```

  - exit 0 (a marketplace install is registered) → overwrite with the target. Tell user: `✓ migrated statusLine from version-pinned path to stable launcher — future cc-hud upgrades no longer need re-running /cc-hud:setup`.
  - exit 1, or the path is not under `<CFG>/plugins/cache/` (a from-source checkout) → **leave untouched**. Tell user: `ℹ statusLine points at a from-source cc-hud checkout — left as is (the launcher only resolves plugins installed via /plugin install). Install from the marketplace and re-run /cc-hud:setup to switch to the launcher.`
- **cc-bot shim** (contains `cc-bot` and `statusline.js`) → leave untouched. Tell user: `ℹ cc-bot's statusline shim already wraps cc-hud automatically — no change needed`.
- **Other non-empty value** → ask via `AskUserQuestion` whether to overwrite (default = keep existing). On "keep", skip the write and tell user the launcher is installed at `<CFG>/bin/cc-hud-launcher.cjs` for manual wiring.

When writing, **merge** — never wipe other top-level keys in `settings.json`.

## Step 4 — Confirm

Tell the user (single block):

```
✓ cc-hud launcher → <CFG>/bin/cc-hud-launcher.cjs
✓ statusLine      → node "<CFG>/bin/cc-hud-launcher.cjs"

Run /reload-plugins to see the HUD.

Future upgrades:
  /plugin marketplace update cc-hud     (refreshes the marketplace in the panel and updates plugins installed from it)
  /reload-plugins
(no need to re-run /cc-hud:setup unless a release note says otherwise; there is no /plugin update slash command — use the panel's "Update now" or `claude plugin update cc-hud@cc-hud` in a terminal if the Installed tab still shows the old version.)
```
