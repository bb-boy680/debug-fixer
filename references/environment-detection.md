# references/environment-detection.md

## 环境判定与缓存机制

**文档描述**  
本文档定义 DebugFixer 如何识别目标代码的运行环境（客户端/服务端/双端均可），并利用项目本地的 `.debug/config.yaml` 缓存已判定路径的 glob 规则，避免重复分析。准确的环境判定是选择正确埋点模板（fetch 或文件写入）的基础，错误判定将直接导致埋点失效。

**核心目标**  
- 为每个待埋点的文件快速确定其所属环境（客户端或服务端）。  
- 通过缓存机制减少 token 消耗和重复推理。  
- 保证环境判定结果可复现、可修正。

---

### 核心原则（必须遵守）

1. **缓存优先**  
   判定环境时，**必须先读取项目根目录的 `.debug/config.yaml`**。如果文件不存在，说明没有任何缓存，此时进入动态检测流程，并在检测完成后创建该文件。永远不要跳过缓存直接动态检测。

2. **证据驱动判定**  
   动态检测必须基于代码中的客观特征（API 引用、模块导入、项目结构），禁止仅凭文件名后缀（如 `.js`、`.ts`）或直觉猜测。

3. **双端代码优先服务端**  
   当一段代码同时具备客户端和服务端特征（如同构组件、SSR 页面），或明确可运行在双端时，**优先使用服务端埋点**。这样后续调试时无需启动 HTTP 服务，直接用 `import("fs")` 写入日志文件，简化操作流程。仅在服务端埋点不可用时，回退到客户端 fetch 模板。

4. **缓存动态更新**  
   每次动态检测完成后，必须将新发现的 glob 规则**追加**到 `.debug/config.yaml` 对应的分组（frontend/backend）下，并保留已有规则。写入时必须确保 YAML 格式合法，避免规则重复。

5. **不确定时提问确认**  
   如果动态检测后仍无法确定环境（例如代码混淆、特征矛盾），必须用明确问题向用户确认，并将确认结果缓存。

6. **环境判定与埋点模板联动**  
   - 判定为 **客户端** → 使用 `fetch` 模板，需要 `DEBUG_PORT` 和 `session_id`。  
   - 判定为 **服务端**（含双端优先选择） → 使用 `import("fs")` 模板，需要 `ABSOLUTE_PROJECT_PATH` 和 `session_id`。

---

### 缓存文件格式

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

- `frontend` 和 `backend` 分组分别包含一组 glob 规则。  
- AI 工具使用内置的 glob 匹配功能，将目标文件路径与规则比对。  
- 命中 `frontend` 则判定为客户端；命中 `backend` 则判定为服务端。  
- 若一个文件同时匹配两组，视为双端代码，按原则 3 优先选服务端。

---

### 操作流程

1. **检查缓存文件**  
   读取 `.debug/config.yaml`。若文件存在，进入步骤 2；若不存在，跳至步骤 3。

2. **glob 匹配**  
   将目标文件路径与 `frontend`、`backend` 规则逐一匹配。  
   - 命中 `frontend` → 环境 = 客户端，流程结束。  
   - 命中 `backend` → 环境 = 服务端，流程结束。  
   - 同时命中两组 → 环境 = 双端，按原则 3 选择服务端并结束。  
   - 均未命中 → 继续步骤 3。

3. **动态检测**  
   打开目标文件，扫描特征（参见下方“判定特征表”），结合项目结构综合判定。注意识别边界情况（参见“边界情况”一节）。

4. **更新缓存**  
   将新确定的 glob 规则写入 `.debug/config.yaml` 对应分组。规则生成遵循以下要求：
   - **覆盖整个目录或模块**，而非单独文件。例如：对于 `src/services/order.js`，应缓存 `src/services/**`，而非 `src/services/order.js`。这样后续同目录下的其他文件可直接命中缓存，减少重复检测。
   - 对于 monorepo 项目，规则应包含包路径前缀（如 `packages/server/**`）。
   - 若文件原本不存在，按“文件创建路径”创建完整的 YAML 结构后写入。

5. **安全写入 YAML（必须遵守）**  
   更新 `.debug/config.yaml` 时，必须执行以下安全检查：
   - 读取当前文件的完整内容（若存在）。  
   - 检查待添加的规则是否已存在于目标分组中，避免重复添加。  
   - 将新规则追加到数组末尾，保持 YAML 缩进与已有规则一致（通常为 2 空格）。  
   - 不删除或覆盖已有规则，仅在末尾追加。  
   - 写入后检查格式是否合法（如无多余缩进、无缺失冒号）。

6. **无法确定时提问**  
   如果特征不足以做出高置信度判定，向用户提问确认，然后将确认结果写入缓存。

