# 环境判定

## 文档描述

本文档帮助你为埋点代码选择正确的日志写入模板——fetch（浏览器）或文件写入（Node）。

判定错误将直接导致埋点日志写入失败，后续的日志分析和偏差定位全部建立在日志数据之上。日志没写进去，你会在第三步浪费至少两轮对话才发现问题不在代码而在埋点本身。这是完全可以避免的。

本文档在第三步制定埋点计划时调用。

## 为什么需要专门判定环境？

你已经读过代码，大概率知道这段代码跑在哪。但有两个陷阱会让有经验的开发者（和 AI）判断失误：

1. **后缀名骗人**：`.tsx` 不等于浏览器。Ink 用 React JSX 写终端 UI，Next.js Server Component 也是 `.tsx`，但它们跑在 Node。
2. **同构代码的双重身份**：同一个文件可能同时被浏览器和 Node 执行（Next.js SSR、Electron），选错模板会让一半的日志丢失。

所以这一步的目的不是重新分析——是**确认你已经知道的结论没有被后缀名误导**。

## 判定方法

你不是从零开始。第一步重建调用链时，你已经掌握了三个事实：

- **项目是什么**：package.json 的 dependencies 告诉你的（有没有 `ink`、`next`、`electron`、`express`）
- **文件做什么**：你在 1.3 画调用链时读过的代码内容
- **它跑在哪**：你大概率已经有一个明确的答案

基于这些已知信息，做出判定：

- **确定是浏览器** → 用 fetch 模板
- **确定是 Node**（包括 TUI、Electron main、Next.js API Route / Server Component）→ 用文件写入模板
- **无法确定 → 默认选服务端**（文件写入模板）

默认选服务端的原因：文件写入不依赖 HTTP 服务的正确启动，比 fetch 少一个故障点。如果默认选错了（实际是浏览器代码），最坏情况是少了一条日志——而你从调用链核验中会立刻发现该处日志缺失，修正成本是一轮。但为此增加一轮用户交互，用户要停下来回答"这段代码跑在哪"——这种打断比日志缺失的代价更大。

## 容易误判的场景速查

以下场景中文件后缀名和框架名具有欺骗性。使用时对照你已经知道的项目上下文，不要凭文件名或后缀单独判断：

| 场景 | 为什么容易误判 | 实际环境 | 关键区分方式 |
|------|---------------|----------|-------------|
| Ink / React TUI | `.tsx` + JSX，长得和浏览器 React 一模一样 | Node | package.json 有 `ink` 依赖 + `bin` 字段 |
| Next.js Server Component | `.tsx` + JSX，但没有 `'use client'` 指令 | Node | Next.js App Router 默认服务端组件 |
| Next.js Client Component | `.tsx` + JSX，文件头有 `'use client'` | 浏览器 | `'use client'` 指令明确声明 |
| Next.js API Route | `pages/api/` 或 `app/api/` 下的文件 | Node | 目录路径本身就是约定 |
| Electron 主进程 | `.js`/`.ts`，没有 DOM API | Node | `BrowserWindow`、`ipcMain`、`app` 模块 |
| Electron 渲染进程 | `.js`/`.ts`，和普通网页写法一样 | 浏览器 | `ipcRenderer` + DOM API，或 `src/renderer/` 目录 |
| VS Code Extension | `.ts` 文件，没有浏览器 API | Node | `import * as vscode from 'vscode'` |
| React Native | `.tsx` + JSX，但 import 来自 `react-native` | 客户端 | `react-native` 包 + `StyleSheet` |

**同构代码（同时包含客户端和服务端逻辑）**：如果一个文件同时出现 `useEffect` 和 `getServerSideProps`，或同时 import 了 `fs` 和 `useState`——选择服务端模板。文件写入不依赖浏览器端口，比 fetch 更可靠。

## 结果输出

判定完成后，在埋点计划中明确写出：

```
环境：[客户端 / 服务端]
依据：[为什么这么判定，一句话]
模板：[fetch / 文件写入]
```

不写缓存文件。每次制定埋点计划时重新确认——因为不同的目标文件可能属于不同环境，缓存一个文件的结论对其他文件没有意义。
