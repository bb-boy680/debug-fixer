## 路径约定

本 skill 中所有路径相对于 `<skill base directory>` 解析。

---

# 埋点体系与分层验证策略

## 文档描述

本文档定义 debug-fixer 的完整埋点体系：在哪埋、埋什么、怎么埋、怎么用结果反推假设。

承接【多维分析】输出的假设和调用链，为每个待验证假设提供精确的日志注入方案，承接【埋点分析】的决策流程，并在 Mark Fixed 后通过清理工具一键移除所有注入代码。

核心目标：
- 提供标准化、跨语言的埋点模板，保证日志格式统一。
- 定义埋点定位策略，用最少埋点最快收敛到根因。
- 定义日志内容清单，确保每条日志信息足够验证或证伪假设。
- 制定分层验证与停止规则，避免无限埋点。

---

## 核心原则

1. **最小化侵入**：首轮最多注入 3 处埋点，追加每次 ≤2 处。每处埋点必须有明确的验证目的。
2. **模板统一，清理友好**：所有埋点必须使用 `#region DEBUG` 包裹。占位符替换规则固定，不可修改模板结构。
3. **环境决定模板**：客户端使用 fetch 投递到本地日志服务，服务端直接写文件。
4. **日志格式统一**：每条日志必须包含 `type`、`location`、`message`、`data`、`timestamp`。只写这 6 个字段，不加任何额外字段。写入同一 session 日志文件。
5. **二分收敛，而非盲插**：埋点位置基于调用链二分法选择，不是全量散点。

---

## 客户端调试服务启动

客户端埋点通过本地 HTTP 日志服务接收日志。注入埋点前必须确保服务已运行：

1. **健康检查**：GET `http://localhost:9220/health`
   - 返回 `200 OK` → 服务已在运行，可直接注入埋点
   - 无响应或连接拒绝 → 服务未启动，执行步骤 2
2. **启动服务**：`node <skill base directory>/scripts/launch-debugger.js`
   - 在新终端窗口中启动，端口固定 9220
   - `pwd` 通过 HTTP 请求体传入，不是启动参数。一个服务可服务多个项目
3. 再次健康检查确认服务可达

> `{{PROJECT_ROOT}}` 占位符替换为当前项目的根目录绝对路径（通过 `pwd` 命令获取），替换到请求体的 `pwd` 字段。服务端根据此字段确定日志写入目录。

---

## 禁止行为

- **禁止使用语言自带的日志方式**：`console.log`、`print`、`fmt.Println`、`echo`、`puts` 等一律不允许。必须使用本文档定义的标准模板。
- **禁止在埋点代码中修改业务变量或程序状态**：埋点只能读取和发送数据。
- **禁止阻塞主流程**：fetch 必须带 `keepalive: true`，文件写入必须用追加模式且不阻塞。
- **禁止不包裹 `#region DEBUG`**：无包裹的埋点无法被清理工具识别，会在清理时遗留。
- **禁止在不可执行位置注入**：类定义、接口声明、类型定义中不可注入埋点。
- **禁止在非函数作用域使用函数调用代码**：如静态初始化块或模块顶层注入时，确保语法合法。

---

## 日志格式

所有埋点输出单行 JSON，写入 `.debug/logs/<session_id>.log`：

```json
{
  "type": "logic | visual",
  "location": "文件路径:行号",
  "message": "[进入] / [返回] / [分支] / [异常] / [状态变化] / [视觉快照]",
  "data": { /* 变量快照或样式快照 */ },
  "timestamp": 1712345678901
}
```

- `type: "logic"` — 逻辑埋点，`data` 包含关键变量快照。
- `type: "visual"` — 视觉埋点，`data` 包含 `computedStyles`、`boundingClientRect`、`viewport`、`classList` 等。

---

## 多语言埋点模板

> 清理兼容性说明：`cleanup-debug-blocks.js` 默认处理以 `//` 或 `#` 开头的单行注释标记 `#region DEBUG` / `#endregion DEBUG`。

