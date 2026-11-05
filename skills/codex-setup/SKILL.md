---
name: codex-setup
description: Set up, check, restore, diagnose misleading quota colors, or style the cc-hud native footer in Codex CLI when requested. Claude Code uses /cc-hud:setup instead.
---

Use the packaged CLI; no global npm installation is needed. Resolve the plugin
root two directories above this SKILL.md, then run:

```sh
node "<plugin-root>/dist/cli.js" setup codex
node "<plugin-root>/dist/cli.js" check codex
```

For a request to check only, run only `check`. For a request to restore the
previous footer, run `restore codex` instead of setup. Report the actual result.

Relay the setup/check color note: Codex colors 5h and weekly by the active
syntax theme, independent of remaining quota. For a color complaint, check
the active `tui.theme` and `tui.status_line_use_colors` before diagnosing it;
use the color the user reports, never infer the visible color from a percentage.
For a requested visual match or a misleading red/green quota color, run
`theme codex`. This installs the bundled native CC-HUD theme,
uses a fixed neutral teal accent for limits, and also changes code highlighting.
Tell the user to open `/theme`, search `cc-hud`, and press Enter for a
live preview/application. Theme names aren't slash-command arguments.
Use `restore-theme codex` to restore prior theme preferences when requested.
Keep theme changes optional; ordinary footer setup preserves the user's theme.
Run `theme codex` again after an upgrade to refresh an unedited installed theme.

Setup requires Node >=18 and Codex CLI >=0.166.0. It edits only
`tui.status_line` through Codex's configuration API and saves the previous
field in `$CODEX_HOME/cc-hud-native.json` (default `~/.codex`). If Codex is not
on PATH, set `CC_HUD_CODEX` to its executable or npm `bin/codex.js` path.

Tell the user to restart Codex to load the saved footer. Display, refresh,
theme, quota data, and truncation stay native. Codex percentages for limits
are remaining quota. Neither the native nor bundled theme changes color by
percentage: 1% left and 93% left share a color. Its appearance approximates
the Claude HUD. Plugin updates need no setup rerun unless the release changes
the preset.

If setup or restore detects a later user edit, leave that configuration in
place and report the conflict. Do not rewrite TOML manually or change other
settings, auth, hooks, MCP servers, or the Codex daemon.
