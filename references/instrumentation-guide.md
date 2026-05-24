# Instrumentation System

When multi-dimension scanning cannot determine the root cause through static code analysis alone, or when you need to confirm cross-dimension cross-cutting points, inject instrumentation to collect runtime evidence.

This document has three parts: environment detection, template selection, and instrumentation strategy.

**Contents:** [Environment Detection](#environment-detection) · [Core Principles](#core-principles) · [Client Debug Service](#client-debug-service-startup) · [Log Format](#log-format) · [Template Selection](#template-selection) · [Common Templates](#common-templates) · [Instrumentation Strategy](#instrumentation-strategy) · [Pre-Injection Checks](#pre-injection-safety-checks) · [Cleanup Integration](#cleanup-integration)

---

## Environment Detection

Before selecting a template, confirm the target code's actual runtime environment. You already know where the code runs from the call chain you reconstructed during multi-dimension scanning. The purpose here is to **avoid being misled by file extensions**.

### Common Pitfalls

`.tsx` does not mean browser. Ink uses React JSX for terminal UI (Node). Next.js Server Components are also `.tsx` (Node). Isomorphic code may run in both browser and Node environments.

### Detection Method

Judge based on package.json dependencies and code content:

| Signal | Actual Environment | Template |
|--------|-------------------|----------|
| `ink` dependency + `bin` field | Node (TUI) | Node file write |
| Next.js `app/`, no `'use client'` | Node (Server Component) | Node file write |
| Next.js `app/`, with `'use client'` | Browser | fetch |
| `pages/api/` or `app/api/` | Node (API Route) | Node file write |
| `ipcRenderer` + DOM API | Browser (Electron renderer) | fetch |
| `BrowserWindow` / `ipcMain` | Node (Electron main) | Node file write |
| `import * as vscode from 'vscode'` | Node (VS Code Extension) | Node file write |
| `react-native` + `StyleSheet` | Client | File write |

If uncertain, default to Node file write — file writes don't depend on HTTP service availability, one less failure point.

After detection, state clearly in the instrumentation plan: `Environment: [client/server], Template: [fetch/file write]`.

---

## Core Principles

- Each instrumentation point must have a clear verification purpose: validate a specific hypothesis, not "see what's here"
- All instrumentation wrapped with `#region DEBUG`: this is the marker `cleanup-debug-blocks.js` recognizes and removes
- Template structure must not be modified: only replace `{{placeholders}}`, don't change log fields or wrapping
- Logs written to the same session file `.debug/logs/{session_id}.log`, one JSON line per entry
- Instrumentation only reads and sends data; it must not modify business variables or program state
- Fail silently: serialization, network, or file write failures must not affect the main flow — this is also why `console.log` is not used

### Why Not console.log

Scattered `console.log` has three problems:
1. Mixed into application logs, cannot be batch-cleaned afterward
2. Inconsistent formats across locations, cannot aggregate by session for analysis
3. May be stripped in production, or may be left in — both are wrong

Standard templates write unified JSON to dedicated log files. The cleanup script removes them in one pass, no trace left behind.

## Client Debug Service Startup

Client-side instrumentation sends logs through a local HTTP log service. Ensure the service is running before injecting instrumentation:

1. **Health check**: GET `http://localhost:9220/health`
   - Returns `200 OK` → service is running, proceed with injection
   - No response or connection refused → service not started, go to step 2
2. **Start service**: `node <skill base directory>/scripts/launch-debugger.js`
   - Launches in a new terminal window, port fixed at 9220
   - `pwd` is passed via HTTP request body, not as a startup parameter. One service can serve multiple projects
3. Health check again to confirm service is reachable

> Replace `{{PROJECT_ROOT}}` with the absolute path of the current project root (obtained via `pwd` command), placed in the `pwd` field of the request body.

## Log Format

All instrumentation outputs a single line of JSON, written to `.debug/logs/<session_id>.log`. For each instrumentation, record only the minimum fields needed for localization; avoid large objects and circular references.

```json
{
  "type": "logic | visual",
  "location": "file_path:line_number",
  "message": "[enter] / [return] / [branch] / [exception] / [state_change] / [visual_snapshot]",
  "data": { },
  "timestamp": 1712345678901
}
```

- `type: "logic"` — logic instrumentation, `data` contains key variable snapshots.
- `type: "visual"` — visual instrumentation, `data` contains `computedStyles`, `boundingClientRect`, `viewport`, `classList`, etc.

## Template Selection

Select based on environment detection result and project language. **Common templates are directly below; other language templates are read on demand from their respective files.**

| Language | Environment | Template Location |
|----------|-------------|-------------------|
| JavaScript / TypeScript | Client (Browser) | Below — JS Client fetch |
| JavaScript / TypeScript | Server (Node ESM) | Below — Node.js ES Modules |
| JavaScript / TypeScript | Server (Node CJS) | Below — Node.js CommonJS |
| Python | Server | Below — Python |
| Go | Server | `<skill base directory>/references/templates/go.md>` |
| Java | Server | `<skill base directory>/references/templates/java.md>` |
| Ruby | Server | `<skill base directory>/references/templates/ruby.md>` |
| PHP | Server | `<skill base directory>/references/templates/php.md>` |
| Rust | Server | `<skill base directory>/references/templates/rust.md>` |
| Visual Snapshot | Client (Browser) | Below — Visual Snapshot template |

> Cleanup compatibility: `cleanup-debug-blocks.js` handles single-line comment markers `#region DEBUG` / `#endregion DEBUG` prefixed with `//` or `#`.

## Common Templates

### JavaScript (Client fetch)

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
// #endregion DEBUG
```

### Node.js (CommonJS)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
require("fs").appendFileSync(
  "{{ABSOLUTE_PROJECT_PATH}}/.debug/logs/{{DEBUG_SESSION_ID}}.log",
  JSON.stringify({
    type: "logic",
    location: "{{FILE}}:{{LINE}}",
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
        "location": "{{FILE}}:{{LINE}}",
        "message": "{{MESSAGE}}",
        "data": {{DATA_SNAPSHOT}},
        "timestamp": time.time()
    }, default=str) + "\n")
# #endregion DEBUG
```

### Visual Snapshot (JavaScript Client Only)

```javascript
// #region DEBUG [sessionId: {{DEBUG_SESSION_ID}}]
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
    message: "[visual snapshot] {{MESSAGE}}",
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
      boundingClientRect: { x: __rect.x, y: __rect.y, width: __rect.width, height: __rect.height },
      classList: Array.from(__el.classList),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    },
    timestamp: Date.now()
  }),
  keepalive: true
});
// #endregion DEBUG
```

## Instrumentation Strategy

### Bisection Method

Select instrumentation positions through call-chain bisection, not suspicion scoring:

1. Draw the complete call chain from the anomaly point to the data entry point.
2. Inject the first instrumentation at the call chain **midpoint**.
3. Reproduce and examine logs:
   - Data is **correct** → problem is in the lower half (closer to anomaly), continue bisecting in the lower half midpoint.
   - Data is **already deviated** → problem is in the upper half (closer to entry), continue bisecting in the upper half midpoint.
4. Max 3 instrumentation points per round. 2-3 rounds should converge to a single node.

> For multi-branch call chains (non-linear), instrument at branch points simultaneously to determine which branch is taken.

### Log Content Checklist

Each round of instrumentation must answer all four questions:

| Question | Field | Example |
|----------|-------|---------|
| What did the function receive? | Input | `{ args: [userId, options] }` |
| What did the function return? | Output | `{ return: { ok: true } }` |
| Which branch was taken? | Branch condition | `{ branch: "isAdmin", value: false }` |
| What side effects occurred? | State changes | `{ storeState: {...}, domChanged: true }` |

### Layered Verification & Stop Rules

#### First Round
- Select ≤3 positions via bisection.
- Reproduce, collect logs.

#### Call Chain Verification

After collecting first-round instrumentation logs, before analyzing data deviation, verify that the statically-constructed call chain is correct:

1. Sort logs by timestamp, reconstruct actual execution order from the `location` field.
2. Compare layer by layer against the static call chain:
   - **Consistent** → call chain correct, proceed to deviation analysis.
   - **Differences found** (extra intermediate layers, missing hops) → correct the call chain based on actual logs, redesign the instrumentation plan.
3. After chain correction, continue from current progress without returning to the bisection starting point.

> This step requires no additional code — only examining existing logs' `location` and `data` — but avoids wasting all instrumentation rounds on an incorrect call chain.

#### Decision After Deviation Analysis

1. **Deviation captured**
   - **Locally produced** (input matches hypothesis but output/side-effect is wrong) → current node is the source, stop adding.
   - **Upstream passed in** (input already deviated from hypothesis) → continue bisecting upward.
2. **No deviation captured**
   - Bisect at the midpoint of the uncovered call chain segment, while confirming reproduction steps are consistent.
   - Two consecutive rounds without capturing deviation → trigger **direction doubt**.
3. **Max additional rounds reached**
   - Maximum of 3 instrumentation rounds total (first round + 2 additional rounds).
   - 3 rounds exhausted without locating the source → trigger direction doubt, terminate instrumentation.

### Visual Issue Special Handling

The visual snapshot template is only a reference framework — **you decide which CSS properties and DOM dimensions to observe based on the bug's rendering chain**. The 8 properties in the template are examples, not a fixed checklist. The key question: which aspect does this bug involve — position, sizing, layering, or visibility? What are the corresponding CSS properties and computed styles?

- Core principle: **simultaneously log "calculated values" and "actual DOM values," and compare the difference.** The difference itself is the clue — e.g., JS calculates height as 979px but DOM actual is 991px, indicating CSS auto-compute behavior is affecting the result.
- Visual snapshot logs use `type: "visual"`, stored in the same session file as logic logs, analyzed by timestamp order.
- Visual deviation source determination:
  - Self CSS rule error → locally produced.
  - Affected by parent container inheritance/override → trace upward through DOM tree (treated as upstream passed in).
  - JS dynamic calculation error → switch to logic call chain tracing.
  - **Browser auto-compute behavior** (auto sizing, flex/grid layout allocation, viewBox adaptation) → not a CSS mistake, but computed results don't match expectations; need to explicitly override default behavior.

### Heisenbug Protection

Instrumentation itself can change program behavior, especially for bugs involving race conditions and timing:

- `fetch` must use `keepalive: true` to ensure logs aren't lost on page close, while not blocking the main thread.
- File writes must use append mode, no locking.
- **If the bug involves race conditions/async timing**: the bug disappearing after instrumentation is an important signal — the slight timing change introduced by instrumentation altered the execution order. Do not continue instrumentation; switch to static code reasoning, focusing on timing dependencies of `Promise`, `setTimeout`, `await`.
- Visual snapshot variables use double-underscore prefix (`__el`, `__rect`) to avoid polluting scope.
- All exceptions must be handled silently; log write failures must not throw errors.

## Pre-Injection Safety Checks

Before writing any instrumentation into user code, verify each item:

1. **Duplicate injection check**: Does the target location already have a `#region DEBUG` block? If so, do not inject again.
2. **Scope check**: The injection point must be inside a function body/method body/module top-level executable code block. Do not inject into class definitions, interface declarations, or type definitions.
3. **Port consistency check**: The port in the client fetch template is fixed at `9220`, consistent with `debugger-server.js`.
4. **Server writability check**: `{{ABSOLUTE_PROJECT_PATH}}` in server templates must be a writable path.
5. **Cleanup comment compatibility**: Injected comment markers must be compatible with `cleanup-debug-blocks.js` (supports `//` and `#` prefixed single-line comments).

## Cleanup Integration

After the confirmation round passes, decide whether to call the cleanup script in the same round:

```bash
node <skill base directory>/scripts/cleanup-debug-blocks.js --session-id <id> --files <file list>
```

Automatically removes all `#region DEBUG` blocks in source files and the corresponding log files. **Use the script for all cleanup — don't manually delete.** Cleanup is predicated on user-confirmed results; don't execute before the user has responded.
