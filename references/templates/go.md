# Go Instrumentation Template

## Notes

The Go template has two parts: `init()` handles creating the log directory (only one per package), and the `{}` block inside the function body records the log. Place each part in the appropriate location accordingly.

If the target file already has an `init()` function, only add the directory creation code to the existing `init()` body — don't create a duplicate `init()`.

## Template

```go
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
// ── Package-level code (file top, import area) ──
import (
    "encoding/json"
    "os"
    "path/filepath"
    "time"
)
func init() {
    _ = os.MkdirAll(filepath.Join("{{ABSOLUTE_PROJECT_PATH}}", ".debug", "logs"), 0755)
}

// ── Function body code ──
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