---

### 文件创建路径

当 `.debug/config.yaml` 不存在时，按以下步骤创建：

1. 创建文件，写入注释行 `# DebugFixer 环境缓存`。
2. 写入顶级键 `frontend:` 和 `backend:`，初始值均为空数组 `[]`。
3. 将动态检测确定的规则写入对应分组，形成完整结构：

```yaml
# DebugFixer 环境缓存
frontend:
  - "web/**/*"
backend:
  - "src/services/**"
```

---

### 判定特征表

#### 客户端特征（满足任一即可判定为客户端）
- 使用了浏览器专属 API：`window`、`document`、`localStorage`、`sessionStorage`、`navigator`、`HTMLElement`。
- 包含 DOM 事件绑定（`addEventListener`、`onclick` 等）。
- 使用了 React/Vue/Angular/Svelte 等前端框架的组件定义（JSX、`<template>`、`.vue` 文件中的 template 部分）。
- 引用 CSS Module、`styled-components`、样式对象。
- 调用 `fetch`/`XMLHttpRequest` 且代码无 Node.js 服务器特征。
- 使用了 Web API 如 `Canvas`、`WebGL`、`IntersectionObserver`。

#### 服务端特征（满足任一即可判定为服务端）
- 导入 Node.js 核心模块：`fs`、`path`、`http`、`https`、`process`、`crypto`、`stream` 等。
- 使用 Express/Koa/Fastify 等服务器框架的路由或中间件定义。
- 包含数据库驱动（`mongoose`、`sequelize`、`mysql2`、`pg` 等）或 ORM 操作。
- 文件流操作（`fs.createReadStream`、`fs.writeFileSync`）。
- Next.js 的 `getServerSideProps`、`getStaticProps`、API routes（`pages/api/`）。
- Python 的 Flask/Django 路由装饰器、`app.run()`。
- Go 的 `net/http` 包使用、`gin`/`echo` 框架定义。
- 包含 `process.env` 读取且非 Vite/Webpack 的客户端环境变量用法。

#### 边界情况（特殊处理）
- **同构/SSR 页面**：若文件中同时出现服务端导出（如 `getServerSideProps`、`getStaticProps`）和客户端 Hook（如 `useEffect`、`useState`），视为双端代码。按原则 3 优先选择服务端。
- **Electron 主进程/渲染进程**：`main.js` 或 `index.ts` 中使用 `BrowserWindow` 等模块 → 服务端（Node.js 环境）；`renderer.js` 中使用 `document` 等 → 客户端。
- **React Native**：使用 `react-native` 包的代码运行在移动端运行时，应视为客户端环境，使用 fetch 模板。

#### 项目结构辅助判断
- 文件位于 `pages/api/`、`server/`、`api/`、`services/` 目录下 → 倾向服务端。
- 文件位于 `components/`、`pages/`（非 API）、`hooks/`、`web/`、`client/` 目录下 → 倾向客户端。
- monorepo 中路径包含 `packages/server` 或 `packages/client` 标识。

---

### 示例

**文件**：`src/checkout.js`
**缓存匹配**：未命中任何规则。  
**动态检测**：代码导入 `fs` 和 `path`，使用 `fs.readFileSync` → 命中服务端特征。  
**缓存更新**：
1. 读取 `.debug/config.yaml` 当前内容。
2. 检查 `backend` 组，确认无重复。
3. 追加规则 `src/**/*` 到 `backend` 组（覆盖整个 src 目录）。
4. 保存，格式保持合法。

**文件**：`components/Sidebar.tsx`
**缓存匹配**：命中 `frontend` 的 `src/components/**` 规则。  
**判定**：客户端。无需动态检测。

**文件**：`pages/index.tsx`（Next.js 页面）
**缓存匹配**：未命中。  
**动态检测**：文件中同时存在 `getServerSideProps`（服务端导出）和 `useEffect`（客户端 Hook）。此为边界情况，视为双端代码。  
**判定**：按原则 3 优先选择服务端。

---

### 与埋点模板的联动

一但环境判定完成，立即根据结果选择对应的埋点模板（详细模板定义在 `instrumentation-guide.md`）。  
- 客户端 → 使用 `fetch` 模板，配置 `{{DEBUG_PORT}}` 和 `{{DEBUG_SESSION_ID}}`。  
- 服务端（含双端） → 使用 `import("fs")` 模板，配置 `{{ABSOLUTE_PROJECT_PATH}}` 和 `{{DEBUG_SESSION_ID}}`。

---

**使用提示**：在每次埋点计划制定时，**首先打开本文档**，按照“缓存优先→动态检测→安全更新缓存”的链路执行。环境判定错了，后续所有日志都将作废。