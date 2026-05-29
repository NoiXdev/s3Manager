# S3 Manager — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global, scan-free dashboard — summary cards (accounts, buckets, provider split) + a per-account bucket breakdown that click-throughs into the Files view — replacing the Dashboard section's "Coming soon" placeholder.

**Architecture:** Renderer-only (no main/preload changes). A `Dashboard` view fetches the account list (`useAccounts`) and fans out one cached `listBuckets` query per account via a new `useAllBuckets` hook (TanStack `useQueries`, reusing the existing `bucketsKey` so it shares cache with the Files buckets view). All totals are derived in the renderer; one account failing to load is isolated.

**Tech Stack:** React 19, TanStack Query (`useQueries`), Tailwind 4, Vitest + React Testing Library.

**Prerequisite (existing, do not redefine):**
- `src/renderer/hooks/useBuckets.ts` exports `bucketsKey(accountId: string | null)` → `['buckets', accountId]` and uses `queryFn: async () => unwrap(await window.s3.listBuckets(accountId!))`.
- `src/renderer/hooks/useAccounts.ts` exports `useAccounts()` → `Account[]` query. `Account = { id: string; label: string; provider: 'amazon-s3' | 'hetzner'; endpoint?: string; region: string; accessKeyId: string; createdAt: number }` (from `src/main/storage/accountsRepo.ts`).
- `src/renderer/lib/result.ts` exports `unwrap`.
- `src/renderer/lib/providers.ts` exports `UI_PROVIDERS: { id: ProviderId; label: string }[]`.
- `src/renderer/components/accounts/ProviderBadge.tsx` exports `ProviderBadge({ provider })`.
- `window.s3.listBuckets(accountId: string): Promise<Result<string[]>>`.
- `App.tsx` owns `section`/`accountId`/`bucket`/`prefix`/`selectedKey` state and renders `<… Coming soon …>` for non-`files` sections. `Section` includes `'dashboard'`.

---

## File Structure

```
src/renderer/
  hooks/useAllBuckets.ts                       # useQueries fan-out -> per-account buckets
  components/dashboard/SummaryCards.tsx        # presentational: totals + provider split
  components/dashboard/AccountBreakdown.tsx    # presentational: per-account rows + bucket chips
  components/dashboard/Dashboard.tsx           # section view: fetch + aggregate + render
  App.tsx                                      # MODIFY: render Dashboard for section==='dashboard' + openInFiles
```

---

## Task 1: useAllBuckets hook

**Files:**
- Create: `src/renderer/hooks/useAllBuckets.ts`
- Test: `src/renderer/hooks/useAllBuckets.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useAllBuckets.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAllBuckets } from './useAllBuckets';
import type { Account } from '../../main/storage/accountsRepo';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const accounts: Account[] = [
  { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 },
  { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn((id: string) =>
      id === 'acc-1'
        ? Promise.resolve({ ok: true, data: ['assets', 'backups'] })
        : Promise.resolve({ ok: false, error: { code: 'AccessDenied', message: 'no' } }),
    ),
  };
});

describe('useAllBuckets', () => {
  it('returns per-account buckets and isolates a failing account', async () => {
    const { result } = renderHook(() => useAllBuckets(accounts), { wrapper: wrapper() });
    await waitFor(() => expect(result.current[0].isLoading).toBe(false));
    await waitFor(() => expect(result.current[1].isLoading).toBe(false));

    expect(result.current[0]).toMatchObject({ accountId: 'acc-1', buckets: ['assets', 'backups'], isError: false });
    expect(result.current[1]).toMatchObject({ accountId: 'acc-2', buckets: [], isError: true });
  });

  it('returns an empty array for no accounts', () => {
    const { result } = renderHook(() => useAllBuckets([]), { wrapper: wrapper() });
    expect(result.current).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useAllBuckets.test.tsx`
