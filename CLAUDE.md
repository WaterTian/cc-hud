# CLAUDE.md — cc-hud 项目指令

## 项目概述

cc-hud — 精简的 Claude Code 单行状态栏插件，显示模型名称、思考深度（effort）、上下文用量、活跃子代理、速率限制（5h / 7d / spend cap）、顶级模型周用量、工作区（目录 · 分支）。另提供 Codex CLI 原生 footer 的一次性预设（见下文「Codex CLI 原生 footer 预设」）。

面向 AI agent 的英文参考在 `AGENTS.md`（运行契约、读写的文件 / 进程 / 网络端点、环境变量、验证与调试步骤、改代码要守的不变量）。改动行为或接口时，README / AGENTS.md / 本文件一起更新。

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript（strict） |
| 运行时 | Node.js ≥ 18 |
| 构建 | tsc（ESM, ES2022） |
| 依赖 | 零外部依赖，仅 Node.js 内置模块 |
| 测试 | node:test（内置；`npm test` 经 scripts/test.cjs 显式枚举 ts/cjs） |
| 配色 | Catppuccin Mocha（ANSI 256 色） |

## 项目结构

```
.claude-plugin/plugin.json  — Claude Code 插件清单
commands/setup.md           — 安装配置命令（v0.5.0+ 写 launcher 到 <cfg>/bin/；cfg = $CLAUDE_CONFIG_DIR 或 ~/.claude）
src/
  index.ts                  — 入口：stdin → 解析 → 渲染 → stdout（全程只写一次 stdout；异常和 2s 超时路径都输出仅含 stdin 数据的行）
  stdin.ts                  — 解析 stdin JSON（非普通对象一律视为 {}）
  transcript.ts             — 思考深度（effort）来自 transcript 尾部 64KB；活跃 agent 来自 <session>/subagents/agent-*.meta.json（Claude Code 异步启动 agent 时写入，结束时标 finished；15 分钟无心跳视为死亡），旧版同步 agent 仍走 transcript
  render.ts                 — 单行紧凑渲染（1/8 精度进度条 + ANSI 颜色；自由文本先剥控制字符）
  model.ts                  — 模型名美化（claude-opus-4-7[1m] → Opus 4.7 (1M)）
  git.ts                    — 工作区段：目录名 + 分支 + 脏标记（800ms 预算，--no-optional-locks；status 失败 = 未知，不当 clean）
  claude.ts                 — 顶级模型周用量（OAuth usage API）：tick 只读缓存，网络全在 refresh.ts
  refresh.ts                — 分离式刷新子进程入口（node refresh.js <kind>，8s 预算，拉取后写缓存）
  cache.ts                  — 缓存约定：~/.cache/cc-hud/<name>.json、原子写；两种纪律：detached（serveCache：tick 只读 + spawn 刷新子进程，TTL / 冷却 / stale 判定）与 inline（cachedInline：采集器 tick 内拉取，失败退回旧值并记 failTs，30s 内不重试；30 分钟没拿到新值标 stale → 渲染加 ~）
  http.ts                   — JSON GET：fetchJson（刷新子进程用）配了代理只走 curl（Node fetch 不认代理，先试就会带着 token 直连），curl 失败不回退；无代理时原生 fetch 优先，传输失败或 WAF 403 回退 curl。fetchJsonNative（采集器用）仅原生 fetch，INLINE_TIMEOUT_MS = 1.2s，不起 curl
  env.ts                    — 布尔环境变量开关（"" / "0" / "false" 视为关）
  balance.ts / glm.ts / mmx.ts  — DeepSeek / GLM / MiniMax 余额或配额采集：只剩后端判定 + 响应解析，缓存与拉取走 cache.cachedInline + http.fetchJsonNative（未命中时 tick 内拉取，1.2s 预算，失败退回旧值）
  types.ts                  — 类型定义
  cli.ts                    — npm bin 入口：无参数走 index.ts（TTY 上打印帮助）；`<action> codex` 分发到 Codex 命令；--help / --version
  codex-rpc.ts              — 临时 `codex app-server --stdio`：版本门槛、JSON-RPC、readUserLayer / writeUserLayer、10s 超时、退出即杀
  codex.ts                  — Codex footer setup / check / restore（只改 tui.status_line，单字段备份 cc-hud-native.json）
  codex-theme.ts            — 可选主题：tui.theme + status_line_use_colors，主题文件按 sha256 跟踪刷新，独立备份 / 恢复
scripts/launcher.cjs        — 稳定路径 launcher（setup 复制到 <cfg>/bin/cc-hud-launcher.cjs；找不到插件时打印一行提示而非空白）
scripts/test.cjs            — npm test 运行器：显式枚举 tests/*.test.{ts,cjs} 并开 type stripping
plugin.json                 — Codex 插件清单（根目录；版本号与另外三处一起 bump）
skills/codex-setup/SKILL.md — Codex onboarding skill（跑 dist/cli.js … codex）
assets/cc-hud.tmTheme       — 可选 Codex 主题文件
dist/                       — 编译输出（提交到仓库，CI 校验与 src 同步）
tests/*.test.ts(.cjs)       — node:test 单元 + 端到端测试（render / model / transcript / git / http / cache / env / claude / balance / glm / mmx / launcher / index / codex；codex-live 需 CC_HUD_CODEX_LIVE_TEST=1；fixtures/fake-codex.cjs 模拟 app-server）
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
           ↘ transcript JSONL（尾部 64KB → 思考深度 effort）+ <session>/subagents/*.meta.json（活跃 agent）
           ↘ git symbolic-ref / status（目录 · 分支*，800ms 预算）
           ↘ ~/.cache/cc-hud/claude-plan.json（只读；过期则 spawn detached refresh.js 后台拉取写回）

Codex（仅显式命令，与 tick 无关）：cc-hud <action> codex → 临时 codex app-server --stdio → config/read → config/batchWrite → $CODEX_HOME/config.toml（只动 tui.status_line / tui.theme / tui.status_line_use_colors）
```

