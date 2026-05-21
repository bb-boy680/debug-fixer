# 埋点体系与分层验证策略

## 文档描述

本文档定义 debug-fixer 的完整埋点体系：在哪埋、埋什么、怎么埋、怎么用结果反推假设。

核心目标：
- 提供标准化埋点模板，保证日志格式统一。
- 定义埋点定位策略，用最少埋点最快收敛到根因。
- 定义日志内容清单，确保每条日志信息足够验证或证伪假设。
- 制定分层验证与停止规则，避免无限埋点。
- 优先使用现有运行时证据；只有证据仍不足时才注入新埋点。

本文档在第三步制定埋点计划时调用。环境判定完成后，根据目标代码的语言选择对应模板。

## 核心原则

1. **最小化侵入**：首轮最多注入 3 处埋点，追加每次 ≤2 处。每处埋点必须有明确的验证目的。
2. **模板统一，清理友好**：所有埋点必须使用 `#region DEBUG` 包裹。占位符替换规则固定，不可修改模板结构。
3. **环境决定模板**：客户端使用 fetch 投递到本地日志服务，服务端直接写文件。
4. **日志格式统一**：每条日志必须包含 `type`、`location`、`message`、`data`、`timestamp`。写入同一 session 日志文件。
5. **二分收敛，而非盲插**：埋点位置基于调用链二分法选择，不是全量散点。

## 禁止行为

- **禁止使用语言自带的日志方式**：`console.log`、`print`、`fmt.Println`、`echo`、`puts` 等一律不允许。必须使用本文档定义的标准模板。
- **禁止在埋点代码中修改业务变量或程序状态**：埋点只能读取和发送数据。
- **禁止阻塞主流程**：fetch 必须带 `keepalive: true`，文件写入必须用追加模式且不阻塞。
- **禁止让埋点自己抛错**：所有模板都要静默失败，不能因为序列化、网络、文件写入问题影响主流程。
- **禁止不包裹 `#region DEBUG`**：无包裹的埋点无法被清理工具识别，会在清理时遗留。
- **禁止在不可执行位置注入**：类定义、接口声明、类型定义中不可注入埋点。

## 客户端调试服务启动

客户端埋点通过本地 HTTP 日志服务接收日志。注入埋点前必须确保服务已运行：

1. **健康检查**：GET `http://localhost:9220/health`
   - 返回 `200 OK` → 服务已在运行，可直接注入埋点
   - 无响应或连接拒绝 → 服务未启动，执行步骤 2
2. **启动服务**：`node <skill base directory>/scripts/launch-debugger.js`
   - 在新终端窗口中启动，端口固定 9220
   - `pwd` 通过 HTTP 请求体传入，不是启动参数。一个服务可服务多个项目
3. 再次健康检查确认服务可达

> `{{PROJECT_ROOT}}` 占位符替换为当前项目的根目录绝对路径（通过 `pwd` 命令获取），替换到请求体的 `pwd` 字段。

## 日志格式

所有埋点输出单行 JSON，写入 `.debug/logs/<session_id>.log`。单次埋点尽量只记录定位所需的最小字段，避免大对象和循环引用。

```json
{
  "type": "logic | visual",
  "location": "文件路径:行号",
  "message": "[进入] / [返回] / [分支] / [异常] / [状态变化] / [视觉快照]",
  "data": { },
  "timestamp": 1712345678901
}
```

- `type: "logic"` — 逻辑埋点，`data` 包含关键变量快照。
- `type: "visual"` — 视觉埋点，`data` 包含 `computedStyles`、`boundingClientRect`、`viewport`、`classList` 等。

## 模板选择

根据环境判定结果和项目语言选择模板。**常用模板直接在下方，其他语言模板按需读取对应文件。**

| 语言 | 环境 | 模板位置 |
|------|------|----------|
| JavaScript / TypeScript | 客户端（浏览器） | 下方 — JS 客户端 fetch |
| JavaScript / TypeScript | 服务端（Node ESM） | 下方 — Node.js ES Modules |
| JavaScript / TypeScript | 服务端（Node CJS） | 下方 — Node.js CommonJS |
| Python | 服务端 | 下方 — Python |
| Go | 服务端 | `<skill base directory>/references/templates/go.md>` |
| Java | 服务端 | `<skill base directory>/references/templates/java.md>` |
| Ruby | 服务端 | `<skill base directory>/references/templates/ruby.md>` |
| PHP | 服务端 | `<skill base directory>/references/templates/php.md>` |
| Rust | 服务端 | `<skill base directory>/references/templates/rust.md>` |
| 视觉快照 | 客户端（浏览器） | 下方 — 视觉快照模板 |

