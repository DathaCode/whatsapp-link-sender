---
name: react
description: "React 19 + Vite + Tailwind v4 frontend patterns: components, state, accessibility, mobile-first layout. Use when building or changing anything under web/."
---

# React Skill

## Purpose
Frontend development with React 18+, using TypeScript, modern hooks patterns, and production-ready component architecture.

## When to Activate
- Building any frontend interface
- Creating React components
- Setting up a new React project
- State management decisions
- Performance optimization
- Writing frontend tests

## Sub-Skills
| File | When to Read |
|------|-------------|
| `component-patterns.md` | Writing or reviewing React components |
| `state-management.md` | Choosing state solutions, managing app state |
| `testing.md` | Writing frontend tests |

## Also Read
- `typescript/SKILL.md` — TypeScript patterns for React
- `security/web-security.md` — XSS prevention, input validation
- `docker/dockerfile-patterns.md` — React Dockerfile patterns

## Core React Rules
1. **Always use TypeScript** — no plain JavaScript for new projects
2. **Always use functional components** — no class components
3. **Use hooks correctly** — follow rules of hooks, proper deps arrays
4. **Keep components small** — max ~150 lines, split when larger
5. **Lift state up only when needed** — keep state as local as possible
6. **Use proper keys** — never use array index as key for dynamic lists
7. **Handle loading and error states** — every async operation needs both
8. **Memoize expensive operations** — useMemo, useCallback when appropriate
9. **Use lazy loading** — React.lazy for route-level code splitting
10. **Accessible by default** — semantic HTML, ARIA labels, keyboard nav

## Project Setup (Vite + React + TypeScript)
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install

# Essential deps
npm install axios react-router-dom @tanstack/react-query zustand
npm install -D @types/node tailwindcss postcss autoprefixer
npm install -D @testing-library/react @testing-library/jest-dom vitest jsdom
```

## Project Structure
```
frontend/
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root component with router
│   ├── components/
│   │   ├── ui/                  # Reusable UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Spinner.tsx
│   │   ├── layout/              # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Layout.tsx
│   │   └── features/            # Feature-specific components
│   │       ├── auth/
│   │       │   ├── LoginForm.tsx
│   │       │   └── RegisterForm.tsx
│   │       └── dashboard/
│   │           ├── DashboardPage.tsx
│   │           └── StatsCard.tsx
│   ├── hooks/                   # Custom hooks
│   │   ├── useAuth.ts
│   │   ├── useApi.ts
│   │   └── useDebounce.ts
│   ├── services/                # API calls
│   │   ├── api.ts               # Axios instance
│   │   ├── authService.ts
│   │   └── userService.ts
│   ├── stores/                  # State management (Zustand)
│   │   ├── authStore.ts
│   │   └── uiStore.ts
│   ├── types/                   # TypeScript types
│   │   ├── api.ts
│   │   ├── user.ts
│   │   └── common.ts
│   ├── utils/                   # Helper functions
│   │   ├── formatters.ts
│   │   └── validators.ts
│   └── styles/
│       └── globals.css
├── public/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── package.json
```

## Essential Commands
```bash
npm run dev             # Start dev server (port 5173)
npm run build           # Production build
npm run preview         # Preview production build
npm run lint            # ESLint check
npm run type-check      # TypeScript check (tsc --noEmit)
npm run test            # Vitest
npm run test:coverage   # With coverage
```