### JavaScript (客户端 fetch)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
fetch("http://localhost:9220/debug/log?session_id={{DEBUG_SESSION_ID}}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "logic",
    location: "{{FILE}}:{{LINE}}",
    message: "{{MESSAGE}}",
    pwd: "{{PROJECT_ROOT}}",
    data: {{DATA_SNAPSHOT}},
    timestamp: Date.now()
  }),
  keepalive: true
});
// #endregion DEBUG
```

### Node.js (ES Modules)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
import("fs").then((fs) =>
  fs.appendFileSync(
    "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs/{{DEBUG_SESSION_ID}}.log",
    JSON.stringify({
      type: "logic",
      location: "{{FILE}}:{{LINE}}",
      message: "{{MESSAGE}}",
      data: {{DATA_SNAPSHOT}},
      timestamp: Date.now()
    }) + "\n"
  )
);
// #endregion DEBUG
```

### Node.js (CommonJS)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
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
// #endregion DEBUG
```

### Python

```python
# #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
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
    }) + "\n")
# #endregion DEBUG
```

### Go

> Go 模板分为两部分：`init()` 负责创建日志目录（每个包只需一份），函数体内 `{}` 代码块负责记录日志。两部分需分别放到文件顶部和函数体内。若目标文件已存在 `init()` 函数，只取目录创建代码追加到已有 `init()` 体内。

```go
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
// ── 包级代码（文件顶部 import 区） ──
import (
    "encoding/json"
    "os"
    "path/filepath"
    "time"
)
func init() {
    os.MkdirAll(filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs"), 0755)
}

// ── 函数体内代码 ──
{
    f, _ := os.OpenFile(
        filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs", "{{DEBUG_SESSION_ID}}.log"),
        os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644,
    )
    defer f.Close()
    json.NewEncoder(f).Encode(map[string]interface{}{
        "type":     "logic",
        "location": "{{FILE}}:{{LINE}}",
        "message":  "{{MESSAGE}}",
        "data":     {{DATA_SNAPSHOT}},
        "timestamp": time.Now().UnixMilli(),
    })
}
// #endregion DEBUG
```

### Java

```java
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
    java.nio.file.Path logPath = java.nio.file.Paths.get(
        "{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs", "{{DEBUG_SESSION_ID}}.log"
    );
    java.nio.file.Files.createDirectories(logPath.getParent());
    String entry = String.format(
        "{\"type\":\"logic\",\"location\":\"%s:%d\",\"message\":\"%s\",\"data\":%s,\"timestamp\":%d}%n",
        "{{FILE}}", {{LINE}}, "{{MESSAGE}}", "{{DATA_SNAPSHOT}}",
        System.currentTimeMillis()
    );
    java.nio.file.Files.writeString(logPath, entry,
        java.nio.file.StandardOpenOption.CREATE,
        java.nio.file.StandardOpenOption.APPEND
    );
} catch (Exception e) {}
// #endregion DEBUG
```

### Ruby

```ruby
# #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
require 'json'
require 'fileutils'
log_dir = File.join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs")
FileUtils.mkdir_p(log_dir)
entry = {
  type: "logic",
  location: "#{__FILE__}:{{LINE}}",
  message: "{{MESSAGE}}",
  data: {{DATA_SNAPSHOT}},
  timestamp: (Time.now.to_f * 1000).to_i
}
File.open(File.join(log_dir, "{{DEBUG_SESSION_ID}}.log"), "a") { |f| f.puts(JSON.generate(entry)) }
# #endregion DEBUG
```

### PHP

```php
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
$logDir = "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs";
if (!is_dir($logDir)) { mkdir($logDir, 0755, true); }
file_put_contents($logDir . "/{{DEBUG_SESSION_ID}}.log", json_encode([
    "type" => "logic",
    "location" => __FILE__ . ":{{LINE}}",
    "message" => "{{MESSAGE}}",
    "data" => {{DATA_SNAPSHOT}},
    "timestamp" => round(microtime(true) * 1000)
]) . "\n", FILE_APPEND);
// #endregion DEBUG
```

### Rust

```rust
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
{
    use std::io::Write;
    let log_dir = std::path::Path::new("{{ABSOLUTE_PROJECT_PATH}}").join(".debug/logs");
    std::fs::create_dir_all(&log_dir).ok();
    let log_path = log_dir.join("{{DEBUG_SESSION_ID}}.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let entry = serde_json::json!({
            "type": "logic",
            "location": format!("{}:{}", file!(), {{LINE}}),
            "message": "{{MESSAGE}}",
            "data": {{DATA_SNAPSHOT}},
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
        });
        let _ = writeln!(f, "{}", entry);
    }
}
// #endregion DEBUG
```

---

### 视觉快照模板 (仅 JavaScript)

视觉快照仅在浏览器/WebView 环境有意义，服务端语言不适用。

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
const __el = document.querySelector('{{TARGET_SELECTOR}}');
if (__el) {
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
  });
}
// #endregion DEBUG
```

