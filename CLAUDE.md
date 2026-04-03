# CLAUDE.md — cc-hud 项目指令

## 项目概述

Claude Code HUD（Heads-Up Display）— 一个 Claude Code 状态栏插件，实时显示上下文窗口用量、活跃工具调用、子代理状态、Todo 进度、Git 分支、模型名称、速率限制等信息。

参考项目：https://github.com/jarrodwatts/claude-hud/

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript |
| 运行时 | Node.js |
| 构建 | tsc |
| API | Claude Code statusline API（stdin JSON → stdout 格式化文本） |

## 项目结构

```
.claude-plugin/       # 插件清单（manifest）
commands/             # 斜杠命令（setup、configure 等）
src/                  # TypeScript 源码
dist/                 # 编译输出
tests/                # 测试
package.json          # 依赖与脚本
tsconfig.json         # TS 配置
```

## 核心机制

- Claude Code 通过 statusline 配置调用脚本，将 JSON 数据通过 stdin 传入
- 脚本解析 transcript JSONL，提取工具调用、子代理、Todo 等状态
- 输出格式化文本到 stdout，Claude Code 在输入框下方显示

## 环境

- Windows 11，运行时使用 Node.js，不要使用 Bun（内存崩溃问题）
- Claude Code 必须通过 npm 安装（`npm i -g @anthropic-ai/claude-code`），不要使用原生安装器（native installer）
  - 原生安装器的 `claude.exe` 内嵌 Bun 运行时，会触发 `pas panic: deallocation did fail` 崩溃
  - npm 版使用系统 Node.js，稳定无此问题
