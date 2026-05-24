# Rust Instrumentation Template

```rust
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
{
    use std::io::Write;
    let log_dir = std::path::Path::new("{{ABSOLUTE_PROJECT_PATH}}").join(".debug/logs");
    std::fs::create_dir_all(&log_dir).ok();
    let log_path = log_dir.join("{{DEBUG_SESSION_ID}}.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let entry = serde_json::json!({
            "type": "logic",
            "location": format!("{}:{}", file!(), {{LINE}}),
            "message": "{{MESSAGE}}",
            "data": {{DATA_SNAPSHOT}},
            "timestamp": timestamp
        });
        let _ = writeln!(f, "{}", entry);
    }
}
// #endregion DEBUG
```
