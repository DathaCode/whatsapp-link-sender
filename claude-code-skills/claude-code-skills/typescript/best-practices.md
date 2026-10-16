# TypeScript Best Practices

## Do's and Don'ts

### Never Use `any`
```typescript
// BAD
function processData(data: any) { return data.name; }

// GOOD — use unknown and narrow
function processData(data: unknown): string {
  if (typeof data === 'object' && data !== null && 'name' in data) {
    return String((data as { name: unknown }).name);
  }
  throw new Error('Invalid data');
}

// GOOD — define the type
interface UserData { name: string; email: string; }
function processData(data: UserData): string { return data.name; }
```

### Prefer Interfaces for Objects
```typescript
// Use interface for object shapes (extendable)
interface User {
  id: number;
  name: string;
  email: string;
}

// Use type for unions, intersections, utilities
type Status = 'active' | 'inactive' | 'suspended';
type UserWithRole = User & { role: string };
type UserKeys = keyof User;
```

### Handle Null/Undefined Properly
```typescript
// BAD — non-null assertion (lies to compiler)
// const name = user!.name;

// GOOD — null check
const name = user?.name ?? 'Unknown';

// GOOD — early return
function getUserName(user: User | null): string {
  if (!user) return 'Unknown';
  return user.name;
}

// GOOD — type guard
function isValid(value: string | null | undefined): value is string {
  return value != null && value.length > 0;
}
```

### Use Exhaustive Checks
```typescript
type Status = 'pending' | 'active' | 'inactive';

function getStatusLabel(status: Status): string {
  switch (status) {
    case 'pending': return 'Pending Approval';
    case 'active': return 'Active';
    case 'inactive': return 'Inactive';
    default: {
      // This ensures you handle all cases
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
// If you add a new Status, TypeScript will error until you handle it
```

### Type Imports
```typescript
// GOOD — separate type imports (tree-shakeable)
import type { User, UserCreate } from '@/types/user';
import { userService } from '@/services/userService';

// GOOD — inline type imports
import { userService, type User } from '@/services/userService';
```

### Event Handler Types
```typescript
// React event types
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setValue(e.target.value);
};

const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
};

const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
  // ...
};

const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') submit();
};
```

### Async Error Handling
```typescript
// BAD — untyped catch
try { await fetchUser(); }
catch (e) { console.log(e.message); }  // e is unknown

// GOOD — typed error handling
try {
  await fetchUser();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('Unknown error:', error);
  }
}

// GOOD — custom error class
class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

try {
  await fetchUser();
} catch (error) {
  if (error instanceof AppError) {
    // Full type safety
    handleError(error.statusCode, error.code, error.message);
  }
}
```

### Environment Variables
```typescript
// src/env.ts — type-safe environment variables
const getEnvVar = (key: string, fallback?: string): string => {
  const value = import.meta.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
};

export const env = {
  API_URL: getEnvVar('VITE_API_URL', 'http://localhost:8000'),
  APP_NAME: getEnvVar('VITE_APP_NAME', 'MyApp'),
  IS_PROD: import.meta.env.PROD,
  IS_DEV: import.meta.env.DEV,
} as const;

// Vite type declarations
// src/vite-env.d.ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_APP_NAME: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

### Records and Maps
```typescript
// Use Record for known key sets
const statusColors: Record<Status, string> = {
  pending: 'yellow',
  active: 'green',
  inactive: 'gray',
};

// Use Map for dynamic keys
const cache = new Map<string, User>();
cache.set('user_123', user);
const cached = cache.get('user_123');  // User | undefined
```

## Code Organization
```
1. Exports at the top of the file (export interface, export type, export function)
2. Types/interfaces before the code that uses them
3. Constants before functions
4. Helper functions before the main export
5. Default export last (if any)
6. One component per file — file name matches component name
7. Co-locate types with the code that uses them (unless shared)
8. Shared types in /types directory
```