## 性能与稳定性

- **无状态** — 每次调用都是独立进程，无内存泄漏风险
- **尾部读取** — 只读 transcript 最后 64KB，不全量解析
- **字符串预过滤** — 只对含 `"Agent"` / `"tool_result"` / `"effort"` 的行做 JSON.parse（assistant 行基本都带 effort，省掉的主要是 user / progress 等行）
- **2s 硬超时** — setTimeout + unref()，超时先输出仅含 stdin 数据的行再退出，不阻塞 Claude Code 也不留空白；第三方采集器的 inline fetch 预算 1.2s，超时只丢该段不丢整行，失败后 30s 冷却不每 tick 重试
- **只写一次 stdout** — 多写一行会污染状态栏；emit 用 writeSync 同步写（macOS / Windows 的管道是异步的，超时路径紧接着 exit），异常路径输出 stdin 能算出的部分，最差 `[Claude]`
- **所有 IO try-catch** — 失败静默降级，不崩溃
- **tick 内零网络（官方后端）** — claude.ts 只读缓存，网络请求全部由 detached 刷新子进程完成；OAuth usage 接口的 WAF 会 403 拦截 Node TLS 指纹，需 curl 回退（2026-07 实测）

## Codex CLI 原生 footer 预设

- 定位：一次性把 Codex **自己的** footer 配成近似 Claude HUD 的信息集（模型/深度 → 上下文已用 → 5h/周额度剩余 → 项目 → 分支），之后由 Codex 原生负责数据、刷新、配色。没有常驻进程、hook、MCP、transcript 扫描或额外额度请求；不用 `-c` 包装正常启动（会绕过 Codex 的共享 daemon）。
- 入口：npm bin 指向 `dist/cli.js`。无参数 + stdin 管道 = 原来的 Claude 渲染器；无参数 + TTY 打印帮助。`cc-hud setup|check|restore|theme|restore-theme codex`、`--help`、`--version`。Claude 的 launcher 直接跑 `dist/index.js`，不经过 cli，零影响。
- 配置通道（`codex-rpc.ts`）：临时起 `codex app-server --stdio`，`config/read` → `config/batchWrite`（`expectedVersion` 防并发）→ 回读校验；10s 总超时，SIGTERM 后 500ms SIGKILL；忽略服务端通知和服务端发起的请求；error body 不回显（可能含私密配置）。要求 Codex ≥ 0.166.0，找不到 / 版本过低分别报错；`CC_HUD_CODEX` 指定可执行文件或 npm `bin/codex.js`。
- footer（`codex.ts`）：只改 `tui.status_line`；单字段备份 `$CODEX_HOME/cc-hud-native.json`（`{schema, previous, applied}`，0600）。幂等；用户事后改过 → setup / restore 都只报告不覆盖；"我们的"= 当前预设或上次 applied 的预设，所以发版换预设后 restore 仍能还原（setup 会把 `applied` 刷新为新预设）。setup / 已配置的 check 会提示限额颜色由主题决定，与剩余百分比无关，并提示可选主题。
- 主题（`codex-theme.ts`，可选）：装 `assets/cc-hud.tmTheme` 到 `$CODEX_HOME/themes/cc-hud.tmTheme`，设 `tui.theme` + `tui.status_line_use_colors`，备份 `cc-hud-theme.json`（含安装文件 sha256 `asset`：新版本只覆盖自己装的文件，用户改过的拒绝并提示删除路径）。即使配置已匹配，也记录原值和文件哈希，保证后续主题升级可用；升级后需再运行 `theme codex` 刷新已装文件。旧名 `cc-hud-mocha` 视为自己的。限额字段为固定中性青绿色，不表示余量健康；主题会连带改代码高亮，所以独立于 setup。
- 失败处理：报错不代表自动回滚；备份、已安装的主题文件或已保存的用户层字段可能保留（例如被其他配置层覆盖）。根据报错重试或执行对应 restore。
- 分发：根 `plugin.json`（Codex 插件清单）+ `skills/codex-setup/SKILL.md`（onboarding skill；Claude Code 也会把它当 skill 载入，描述里已注明 Claude 用 /cc-hud:setup）；复用现有 marketplace 仓库。`codex plugin marketplace add WaterTian/cc-hud` → `codex plugin add cc-hud@cc-hud`；`marketplace upgrade` 同步更新已装插件，新会话生效。
- 视觉边界：Codex 额度显示**剩余**、Claude 显示**已用**；Codex 把 5h / weekly 映射到语法主题的 `constant.language`（回退 `storage.type`），按字段固定取色，不按百分比变色，因此原主题可能把 `93% left` 显示为红色。cc-hud 主题把 `constant.numeric` 的绿色与限额 scope 分离，将限额改为中性青绿色；`1% left` 与 `93% left` 仍同色。分隔符 / 配色由 Codex 控制，无进度条；`/compact` 期间可能短暂显示 0%。
- 测试：`tests/codex.test.ts` 用 `tests/fixtures/fake-codex.cjs` 模拟 app-server（挂死 / 并发 / 写失败 / 版本开关）；`CC_HUD_CODEX_LIVE_TEST=1 npm test` 加测真实 Codex（隔离 CODEX_HOME、离线 provider），需本机 Codex ≥ 0.166.0。`npm test` 经 `scripts/test.cjs` 显式枚举 ts/cjs 测试并开 type stripping。

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
