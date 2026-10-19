# CLAUDE.md — cc-hud 项目指令

## 项目概述

cc-hud — 精简的 Claude Code 单行状态栏插件，显示模型名称、思考深度（effort）、上下文用量、活跃子代理、速率限制（5h / 7d / spend cap）、顶级模型周用量、工作区（目录 · 分支）与会话费用。

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
commands/setup.md           — 安装配置命令（v0.5.0+ 写 launcher 到 <cfg>/bin/；cfg = $CLAUDE_CONFIG_DIR 或 ~/.claude）
src/
  index.ts                  — 入口：stdin → 解析 → 渲染 → stdout（全程只写一次 stdout，异常路径也输出最简行）
  stdin.ts                  — 解析 stdin JSON（非普通对象一律视为 {}）
  transcript.ts             — 读 transcript JSONL 尾部 64KB，提取活跃 agent + 思考深度（effort）
  render.ts                 — 单行紧凑渲染（1/8 精度进度条 + ANSI 颜色；自由文本先剥控制字符）
  model.ts                  — 模型名美化（claude-opus-4-7[1m] → Opus 4.7 (1M)）
  git.ts                    — 工作区段：目录名 + 分支 + 脏标记（800ms 预算，--no-optional-locks；status 失败 = 未知，不当 clean）
  claude.ts                 — 顶级模型周用量（OAuth usage API）：tick 只读缓存，网络全在 refresh.ts
  refresh.ts                — 分离式刷新子进程入口（node refresh.js <kind>，8s 预算，拉取后写缓存）
  cache.ts                  — 缓存约定：~/.cache/cc-hud/<name>.json、TTL / 冷却 / stale 判定、原子写、spawn 刷新子进程
  http.ts                   — JSON GET：原生 fetch 优先，传输失败或 WAF 403 回退 curl（代理只在 curl 路径生效）
  env.ts                    — 布尔环境变量开关（"" / "0" / "false" 视为关）
  balance.ts / glm.ts / mmx.ts  — DeepSeek / GLM / MiniMax 余额或配额采集（缓存未命中时 tick 内拉取，1.2s 预算）
  types.ts                  — 类型定义
scripts/launcher.cjs        — 稳定路径 launcher（setup 复制到 <cfg>/bin/cc-hud-launcher.cjs；找不到插件时打印一行提示而非空白）
dist/                       — 编译输出（提交到仓库，CI 校验与 src 同步）
tests/*.test.ts(.cjs)       — node:test 单元 + 端到端测试（render / model / transcript / git / http / cache / env / claude / balance / glm / mmx / launcher / index）
```

## 数据流

```
Claude Code → stdin JSON → cc-hud → stdout → 状态栏
           ↘ transcript JSONL（尾部 64KB → 活跃 agent + 思考深度 effort）
           ↘ git symbolic-ref / status（目录 · 分支*，800ms 预算）
           ↘ ~/.cache/cc-hud/claude-plan.json（只读；过期则 spawn detached refresh.js 后台拉取写回）
```

## 性能与稳定性

- **无状态** — 每次调用都是独立进程，无内存泄漏风险
- **尾部读取** — 只读 transcript 最后 64KB，不全量解析
- **字符串预过滤** — 只对含 `"Agent"` / `"tool_result"` / `"effort"` 的行做 JSON.parse（assistant 行基本都带 effort，省掉的主要是 user / progress 等行）
- **2s 硬超时** — setTimeout + unref()，异常时强制退出不阻塞 Claude Code；第三方采集器的 inline fetch 预算 1.2s，超时只丢该段不丢整行
- **只写一次 stdout** — 多写一行会污染状态栏；异常路径也只输出最简 `[Claude]` 行
- **所有 IO try-catch** — 失败静默降级，不崩溃
- **tick 内零网络（官方后端）** — claude.ts 只读缓存，网络请求全部由 detached 刷新子进程完成；OAuth usage 接口的 WAF 会 403 拦截 Node TLS 指纹，需 curl 回退（2026-07 实测）

## 环境

- Windows 11，运行时使用 Node.js，不要使用 Bun（内存崩溃问题）
- Claude Code 必须通过 npm 安装（`npm i -g @anthropic-ai/claude-code`），不要使用原生安装器（native installer）
  - 原生安装器的 `claude.exe` 内嵌 Bun 运行时，会触发 `pas panic: deallocation did fail` 崩溃
  - npm 版使用系统 Node.js，稳定无此问题
