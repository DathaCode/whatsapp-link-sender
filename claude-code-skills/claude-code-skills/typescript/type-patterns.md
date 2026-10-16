# TypeScript Type Patterns

## API Response Types
```typescript
// types/api.ts

// Generic API response wrapper
interface ApiResponse<T> {
  data: T;
  message?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

// Error response
interface ApiError {
  error: string;
  detail?: Record<string, unknown>;
  status: number;
}

// API call result (discriminated union)
type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };
```

## Domain Types
```typescript
// types/user.ts
export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'admin' | 'user' | 'viewer';

// For creating (omit server-generated fields)
export type UserCreate = Pick<User, 'email' | 'name'> & {
  password: string;
};

// For updating (all fields optional)
export type UserUpdate = Partial<Pick<User, 'name' | 'email' | 'role'>>;

// For display (exclude sensitive fields)
export type UserPublic = Omit<User, 'updated_at'>;
```

## Discriminated Unions (State Machines)
```typescript
// Async operation states
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string };

// Usage
function renderState<T>(state: AsyncState<T>) {
  switch (state.status) {
    case 'idle':
      return null;
    case 'loading':
      return <Spinner />;
    case 'success':
      return <DataView data={state.data} />;  // TypeScript knows data exists
    case 'error':
      return <Error message={state.error} />;  // TypeScript knows error exists
  }
}

// Payment method example
type PaymentMethod =
  | { type: 'credit_card'; cardNumber: string; expiry: string; cvv: string }
  | { type: 'paypal'; email: string }
  | { type: 'bank_transfer'; accountNumber: string; routingNumber: string };

function processPayment(method: PaymentMethod) {
  switch (method.type) {
    case 'credit_card':
      // TypeScript knows cardNumber, expiry, cvv exist
      return chargeCard(method.cardNumber, method.expiry, method.cvv);
    case 'paypal':
      return chargePaypal(method.email);
    case 'bank_transfer':
      return initTransfer(method.accountNumber, method.routingNumber);
  }
}
```

## Generics
```typescript
// Generic API service
async function fetchApi<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// Usage — TypeScript infers the return type
const user = await fetchApi<User>('/api/users/1');
const users = await fetchApi<PaginatedResponse<User>>('/api/users');

// Generic component
interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
}

function List<T>({ items, renderItem, keyExtractor, emptyMessage }: ListProps<T>) {
  if (items.length === 0) return <p>{emptyMessage || 'No items'}</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
```

## Utility Types Cheatsheet
```typescript
// Built-in utility types you should use often

Partial<T>          // All properties optional
Required<T>         // All properties required
Pick<T, K>          // Select specific properties
Omit<T, K>          // Remove specific properties
Record<K, T>        // Object with keys K and values T
Readonly<T>         // All properties readonly
ReturnType<T>       // Return type of a function
Parameters<T>       // Parameter types of a function
Extract<T, U>       // Extract types assignable to U
Exclude<T, U>       // Exclude types assignable to U
NonNullable<T>      // Remove null and undefined

// Custom utility types
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

type Nullable<T> = T | null;

type ValueOf<T> = T[keyof T];
```

## Type Guards
```typescript
// Type guard functions
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'email' in value &&
    'name' in value
  );
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    'status' in error
  );
}

// Usage
try {
  const result = await fetchApi('/api/users/1');
  if (isUser(result)) {
    console.log(result.email);  // TypeScript knows this is a User
  }
} catch (err) {
  if (isApiError(err)) {
    console.error(err.error);  // TypeScript knows this is an ApiError
  }
}

// Narrowing with typeof and instanceof
function format(value: string | number | Date): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toFixed(2);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
```

## Const Assertions and Enums
```typescript
// Prefer const objects over enums
const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  VIEWER: 'viewer',
} as const;

type Role = typeof ROLES[keyof typeof ROLES];  // 'admin' | 'user' | 'viewer'

// Status codes
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];
```
