# Sidebar Account & Bucket Selectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move account and bucket selection out of the Files panes into sidebar dropdowns above the menu, with account management on a new full-screen Connections view.

**Architecture:** `App` keeps owning `accountId`/`bucket` state. Two new sidebar components (`AccountSelect`, `BucketSelect`) drive that state and are shown only on the single-target sections (Files, CORS, Object Lock). A "Manage connections" button opens a new full-screen `ConnectionsScreen` (absorbing the old `AccountsPane` add/remove logic). `CorsEditor` and `ObjectLockEditor` drop their internal pickers and become controlled by props. Sync is multi-endpoint and keeps its own pickers; sidebar selectors are hidden there.

**Tech Stack:** React + TypeScript, TanStack Query, Tailwind, Vitest + Testing Library (`@testing-library/react`, `@testing-library/user-event`).

**Conventions (read before starting):**
- Run a single test file: `npx vitest run src/renderer/components/<path>.test.tsx`
- Test render helper pattern (used across the repo): wrap the node in a fresh `QueryClient` provider; wrap in `ToastProvider` too when the component (or a dialog it opens) calls `useToast`.
- Account fixture shape: `{ id, label, provider, region, accessKeyId, createdAt }`.
- Do NOT add `Co-Authored-By: Claude` to commits (repo rule).

---

### Task 1: SectionNav — add `connections` to the type, reorder, add divider

**Files:**
- Modify: `src/renderer/components/SectionNav.tsx`
- Test: `src/renderer/components/SectionNav.test.tsx`

- [ ] **Step 1: Update the failing tests**

Replace the body of `src/renderer/components/SectionNav.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders the menu sections and marks the active one', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    for (const label of ['Files', 'Object Lock', 'CORS', 'Sync', 'Dashboard', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not render a Connections menu item (reached via the sidebar button)', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Connections' })).not.toBeInTheDocument();
  });

  it('renders a divider between primary and secondary groups', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="files" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: FAIL (no `role="separator"`; `'connections'` not yet in `Section`).

- [ ] **Step 3: Update SectionNav implementation**

Replace the full contents of `src/renderer/components/SectionNav.tsx` with:

```tsx
export type Section =
  | 'files'
  | 'dashboard'
  | 'objectLock'
  | 'cors'
  | 'sync'
  | 'settings'
  | 'connections';

const PRIMARY: { id: Section; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'objectLock', label: 'Object Lock' },
  { id: 'cors', label: 'CORS' },
  { id: 'sync', label: 'Sync' },
];

const SECONDARY: { id: Section; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'settings', label: 'Settings' },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const renderItem = (s: { id: Section; label: string }) => {
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
  };

  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY.map(renderItem)}
      <div role="separator" className="my-1 border-t border-slate-200" />
      {SECONDARY.map(renderItem)}
    </nav>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SectionNav.tsx src/renderer/components/SectionNav.test.tsx
git commit -m "feat(ui): reorder section nav, add divider and connections section type"
```

---

### Task 2: AccountSelect component

**Files:**
- Create: `src/renderer/components/accounts/AccountSelect.tsx`
- Test: `src/renderer/components/accounts/AccountSelect.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/accounts/AccountSelect.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountSelect } from './AccountSelect';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
  };
});

