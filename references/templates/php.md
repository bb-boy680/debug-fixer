# PHP Instrumentation Template

```php
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
try {
    $logDir = "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs";
    if (!is_dir($logDir)) { mkdir($logDir, 0755, true); }
    $entry = json_encode([
        "type" => "logic",
        "location" => __FILE__ . ":{{LINE}}",
        "message" => "{{MESSAGE}}",
        "data" => {{DATA_SNAPSHOT}},
        "timestamp" => round(microtime(true) * 1000)
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($entry !== false) {
        file_put_contents($logDir . "/{{DEBUG_SESSION_ID}}.log", $entry . "\n", FILE_APPEND);
    }
} catch (\Throwable $e) {
    // Ignore debug instrumentation errors.
}
// #endregion DEBUG
```
