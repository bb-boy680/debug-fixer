# references/instrumentation-guide.md

## 埋点体系与分层验证策略

**文档描述**  
本文档定义 DebugFixer 的埋点代码模板（支持多种语言）、插入策略、分层验证流程以及对应停止规则。它承接环境判定结果，为每个待验证的正确性假设提供精确的动态日志注入方案。

**核心目标**  
- 提供标准化、跨语言的客户端与服务端埋点模板，保证日志格式统一。  
- 根据怀疑度排序实现最小化侵入，首轮最多注入 3 处埋点。  
- 制定偏差捕获后的停止与追加规则，避免无限埋点。  
- 确保所有注入代码均可通过清理机制一键移除。

---

### 核心原则

1. **最小化侵入**：仅对经过怀疑度排序、确认需要验证的关键节点注入埋点。首轮总数 ≤3 处，追加每次 ≤2 处。  
2. **模板统一，清理友好**：所有埋点必须用 `#region DEBUG` 包裹（或该语言的等价注释），占位符替换规则固定，不可修改模板结构。  
3. **环境决定模板**：根据 `environment-detection.md` 的判定选择对应模板（客户端 fetch，服务端文件写入）。  
4. **日志格式统一**：每条日志必须包含 `type`、`location`、`message`、`data`、`timestamp`，写入同一 session 日志文件。  
5. **分层验证，逐步收敛**：首轮埋点后必须分析日志，依据偏差情况停止、追加或重新评估，禁止全量盲插。  
6. **怀疑度驱动**：埋点位置选择基于怀疑度（1~10），高分优先。

---

### 统一日志格式

所有埋点输出单行 JSON，写入 `.debug/logs/<session_id>.log`：

```json
{
  "type": "logic | visual",
  "location": "文件路径:行号",
  "message": "[进入] / [返回] / [异常] / [分支] / [状态变化] / [视觉快照]",
  "data": { /* 变量快照或样式快照 */ },
  "timestamp": 1712345678901
}
```

- `type`=`logic` 时，`data` 包含关键变量快照。  
- `type`=`visual` 时，`data` 包含 `computedStyles`、`boundingClientRect`、`viewport`、`classList` 等（参见视觉模板）。

---

### 注入前安全检查

**在向用户代码写入任何埋点前，必须逐项确认以下检查点，避免引入新错误：**

1. **重复注入检查**：目标位置是否已存在 `#region DEBUG` 块？若已有，不得再次注入。  
2. **作用域检查**：注入位置是否在函数体/方法体/模块顶层可执行代码块内？禁止将埋点插入到类定义、接口声明等不可执行位置。  
3. **端口一致性检查**：客户端 fetch 模板中的 `{{DEBUG_PORT}}` 必须与 `debugger-server.js` 启动端口一致（默认 9220）。  
4. **服务端权限检查**：服务端模板中的 `{{ABSOLUTE_PROJECT_PATH}}` 必须是可写路径，日志目录会自动创建但需确认父目录存在。  
5. **语法兼容性**：对于 Go 语言的 `init()` 函数注入（见 Go 模板备注），必须检查目标文件是否已存在 `init()`，避免重复定义。  
6. **多语言清理注释确认**：注入的注释标记必须与 `cleanup-debug-blocks.js` 的处理能力兼容（默认支持 `//` 和 `#` 开头的单行注释，参见各模板末尾的清理说明）。

---

### 多语言埋点模板

> **清理兼容性说明**：`cleanup-debug-blocks.js` 默认处理以 `//` 或 `#` 开头的单行注释标记 `#region DEBUG` / `#endregion DEBUG`。以下模板均使用对应语言的单行注释语法，确保可被自动清理。若遇到不支持的语言（如仅支持块注释 `/* */`），AI 应优先使用 `//` 形式，其次使用 `#` 形式，并告知用户可能需手动清理。

