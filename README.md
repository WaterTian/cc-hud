# Claude Code HUD &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; CC-HUD
A compact, single-line statusline for [Claude Code](https://claude.ai/claude-code).

一个精简的 Claude Code 单行状态栏插件。

```
[Opus 4.6] ████▌░░░░░ 45% │ ◐ explore [haiku] │ 5h: 25% 7d: 10%
```

> **Model** &rarr; **Context** &rarr; **Agents** &rarr; **Rate Limits** &mdash; everything you need, nothing you don't.

---

### Features

| | Feature | Detail |
|---|---|---|
| **`█▌`** | Context bar | 1/8-precision Unicode blocks, 80-level granularity |
| **`🎨`** | Color | [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) 4-stop gradient |
| **`◐`** | Agents | Running subagents with type & model |
| **`%`** | Rate limits | 5h / 7d usage (Pro/Max) |
| **`0`** | Dependencies | Zero. Node.js built-in modules only |

---

### Install

Inside Claude Code:

```
/plugin marketplace add WaterTian/cc-hud
/plugin install cc-hud
/cc-hud:setup
```

Restart Claude Code. Done.

<details>
<summary>Manual install</summary>

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

</details>

---

### How It Works

```
Claude Code ─── stdin JSON ──→ cc-hud ──→ stdout ──→ status bar
             ↘ transcript JSONL (tail 64KB → active agents)
```

|  | |
|---|---|
| Stateless | Each call is a fresh process — zero memory leaks |
| Fast | ~60ms exec, within 300ms debounce |
| Safe | 2s hard timeout, all IO try-catch |

---

### Development

```bash
npm run build      # compile
npm test           # 13 tests
```

---

### License

MIT
