# cc-hud

Compact statusline HUD for [Claude Code](https://claude.ai/claude-code) — context usage, active agents, and rate limits at a glance.

精简的 Claude Code 状态栏插件 — 实时显示上下文用量、活跃代理、速率限制。

## Preview / 预览

```
[Opus 4.6] ████▌░░░░░ 45% │ ◐ explore [haiku] │ 5h: 25% 7d: 10%
```

- **Progress bar** — 1/8-precision Unicode blocks (`▏▎▍▌▋▊▉█`), 80-level granularity
- **Color scheme** — [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) 4-stop gradient:
  - 🟢 ≤50% green `#a6e3a1` · 🟡 51-70% yellow `#f9e2af` · 🟠 71-85% peach `#fab387` · 🔴 >85% red `#f38ba8`
- **Agents** — shows running subagents with type and model
- **Rate limits** — 5-hour and 7-day usage (Pro/Max only)

## Install / 安装

Requires Node.js ≥ 18.

```bash
git clone https://github.com/WaterTian/cc-hud.git
cd cc-hud
npm install
npm run build
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

Restart Claude Code to see the HUD.

## Tech Stack / 技术栈

- TypeScript + Node.js
- Zero external dependencies — only Node.js built-in modules
- Built for Windows 11 compatibility (no Bun)

## Development / 开发

```bash
npm run build      # compile TypeScript
npm run dev        # watch mode
npm test           # run tests (node --test)
```

Test with sample data:

```bash
echo '{"model":{"display_name":"Opus 4.6"},"context_window":{"used_percentage":45},"rate_limits":{"five_hour":{"used_percentage":25}}}' | node dist/index.js
```

## License

MIT
