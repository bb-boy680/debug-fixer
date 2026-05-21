# Go 埋点模板

## 注意事项

Go 模板分为两部分：`init()` 负责创建日志目录（每个包只需一份），函数体内 `{}` 代码块负责记录日志。两部分需分别放到文件顶部和函数体内。

若目标文件已存在 `init()` 函数，只取目录创建代码追加到已有 `init()` 体内，不要创建重复的 `init()`。

## 模板

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
    _ = os.MkdirAll(filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs"), 0755)
}

// ── 函数体内代码 ──
{
    if f, err := os.OpenFile(
        filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs", "{{DEBUG_SESSION_ID}}.log"),
        os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644,
    ); err == nil {
        defer f.Close()
        _ = json.NewEncoder(f).Encode(map[string]interface{}{
            "type":     "logic",
            "location": "{{FILE}}:{{LINE}}",
            "message":  "{{MESSAGE}}",
            "data":     {{DATA_SNAPSHOT}},
            "timestamp": time.Now().UnixMilli(),
        })
    }
}
// #endregion DEBUG
```