describe('AccountSelect', () => {
  it('lists accounts with provider label and fires onSelect on change', async () => {
    const onSelect = vi.fn();
    wrap(<AccountSelect selectedId={null} onSelect={onSelect} />);
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'acc-1');
    expect(onSelect).toHaveBeenCalledWith('acc-1');
  });

  it('shows a placeholder option when nothing is selected', () => {
    wrap(<AccountSelect selectedId={null} onSelect={() => {}} />);
    expect(screen.getByRole('option', { name: 'Select account' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/accounts/AccountSelect.test.tsx`
Expected: FAIL with "Failed to resolve import ./AccountSelect".

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/accounts/AccountSelect.tsx`:

```tsx
import { useAccounts } from '../../hooks/useAccounts';
import { UI_PROVIDERS } from '../../lib/providers';
import type { ProviderId } from '../../../main/s3/providers';

function providerLabel(provider: ProviderId): string {
  return UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function AccountSelect({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const accounts = useAccounts();
  const list = accounts.data ?? [];

  return (
    <select
      aria-label="Account"
      className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      value={selectedId ?? ''}
      onChange={(e) => {
        if (e.target.value) onSelect(e.target.value);
      }}
    >
      <option value="">{accounts.isLoading ? 'Loading…' : 'Select account'}</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label} ({providerLabel(a.provider)})
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/accounts/AccountSelect.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/AccountSelect.tsx src/renderer/components/accounts/AccountSelect.test.tsx
git commit -m "feat(ui): add AccountSelect dropdown"
```

---

### Task 3: BucketSelect component

**Files:**
- Create: `src/renderer/components/buckets/BucketSelect.tsx`
- Test: `src/renderer/components/buckets/BucketSelect.test.tsx`

Note: `BucketSelect` opens `CreateBucketDialog`, which calls `useToast`, so its test must wrap in `ToastProvider`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/buckets/BucketSelect.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { BucketSelect } from './BucketSelect';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
  };
});

describe('BucketSelect', () => {
  it('lists buckets and fires onSelect on change', async () => {
    const onSelect = vi.fn();
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
    expect(onSelect).toHaveBeenCalledWith('assets');
  });

  it('disables the dropdown and hides create when no account is selected', () => {
    wrap(<BucketSelect accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Bucket')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
  });

  it('opens the create-bucket dialog from the + button', async () => {
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(screen.getByRole('heading', { name: 'Create bucket' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/buckets/BucketSelect.test.tsx`
Expected: FAIL with "Failed to resolve import ./BucketSelect".

(If the third test later fails on the heading name, open `src/renderer/components/buckets/CreateBucketDialog.tsx` and match the dialog's actual `<h2>`/heading text — adjust the test's expected name to match. The dialog text is the source of truth.)

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/buckets/BucketSelect.tsx`:

```tsx
import { useState } from 'react';
import { useBuckets } from '../../hooks/useBuckets';
import { CreateBucketDialog } from './CreateBucketDialog';

export function BucketSelect({
  accountId,
  selectedBucket,
  onSelect,
}: {
  accountId: string | null;
  selectedBucket: string | null;
  onSelect: (bucket: string) => void;
}) {
  const buckets = useBuckets(accountId);
  const [creating, setCreating] = useState(false);

  const placeholder =
    accountId === null ? 'Select account first' : buckets.isLoading ? 'Loading…' : 'Select bucket';

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Bucket"
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
        value={selectedBucket ?? ''}
        disabled={accountId === null}
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {(buckets.data ?? []).map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      {accountId !== null && (
        <button
          type="button"
          aria-label="Create bucket"
          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100"
          onClick={() => setCreating(true)}
        >
          +
        </button>
      )}
      {creating && accountId !== null && (
        <CreateBucketDialog
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            onSelect(name);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/buckets/BucketSelect.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/buckets/BucketSelect.tsx src/renderer/components/buckets/BucketSelect.test.tsx
git commit -m "feat(ui): add BucketSelect dropdown with inline create"
```

---

### Task 4: ConnectionsScreen (full-screen account management)

**Files:**
- Create: `src/renderer/components/connections/ConnectionsScreen.tsx`
- Test: `src/renderer/components/connections/ConnectionsScreen.test.tsx`

This absorbs the add/remove/list logic from the old `AccountsPane`, rendered full-screen like `SettingsScreen`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/connections/ConnectionsScreen.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConnectionsScreen } from './ConnectionsScreen';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: [account] }),
      remove: vi.fn().mockResolvedValue({ ok: true, data: true }),
    },
  };
});

describe('ConnectionsScreen', () => {
  it('lists existing accounts', async () => {
    wrap(<ConnectionsScreen />);
    expect(await screen.findByText('AWS prod')).toBeInTheDocument();
  });

  it('opens the add-account form', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add account' }));
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });

  it('removes an account', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, data: true });
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }), remove },
    };
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove AWS prod' }));
    expect(remove).toHaveBeenCalledWith('acc-1');
  });

  it('shows an empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = { accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    wrap(<ConnectionsScreen />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/connections/ConnectionsScreen.test.tsx`
Expected: FAIL with "Failed to resolve import ./ConnectionsScreen".

- [ ] **Step 3: Write the implementation**

Create `src/renderer/components/connections/ConnectionsScreen.tsx`:

```tsx
import { useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { useAccounts, useCreateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from '../accounts/ProviderBadge';
import { AddAccountForm } from '../accounts/AddAccountForm';

export function ConnectionsScreen() {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const removeAccount = useRemoveAccount();
  const [adding, setAdding] = useState(false);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">Connections</h2>
        {!adding && (
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            onClick={() => setAdding(true)}
          >
            + Add account
          </button>
        )}
      </div>

      {adding ? (
        <div className="max-w-md">
          <AddAccountForm
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await createAccount.mutateAsync(input);
              setAdding(false);
            }}
          />
        </div>
      ) : (
        <>
          {accounts.isLoading && <p className="text-slate-500">Loading…</p>}
          {accounts.isError && <p className="text-red-600">{(accounts.error as Error).message}</p>}

          {accounts.isSuccess && accounts.data.length === 0 && (
            <div className="text-slate-500">
              <p className="font-medium text-slate-700">No accounts yet</p>
              <p className="mt-1 text-sm">Add an Amazon S3 or Hetzner account to get started.</p>
            </div>
          )}

          <ul className="max-w-md divide-y divide-slate-100">
            {accounts.data?.map((acc) => (
              <li key={acc.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{acc.label}</span>
                  <ProviderBadge provider={acc.provider} />
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${acc.label}`}
                  className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => removeAccount.mutate(acc.id)}
                >
                  <FiTrash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/connections/ConnectionsScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/connections/ConnectionsScreen.tsx src/renderer/components/connections/ConnectionsScreen.test.tsx
