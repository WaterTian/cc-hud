# CLAUDE.md — cc-hud 项目指令

## 项目概述

cc-hud — 精简的 Claude Code 单行状态栏插件，显示模型名称、思考深度（effort）、上下文用量、活跃子代理、速率限制（5h / 7d / spend cap）、顶级模型周用量、工作区（目录 · 分支）。

面向 AI agent 的英文参考在 `AGENTS.md`（运行契约、读写的文件 / 进程 / 网络端点、环境变量、验证与调试步骤、改代码要守的不变量）。改动行为或接口时，README / AGENTS.md / 本文件一起更新。

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
  cache.ts                  — 缓存约定：~/.cache/cc-hud/<name>.json、原子写；两种纪律：detached（serveCache：tick 只读 + spawn 刷新子进程，TTL / 冷却 / stale 判定）与 inline（cachedInline：采集器 tick 内拉取，失败退回旧值）
  http.ts                   — JSON GET：fetchJson（刷新子进程用）配了代理只走 curl（Node fetch 不认代理，先试就会带着 token 直连），curl 失败不回退；无代理时原生 fetch 优先，传输失败或 WAF 403 回退 curl。fetchJsonNative（采集器用）仅原生 fetch，INLINE_TIMEOUT_MS = 1.2s，不起 curl
  env.ts                    — 布尔环境变量开关（"" / "0" / "false" 视为关）
  balance.ts / glm.ts / mmx.ts  — DeepSeek / GLM / MiniMax 余额或配额采集：只剩后端判定 + 响应解析，缓存与拉取走 cache.cachedInline + http.fetchJsonNative（未命中时 tick 内拉取，1.2s 预算，失败退回旧值）
  types.ts                  — 类型定义