> 清理兼容性说明：`cleanup-debug-blocks.js` 默认处理以 `//` 或 `#` 开头的单行注释标记 `#region DEBUG` / `#endregion DEBUG`。

## 常用模板

### JavaScript (客户端 fetch)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
void (() => {
  try {
    const __safeStringify = (value) => {
      const seen = new WeakSet();
      return JSON.stringify(value, (_, v) => {
        if (typeof v === "bigint") return v.toString();
        if (typeof v === "function") return "[Function]";
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      });
    };

    const __payload = {
      type: "logic",
      location: "{{FILE}}:{{LINE}}",
      message: "{{MESSAGE}}",
      pwd: "{{PROJECT_ROOT}}",
      data: {{DATA_SNAPSHOT}},
      timestamp: Date.now()
    };

    fetch("http://localhost:9220/debug/log?session_id={{DEBUG_SESSION_ID}}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: __safeStringify(__payload),
      keepalive: true
    }).catch(() => {});
  } catch {}
})();
// #endregion DEBUG
```

### Node.js (ES Modules)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
void (async () => {
  try {
    const fs = await import("node:fs");
    fs.appendFileSync(
      "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs/{{DEBUG_SESSION_ID}}.log",
      JSON.stringify({
        type: "logic",
        location: "{{FILE}}:{{LINE}}",
        message: "{{MESSAGE}}",
        data: {{DATA_SNAPSHOT}},
        timestamp: Date.now()
      }) + "\n"
    );
  } catch {}
})();
// #endregion DEBUG
```

### Node.js (CommonJS)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
  require("fs").appendFileSync(
    "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs/{{DEBUG_SESSION_ID}}.log",
    JSON.stringify({
      type: "logic",
      location: `${__filename}:{{LINE}}`,
      message: "{{MESSAGE}}",
      data: {{DATA_SNAPSHOT}},
      timestamp: Date.now()
    }) + "\n"
  );
} catch {}
// #endregion DEBUG
```

### Python

```python
# #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try:
    import json, time, os
    log_dir = os.path.join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs")
    os.makedirs(log_dir, exist_ok=True)
    with open(os.path.join(log_dir, "{{DEBUG_SESSION_ID}}.log"), "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "type": "logic",
            "location": f"{__file__}:{{LINE}}",
            "message": "{{MESSAGE}}",
            "data": {{DATA_SNAPSHOT}},
            "timestamp": time.time()
        }, default=str) + "\n")
except Exception:
    pass
# #endregion DEBUG
```

### 视觉快照 (仅 JavaScript 客户端)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
void (() => {
  try {
    const __el = document.querySelector('{{TARGET_SELECTOR}}');
    if (!__el) return;

    const __rect = __el.getBoundingClientRect();
    const __styles = getComputedStyle(__el);
    fetch("http://localhost:9220/debug/log?session_id={{DEBUG_SESSION_ID}}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visual",
        location: "{{FILE}}:{{LINE}}",
        message: "[视觉快照] {{MESSAGE}}",
        pwd: "{{PROJECT_ROOT}}",
        data: {
          computedStyles: {
            display: __styles.display,
            visibility: __styles.visibility,
            position: __styles.position,
            zIndex: __styles.zIndex,
            pointerEvents: __styles.pointerEvents,
            opacity: __styles.opacity,
            transform: __styles.transform,
            overflow: __styles.overflow
          },
          boundingClientRect: {
            x: __rect.x, y: __rect.y,
            width: __rect.width, height: __rect.height
          },
          classList: Array.from(__el.classList),
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          }
        },
        timestamp: Date.now()
      }),
      keepalive: true
    }).catch(() => {});
  } catch {}
})();
// #endregion DEBUG
```

## 埋点策略

### 二分定位法

埋点位置不靠怀疑度打分，靠**调用链二分法**收敛：

1. 画出从异常表现点到数据入口的完整调用链。
2. 在调用链**中点**注入首处埋点。
3. 执行复现，检查日志：
   - 数据**正确** → 问题在下半段（靠近异常点），在下半段中点继续二分。
   - 数据**已偏离** → 问题在上半段（靠近入口），在上半段中点继续二分。
4. 每轮最多 3 处埋点，2-3 轮即可收敛到单个节点。

> 对于多分支调用链（非单链），在分叉点同时埋点以确定走的是哪条分支。

