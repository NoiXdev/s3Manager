# S3 Manager — UI Foundation, App Shell & Accounts (Plan 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the React + Tailwind 4 renderer with a section-nav app shell and full account management (add/test/list/select/remove Amazon S3 + Hetzner accounts), consuming the existing typed `window.s3` IPC bridge.

**Architecture:** The renderer is a React 18 app bundled by the existing Electron Forge Vite renderer target. It talks to the backend only through `window.s3` (the typed preload bridge from Plan 1). TanStack Query manages async/list/mutation state. Components are function components styled with Tailwind 4 (config-less, via `@tailwindcss/vite`). Every component/hook is tested with Vitest + React Testing Library against a mocked `window.s3`.

**Tech Stack:** React 18, `@vitejs/plugin-react`, Tailwind CSS 4 (`@tailwindcss/vite`), `@tanstack/react-query`, Vitest + jsdom + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom`.

**Prerequisite:** Plan 1 (backend foundation) is merged to `develop`. `window.s3` exposes: `accounts.list()`, `accounts.create(input)`, `accounts.remove(id)`, `accounts.test(input)`, `encryptionAvailable()`, plus the S3 ops (used in Plan 2b). All return `Promise<Result<T>>` where `Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }`. `Account = { id, label, provider, endpoint?, region, accessKeyId, createdAt }`. `CreateAccountInput = { label, provider, region, accessKeyId, secretAccessKey }`. `provider` is `'amazon-s3' | 'hetzner'`.

---

## File Structure

```
src/renderer/
  main.tsx                       # React entry: mounts <App/> with QueryClientProvider
  index.css                      # Tailwind import + base styles
  types/global.d.ts              # window.s3 typing (S3Api from preload)
  lib/result.ts                  # unwrap(Result) -> data | throw  (for React Query)
  lib/providers.ts               # re-export PROVIDERS list for UI (id -> label)
  state/SelectionContext.tsx     # selected account id (lifted state)
  hooks/useAccounts.ts           # list/create/remove/testConnection query+mutations
  components/SectionNav.tsx      # left rail: Files / Dashboard / Object Lock / CORS / Settings
  components/AppShell.tsx        # nav + active section content region
  components/accounts/AccountsPane.tsx     # list + badges + select + remove + add button
  components/accounts/AddAccountForm.tsx   # modal form: fields + Test connection + submit
  components/accounts/ProviderBadge.tsx    # small provider label chip
  App.tsx                        # composes AppShell; Files section renders AccountsPane (pane 1)
