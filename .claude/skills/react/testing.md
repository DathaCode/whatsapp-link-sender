# React Testing

## Setup (Vitest + Testing Library)
```typescript
// vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
});
```

```typescript
// src/test/setup.ts
import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
```

## Test Utilities
```tsx
// src/test/utils.tsx
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { type ReactElement } from 'react';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });

export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions,
) {
  const queryClient = createTestQueryClient();

  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    ),
    ...options,
  });
}

export { screen, waitFor, within, act } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
```

## Component Tests
```tsx
// components/ui/__tests__/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '@/test/utils';
import { Button } from '../Button';

describe('Button', () => {
  it('renders with text', () => {
    renderWithProviders(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Click</Button>);
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when loading', () => {
    renderWithProviders(<Button loading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows spinner when loading', () => {
    renderWithProviders(<Button loading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies variant styles', () => {
    renderWithProviders(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-red-600');
  });
});
```

## Form Tests
```tsx
// components/features/auth/__tests__/LoginForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/utils';
import { LoginForm } from '../LoginForm';

// Mock the auth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    login: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  }),
}));

describe('LoginForm', () => {
  it('renders email and password fields', () => {
    renderWithProviders(<LoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('submits with valid data', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Verify form was submitted (check mock was called)
  });

  it('shows validation errors for empty fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    // HTML5 validation should prevent submission
  });
});
```

## Page Tests with Data Fetching
```tsx
// components/features/dashboard/__tests__/DashboardPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { DashboardPage } from '../DashboardPage';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('http://localhost:8000/api/v1/dashboard/stats', () => {
    return HttpResponse.json({
      totalUsers: 1250,
      revenue: 45000,
      activeSessions: 89,
      errorRate: 0.5,
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('DashboardPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('status')).toBeInTheDocument(); // Spinner
  });

  it('renders stats after loading', async () => {
    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('1,250')).toBeInTheDocument();
      expect(screen.getByText('$45,000')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    server.use(
      http.get('http://localhost:8000/api/v1/dashboard/stats', () => {
        return HttpResponse.error();
      })
    );

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
  });
});
```

## Test Commands
```bash
# Run all tests
npm run test

# Run in watch mode
npm run test -- --watch

# Run specific file
npm run test -- src/components/ui/__tests__/Button.test.tsx

# With coverage
npm run test -- --coverage

# Run only tests matching name
npm run test -- -t "LoginForm"
```

## Testing Rules
```
1. Test user behavior, not implementation — click buttons, fill inputs, check text
2. Use getByRole, getByLabelText, getByText — not getByTestId (last resort)
3. Never test internal state — test what the user sees
4. Mock API calls with MSW — don't mock fetch/axios directly
5. Test loading, success, and error states
6. Use userEvent over fireEvent (more realistic)
7. Prefer renderWithProviders for consistency
8. Don't test third-party libraries — test YOUR code using them
```
