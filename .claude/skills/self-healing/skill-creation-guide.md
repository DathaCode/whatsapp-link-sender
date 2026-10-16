# Skill Creation Guide

## When to Create a New Skill
- A pattern has been used successfully 3+ times across different projects
- A complex workflow needs to be standardized
- A common error keeps appearing and the fix should be documented
- The user explicitly asks to document a pattern

## Skill File Structure

### SKILL.md (Required — Entry Point)
```markdown
# [Skill Name]

## Purpose
One sentence explaining what this skill teaches Claude to do.

## When to Activate
- Trigger condition 1
- Trigger condition 2

## Sub-Skills
| File | When to Read |
|------|-------------|
| `sub-file.md` | Condition for reading this sub-file |

## Core Rules (Apply Always)
1. Rule 1
2. Rule 2

## Quick Checklist
□ Check item 1
□ Check item 2
```

### Sub-Skill Files (One Per Topic)
```markdown
# [Topic Name]

## [Pattern/Section 1]
### When
Description of when this applies

### How
Code examples, configurations, commands

### Why
Brief explanation of reasoning

## [Pattern/Section 2]
...

## Checklist
□ Verification item 1
□ Verification item 2
```

## Quality Rules for Skill Files
1. **Concrete over abstract** — always include real code examples, not just theory
2. **Copy-pasteable** — code blocks should work with minimal modification
3. **Contextual** — include when/where each pattern applies
4. **Opinionated** — give one recommended approach, then alternatives
5. **Checklists** — end every file with a verification checklist
6. **Anti-patterns** — show what NOT to do alongside what TO do
7. **Cross-reference** — link to other skill files when relevant

## Naming Conventions
- Folder names: `kebab-case` (e.g., `cost-reducer`, `self-healing`)
- File names: `kebab-case.md` (e.g., `auth-and-secrets.md`)
- SKILL.md is always capitalized (entry point)
