---
name: typescript
description: "TypeScript standards for Node backends and React frontends: strict mode, no any, NodeNext ESM imports with .js suffixes, zod at boundaries. Use when writing or reviewing any .ts/.tsx file or tsconfig."
---

# TypeScript Skill

## Purpose
Type-safe JavaScript development for React frontends, Node.js backends, and shared utilities. TypeScript is mandatory for all new JavaScript projects.

## When to Activate
- Writing any JavaScript code (always use TypeScript instead)
- Defining types and interfaces for API responses, models, props
- Setting up a new TypeScript project
- Debugging type errors
- Configuring tsconfig.json

## Sub-Skills
| File | When to Read |
|------|-------------|
| `type-patterns.md` | Writing types, interfaces, generics, utility types |
| `project-setup.md` | tsconfig, ESLint, path aliases |
| `best-practices.md` | Coding standards, anti-patterns, tips |

## Also Read
- `react/SKILL.md` — React-specific TypeScript patterns

## Core TypeScript Rules
1. **No `any`** — use `unknown` if type is truly unknown, then narrow
2. **No type assertions** (`as`) unless absolutely necessary — prefer type guards
3. **Always define return types** for exported functions
4. **Use interfaces for objects** — use types for unions, intersections, utilities
5. **Use strict mode** — `"strict": true` in tsconfig
6. **Use `const` assertions** — for literal types and enums
7. **Use discriminated unions** — for state management and error handling
8. **Never use `!`** (non-null assertion) — handle null properly
9. **Use path aliases** — `@/components` instead of `../../../components`
10. **Export types separately** — `export type { User }` for type-only exports