git commit -m "feat(ui): add full-screen ConnectionsScreen for account management"
```

---

### Task 5: Make CorsEditor controlled by the sidebar selection

**Files:**
- Modify: `src/renderer/components/cors/CorsEditor.tsx`
- Test: `src/renderer/components/cors/CorsEditor.test.tsx`

Goal: remove the internal account/bucket `<select>`s; change props `initialAccountId`/`initialBucket` → `accountId`/`bucket` (controlled).

- [ ] **Step 1: Update the test props**

In `src/renderer/components/cors/CorsEditor.test.tsx`, replace every occurrence of:

```tsx
<CorsEditor initialAccountId="acc-1" initialBucket="assets" />
```

with:

```tsx
<CorsEditor accountId="acc-1" bucket="assets" />
```

(There are 5 such render calls.) Leave everything else in that file unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: FAIL (TypeScript/prop mismatch — `accountId` not a known prop yet).

- [ ] **Step 3: Update CorsEditor implementation**

Edit `src/renderer/components/cors/CorsEditor.tsx`. Apply these changes:

1. Remove the now-unused imports `useAccounts` and `useBuckets` (delete those two import lines).
2. Replace the component signature and the top hook/state block. Replace this:

```tsx
export function CorsEditor({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  const [bucket, setBucket] = useState<string | null>(initialBucket);
  const buckets = useBuckets(accountId);
  const cors = useCors(accountId, bucket);
  const { show } = useToast();

  const [rules, setRules] = useState<CorsRule[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (cors.query.data) setRules(cors.query.data);
  }, [cors.query.data]);

  const selectAccount = (id: string | null) => {
    setAccountId(id);
    setBucket(null);
    setRules([]);
  };
  const selectBucket = (b: string | null) => {
    setBucket(b);
    setRules([]);
  };

  const fieldClass = 'rounded border border-slate-300 px-2 py-1 text-sm';
```

with:

```tsx
export function CorsEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const cors = useCors(accountId, bucket);
  const { show } = useToast();

  const [rules, setRules] = useState<CorsRule[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset the working set whenever the selection changes; the data effect below
  // repopulates it once the new bucket's rules load.
  useEffect(() => {
    setRules([]);
  }, [accountId, bucket]);

  useEffect(() => {
    if (cors.query.data) setRules(cors.query.data);
  }, [cors.query.data]);
```

3. Delete the selector block in the returned JSX — remove this entire element:

```tsx
      <div className="flex gap-2">
        <select aria-label="Account" className={fieldClass} value={accountId ?? ''} onChange={(e) => selectAccount(e.target.value || null)}>
          <option value="">Select account…</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <select aria-label="Bucket" className={fieldClass} value={bucket ?? ''} disabled={accountId === null} onChange={(e) => selectBucket(e.target.value || null)}>
          <option value="">Select bucket…</option>
          {buckets.data?.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>
```

The `<h2>CORS configuration</h2>` heading stays; the `{bucket === null && ...}` empty-state message and everything below it stay unchanged. (`fieldClass` is now unused — its declaration was already removed in step 2.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/cors/CorsEditor.tsx src/renderer/components/cors/CorsEditor.test.tsx
git commit -m "refactor(ui): make CorsEditor controlled by sidebar selection"
```

---

### Task 6: Make ObjectLockEditor controlled by the sidebar selection

**Files:**
- Modify: `src/renderer/components/objectlock/ObjectLockEditor.tsx`
- Test: `src/renderer/components/objectlock/ObjectLockEditor.test.tsx`

- [ ] **Step 1: Update the test props**

In `src/renderer/components/objectlock/ObjectLockEditor.test.tsx`, replace every occurrence of:

```tsx
<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />
```

with:

```tsx
<ObjectLockEditor accountId="acc-1" bucket="assets" />
```

(There are 5 such render calls.) Leave everything else unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/objectlock/ObjectLockEditor.test.tsx`
Expected: FAIL (prop mismatch — `accountId` not a known prop yet).

- [ ] **Step 3: Update ObjectLockEditor implementation**

Edit `src/renderer/components/objectlock/ObjectLockEditor.tsx`:

1. Remove the now-unused imports `useAccounts` and `useBuckets` (delete those two import lines).
2. Replace the signature + top block. Replace this:

```tsx
export function ObjectLockEditor({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  const [bucket, setBucket] = useState<string | null>(initialBucket);
  const buckets = useBuckets(accountId);
  const lock = useObjectLock(accountId, bucket);
  const { show } = useToast();
```

with:

```tsx
export function ObjectLockEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const lock = useObjectLock(accountId, bucket);
  const { show } = useToast();
```

3. Remove the now-unused `selectAccount` helper — delete this block:

```tsx
  const selectAccount = (id: string | null) => {
    setAccountId(id);
    setBucket(null);
  };
```

   Keep the `const fieldClass = ...` declaration — unlike CorsEditor, ObjectLockEditor still uses `fieldClass` on the Retention mode / Period / Unit inputs.

4. Delete the selector block in the returned JSX — remove this entire element:

```tsx
      <div className="flex gap-2">
        <select aria-label="Account" className={fieldClass} value={accountId ?? ''} onChange={(e) => selectAccount(e.target.value || null)}>
          <option value="">Select account…</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <select aria-label="Bucket" className={fieldClass} value={bucket ?? ''} disabled={accountId === null} onChange={(e) => setBucket(e.target.value || null)}>
          <option value="">Select bucket…</option>
          {buckets.data?.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>
```

The `<h2>Object Lock</h2>` heading and everything from the `{bucket === null && ...}` message onward stay unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/objectlock/ObjectLockEditor.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/objectlock/ObjectLockEditor.tsx src/renderer/components/objectlock/ObjectLockEditor.test.tsx
git commit -m "refactor(ui): make ObjectLockEditor controlled by sidebar selection"
```

---

### Task 7: Wire selectors into App, add Connections route, remove old panes

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Delete: `src/renderer/components/accounts/AccountsPane.tsx`, `src/renderer/components/accounts/AccountsPane.test.tsx`
- Delete: `src/renderer/components/buckets/BucketsPane.tsx`, `src/renderer/components/buckets/BucketsPane.test.tsx`

- [ ] **Step 1: Confirm AccountsPane/BucketsPane have no other consumers**

Run: `grep -rn "AccountsPane\|BucketsPane" src --include=*.tsx --include=*.ts | grep -v ".test."`
Expected: only matches in `src/renderer/App.tsx` (which Task 7 rewrites). If anything else references them, stop and reassess.

- [ ] **Step 2: Update the App tests**

Edit `src/renderer/App.test.tsx`.

(a) Replace the "drills from account to bucket to object" test body with selector-driven navigation:

```tsx
  it('drills from account to bucket to object and opens the metadata panel', async () => {
    renderApp();
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a');
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
    await userEvent.click(await screen.findByText('logo.png'));
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(await screen.findByText('private')).toBeInTheDocument();
  });
```

(b) Replace the "shows a toast after copying a presigned URL" test body the same way:

```tsx
  it('shows a toast after copying a presigned URL from the metadata panel', async () => {
    renderApp();
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a');
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
    await userEvent.click(await screen.findByText('logo.png'));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText('Signed URL copied')).toBeInTheDocument();
  });
```

(c) Add a new test (place it after the "renders the Settings screen" test, inside the `describe('App — Files browsing', ...)` block):

```tsx
  it('opens the Connections screen from the Manage connections button', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Manage connections' }));
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });
```

(d) The CORS and Object Lock tests already assert `screen.getByLabelText('Account')` — that label is now provided by the sidebar `AccountSelect` (shown on those sections), so leave those two tests as-is. The Sync tests use `Bucket account`/`Bucket bucket` (the Sync editor's own labels) and are unaffected.

- [ ] **Step 3: Run the App tests to verify they fail**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL (no "Manage connections" button yet; `getByLabelText('Account')` not present on Files because panes still render the old UI).

- [ ] **Step 4: Rewrite App.tsx**

Replace the full contents of `src/renderer/App.tsx` with:

```tsx
import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountSelect } from './components/accounts/AccountSelect';
import { BucketSelect } from './components/buckets/BucketSelect';
import { ConnectionsScreen } from './components/connections/ConnectionsScreen';
import { FileBrowser } from './components/files/FileBrowser';
import { MetadataPanel } from './components/files/MetadataPanel';
import { ToastProvider } from './components/ui/ToastProvider';
import { Dashboard } from './components/dashboard/Dashboard';
import { CorsEditor } from './components/cors/CorsEditor';
import { ObjectLockEditor } from './components/objectlock/ObjectLockEditor';
import { SyncSection } from './components/sync/SyncSection';
import { SyncRunProvider } from './components/sync/SyncRunProvider';
import { SyncStatus } from './components/sync/SyncStatus';
import { SettingsScreen } from './components/settings/SettingsScreen';

// Sections whose work targets the single account/bucket chosen in the sidebar.
const SELECTOR_SECTIONS: Section[] = ['files', 'cors', 'objectLock'];

export function App() {
  const [section, setSection] = useState<Section>('files');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Once Sync is opened, keep it mounted (hidden when inactive) so an in-flight
  // sync's progress/result and active sub-tab survive navigating to other sections.
  const [syncVisited, setSyncVisited] = useState(false);

  const goToSection = (s: Section) => {
    setSection(s);
    if (s === 'sync') setSyncVisited(true);
  };

  const selectAccount = (id: string) => {
    setAccountId(id);
    setBucket(null);
    setPrefix('');
    setSelectedKey(null);
  };
  const selectBucket = (b: string) => {
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
  };
  const navigate = (p: string) => {
    setPrefix(p);
    setSelectedKey(null);
  };
  const openInFiles = (id: string, b: string | null = null) => {
    setAccountId(id);
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
    setSection('files');
  };

  const showSelectors = SELECTOR_SECTIONS.includes(section);

  return (
    <ToastProvider>
      <SyncRunProvider>
      <div className="flex h-full text-sm text-slate-800">
        <aside className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-3">
          <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>

          {showSelectors && (
            <div className="flex flex-col gap-2 px-2 pb-3">
              <AccountSelect selectedId={accountId} onSelect={selectAccount} />
              <BucketSelect accountId={accountId} selectedBucket={bucket} onSelect={selectBucket} />
            </div>
          )}

          <button
            type="button"
            onClick={() => setSection('connections')}
            aria-current={section === 'connections' ? 'page' : undefined}
            className={`mb-3 rounded px-2 py-1.5 text-left ${
              section === 'connections' ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'
            }`}
          >
            Manage connections
          </button>

          <SectionNav active={section} onSelect={goToSection} />
          <SyncStatus onOpen={() => goToSection('sync')} />
          <p className="mt-auto px-2 pt-3 text-xs text-slate-400">
            © {new Date().getFullYear()} S3 Manager
          </p>
        </aside>

        <main className="flex-1 overflow-hidden">
          {section === 'files' ? (
            <div className="flex h-full">
              <div className="flex-1 overflow-hidden">
                <FileBrowser
                  accountId={accountId}
                  bucket={bucket}
                  prefix={prefix}
                  selectedKey={selectedKey}
                  onNavigate={navigate}
                  onSelectFile={setSelectedKey}
                />
              </div>
              {selectedKey !== null && (
                <MetadataPanel
                  accountId={accountId}
                  bucket={bucket}
                  objectKey={selectedKey}
                  onClose={() => setSelectedKey(null)}
                />
              )}
            </div>
          ) : section === 'connections' ? (
            <ConnectionsScreen />
          ) : section === 'dashboard' ? (
            <Dashboard
              onOpenAccount={(id) => openInFiles(id, null)}
              onOpenBucket={(id, b) => openInFiles(id, b)}
            />
          ) : section === 'cors' ? (
            <CorsEditor accountId={accountId} bucket={bucket} />
          ) : section === 'objectLock' ? (
            <ObjectLockEditor accountId={accountId} bucket={bucket} />
          ) : section === 'sync' ? null : section === 'settings' ? (
            <SettingsScreen />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}

          {/* Sync stays mounted once opened (hidden when inactive) so a running
              sync keeps its progress, result, and active sub-tab across navigation. */}
          {syncVisited && (
            <div className={section === 'sync' ? 'h-full' : 'hidden'}>
              <SyncSection initialAccountId={accountId} initialBucket={bucket} />
            </div>
          )}
        </main>
      </div>
      </SyncRunProvider>
    </ToastProvider>
  );
}
```

- [ ] **Step 5: Delete the obsolete pane components and their tests**

```bash
git rm src/renderer/components/accounts/AccountsPane.tsx src/renderer/components/accounts/AccountsPane.test.tsx src/renderer/components/buckets/BucketsPane.tsx src/renderer/components/buckets/BucketsPane.test.tsx
```

- [ ] **Step 6: Run the App tests to verify they pass**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full test suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: All tests PASS, no type errors. (If `tsc` flags an unused `fieldClass` in CorsEditor, remove that single declaration — it should have been removed in Task 5.)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): move account & bucket selection into sidebar dropdowns"
```

---

## Self-Review

**Spec coverage:**
- Sidebar dropdowns above the menu → Task 7 (aside renders `AccountSelect`/`BucketSelect` above `SectionNav`).
- Shown only on Files/CORS/Object Lock → Task 7 (`SELECTOR_SECTIONS` + `showSelectors`).
- Bucket `+` create inline → Task 3 (`BucketSelect` + `CreateBucketDialog`).
- Manage connections button between selectors and menu, always visible → Task 7.
- Full-screen Connections (add/remove/list) → Task 4.
- Nav reorder + divider, `connections` excluded from nav → Task 1.
- CORS/Object Lock controlled by sidebar; Sync keeps own pickers, hidden selectors → Tasks 5, 6, 7.
- Remove `AccountsPane`/`BucketsPane` → Task 7.
- Native `<select>` with `label (provider)` → Task 2.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Section` gains `'connections'` (Task 1) and is imported in App (Task 7). `AccountSelect` props `{selectedId, onSelect}`; `BucketSelect` props `{accountId, selectedBucket, onSelect}`; `CorsEditor`/`ObjectLockEditor` props `{accountId, bucket}` — all matched at call sites in Task 7. `selectAccount(id: string)` / `selectBucket(b: string)` signatures match the selectors' `onSelect: (x: string) => void`.
