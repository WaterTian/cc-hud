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
- **Direct cc-hud path** (contains `cc-hud` and `dist/index.js` or `dist\index.js`) — either the old version-pinned marketplace form **or** a from-source checkout; the launcher can only resolve the former, so check which before touching it:

  ```bash
  node -e 'process.exit(require("<CFG>/bin/cc-hud-launcher.cjs").findCcHudEntry() ? 0 : 1)'
  ```

  - exit 0 (a marketplace install is registered) → overwrite with the target. Tell user: `✓ migrated statusLine from version-pinned path to stable launcher — future cc-hud upgrades no longer need re-running /cc-hud:setup`.
  - exit 1 (nothing registered — a from-source checkout) → **leave untouched**. Tell user: `ℹ statusLine points at a from-source cc-hud checkout that the launcher cannot resolve (it only finds plugins installed via /plugin install) — left as is. Install from the marketplace and re-run /cc-hud:setup to switch to the launcher.`
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
  /plugin marketplace update cc-hud
  /reload-plugins
(no need to re-run /cc-hud:setup unless a release note says otherwise.)
```
