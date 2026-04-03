# CLAUDE.md — cc-hud 项目指令

## 项目概述

cc-hud — 精简的 Claude Code 单行状态栏插件，显示模型名称、上下文用量、活跃子代理、速率限制。

参考项目：https://github.com/jarrodwatts/claude-hud/

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript（strict） |
| 运行时 | Node.js ≥ 18 |
| 构建 | tsc（ESM, ES2022） |
| 依赖 | 零外部依赖，仅 Node.js 内置模块 |
| 测试 | node --test（内置测试运行器） |
| 配色 | Catppuccin Mocha（ANSI 256 色） |

## 项目结构

```
.claude-plugin/plugin.json  — 插件清单
commands/setup.md           — 安装配置命令
src/
  index.ts                  — 入口：stdin → 解析 → 渲染 → stdout
  stdin.ts                  — 解析 stdin JSON
  transcript.ts             — 读 transcript JSONL 尾部 64KB，提取活跃 agent
  render.ts                 — 单行紧凑渲染（1/8 精度进度条 + ANSI 颜色）
  types.ts                  — 类型定义
dist/                       — 编译输出（提交到仓库）
tests/render.test.ts        — 渲染逻辑单元测试
```

## 数据流

```
Claude Code → stdin JSON → cc-hud → stdout → 状态栏
           ↘ transcript JSONL（尾部 64KB → 活跃 agent）
```

## 性能与稳定性

- **无状态** — 每次调用都是独立进程，无内存泄漏风险
- **尾部读取** — 只读 transcript 最后 64KB，不全量解析
- **字符串预过滤** — 跳过不含 agent 数据的行，减少 ~90% JSON.parse
- **2s 硬超时** — setTimeout + unref()，异常时强制退出不阻塞 Claude Code
- **所有 IO try-catch** — 失败静默降级，不崩溃

## 环境

- Windows 11，运行时使用 Node.js，不要使用 Bun（内存崩溃问题）
- Claude Code 必须通过 npm 安装（`npm i -g @anthropic-ai/claude-code`），不要使用原生安装器（native installer）
  - 原生安装器的 `claude.exe` 内嵌 Bun 运行时，会触发 `pas panic: deallocation did fail` 崩溃
  - npm 版使用系统 Node.js，稳定无此问题
