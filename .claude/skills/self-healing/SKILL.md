---
name: self-healing
description: "Error-recovery discipline: read the full error, find the root cause, never retry the same failing command, escalate after repeated failures, and record new gotchas in the project-memory skill. Use whenever a command, test, build or container fails, or the user corrects you."
---

# Self-Healing Skill

## Purpose
Teaches Claude Code to learn from its own mistakes, recognize patterns in errors, and improve its output quality over time within a session and across projects.

## When to Activate
- When a command or code fails
- When a test doesn't pass
- When a deployment breaks
- When the user says "that's wrong" or corrects Claude
- When the same type of error occurs more than once

## Sub-Skills
| File | When to Read |
|------|-------------|
| `pattern-recognition.md` | After any error — identify if this is a known pattern |
| `memory-management.md` | To track what worked and what didn't across the session |
| `skill-creation-guide.md` | When a new pattern emerges that should be documented |

## Core Self-Healing Loop
```
1. ERROR OCCURS
   ↓
2. IDENTIFY — What exactly failed? Read the full error message.
   ↓
3. CATEGORIZE — Is this a known pattern? Check pattern-recognition.md
   ↓
4. DIAGNOSE — Root cause, not symptoms. Don't just retry the same thing.
   ↓
5. FIX — Apply the correct fix based on diagnosis
   ↓
6. VERIFY — Run the command/test again to confirm the fix works
   ↓
7. DOCUMENT — If this is a new pattern, note it for future reference
   ↓
8. PREVENT — Update the approach to prevent this error class entirely
```

## Anti-Patterns (Things Claude Must NEVER Do)
1. **Never retry the exact same command** hoping for a different result
2. **Never ignore error messages** — read them completely
3. **Never apply a fix without understanding the root cause**
4. **Never say "that should work"** without actually testing it
5. **Never blame the environment** before checking the code
6. **Never make multiple changes at once** — fix one thing, test, then next
7. **Never delete and recreate** when a targeted fix is possible

## Escalation Rules
- After 2 failed attempts at the same fix → change approach entirely
- After 3 different approaches fail → stop and explain the problem to the user
- If the error is outside Claude's control (cloud service down, permission issue) → tell the user immediately, don't keep trying