---

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

每处埋点必须回答四个问题，缺一不可采样：

| 问题 | 对应字段 | 示例 |
|------|----------|------|
| 函数收到了什么？ | 入参 | `{ args: [userId, options] }` |
| 函数返回了什么？ | 出值 | `{ return: { ok: true } }` |
| 走了哪个分支？ | 分支条件 | `{ branch: "isAdmin", value: false }` |
| 对外产生了什么影响？ | 副作用状态 | `{ storeState: {...}, domChanged: true }` |

`data` 字段中应包含当前验证假设所需的全部关键变量，不依赖单次日志推理。

### 分层验证与停止规则

#### 首轮埋点
- 基于二分法选取 ≤3 个位置。
- 执行复现，收集日志。

#### 调用链核验

首轮埋点日志收集后，在分析数据偏差之前，必须先用堆栈字段核验静态构建的调用链是否正确：

1. 提取每条日志的 `stack` 字段，还原实际的运行时调用路径。
2. 将运行时调用路径与静态分析构建的调用链逐层对比：
   - **一致** → 调用链正确，进入偏差分析。
   - **存在差异**（如多出未预期的中间层、缺少某跳） → **调用链理解有误**，按实际堆栈修正调用链，重新制定埋点计划。
3. 调用链修正后不必回到二分起点，在修正后的链上按原有进度继续。

> 这一步投入极小（无需额外代码，仅检查已有日志），但能避免在错误调用链上浪费全部埋点轮次。

#### 偏差分析后决策

1. **捕获到偏差**
   - **本地产生**（入参符合假设但输出/副作用错误）→ 当前节点即源头，停止追加。
   - **上游传入**（入参已偏离假设）→ 向上二分继续追踪。
2. **未捕获到偏差**
   - 偏差在未埋点节点，或被复现条件差异掩盖。
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
- **如果 BUG 涉及竞态/异步时序**：埋点后 BUG 消失是重要信号——说明埋点引入的微小时序变化改变了执行顺序。此时不应继续埋点，应转为静态代码推理，重点检查 `Promise`、`setTimeout`、`await` 的时序依赖。
- 视觉快照变量使用双下划线前缀（`__el`、`__rect`）避免污染作用域。
- 所有异常必须静默处理，日志写入失败不得抛出错误。

---

## 注入前安全检查

在向用户代码写入任何埋点前，必须逐项确认：

1. **重复注入检查**：目标位置是否已存在 `#region DEBUG` 块？若已有，不得再次注入。
2. **作用域检查**：注入位置必须在函数体/方法体/模块顶层可执行代码块内。禁止插入到类定义、接口声明、类型定义中。
3. **端口一致性检查**：客户端 fetch 模板中的端口固定为 `9220`，与 `debugger-server.js` 保持一致。
4. **服务端权限检查**：服务端模板中的 `{{ABSOLUTE_PROJECT_PATH}}` 必须是可写路径。
5. **Go init 函数检查**：若目标文件已存在 `init()` 函数，将埋点代码追加到已有 `init()` 体内，不要创建重复定义。
6. **清理注释兼容性**：注入的注释标记必须与 `cleanup-debug-blocks.js` 兼容（支持 `//` 和 `#` 开头的单行注释）。

---

## 与其它参考文档的协同

- 环境判定：`<skill base directory>/references/environment-detection.md` — 根据客户端/服务端判定结果选择 fetch 或文件写入模板
- 追溯入口：`<skill base directory>/references/root-cause-tracing.md` — 埋点日志收集后回到追溯流程判定偏差源
- 停止规则：连续两轮未捕获偏差或三轮埋点耗尽时，由 `<skill base directory>/references/direction-doubt.md` 接管方向自疑

---

## 与清理工具的联动

修复完成后（Mark Fixed），调用清理脚本：

```bash
node <skill base directory>/scripts/cleanup-debug-blocks.js --session-id <id> --files <文件列表>
```

自动清除：
- 所有源文件中的 `// #region DEBUG ... // #endregion DEBUG` 块。
- 对应的 `.debug/logs/<session_id>.log` 文件。

**不要手动删除后再调用脚本，直接使用脚本完成全部清理。**
