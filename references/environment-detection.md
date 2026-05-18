## 路径约定

本 skill 中所有路径相对于 `<skill base directory>` 解析。

---

# 环境判定与缓存机制

## 文档描述

本文档定义 debug-fixer 如何识别目标代码的运行环境（客户端/服务端），并利用 `.debug/config.yaml` 缓存判定结果，避免重复分析。

准确的环境判定是选择正确埋点模板（fetch 或文件写入）的前提。判定错误将直接导致埋点日志写入失败。

本文档在每次制定埋点计划时优先调用，输出环境判定结果供 `<skill base directory>/references/instrumentation-guide.md` 选择对应模板。

---

## 核心原则

1. **缓存优先**：判定环境前必须先读取 `.debug/config.yaml`。不存在则动态检测，检测完成后创建缓存。
2. **证据驱动**：动态检测基于代码中的客观特征（API 引用、模块导入、项目结构），禁止凭文件名后缀猜测。
3. **双端优先服务端**：代码同时具备客户端和服务端特征时，优先选服务端埋点（`import("fs")` 写文件，无需启动 HTTP 服务）。
4. **缓存追加不覆盖**：新发现的规则追加到对应分组末尾，不删除已有规则，不重复添加。
5. **无法判定时提问**：特征矛盾或不足时，用具体问题向用户确认，将确认结果写入缓存。
6. **规则覆盖目录而非单文件**：对于 `src/services/order.js`，缓存 `src/services/**`，后续同目录文件直接命中。

---

## 禁止行为

- **禁止跳过缓存直接动态检测**：每次都读代码判定会浪费 token 且结果不稳定。
- **禁止凭文件名后缀判定环境**：`.js`/`.ts` 文件既可能是 Node.js 也可能是浏览器代码。
- **禁止覆盖已有缓存规则**：追加模式，不删除、不复写。
- **禁止添加重复规则**：写入前必须检查目标分组中是否已存在相同规则。
- **禁止对单文件缓存**：缓存应覆盖目录或模块，对单文件的缓存几乎不会被复用。

---

## 缓存文件格式

`.debug/config.yaml`（项目根目录）：

```yaml
# DebugFixer 环境缓存
frontend:
  - "web/**/*"
  - "**/client/**"
  - "src/components/**"
backend:
  - "cli/**/*"
  - "packages/**/*"
  - "**/server/**"
  - "src/api/**"
```

- `frontend`：客户端 glob 规则
- `backend`：服务端 glob 规则
- 同时命中两组 → 双端代码，按核心原则 3 选服务端
- 均未命中 → 进入动态检测

---

## 操作流程

1. 读取 `.debug/config.yaml` → 存在则步骤 2，不存在则步骤 3
2. 将目标文件路径与规则逐一匹配 → 命中即结束，未命中则步骤 3
3. 动态检测：打开目标文件，对照判定特征表扫描，结合项目结构综合判定
4. 将新规则写入 `.debug/config.yaml`，确保目录级覆盖、无重复
5. 特征不足时向用户提问确认，确认结果同样缓存

---

## 文件创建路径

首次创建 `.debug/config.yaml` 时：

1. 写入 `# DebugFixer 环境缓存`
2. 写入 `frontend:` 和 `backend:`，初始为空数组 `[]`
3. 写入动态检测确定的规则：

```yaml
# DebugFixer 环境缓存
frontend:
  - "web/**/*"
backend:
  - "src/services/**"
```

---

## 判定特征表

### 客户端特征（满足任一即可）

- 浏览器专属 API：`window`、`document`、`localStorage`、`sessionStorage`、`navigator`、`HTMLElement`
- DOM 事件绑定：`addEventListener`、`onclick` 等
- 前端框架组件：JSX、`<template>`、`.vue` template 部分
- CSS Module、`styled-components`、样式对象
- Web API：`Canvas`、`WebGL`、`IntersectionObserver`
- `fetch`/`XMLHttpRequest` 且无 Node.js 服务端特征

### 服务端特征（满足任一即可）

- Node.js 核心模块：`fs`、`path`、`http`、`https`、`crypto`、`stream`
- 服务端框架：Express/Koa/Fastify 路由或中间件定义
- 数据库驱动：`mongoose`、`sequelize`、`mysql2`、`pg` 等
- 文件流操作：`fs.createReadStream`、`fs.writeFileSync`
- Next.js：`getServerSideProps`、`getStaticProps`、`pages/api/`
- Python：Flask/Django 路由装饰器、`app.run()`
- Go：`net/http` 包、`gin`/`echo` 框架

### 边界情况

- **同构/SSR**：同时出现 `getServerSideProps` 和 `useEffect` → 双端，选服务端
- **Electron**：`main.js` 用 `BrowserWindow` → 服务端；`renderer.js` 用 `document` → 客户端
- **React Native**：`react-native` 包 → 客户端，用 fetch 模板

### 项目结构辅助

- `pages/api/`、`server/`、`api/`、`services/` → 倾向服务端
- `components/`、`pages/`（非 API）、`hooks/`、`web/`、`client/` → 倾向客户端

---

## 与其它参考文档的协同

- 埋点模板：`<skill base directory>/references/instrumentation-guide.md` — 环境判定结果决定模板选择
  - 客户端 → `fetch` 模板，需 `{{DEBUG_PORT}}` 和 `{{DEBUG_SESSION_ID}}`
  - 服务端（含双端选择） → `import("fs")` 模板，需 `{{ABSOLUTE_PROJECT_PATH}}` 和 `{{DEBUG_SESSION_ID}}`
