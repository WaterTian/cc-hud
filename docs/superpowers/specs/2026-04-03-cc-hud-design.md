# cc-hud 设计文档

## 目标

用 Node.js 构建一个精简、稳定、高效的 Claude Code 状态栏插件，解决参考项目（jarrodwatts/claude-hud）在 Windows 上因 Bun 运行时导致的内存泄漏与 segfault 问题。

## 核心约束

- **Node.js only** — 禁止使用 Bun（Windows 长时间运行内存崩溃）
- **零外部依赖** — 不引入任何 npm 包，仅使用 Node.js 内置模块
- **长时间运行稳定** — 无内存泄漏，无缓冲区累积，每次调用独立执行
- **Windows 11 兼容** — 路径处理、编码、换行符均需兼容 Windows

## 显示指标（4 项）

| 指标 | 数据来源 | 格式示例 |
|------|----------|----------|
| 模型名称 | `stdin.model.display_name` | `[Opus]` |
| Context 用量 | `stdin.context_window.used_percentage` | `▰▰▰▰▰▱▱▱▱▱ 45%` |
| 子代理状态 | transcript JSONL 中 `running` 的 Agent 条目 | `◐ explore [haiku]` |
| 速率限制 | `stdin.rate_limits.five_hour / seven_day` | `5h: 25% 7d: 10%` |

## 输出格式

**仅紧凑模式** — 始终单行显示，用 `│` 分隔各段：

**无 agent 活动：**
```
[Opus] ▰▰▰▰▰▱▱▱▱▱ 45% │ 5h: 25% 7d: 10%
```

**有 agent 活动：**
```
[Opus] ▰▰▰▰▰▱▱▱▱▱ 45% │ ◐ explore [haiku] │ 5h: 25%
```

**空间不足时：** agent 信息优先于 7d 速率限制显示。

## 进度条规格

- 宽度：10 格
- 字符：`▰`（已用）`▱`（剩余）
- 颜色阈值：绿色（0-60%）→ 黄色（61-80%）→ 红色（81-100%）
- 速率限制同样使用此颜色阈值（无进度条，仅数字着色）

## 模块划分

```
src/
  index.ts        — 入口：读 stdin → 解析 → 渲染 → 输出
  stdin.ts        — 解析 stdin JSON，类型安全提取字段
  transcript.ts   — 读取 transcript JSONL 尾部，提取活跃 agent
  render.ts       — 组装单行输出（进度条、ANSI 颜色、截断）
  types.ts        — 所有接口/类型定义
```

## 数据流

```
Claude Code stdin (JSON)
        │
        ▼
    stdin.ts — 解析 StdinData
        │
        ▼
  transcript.ts — 读 JSONL，提取 running agents
        │
        ▼
    render.ts — 拼装单行输出
        │
        ▼
  console.log() → stdout → Claude Code 状态栏
```

## 类型定义

```typescript
interface StdinData {
  model?: { id?: string; display_name?: string };
  context_window?: {
    context_window_size?: number;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  rate_limits?: {
    five_hour?: { used_percentage?: number | null; resets_at?: number | null } | null;
    seven_day?: { used_percentage?: number | null; resets_at?: number | null } | null;
  } | null;
  transcript_path?: string;
  cwd?: string;
}

interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed';
}

interface RenderData {
  model: string;
  contextPercent: number;
  agents: AgentEntry[];
  fiveHourPercent: number | null;
  sevenDayPercent: number | null;
}
```

## Transcript 解析策略

- 从文件尾部向前读取（避免全量解析大文件）
- 只关注 `tool_use` 中 `name === 'Task'`（即 Agent 调用）的条目
- 只保留 `status === 'running'` 的 agent
- 如果 transcript_path 不存在或不可读，静默跳过（不报错）

## 稳定性保障

1. **无状态设计** — 每次 Claude Code 调用都是独立进程，无需管理全局状态
2. **所有外部 IO 包裹 try-catch** — stdin 解析失败、transcript 读取失败均 fallback 到默认值
3. **无 Buffer 累积** — 不缓存历史数据，每次调用只处理当前快照
4. **超时保护** — transcript 文件读取设置合理上限，避免阻塞
5. **Windows 路径兼容** — 使用 `path.resolve()` / `path.join()` 处理路径

## 项目结构

```
.claude-plugin/
  manifest.json       — 插件清单
commands/
  setup.md            — 安装配置命令
src/
  index.ts
  stdin.ts
  transcript.ts
  render.ts
  types.ts
dist/                 — tsc 编译输出
tests/
  render.test.ts      — 渲染逻辑单元测试
package.json
tsconfig.json
```

## 构建与运行

- `npm run build` — tsc 编译
- `npm test` — node --test 运行测试
- 入口：`dist/index.js`，Claude Code statusline 配置指向此文件
