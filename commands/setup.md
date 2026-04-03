---
name: setup
description: Configure cc-hud statusline in Claude Code settings
---

Set up the cc-hud statusline. Write the following `statusLine` config into the user's `~/.claude/settings.json` (merge with existing settings, do not overwrite other fields):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/index.js",
    "padding": 2
  }
}
```

Use `${CLAUDE_PLUGIN_ROOT}` which resolves to the plugin's install directory.

After writing the config, tell the user to restart Claude Code to see the HUD.
