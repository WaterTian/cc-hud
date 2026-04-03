<p align="center">
  <img src="cc-hud-preview.png" alt="cc-hud preview" width="700" />
</p>

<h1 align="center">CC-HUD</h1>

<p align="center">
  A compact, single-line statusline for <a href="https://claude.ai/claude-code">Claude Code</a><br/>
  精简的 Claude Code 单行状态栏插件
</p>

<p align="center">
  <b>Model</b> &rarr; <b>Context</b> &rarr; <b>Agents</b> &rarr; <b>Rate Limits</b> &mdash; everything you need, nothing you don't.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="zero deps" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-blue" alt="node >= 18" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT" />
</p>

---

## Why CC-HUD? &nbsp;/&nbsp; 为什么做 CC-HUD？

<table>
<tr>
<td width="50%">

**The Problem**

Claude Code's native installer bundles [Bun](https://bun.sh), which has a known memory allocator bug on **Windows** ([oven-sh/bun#25082](https://github.com/oven-sh/bun/issues/25082)), causing frequent `pas panic` crashes.

Statusline plugins like [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) run **on every tick**, amplifying memory pressure and making crashes far more likely.

</td>
<td width="50%">

**问题**

Claude Code 原生安装器内嵌 [Bun](https://bun.sh)，在 **Windows** 上存在已知内存分配器 bug（[oven-sh/bun#25082](https://github.com/oven-sh/bun/issues/25082)），频繁触发 `pas panic` 崩溃。

而 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud) 等状态栏插件**每次 tick 都会执行**，加剧内存压力，使崩溃更加频繁。

</td>
</tr>
<tr>
<td>

**The Solution**

CC-HUD is a **crash-free alternative** — pure Node.js, zero dependencies, stateless per-call, ~60ms execution, 2s hard timeout.

</td>
<td>

**解决方案**

CC-HUD 是**不会崩溃的替代方案** — 纯 Node.js、零依赖、无状态调用、~60ms 执行、2s 硬超时。

</td>
</tr>
</table>

> [!TIP]
> On Windows, use `npm i -g @anthropic-ai/claude-code` instead of the native installer to avoid Bun crashes.
>
> Windows 用户建议用 `npm i -g @anthropic-ai/claude-code` 代替原生安装器，彻底规避 Bun 崩溃。

---

## Features

| | Feature | Detail |
|---|---|---|
| `█▌` | **Context bar** | 1/8-precision Unicode blocks, 80-level granularity |
| `🎨` | **Color** | [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) 4-stop gradient |
| `◐` | **Agents** | Running subagents with type & model |
| `%` | **Rate limits** | 5h / 7d usage (Pro/Max) |
| `0` | **Dependencies** | Zero. Node.js built-in modules only |

---

## Install

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

## How It Works

```
Claude Code ─── stdin JSON ──→ cc-hud ──→ stdout ──→ status bar
             ↘ transcript JSONL (tail 64KB → active agents)
```

| | |
|---|---|
| **Stateless** | Each call is a fresh process — zero memory leaks |
| **Fast** | ~60ms exec, within 300ms debounce |
| **Safe** | 2s hard timeout, all IO try-catch |

---

## Development

```bash
npm run build      # compile
npm test           # 13 tests
```

---

## License

MIT
