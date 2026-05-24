---
name: debug-fixer
description: Use when a user reports a bug, crash, test failure, unexpected behavior, UI display issues, styling problems, incorrect data, unresponsive clicks, or behavior that doesn't match expectations. Spawns a multi-dimension scan agent to globally identify candidate root causes. Allows exactly one static fix attempt; if it fails, collects runtime evidence via instrumentation (frontend HTTP + backend file write, 7 language templates) to pinpoint the root cause. When stuck, spawns an independent review agent to identify blind spots from an external perspective. Automatically cleans up instrumentation after fix.
---

## Paths & Resources

- Two agents (`agents/multi-dimension-scan`, `agents/senior-review`) can be spawned independently with isolated context. When spawning, only pass facts — don't teach method. Agents come with their own execution framework
- `references/instrumentation-guide.md`: instrumentation templates + environment detection + bisection strategy. Read only when injecting instrumentation
- `scripts/`: `launch-debugger.js` (start log server), `cleanup-debug-blocks.js` (remove instrumentation code)
- All paths resolved relative to `<skill base directory>`

## Session ID

Generate immediately when skill triggers: `debug_YYYYMMDD-HHmmss-xxxx`. No script dependency. All instrumentation and log files in this round share this ID.

---

# Debug Fixer

You get one guess. If it's wrong, let runtime evidence do the talking. If you can't find it yourself, let someone else look.

---

## Step 1: Scan Code, Identify Candidate Sources

Spawn `agents/multi-dimension-scan`. Pass only the bug symptoms and any existing evidence. The agent performs a four-dimension scan:

- **Data flow**: the full lifecycle of data from origin to consumption, all write points
- **Control flow**: execution order, condition branches, race windows, side-effect chains
- **Visual**: the intersection of DOM + CSS + JS dynamic styles. Client-side bugs often originate in CSS, not JS — browser layout behavior (flexbox centering, auto sizing, viewBox scaling) can override JS calculations
- **Contract**: whether inter-module data agreements are violated

Agent returns cross-cutting nodes, 1-3 candidate sources, and a recommended next step.

---

## Step 2: Fix Once

You get exactly one static fix attempt. Static reasoning can identify at most one root cause — if that's wrong, you need runtime data.

### Fast Track

Obvious typos, missing null checks, missing imports, inverted conditions — fix directly.

### Gated Fix (3 of 4 required)

| # | Condition |
|---|-----------|
| 1 | Small scope (1-2 files, tens of lines) |
| 2 | Can explain complete propagation path from source to symptom |
| 3 | Does not involve async/race conditions/caching |
| 4 | Scan confirms single-dimension, single-point (not cross-dimensional) |

### Skip to Instrumentation

Async, race conditions, caching, multi-entry state, cross-dimensional — proceed directly to Step 3.

### Fix Failed

- Stop all code changes immediately. If you're thinking "one more attempt should work," you're guessing
- Revert your changes manually (use Edit tool, not git — git reset destroys uncommitted changes from other conversations)
- Proceed to Step 3

---

## Step 3: Instrument, Collect Runtime Evidence

**No console.log / print / echo.** They mix into application output, can't be cleaned up, and can't be aggregated by session. Standard templates write unified JSON to dedicated files; the cleanup script removes them in one pass.

### Injection Flow

1. Read `references/instrumentation-guide.md`, determine environment, select template
2. Apply template verbatim. Only replace `{{placeholders}}`. Replace `{{DEBUG_SESSION_ID}}` with the session ID generated at skill start
3. Select positions via call-chain bisection: ≤3 in first round, ≤2 per additional round, ≤3 rounds total
4. For client-side, check `http://localhost:9220/health` first; if down, start log service
5. Clear log: `echo "" > .debug/logs/{session_id}.log`
6. Tell user to reproduce

### Each Round Must Answer

- What was received? (input snapshot)
- What was returned? (output snapshot)
- Which branch was taken? (condition snapshot)
- What side effects occurred? (state/effect changes)

### Visual Instrumentation

Don't blindly copy the template's fixed property list. Decide which CSS properties and DOM dimensions to observe based on the bug's rendering chain. **Log both calculated values and actual DOM values — the difference IS the clue.**

- Two consecutive rounds with no deviation captured → spawn senior-review
- Three rounds exhausted without locating the source → spawn senior-review

---

## Step 4: Fix Based on Evidence

- Once runtime evidence points to the first deviation point, make a minimal fix at the source
- Run typecheck and lint
- Enter confirmation round: briefly tell user what you changed, how you verified, and ask for confirmation

### Interpreting User Feedback

Users only say "fixed" or "still broken." They won't analyze for you.

- **"Fixed"** → proceed to cleanup
- **"Still broken"** → assess yourself:
  - Have a new direction that needs instrumentation to verify? → go back to Step 3 and **inject new instrumentation**. Old instrumentation only validated the old hypothesis; a new direction needs new data
  - Circling on the same idea? → spawn senior-review
  - Logic looks correct but bug persists? → the issue is likely in CSS. Check whether browser layout behavior is overriding JS calculations

---

## Spawn Senior-Review Agent

When you've been debugging the same bug for a while without progress, your thinking narrows — you keep re-examining the same files and the same hypotheses. The senior-review agent solves this: it has clean context, no memory of your failed attempts, and can spot what you've been blind to. Spawning it isn't admitting failure — it's using the right tool for the situation.

Here are signs that escalation will help more than another round of debugging alone:

- **You've run multiple instrumentation rounds and the fix still doesn't work.** The runtime data says the logic is correct, but the bug persists — the real problem is likely somewhere you haven't looked yet.
- **You're going down the same path repeatedly.** Same function, same file, same type of fix, different parameters — you're in a tunnel. The agent sees the landscape.
- **Instrumentation logs show no logic errors, yet the bug remains.** This is a strong signal that the root cause is in a dimension you haven't instrumented — likely CSS, a side effect, or a module contract violation.
- **The user has said "still broken" several times** and each of your fixes was a different guess. You're sampling, not diagnosing.

None of these require counting rounds. If you notice any of these patterns, pause and escalate — you'll save time.

Before spawning: manually revert failed changes, summarize what you tried, your hypotheses, user feedback, and log conclusions. Agent only analyzes, does not modify code. You execute after receiving recommendations.

**Can be triggered multiple times.** If the bug persists after the first review, spawn again — include the new failure information. Each agent instance has independent context, unaffected by previous inertia.

---

## After Fix

Once user confirms the fix, execute automatically:

1. If instrumentation was used, clean up (script filters by session ID, removing only current session's `#region DEBUG` blocks):
   ```bash
   node <skill base directory>/scripts/cleanup-debug-blocks.js --session-id {id} --files {file list} --log-file .debug/logs/{id}.log
   ```
2. One sentence to inform user of cleanup result
