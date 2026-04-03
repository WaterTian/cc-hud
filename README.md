# cc-hud

A compact, single-line statusline for [Claude Code](https://claude.ai/claude-code).

一个精简的 Claude Code 单行状态栏插件。

```
[Opus 4.6] ████▌░░░░░ 45% │ ◐ explore [haiku] │ 5h: 25% 7d: 10%
```

| What You See | Source |
|---|---|
| Model name | `[Opus 4.6]` from stdin |
| Context health | 1/8-precision bar, [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) 4-stop gradient |
| Active agents | Parsed from transcript JSONL |
| Rate limits | 5h / 7d usage (Pro/Max) |

## Install

Node.js ≥ 18 required.

```bash
git clone https://github.com/WaterTian/cc-hud.git
cd cc-hud && npm install && npm run build
```

Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/cc-hud/dist/index.js",
    "padding": 2
  }
}
```

Restart Claude Code.

## How It Works

```
Claude Code → stdin JSON → cc-hud → stdout → status bar
           ↘ transcript JSONL (agents)
```

Zero dependencies. TypeScript + Node.js built-in modules only.

## Development

```bash
npm run build      # compile
npm test           # node --test (13 tests)
```

## License

MIT