scripts/launcher.cjs        — 稳定路径 launcher（setup 复制到 <cfg>/bin/cc-hud-launcher.cjs；找不到插件时打印一行提示而非空白）
dist/                       — 编译输出（提交到仓库，CI 校验与 src 同步）
tests/*.test.ts(.cjs)       — node:test 单元 + 端到端测试（render / model / transcript / git / http / cache / env / claude / balance / glm / mmx / launcher / index）
.claude-plugin/marketplace.json — marketplace 入口（`/plugin marketplace add WaterTian/cc-hud` 读它；发版时和 plugin.json 一起 bump）
.github/workflows/ci.yml    — CI：ubuntu / windows / macos × node 22 / 24 测试矩阵 + dist 同步检查 + node 18 / 20 运行时 smoke
AGENTS.md                   — 面向 AI agent 的英文参考（运行契约 / 文件与网络 / 环境变量 / 验证与调试 / 不变量），与本文件同步维护
scripts/ds-balance-cache.sh — DeepSeek 余额写成一行文件给 CC_HUD_EXTRA_FILE 的示例脚本
scripts/mmx-debug.mjs       — MiniMax 配额接口调试脚本（不进 src）
preview.html / cc-hud-preview.{svg,png} — README 顶部预览图源文件与产物（图变了再改 README 里的 ?v= 缓存参数）
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

## Codex CLI 原生预设

### 本次交接（2026-11-05）

- 用户要求：官方 Codex CLI、原生、轻量、高效精简；接受与 Claude HUD 近似样式。用户侧主题统一叫 **cc-hud**，不带 Mocha 后缀；不引入 fork、tmux、常驻服务或额外额度请求。
- 本批只提交、推送供另一个 Claude 对话审查，**不打 tag、不建 Release、不发布 npm**；版本号暂留 `0.10.0`。npm 的 `0.10.0` 已在本会话较早阶段发布，不能重复发布。
- 最新验证：`CC_HUD_CODEX_LIVE_TEST=1 npm test` **243/243 通过**；原生 TUI 已实测主题选择、颜色、真实对话刷新、压缩、新建/恢复会话；配置 API 的隔离读写/恢复通过。Git diff 无空白错误。跨平台 CI 尚待推送后验证。
- 当前老 Mac 默认 CLI 已从 app 内置 `0.166.0-alpha.6` 切到 npm 稳定版 `0.166.0`；app 内置旧版保留。共享 daemon 仍为 `0.166.0-alpha.5.1`，未重启，避免中断其他工作。
- 本地插件已从此仓库安装并启用，缓存 `~/.codex/plugins/cache/cc-hud/cc-hud/0.10.0/`；当前原生主题配置为 `cc-hud`。原设置分别保存在 `~/.codex/cc-hud-native.json`、`~/.codex/cc-hud-theme.json`，仅含所管字段。
- 视觉边界：原生分隔符、文字格式、百分比含义不能完全复刻 Claude；Codex 额度显示剩余，Claude 显示已用。原生颜色区分字段，不按百分比动态变色；`/compact` 期间可能短暂显示 0% 已用。
- 后续审查优先核对：配置幂等与恢复、并发编辑保护、主题旧名迁移、Node ≥18 / Windows 路径、插件安装/更新和产物打包。不要将测试终端截图或浏览器预览当成用户当前窗口已重绘的证据。

- 保留官方 CLI，采用近似样式：模型/深度 → 上下文已用 → 主/次额度剩余 → 项目 → 分支。
- Codex 原生负责数据、配色、显示和刷新。无额外常驻进程、hook、MCP、会话扫描或额度 API；不承诺 Claude 版的进度条或完全相同样式。
- root `plugin.json` + `skills/codex-setup/SKILL.md` 提供 Codex 插件和设置 skill，复用现有 marketplace。安装用 `codex plugin marketplace add WaterTian/cc-hud`、`codex plugin add cc-hud@cc-hud`；marketplace `upgrade` 会同步更新已装插件，新会话加载。
- npm bin 改为 `dist/cli.js`，无参数仍调用 Claude `dist/index.js`；Claude launcher 保持不变。命令为 `cc-hud setup codex` / `check codex` / `restore codex`。
- 可选 `theme codex` 安装 2.5KB 原生 `cc-hud.tmTheme`，模型蓝、项目青、分支/上下文/额度绿，也统一代码高亮。当前窗口用 `/theme` 搜索并选择 `cc-hud`；`restore-theme codex` 恢复先前主题配置。主题独立备份到 `cc-hud-theme.json`，默认 setup 不改主题。原生字段配色不随百分比动态变色。
- 仅通过 Codex config API 修改 `tui.status_line`，保留其他设置；单字段备份位于 `$CODEX_HOME/cc-hud-native.json`。幂等设置、并发版本检查、恢复时保护后续用户修改。
- 设置命令临时启动 stdio app-server，结束即退出；不使用 `-c` 包装正常 Codex 启动（会绕过共享 daemon）。要求 Codex ≥0.166.0，`CC_HUD_CODEX` 可指定可执行文件或 npm `codex.js`。
- `npm test` 通过 `scripts/test.cjs` 显式枚举 TS/CJS，防止 Node 22 漏跑 TS。`CC_HUD_CODEX_LIVE_TEST=1 npm test` 加测隔离配置的真实 Codex 读写。

## 发版流程

无脚本，手动四步（dist 已进库，`npm test` 内含 build）：

1. bump 四处版本号：`package.json` / `.claude-plugin/plugin.json` / `.claude-plugin/marketplace.json` / root `plugin.json`
2. `npm test` 全过，`git diff -- dist/` 已随源码一起变更
3. 单 commit（标题带 `(vX.Y.Z)`）→ `git tag vX.Y.Z` → `git push origin main && git push origin vX.Y.Z` → `gh release create vX.Y.Z --notes-file <notes>`
4. `npm publish`（npm 包名 **`cc-hud`**，唯一维护者 watertian）。`@watertian/cc-hud` 停在 0.9.4 并已废弃，不要再往那个名字发

插件用户走 Claude Code marketplace（`/plugin marketplace add WaterTian/cc-hud`），与 npm 发布互不影响；README 的 npm 徽章 / Via npm 段指向 `cc-hud`。

## 环境

- Windows 11，运行时使用 Node.js，不要使用 Bun（内存崩溃问题）
- Claude Code 必须通过 npm 安装（`npm i -g @anthropic-ai/claude-code`），不要使用原生安装器（native installer）
  - 原生安装器的 `claude.exe` 内嵌 Bun 运行时，会触发 `pas panic: deallocation did fail` 崩溃
  - npm 版使用系统 Node.js，稳定无此问题
