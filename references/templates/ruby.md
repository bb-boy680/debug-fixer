# Ruby Instrumentation Template

```ruby
# #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
begin
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
rescue StandardError
  # Ignore debug instrumentation errors.
end
# #endregion DEBUG
```
