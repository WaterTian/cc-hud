---
name: setup
description: Configure cc-hud statusline in Claude Code settings
---

Set up the cc-hud statusline by adding the following to your Claude Code settings file (`~/.claude/settings.json`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node PLUGIN_DIR/dist/index.js",
    "padding": 2
  }
}
```

Replace `PLUGIN_DIR` with the absolute path to the cc-hud plugin directory. On Windows, use forward slashes in the path.

After saving, restart Claude Code to see the HUD.