index.html                       # entry script -> /src/renderer/main.tsx (modified)
vite.renderer.config.ts          # add react() + tailwindcss() plugins (modified)
vitest.config.ts                 # jsdom for src/renderer/**, setup file (modified)
vitest.setup.ts                  # import @testing-library/jest-dom (created)
package.json                     # renderer deps (modified)
```

Plan 2b adds `components/buckets/*`, `components/files/*`, and the bucket/object hooks under the same `src/renderer` tree.

---

## Task 1: Renderer toolchain — React, Tailwind 4, Vitest/jsdom

**Files:**
- Modify: `package.json`
- Modify: `vite.renderer.config.ts`
- Modify: `vitest.config.ts`
- Create: `vitest.setup.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install react react-dom @tanstack/react-query
npm install -D @vitejs/plugin-react tailwindcss @tailwindcss/vite @types/react @types/react-dom jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 2: Configure the renderer Vite build** — replace `vite.renderer.config.ts` with:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

- [ ] **Step 3: Create `vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Update `vitest.config.ts`** to keep main-process tests on node and run renderer tests in jsdom. Replace its contents with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['src/renderer/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 5: Verify the suite still runs (all Plan 1 tests pass, no renderer tests yet)**

Run: `npm test`
Expected: 45 passing, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.renderer.config.ts vitest.config.ts vitest.setup.ts
git commit -m "chore: add React, Tailwind 4, and RTL/jsdom test setup for renderer"
```

---

## Task 2: Typed `window.s3` global + Result unwrap helper

**Files:**
- Create: `src/renderer/types/global.d.ts`
- Create: `src/renderer/lib/result.ts`
- Test: `src/renderer/lib/result.test.ts`

- [ ] **Step 1: Declare the global** — `src/renderer/types/global.d.ts`:

```ts
import type { S3Api } from '../../preload';

declare global {
  interface Window {
    s3: S3Api;
  }
}

export {};
```

- [ ] **Step 2: Write the failing test** — `src/renderer/lib/result.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unwrap } from './result';

describe('unwrap', () => {
  it('returns data for an ok Result', () => {
    expect(unwrap({ ok: true, data: 42 })).toBe(42);
  });

  it('throws an Error carrying the code + message for an err Result', () => {
    expect(() => unwrap({ ok: false, error: { code: 'AccessDenied', message: 'nope' } })).toThrowError(
      /AccessDenied: nope/,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/result.test.ts`
Expected: FAIL — cannot find module `./result`.

- [ ] **Step 4: Implement** — `src/renderer/lib/result.ts`:

```ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Unwrap a Result for use with TanStack Query: returns data or throws so the
 *  query/mutation enters its error state with a readable message. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(`${result.error.code}: ${result.error.message}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/result.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/types/global.d.ts src/renderer/lib/result.ts src/renderer/lib/result.test.ts
git commit -m "feat(ui): add typed window.s3 global and Result unwrap helper"
```

---

## Task 3: Provider list for the UI

**Files:**
- Create: `src/renderer/lib/providers.ts`
- Test: `src/renderer/lib/providers.test.ts`

Reuses the backend registry (pure, no Node deps) so provider ids/labels stay single-sourced.

- [ ] **Step 1: Write the failing test** — `src/renderer/lib/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UI_PROVIDERS } from './providers';

describe('UI_PROVIDERS', () => {
  it('exposes id + label for amazon-s3 and hetzner', () => {
    expect(UI_PROVIDERS).toEqual([
      { id: 'amazon-s3', label: 'Amazon S3' },
      { id: 'hetzner', label: 'Hetzner Object Storage' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/providers.test.ts`
Expected: FAIL — cannot find module `./providers`.

- [ ] **Step 3: Implement** — `src/renderer/lib/providers.ts`:

```ts
import { PROVIDERS, type ProviderId } from '../../main/s3/providers';

export interface UiProvider {
  id: ProviderId;
  label: string;
}

export const UI_PROVIDERS: UiProvider[] = PROVIDERS.map((p) => ({ id: p.id, label: p.label }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/providers.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/providers.ts src/renderer/lib/providers.test.ts
git commit -m "feat(ui): derive UI provider list from backend registry"
```

---

## Task 4: React entry + Tailwind base + boot smoke test

**Files:**
- Create: `src/renderer/index.css`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`
- Modify: `index.html`
- Test: `src/renderer/App.test.tsx`

- [ ] **Step 1: Create `src/renderer/index.css`**

```css
@import 'tailwindcss';

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
}
```

- [ ] **Step 2: Write the failing test** — `src/renderer/App.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app shell with the product name', () => {
    render(<App />);
    expect(screen.getByText('S3 Manager')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — cannot find module `./App`.

- [ ] **Step 4: Create a minimal `src/renderer/App.tsx`** (expanded in Task 6/8):

```tsx
export function App() {
  return (
    <div className="flex h-full text-sm text-slate-800">
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
        <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
      </aside>
      <main className="flex-1 overflow-auto p-4">Select a section</main>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/renderer/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Replace `index.html`** so the renderer mounts React:

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>S3 Manager</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/renderer/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Delete the obsolete starter renderer entry**

```bash
git rm src/renderer.ts src/index.css
```
(The old `src/renderer.ts`/`src/index.css` are replaced by `src/renderer/main.tsx` + `src/renderer/index.css`.)

- [ ] **Step 8: Run test + typecheck**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (1 test).
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ui): React entry, Tailwind base, and app shell skeleton"
```

---

## Task 5: SectionNav component

**Files:**
- Create: `src/renderer/components/SectionNav.tsx`
- Test: `src/renderer/components/SectionNav.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/SectionNav.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders all sections and marks the active one', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    for (const label of ['Files', 'Dashboard', 'Object Lock', 'CORS', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="files" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: FAIL — cannot find module `./SectionNav`.

- [ ] **Step 3: Implement** — `src/renderer/components/SectionNav.tsx`:

```tsx
export type Section = 'files' | 'dashboard' | 'objectLock' | 'cors' | 'settings';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'objectLock', label: 'Object Lock' },
  { id: 'cors', label: 'CORS' },
  { id: 'settings', label: 'Settings' },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {SECTIONS.map((s) => {
        const isActive = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
            className={`rounded px-2 py-1.5 text-left ${
              isActive ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SectionNav.tsx src/renderer/components/SectionNav.test.tsx
git commit -m "feat(ui): add SectionNav"
```

---

## Task 6: Account hooks (list)

**Files:**
- Create: `src/renderer/hooks/useAccounts.ts`
- Test: `src/renderer/hooks/useAccounts.test.tsx`

`window.s3` is mocked in tests. A shared test helper wraps hooks in a `QueryClientProvider`.

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useAccounts.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAccounts } from './useAccounts';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }),
    },
  };
});

describe('useAccounts', () => {
  it('loads the account list', async () => {
    const { result } = renderHook(() => useAccounts(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].label).toBe('AWS prod');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useAccounts.test.tsx`
Expected: FAIL — cannot find module `./useAccounts`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useAccounts.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export const accountsKey = ['accounts'] as const;

export function useAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: async () => unwrap(await window.s3.accounts.list()),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useAccounts.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useAccounts.ts src/renderer/hooks/useAccounts.test.tsx
git commit -m "feat(ui): add useAccounts query hook"
```

---

## Task 7: Account mutations (create, remove, testConnection)

**Files:**
- Modify: `src/renderer/hooks/useAccounts.ts`
- Modify: `src/renderer/hooks/useAccounts.test.tsx`

- [ ] **Step 1: Add failing tests** — append to `src/renderer/hooks/useAccounts.test.tsx` (add `useCreateAccount`, `useRemoveAccount`, `useTestConnection` to the `./useAccounts` import):

```tsx
describe('account mutations', () => {
  it('useCreateAccount calls accounts.create and returns the new account', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, data: { id: 'b', label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 } });
    (window as unknown as { s3: unknown }).s3 = { accounts: { create, list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    const { result } = renderHook(() => useCreateAccount(), { wrapper: wrapper() });
    const created = await result.current.mutateAsync({ label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK' });
    expect(create).toHaveBeenCalled();
    expect(created.id).toBe('b');
  });

  it('useTestConnection returns true on success and throws the message on failure', async () => {
    const test = vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'bad key' } });
    (window as unknown as { s3: unknown }).s3 = { accounts: { test } };
    const { result } = renderHook(() => useTestConnection(), { wrapper: wrapper() });
    await expect(
      result.current.mutateAsync({ label: 'H', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK' }),
    ).rejects.toThrow(/AccessDenied: bad key/);
  });

  it('useRemoveAccount calls accounts.remove', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, data: true });
    (window as unknown as { s3: unknown }).s3 = { accounts: { remove, list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    const { result } = renderHook(() => useRemoveAccount(), { wrapper: wrapper() });
    await result.current.mutateAsync('a');
    expect(remove).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/hooks/useAccounts.test.tsx`
Expected: FAIL — the three hooks are not exported.

- [ ] **Step 3: Implement** — append to `src/renderer/hooks/useAccounts.ts` (add `useMutation`, `useQueryClient` to the `@tanstack/react-query` import):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateAccountInput } from '../../main/ipc/channels';

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAccountInput) => unwrap(await window.s3.accounts.create(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useRemoveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await window.s3.accounts.remove(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (input: CreateAccountInput) => unwrap(await window.s3.accounts.test(input)),
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/hooks/useAccounts.test.tsx`
Expected: PASS (all 4 tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useAccounts.ts src/renderer/hooks/useAccounts.test.tsx
git commit -m "feat(ui): add account create/remove/test-connection mutations"
```

---

## Task 8: ProviderBadge component

**Files:**
- Create: `src/renderer/components/accounts/ProviderBadge.tsx`
- Test: `src/renderer/components/accounts/ProviderBadge.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/accounts/ProviderBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProviderBadge } from './ProviderBadge';

describe('ProviderBadge', () => {
  it('shows the human label for a provider id', () => {
    render(<ProviderBadge provider="hetzner" />);
    expect(screen.getByText('Hetzner Object Storage')).toBeInTheDocument();
  });

  it('falls back to the raw id for an unknown provider', () => {
    render(<ProviderBadge provider={'gcs' as never} />);
    expect(screen.getByText('gcs')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/accounts/ProviderBadge.test.tsx`
Expected: FAIL — cannot find module `./ProviderBadge`.

- [ ] **Step 3: Implement** — `src/renderer/components/accounts/ProviderBadge.tsx`:

```tsx
import type { ProviderId } from '../../../main/s3/providers';
import { UI_PROVIDERS } from '../../lib/providers';

export function ProviderBadge({ provider }: { provider: ProviderId }) {
  const label = UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{label}</span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/accounts/ProviderBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/ProviderBadge.tsx src/renderer/components/accounts/ProviderBadge.test.tsx
git commit -m "feat(ui): add ProviderBadge"
```

---

## Task 9: AddAccountForm component

**Files:**
- Create: `src/renderer/components/accounts/AddAccountForm.tsx`
- Test: `src/renderer/components/accounts/AddAccountForm.test.tsx`

A controlled form with label, provider, region, accessKeyId, secretAccessKey. "Test connection" runs `useTestConnection` and shows the outcome inline. "Add account" calls `onSubmit` with the input. Provider/region default to the first provider / its typical region.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/accounts/AddAccountForm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AddAccountForm } from './AddAccountForm';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { test: vi.fn().mockResolvedValue({ ok: true, data: true }) },
  };
});

describe('AddAccountForm', () => {
  it('submits the entered values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AddAccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Label'), 'AWS prod');
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'amazon-s3');
    await userEvent.clear(screen.getByLabelText('Region'));
    await userEvent.type(screen.getByLabelText('Region'), 'eu-central-1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIA');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(onSubmit).toHaveBeenCalledWith({
      label: 'AWS prod',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    });
  });

  it('runs a connection test and reports success', async () => {
    wrap(<AddAccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection OK')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/accounts/AddAccountForm.test.tsx`
Expected: FAIL — cannot find module `./AddAccountForm`.

- [ ] **Step 3: Implement** — `src/renderer/components/accounts/AddAccountForm.tsx`:

```tsx
import { useState } from 'react';
import type { CreateAccountInput } from '../../../main/ipc/channels';
import { UI_PROVIDERS } from '../../lib/providers';
import { useTestConnection } from '../../hooks/useAccounts';

const fieldClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1';

export function AddAccountForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: CreateAccountInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<CreateAccountInput['provider']>(UI_PROVIDERS[0].id);
  const [region, setRegion] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const test = useTestConnection();

  const input: CreateAccountInput = { label, provider, region, accessKeyId, secretAccessKey };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(input);
      }}
    >
      <label className="block">
        Label
        <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="block">
        Provider
        <select className={fieldClass} value={provider} onChange={(e) => setProvider(e.target.value as CreateAccountInput['provider'])}>
          {UI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        Region
        <input className={fieldClass} value={region} onChange={(e) => setRegion(e.target.value)} />
      </label>
      <label className="block">
        Access key ID
        <input className={fieldClass} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
      </label>
      <label className="block">
        Secret access key
        <input type="password" className={fieldClass} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          disabled={test.isPending}
          onClick={() => test.mutate(input)}
        >
          Test connection
        </button>
        {test.isSuccess && <span className="text-sm text-green-600">Connection OK</span>}
        {test.isError && <span className="text-sm text-red-600">{(test.error as Error).message}</span>}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1 hover:bg-slate-100" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700">
          Add account
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/accounts/AddAccountForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/AddAccountForm.tsx src/renderer/components/accounts/AddAccountForm.test.tsx
git commit -m "feat(ui): add AddAccountForm with inline connection test"
```

---

## Task 10: AccountsPane component

**Files:**
- Create: `src/renderer/components/accounts/AccountsPane.tsx`
- Test: `src/renderer/components/accounts/AccountsPane.test.tsx`

Lists accounts with `ProviderBadge`, highlights the selected one, calls `onSelect(id)`, removes via `useRemoveAccount`, toggles the `AddAccountForm`, and shows an onboarding empty state when there are no accounts.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/accounts/AccountsPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountsPane } from './AccountsPane';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const oneAccount = [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: oneAccount }),
      remove: vi.fn().mockResolvedValue({ ok: true, data: true }),
    },
  };
});

describe('AccountsPane', () => {
  it('shows the onboarding empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = { accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    wrap(<AccountsPane selectedId={null} onSelect={() => {}} />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('lists accounts and selects one on click', async () => {
    const onSelect = vi.fn();
    wrap(<AccountsPane selectedId={null} onSelect={onSelect} />);
    const row = await screen.findByText('AWS prod');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('opens the add-account form', async () => {
    wrap(<AccountsPane selectedId={null} onSelect={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add account' }));
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/accounts/AccountsPane.test.tsx`
Expected: FAIL — cannot find module `./AccountsPane`.

- [ ] **Step 3: Implement** — `src/renderer/components/accounts/AccountsPane.tsx`:

```tsx
import { useState } from 'react';
import { useAccounts, useCreateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from './ProviderBadge';
import { AddAccountForm } from './AddAccountForm';

export function AccountsPane({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const removeAccount = useRemoveAccount();
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <div className="p-3">
        <h2 className="pb-2 font-medium">Add account</h2>
        <AddAccountForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await createAccount.mutateAsync(input);
            setAdding(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accounts</span>
        <button type="button" className="rounded px-2 py-0.5 text-sm hover:bg-slate-100" onClick={() => setAdding(true)}>
          + Add account
        </button>
      </div>

      {accounts.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {accounts.isError && <p className="p-3 text-red-600">{(accounts.error as Error).message}</p>}

      {accounts.isSuccess && accounts.data.length === 0 && (
        <div className="p-3 text-slate-500">
          <p className="font-medium text-slate-700">No accounts yet</p>
          <p className="mt-1 text-sm">Add an Amazon S3 or Hetzner account to get started.</p>
        </div>
      )}

      <ul className="flex-1 overflow-auto">
        {accounts.data?.map((acc) => (
          <li key={acc.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(acc.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(acc.id)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                acc.id === selectedId ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <span className="flex flex-col">
                <span className="font-medium">{acc.label}</span>
                <ProviderBadge provider={acc.provider} />
              </span>
              <button
                type="button"
                aria-label={`Remove ${acc.label}`}
                className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAccount.mutate(acc.id);
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/accounts/AccountsPane.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/AccountsPane.tsx src/renderer/components/accounts/AccountsPane.test.tsx
git commit -m "feat(ui): add AccountsPane with list, select, remove, add"
```

---

## Task 11: Compose the shell — wire SectionNav + AccountsPane into App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

The Files section renders the three-pane layout; in Plan 2a only pane 1 (AccountsPane) is real, with placeholders for the buckets/files panes (filled in Plan 2b). Selected account id is held in `App` state and passed down. Non-Files sections show a "Coming soon" placeholder.

- [ ] **Step 1: Update the failing test** — replace `src/renderer/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
  };
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders the shell with the product name and Files section active by default', async () => {
    renderApp();
    expect(screen.getByText('S3 Manager')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('switches to a placeholder section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'CORS' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — App still renders the skeleton, not the nav/sections.

- [ ] **Step 3: Implement** — replace `src/renderer/App.tsx`:

```tsx
import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountsPane } from './components/accounts/AccountsPane';

export function App() {
  const [section, setSection] = useState<Section>('files');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  return (
    <div className="flex h-full text-sm text-slate-800">
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
        <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
        <SectionNav active={section} onSelect={setSection} />
      </aside>

      <main className="flex-1 overflow-hidden">
        {section === 'files' ? (
          <div className="flex h-full">
            <div className="w-60 shrink-0 border-r border-slate-200">
              <AccountsPane selectedId={selectedAccountId} onSelect={setSelectedAccountId} />
            </div>
            <div className="w-64 shrink-0 border-r border-slate-200 p-3 text-slate-400">
              Buckets (Plan 2b)
            </div>
            <div className="flex-1 p-3 text-slate-400">File browser (Plan 2b)</div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (2 tests).
Run: `npm test`
Expected: all tests pass (Plan 1's 45 + the new renderer tests).
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): compose app shell with section nav and accounts pane"
```

---

## Manual smoke checklist (run once after Task 11)

`npm start`, then:
1. Window opens showing the **S3 Manager** shell with the section nav.
2. Files section shows "No accounts yet" onboarding in pane 1.
3. Click **+ Add account**, fill an Amazon S3 account, click **Test connection** → "Connection OK" (with valid creds) or a red error (with bad creds).
4. **Add account** → it appears in the list with its provider badge.
5. Add a Hetzner account; both list correctly.
6. Click an account → it highlights (selection state for Plan 2b).
7. Remove an account via ✕ → it disappears.
8. Switch sections (Dashboard/CORS/etc.) → "Coming soon"; back to Files → accounts still listed.
9. Restart the app → accounts persist (secrets in keychain, config in SQLite).

---

## Self-Review

**Spec coverage (UI scope of `2026-05-29-s3-manager-foundation-mvp-design.md`):**
- App shell with section nav (Files / Dashboard / Object Lock / CORS / Settings) → Tasks 5, 11. ✅
- Three-pane Files layout with accounts as pane 1 → Task 11 (panes 2–3 are placeholders for Plan 2b). ✅
- Add account form (label, provider, region/endpoint, keys) + Test connection → Task 9. ✅
- List buckets/objects, metadata panel, drag-drop upload, download, delete, presign, visibility badges → **Plan 2b** (explicitly out of scope here). ✅ (deferred, not missing)
- No-accounts onboarding state → Task 10. ✅
- React + Tailwind 4 + React Query → Tasks 1, 4, 6. ✅
- Secrets never in renderer: the form sends `secretAccessKey` to `accounts.create`/`accounts.test` over IPC; it is never read back (the `Account` type has no secret). ✅

**Placeholder scan:** none — every code step is complete and runnable. The "Buckets (Plan 2b)"/"File browser (Plan 2b)" strings are intentional UI placeholders for the next plan, not plan placeholders.

**Type consistency:** `Section` ids (`files|dashboard|objectLock|cors|settings`), `CreateAccountInput`, `accountsKey`, and the hook names (`useAccounts`, `useCreateAccount`, `useRemoveAccount`, `useTestConnection`) are defined once and referenced consistently. `CreateAccountInput` is imported from `../../main/ipc/channels` (the single source from Plan 1). `Account` shape used in tests matches Plan 1's `accountsRepo.Account`.

**Note for implementers:** `endpoint` is intentionally absent from `CreateAccountInput` — the backend resolves it from provider+region (Plan 1, Task 19). The form only collects region.