Expected: FAIL — cannot find module `./useAllBuckets`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useAllBuckets.ts`:

```ts
import { useQueries } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { bucketsKey } from './useBuckets';
import type { Account } from '../../main/storage/accountsRepo';

export interface AccountBuckets {
  accountId: string;
  buckets: string[];
  isLoading: boolean;
  isError: boolean;
}

export function useAllBuckets(accounts: Account[]): AccountBuckets[] {
  const results = useQueries({
    queries: accounts.map((account) => ({
      queryKey: bucketsKey(account.id),
      queryFn: async () => unwrap(await window.s3.listBuckets(account.id)),
    })),
  });

  return accounts.map((account, i) => ({
    accountId: account.id,
    buckets: results[i]?.data ?? [],
    isLoading: results[i]?.isLoading ?? false,
    isError: results[i]?.isError ?? false,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useAllBuckets.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useAllBuckets.ts src/renderer/hooks/useAllBuckets.test.tsx
git commit -m "feat(ui): add useAllBuckets fan-out hook"
```

---

## Task 2: SummaryCards component

**Files:**
- Create: `src/renderer/components/dashboard/SummaryCards.tsx`
- Test: `src/renderer/components/dashboard/SummaryCards.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/dashboard/SummaryCards.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryCards } from './SummaryCards';

describe('SummaryCards', () => {
  it('renders account total, bucket total, and the provider split', () => {
    render(
      <SummaryCards
        accountCount={3}
        bucketCount={5}
        providerAccountCounts={[
          { provider: 'amazon-s3', count: 2 },
          { provider: 'hetzner', count: 1 },
        ]}
      />,
    );
    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Buckets')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Amazon S3 · 2')).toBeInTheDocument();
    expect(screen.getByText('Hetzner Object Storage · 1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/dashboard/SummaryCards.test.tsx`
Expected: FAIL — cannot find module `./SummaryCards`.

- [ ] **Step 3: Implement** — `src/renderer/components/dashboard/SummaryCards.tsx`:

```tsx
import type { ProviderId } from '../../../main/s3/providers';
import { UI_PROVIDERS } from '../../lib/providers';

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function SummaryCards({
  accountCount,
  bucketCount,
  providerAccountCounts,
}: {
  accountCount: number;
  bucketCount: number;
  providerAccountCounts: { provider: ProviderId; count: number }[];
}) {
  const label = (p: ProviderId) => UI_PROVIDERS.find((x) => x.id === p)?.label ?? p;

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card label="Accounts">
        <span className="text-2xl font-semibold">{accountCount}</span>
      </Card>
      <Card label="Buckets">
        <span className="text-2xl font-semibold">{bucketCount}</span>
      </Card>
      <Card label="Providers">
        <ul className="text-sm text-slate-700">
          {providerAccountCounts.map((pc) => (
            <li key={pc.provider}>
              {label(pc.provider)} · {pc.count}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/dashboard/SummaryCards.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/SummaryCards.tsx src/renderer/components/dashboard/SummaryCards.test.tsx
git commit -m "feat(ui): add dashboard SummaryCards"
```

---

## Task 3: AccountBreakdown component

**Files:**
- Create: `src/renderer/components/dashboard/AccountBreakdown.tsx`
- Test: `src/renderer/components/dashboard/AccountBreakdown.test.tsx`

Presentational: one row per account (clickable header opening the account, bucket chips opening each bucket), with per-account loading/error states.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/dashboard/AccountBreakdown.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountBreakdown, type BreakdownItem } from './AccountBreakdown';

const items: BreakdownItem[] = [
  {
    account: { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 },
    buckets: ['assets', 'backups'],
    isLoading: false,
    isError: false,
  },
  {
    account: { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 },
    buckets: [],
    isLoading: false,
    isError: true,
  },
];

describe('AccountBreakdown', () => {
  it('renders accounts with bucket chips and a per-account error', () => {
    render(<AccountBreakdown items={items} onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open account AWS prod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'backups' })).toBeInTheDocument();
    expect(screen.getByText("Couldn't load buckets")).toBeInTheDocument();
  });

  it('calls onOpenBucket when a bucket chip is clicked', async () => {
    const onOpenBucket = vi.fn();
    render(<AccountBreakdown items={items} onOpenAccount={() => {}} onOpenBucket={onOpenBucket} />);
    await userEvent.click(screen.getByRole('button', { name: 'assets' }));
    expect(onOpenBucket).toHaveBeenCalledWith('acc-1', 'assets');
  });

  it('calls onOpenAccount when the account header is clicked', async () => {
    const onOpenAccount = vi.fn();
    render(<AccountBreakdown items={items} onOpenAccount={onOpenAccount} onOpenBucket={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open account AWS prod' }));
    expect(onOpenAccount).toHaveBeenCalledWith('acc-1');
  });

  it('shows a loading hint while an account is loading', () => {
    render(
      <AccountBreakdown
        items={[{ account: items[0].account, buckets: [], isLoading: true, isError: false }]}
        onOpenAccount={() => {}}
        onOpenBucket={() => {}}
      />,
    );
    expect(screen.getByText('Loading buckets…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/dashboard/AccountBreakdown.test.tsx`
Expected: FAIL — cannot find module `./AccountBreakdown`.

- [ ] **Step 3: Implement** — `src/renderer/components/dashboard/AccountBreakdown.tsx`:

```tsx
import type { Account } from '../../../main/storage/accountsRepo';
import { ProviderBadge } from '../accounts/ProviderBadge';

export interface BreakdownItem {
  account: Account;
  buckets: string[];
  isLoading: boolean;
  isError: boolean;
}

export function AccountBreakdown({
  items,
  onOpenAccount,
  onOpenBucket,
}: {
  items: BreakdownItem[];
  onOpenAccount: (accountId: string) => void;
  onOpenBucket: (accountId: string, bucket: string) => void;
}) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {items.map(({ account, buckets, isLoading, isError }) => (
        <li key={account.id} className="rounded border border-slate-200 bg-white p-3">
          <button
            type="button"
            aria-label={`Open account ${account.label}`}
            onClick={() => onOpenAccount(account.id)}
            className="flex items-center gap-2 text-left"
          >
            <span className="font-medium">{account.label}</span>
            <ProviderBadge provider={account.provider} />
            {!isLoading && !isError && (
              <span className="text-xs text-slate-400">
                {buckets.length} bucket{buckets.length === 1 ? '' : 's'}
              </span>
            )}
          </button>

          {isLoading && <p className="mt-2 text-sm text-slate-500">Loading buckets…</p>}
          {isError && <p className="mt-2 text-sm text-red-600">Couldn't load buckets</p>}

          {!isLoading && !isError && buckets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {buckets.map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => onOpenBucket(account.id, bucket)}
                  className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200"
                >
                  {bucket}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/dashboard/AccountBreakdown.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/AccountBreakdown.tsx src/renderer/components/dashboard/AccountBreakdown.test.tsx
git commit -m "feat(ui): add dashboard AccountBreakdown"
```

---

## Task 4: Dashboard component

**Files:**
- Create: `src/renderer/components/dashboard/Dashboard.tsx`
- Test: `src/renderer/components/dashboard/Dashboard.test.tsx`

Composes `useAccounts` + `useAllBuckets`, derives the aggregates, handles the no-accounts empty state, and wires click handlers through to its props.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/dashboard/Dashboard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Dashboard } from './Dashboard';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const accounts = [
  { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 },
  { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: accounts }) },
    listBuckets: vi.fn((id: string) =>
      id === 'acc-1'
        ? Promise.resolve({ ok: true, data: ['assets'] })
        : Promise.resolve({ ok: true, data: ['x', 'y'] }),
    ),
  };
});

describe('Dashboard', () => {
  it('shows totals and a per-account breakdown', async () => {
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(await screen.findByText('Accounts')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument(); // accounts
    expect(await screen.findByText('3')).toBeInTheDocument(); // buckets (1 + 2)
    expect(await screen.findByRole('button', { name: 'Open account AWS prod' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'assets' })).toBeInTheDocument();
  });

  it('opens a bucket via click-through', async () => {
    const onOpenBucket = vi.fn();
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={onOpenBucket} />);
    await userEvent.click(await screen.findByRole('button', { name: 'assets' }));
    expect(onOpenBucket).toHaveBeenCalledWith('acc-1', 'assets');
  });

  it('shows an onboarding empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      listBuckets: vi.fn(),
    };
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/dashboard/Dashboard.test.tsx`
Expected: FAIL — cannot find module `./Dashboard`.

- [ ] **Step 3: Implement** — `src/renderer/components/dashboard/Dashboard.tsx`:

```tsx
import { useAccounts } from '../../hooks/useAccounts';
import { useAllBuckets } from '../../hooks/useAllBuckets';
import { UI_PROVIDERS } from '../../lib/providers';
import { SummaryCards } from './SummaryCards';
import { AccountBreakdown, type BreakdownItem } from './AccountBreakdown';

export function Dashboard({
  onOpenAccount,
  onOpenBucket,
}: {
  onOpenAccount: (accountId: string) => void;
  onOpenBucket: (accountId: string, bucket: string) => void;
}) {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const perAccount = useAllBuckets(accounts);

  if (accountsQuery.isLoading) {
    return <div className="p-6 text-slate-500">Loading…</div>;
  }
  if (accountsQuery.isError) {
    return <div className="p-6 text-red-600">{(accountsQuery.error as Error).message}</div>;
  }
  if (accounts.length === 0) {
    return (
      <div className="p-6 text-slate-500">
        <p className="font-medium text-slate-700">No accounts yet</p>
        <p className="mt-1 text-sm">Add an account in the Files view to populate the dashboard.</p>
      </div>
    );
  }

  const items: BreakdownItem[] = accounts.map((account, i) => ({
    account,
    buckets: perAccount[i]?.buckets ?? [],
    isLoading: perAccount[i]?.isLoading ?? false,
    isError: perAccount[i]?.isError ?? false,
  }));

  const bucketCount = items.reduce((sum, it) => sum + it.buckets.length, 0);
  const providerAccountCounts = UI_PROVIDERS.map((p) => ({
    provider: p.id,
    count: accounts.filter((a) => a.provider === p.id).length,
  })).filter((pc) => pc.count > 0);

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Dashboard</h2>
      <SummaryCards accountCount={accounts.length} bucketCount={bucketCount} providerAccountCounts={providerAccountCounts} />
      <AccountBreakdown items={items} onOpenAccount={onOpenAccount} onOpenBucket={onOpenBucket} />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/dashboard/Dashboard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/Dashboard.tsx src/renderer/components/dashboard/Dashboard.test.tsx
git commit -m "feat(ui): add Dashboard view"
```

---

## Task 5: Wire Dashboard into App with click-through

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

Render `Dashboard` for `section === 'dashboard'`; add an `openInFiles(accountId, bucket?)` helper so dashboard clicks select the account/bucket and switch to the Files view.

- [ ] **Step 1: Add the failing test** — append to `src/renderer/App.test.tsx` (the `beforeEach` already stubs `window.s3` with `accounts.list` + `listBuckets` + `listObjects` etc.; `userEvent`/`screen` are imported):

```tsx
describe('App — Dashboard', () => {
  it('shows the dashboard and click-through opens a bucket in the Files view', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    // Dashboard renders the per-account breakdown
    const bucketChip = await screen.findByRole('button', { name: 'assets' });
    await userEvent.click(bucketChip);
    // Now in the Files view: Files is active and the file browser shows the bucket's object
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('logo.png')).toBeInTheDocument();
  });
});
```

Note: this assumes the existing `App.test.tsx` `beforeEach` stubs `listBuckets` → `['assets']` and `listObjects` → a listing containing `logo.png` (the mock set in the Plan 2b-2b work). FIRST read the current `App.test.tsx` `beforeEach`; if the stubbed bucket name or object name differs, align the chip name (`assets`) and the post-click-through assertion (`logo.png`) to whatever that mock actually returns. The point of the test is unchanged: clicking a dashboard bucket chip lands in the Files view showing that bucket's contents.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — Dashboard section still renders "Coming soon".

- [ ] **Step 3: Implement** — modify `src/renderer/App.tsx`. Add the import:

```tsx
import { Dashboard } from './components/dashboard/Dashboard';
```

Add the `openInFiles` helper alongside the existing `selectAccount`/`selectBucket`/`navigate` helpers:

```tsx
  const openInFiles = (id: string, b: string | null = null) => {
    setAccountId(id);
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
    setSection('files');
  };
```

Replace the non-`files` branch (the ternary's `else`) so Dashboard renders for its section. Change:

```tsx
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}
```

to:

```tsx
          ) : section === 'dashboard' ? (
            <Dashboard
              onOpenAccount={(id) => openInFiles(id, null)}
              onOpenBucket={(id, b) => openInFiles(id, b)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}
```

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS.
Run: `npm test`
Expected: all pass.
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): wire Dashboard into App with click-through to Files"
```

---

## Manual smoke checklist (after Task 5)

`npm start`, with ≥1 account configured:
1. Click **Dashboard** → summary cards show account count, bucket count, and provider split; a per-account breakdown lists each account with its bucket chips.
2. An account with bad credentials shows "Couldn't load buckets" on its row while the rest of the board still renders.
3. Click a bucket chip → jumps to the **Files** view with that account + bucket selected (file browser shows its contents).
4. Click an account header → jumps to Files with that account selected (its bucket list).
5. With no accounts → "No accounts yet" onboarding.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-dashboard-design.md`):**
- Global overview across all accounts, scan-free → Tasks 1, 4 (`useAllBuckets` fan-out, derived totals). ✅
- Summary: total accounts, total buckets, provider split → Task 2 (`SummaryCards`) + Task 4 (derivation). ✅
- Per-account breakdown with bucket lists → Task 3 (`AccountBreakdown`). ✅
- Click-through into Files (bucket + account) → Tasks 3, 5 (`openInFiles`). ✅
- Cache shared with Files buckets view → Task 1 reuses `bucketsKey`. ✅
- Per-account error isolation; no-accounts empty state; loading → Tasks 1, 3, 4. ✅
- Replace "Coming soon" placeholder → Task 5. ✅
- No backend/preload changes → confirmed (all tasks renderer-only). ✅
- Out of scope (object counts, size, charts) → none added. ✅

**Placeholder scan:** none — every step has complete, runnable code/commands.

**Type consistency:** `AccountBuckets` (`{accountId, buckets, isLoading, isError}`) from Task 1; `BreakdownItem` (`{account, buckets, isLoading, isError}`) defined in Task 3 and consumed by Task 4; `SummaryCards` props (`accountCount`, `bucketCount`, `providerAccountCounts: {provider, count}[]`) match between Tasks 2 and 4; `Dashboard` props `onOpenAccount(id)`/`onOpenBucket(id, bucket)` match `App`'s `openInFiles` wiring in Task 5; `Account`/`ProviderId` imported from the existing Plan-1 modules; `bucketsKey`/`UI_PROVIDERS`/`ProviderBadge`/`useAccounts`/`unwrap` reused from existing files.

**Note for implementers:** `useAllBuckets` is always called (not behind an early return) in `Dashboard` — it's invoked before the loading/empty guards return, so the Rules of Hooks are respected (the guards come after both hook calls).