#### JavaScript (客户端 fetch)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}, port: {{DEBUG_PORT}}]
fetch("http://localhost:{{DEBUG_PORT}}/debug/log?session_id={{DEBUG_SESSION_ID}}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "logic",
    location: "{{FILE}}:{{LINE}}",
    message: "{{MESSAGE}}",
    data: {{DATA_SNAPSHOT}},
    timestamp: Date.now()
  }),
  keepalive: true
});
// #endregion DEBUG
```

#### Node.js (ES Modules)

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

#### Node.js (CommonJS)

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

#### Python

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

#### Go

> **注意**：若目标文件已存在 `init()` 函数，不要创建新的 `init()`，而是将埋点代码追加到已有 `init()` 函数体内。

```go
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
import (
    "encoding/json"
    "os"
    "path/filepath"
    "time"
)
func init() {
    logDir := filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs")
    os.MkdirAll(logDir, 0755)
    logPath := filepath.Join(logDir, "{{DEBUG_SESSION_ID}}.log")
    f, _ := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
    defer f.Close()
    entry := map[string]interface{}{
        "type": "logic",
        "location": "{{FILE}}:{{LINE}}",
        "message": "{{MESSAGE}}",
        "data": {{DATA_SNAPSHOT}},
        "timestamp": time.Now().UnixMilli(),
    }
    json.NewEncoder(f).Encode(entry)
}
// #endregion DEBUG
```

#### Java

```java
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
    java.nio.file.Path logPath = java.nio.file.Paths.get(
        "{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs", "{{DEBUG_SESSION_ID}}.log"
    );
    java.nio.file.Files.createDirectories(logPath.getParent());
    String entry = String.format(
        "{\"type\":\"logic\",\"location\":\"%s:%d\",\"message\":\"%s\",\"data\":%s,\"timestamp\":%d}%n",
        "{{FILE}}", {{LINE}}, "{{MESSAGE}}", "{{DATA_SNAPSHOT}}", System.currentTimeMillis()
    );
    java.nio.file.Files.writeString(logPath, entry,
        java.nio.file.StandardOpenOption.CREATE,
        java.nio.file.StandardOpenOption.APPEND
    );
} catch (Exception e) {}
// #endregion DEBUG
```

#### Ruby

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

#### PHP

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

#### Rust

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

### 客户端视觉快照模板 (仅 JavaScript)

> 视觉快照仅在浏览器/WebView 环境有意义，因此只提供 JavaScript 模板。服务端语言（Python/Go/Java 等）不适用视觉埋点。

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}, port: {{DEBUG_PORT}}]
const __el = document.querySelector('{{TARGET_SELECTOR}}');
if (__el) {
  const __rect = __el.getBoundingClientRect();
  const __styles = getComputedStyle(__el);
  fetch("http://localhost:{{DEBUG_PORT}}/debug/log?session_id={{DEBUG_SESSION_ID}}", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "visual",
      location: "{{FILE}}:{{LINE}}",
      message: "[视觉快照] {{MESSAGE}}",
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

### 怀疑度计算与排序

在制定埋点计划前，为每个嫌疑点计算**怀疑度分数**（1~10），综合以下因素：

| 因素 | 影响方向 | 说明 |
|------|----------|------|
| 距异常点的调用层数 | 层数越少越低，层数越多越高 | 直接调用异常函数的节点怀疑度较低，5 层以上的上游节点怀疑度显著提高 |
| 数据变异程度 | 变换越多越高 | 拼接、类型转换、条件判断等操作越多越可疑 |
| 历史出错记录 | 出现则显著提高 | 记忆库中同函数曾为源头，直接 +3 |
| 代码复杂度 | 圈复杂度高则升高 | 分支多、条件嵌套深 |
| 视觉重叠/遮挡概率 | 存在则升高 | 元素被覆盖或 z-index 冲突 |
| 契约明确性违背 | 明确约束但可能被违反 | 设为 8~10 |

**排序**：按怀疑度从高到低选取首轮 **最多 3 个** 位置。同分时优先选靠近异常点的节点。

---

### 分层验证与停止规则

#### 首轮埋点
- 依据怀疑度排序，选取 ≤3 个位置注入。
- 执行复现，收集日志。

#### 偏差分析后决策
1. **捕获到偏差**  
   - **本地产生**（输入符合假设但输出错误）→ 当前节点即源头，停止追加。  
   - **上游传入**（输入参数已偏离假设）→ 不停止，向上追加 1~2 个埋点继续追踪。  
2. **未捕获到偏差**  
   - 重新审视假设与怀疑度排序，可能偏差在未埋点节点或复现不一致。  
   - 选取下一批 ≤2 个次高怀疑度位置继续埋点，同时考虑调整假设。  
   - 若连续两轮未捕获偏差，触发**方向自疑**（参考 `direction-doubt.md`）。  
3. **达到最大追加轮次**  
   - 总共最多 3 轮埋点追加（首轮 + 2 次追加）。  
   - 3 轮耗尽仍无法定位源头，触发方向自疑，终止埋点。

---

### 视觉问题的特殊处理

- 视觉快照日志 `type`=`visual`，与逻辑日志存储在同一 session 文件中，按时间戳排序分析。  
- 视觉偏差源头判定与逻辑一致：  
  - 自身 CSS 规则错误 → 本地产生。  
  - 受父容器继承影响 → 向上追踪 DOM 树（视为上游传入）。  
  - JS 动态计算错误 → 转入逻辑调用链追溯。

---

### 与清理工具的联动

修复完成后（Mark Fixed），必须调用 `scripts/cleanup-debug-blocks.js --session-id <id> --files <文件列表>`，清除：
- 所有源文件中 `// #region DEBUG ... // #endregion DEBUG` 块。
- 对应的 `.debug/logs/<session_id>.log` 文件。

**不要手动删除后再调用脚本，直接使用脚本完成全部清理。**

---

### 埋点安全注意事项

- 埋点代码仅读取和发送数据，不得修改任何业务变量或程序状态。  
- 客户端 fetch 必须使用 `keepalive: true`，避免页面关闭时日志丢失。  
- 服务端动态 import/require 不阻塞模块加载。  
- 视觉快照变量使用双下划线前缀（`__el`、`__rect`）避免污染作用域。  
- 多语言模板中的异常必须静默处理，不影响主流程。  
- Go 语言中注意避免重复定义 `init()` 函数，必要时将代码追加到已有 `init()` 内。

---

**使用提示**：制定埋点计划时，务必对照 `tracing-strategy.md` 的调用链和 `correctness-hypothesis.md` 的假设，确保每个埋点对应一个明确的验证问题。每一次注入都应有不可替代的验证价值。注入前完成所有安全检查，注入后立即验证服务端路径或客户端端口是否可达。