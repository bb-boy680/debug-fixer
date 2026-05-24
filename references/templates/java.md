# Java Instrumentation Template

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
} catch (Exception e) {
    // Ignore debug instrumentation errors.
}
// #endregion DEBUG
```