### 日志内容清单

每轮埋点计划必须整体覆盖四个问题，缺一不可：

| 问题 | 对应字段 | 示例 |
|------|----------|------|
| 函数收到了什么？ | 入参 | `{ args: [userId, options] }` |
| 函数返回了什么？ | 出值 | `{ return: { ok: true } }` |
| 走了哪个分支？ | 分支条件 | `{ branch: "isAdmin", value: false }` |
| 对外产生了什么影响？ | 副作用状态 | `{ storeState: {...}, domChanged: true }` |

### 分层验证与停止规则

#### 首轮埋点
- 基于二分法选取 ≤3 个位置。
- 执行复现，收集日志。

#### 调用链核验

首轮埋点日志收集后，在分析数据偏差之前，必须核验静态构建的调用链是否正确：

1. 按时间戳排序日志，用 `location` 字段还原实际执行顺序。
2. 与静态调用链逐层对比：
   - **一致** → 调用链正确，进入偏差分析。
   - **存在差异**（多出中间层、缺少某跳） → 按实际日志修正调用链，重新制定埋点计划。
3. 调用链修正后按原有进度继续，不回到二分起点。

> 这一步无需额外代码，仅检查已有日志的 `location` 和 `data`，但能避免在错误调用链上浪费全部埋点轮次。

#### 偏差分析后决策

1. **捕获到偏差**
   - **本地产生**（入参符合假设但输出/副作用错误）→ 当前节点即源头，停止追加。
   - **上游传入**（入参已偏离假设）→ 向上二分继续追踪。
2. **未捕获到偏差**
   - 在未覆盖的调用链段取中点继续埋点，同时确认复现步骤一致。
   - 连续两轮未捕获偏差，触发**方向自疑**。
3. **达到最大追加轮次**
   - 总共最多 3 轮埋点追加（首轮 + 2 次追加）。
   - 3 轮耗尽仍无法定位源头，触发方向自疑，终止埋点。

### 视觉问题的特殊处理

- 视觉快照日志 `type: "visual"`，与逻辑日志存储在同一 session 文件中，按时间戳排序分析。
- 视觉偏差源头判定：
  - 自身 CSS 规则错误 → 本地产生。
  - 受父容器继承/覆盖影响 → 向上追踪 DOM 树（视为上游传入）。
  - JS 动态计算错误 → 转入逻辑调用链追溯。

### Heisenbug 防护

埋点本身可能改变程序行为，尤其是涉及竞态和时序的 BUG：

- `fetch` 必须使用 `keepalive: true`，确保日志不因页面关闭丢失，同时不阻塞主线程。
- 文件写入必须使用追加模式，不加锁。
- **如果 BUG 涉及竞态/异步时序**：埋点后 BUG 消失是重要信号——埋点引入的微小时序变化改变了执行顺序。此时不应继续埋点，应转为静态代码推理，重点检查 `Promise`、`setTimeout`、`await` 的时序依赖。
- 视觉快照变量使用双下划线前缀（`__el`、`__rect`）避免污染作用域。
- 所有异常必须静默处理，日志写入失败不得抛出错误。

## 注入前安全检查

在向用户代码写入任何埋点前，必须逐项确认：

1. **重复注入检查**：目标位置是否已存在 `#region DEBUG` 块？若已有，不得再次注入。
2. **作用域检查**：注入位置必须在函数体/方法体/模块顶层可执行代码块内。禁止插入到类定义、接口声明、类型定义中。
3. **端口一致性检查**：客户端 fetch 模板中的端口固定为 `9220`，与 `debugger-server.js` 保持一致。
4. **服务端权限检查**：服务端模板中的 `{{ABSOLUTE_PROJECT_PATH}}` 必须是可写路径。
5. **Go init 函数检查**：若目标文件已存在 `init()` 函数，将埋点代码追加到已有 `init()` 体内，不要创建重复定义。
6. **清理注释兼容性**：注入的注释标记必须与 `cleanup-debug-blocks.js` 兼容（支持 `//` 和 `#` 开头的单行注释）。

## 与清理工具的联动

确认回合通过后，在同一个回合里决定是否调用清理脚本：

```bash
node <skill base directory>/scripts/cleanup-debug-blocks.js --session-id <id> --files <文件列表>
```

自动清除所有源文件中的 `#region DEBUG` 块和对应的日志文件。**直接使用脚本完成全部清理，不手动删除。**清理动作以用户确认过的结果为前提，不要在用户还没回复前自动执行。
