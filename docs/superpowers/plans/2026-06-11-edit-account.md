# Edit an Account/Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit an existing S3 account/connection (label, provider, region, endpoint, keys, path-style) instead of only add/delete.

**Architecture:** Add an `update` method to the accounts repo, an `accounts:update` IPC channel + handler that mirrors create (re-resolving provider params, conditionally rewriting the secret), and a renderer flow that reuses the Add form in an edit mode. The secret is left blank in edit mode and only overwritten when the user types a new one; connection-test in edit mode falls back to the stored secret.

**Tech Stack:** Electron + TypeScript, SQLite (`node-sqlite3-wasm`) via repos, Electron `safeStorage` for secrets, React 19 + TanStack Query + Tailwind, Vitest + Testing Library.

Reference spec: `docs/superpowers/specs/2026-06-11-edit-account-design.md`

---

## File Structure

- `src/main/storage/accountsRepo.ts` — add `update(id, input)` (Task 1)
- `src/main/ipc/channels.ts` — add `accountsUpdate` channel, `UpdateAccountInput`, `TestAccountInput`, ApiMap entries (Task 2)
- `src/main/ipc/register.ts` — `resolveConnParams` accepts a structural subset; new update handler; test handler resolves stored secret (Task 3)
- `src/preload.ts` — expose `accounts.update`, retype `accounts.test` (Task 4)
- `src/renderer/hooks/useAccounts.ts` — `useUpdateAccount`, retype `useTestConnection` (Task 4)
- `src/renderer/components/accounts/AccountForm.tsx` — renamed from `AddAccountForm.tsx`, gains edit mode (Task 5)
- `src/renderer/components/accounts/AccountForm.test.tsx` — renamed test, plus edit-mode cases (Task 5)
- `src/renderer/components/connections/ConnectionsScreen.tsx` — Edit button + edit state (Task 6)

---

### Task 1: Repo `update` method

**Files:**
- Modify: `src/main/storage/accountsRepo.ts`
- Test: `src/main/storage/accountsRepo.test.ts`

- [ ] **Step 1: Write the failing test**

Add these two tests inside the `describe('accountsRepo', …)` block in `src/main/storage/accountsRepo.test.ts` (after the existing `round-trips forcePathStyle` test):

```typescript
  it('updates an account in place, preserving id and createdAt', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    const updated = repo.update(created.id, {
      label: 'AWS staging',
      provider: 'custom',
      endpoint: 'https://minio.example.com:9000',
      region: 'us-east-1',
      accessKeyId: 'AK2',
      forcePathStyle: true,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.label).toBe('AWS staging');
    expect(updated.provider).toBe('custom');
    expect(updated.endpoint).toBe('https://minio.example.com:9000');
    expect(updated.forcePathStyle).toBe(true);
    // persisted, not just returned
    expect(repo.get(created.id)?.label).toBe('AWS staging');
    expect(repo.list()).toHaveLength(1);
  });

  it('throws when updating a missing account', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    expect(() => repo.update('missing', sample)).toThrow();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: FAIL — `repo.update is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/main/storage/accountsRepo.ts`, add an `update` method to the returned object in `createAccountsRepo`, immediately after the `get(id)` method (before `remove`):

```typescript
    update(id: string, input: NewAccount): Account {
      const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
      if (!existing) throw new Error(`Account not found: ${id}`);
      db.prepare(
        `UPDATE accounts
         SET label = ?, provider = ?, endpoint = ?, region = ?, access_key_id = ?, force_path_style = ?
         WHERE id = ?`,
      ).run(
        input.label, input.provider, input.endpoint ?? null, input.region,
        input.accessKeyId, input.forcePathStyle ? 1 : 0, id,
      );
      return { ...input, id, createdAt: existing.created_at };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/accountsRepo.ts src/main/storage/accountsRepo.test.ts
git commit -m "feat: add accountsRepo.update"
```

---

### Task 2: IPC channel + input types

**Files:**
- Modify: `src/main/ipc/channels.ts`

No new test file here — types are exercised by the handler tests in Task 3 and compile-checked by `tsc`/lint.

- [ ] **Step 1: Add the channel constant**

In `src/main/ipc/channels.ts`, add to the `CH` object, immediately after the `accountsCreate` line:

```typescript
  accountsUpdate: 'accounts:update',
```

- [ ] **Step 2: Add the input types**

In `src/main/ipc/channels.ts`, immediately after the `CreateAccountInput` interface (after its closing brace, before the `ApiMap` comment), add:

```typescript
export interface UpdateAccountInput {
  id: string;
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  /** Blank/omitted keeps the stored secret; a value replaces it. */
  secretAccessKey?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

/** Test input: secret optional so edit-mode can reuse the stored secret by id. */
export interface TestAccountInput {
  id?: string;
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}
```

- [ ] **Step 3: Add the ApiMap entries**

In `src/main/ipc/channels.ts`, in the `ApiMap` interface, add the update entry right after the `accountsCreate` line, and change the `accountsTest` line to use `TestAccountInput`:

```typescript
  [CH.accountsCreate]: { args: [CreateAccountInput]; res: Result<Account> };
  [CH.accountsUpdate]: { args: [UpdateAccountInput]; res: Result<Account> };
  [CH.accountsRemove]: { args: [string]; res: Result<true> };
  [CH.accountsTest]: { args: [TestAccountInput]; res: Result<true> };
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no type errors). (`accounts:update` has no handler yet — that's fine; the "handler for every channel" test in Task 3 will catch it.)

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/channels.ts
git commit -m "feat: add accounts:update channel and input types"
```

---

### Task 3: IPC update handler + test-secret fallback

**Files:**
- Modify: `src/main/ipc/register.ts`
- Test: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/ipc/register.test.ts`, add these tests inside the `describe('registerIpc', …)` block, after the existing `accounts:create persists forcePathStyle…` test. (A helper to create an account first keeps them readable.)

```typescript
  it('accounts:update changes fields and keeps the secret when none is given', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'AWS renamed', provider: 'amazon-s3',
      region: 'us-east-1', accessKeyId: 'AK2',
    })) as { ok: boolean; data: { label: string; region: string } };

    expect(res.ok).toBe(true);
    expect(res.data.label).toBe('AWS renamed');
    expect(deps.accounts.get(created.data.id)?.region).toBe('us-east-1');
    expect(deps.secrets.get(created.data.id)).toBe('SK'); // unchanged
  });

  it('accounts:update replaces the secret when one is provided', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    await handlers.get(CH.accountsUpdate)!({
      id: created.data.id, label: 'AWS', provider: 'amazon-s3',
      region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'NEWSECRET',
    });

    expect(deps.secrets.get(created.data.id)).toBe('NEWSECRET');
  });

  it('accounts:update rejects an unknown provider', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsUpdate)!({
      id: 'x', label: 'L', provider: 'nope', region: 'r', accessKeyId: 'AK',
    })) as { ok: boolean; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('InvalidProvider');
  });

  it('accounts:test uses the stored secret when given an id and no secret', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'STORED',
    })) as { data: { id: string } };
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [] });

    const res = (await handlers.get(CH.accountsTest)!({
      id: created.data.id, label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK',
    })) as { ok: boolean };

    expect(res.ok).toBe(true); // did not throw for a missing secret
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — the "registers a handler for every channel" test fails (no `accounts:update` handler) and the new update tests fail (`handlers.get(...)` is undefined).

- [ ] **Step 3: Loosen `resolveConnParams` to a structural input**

In `src/main/ipc/register.ts`, change the `resolveConnParams` signature so update/test inputs (which have an optional secret) are accepted. Replace the existing signature line:

```typescript
function resolveConnParams(input: CreateAccountInput): Result<ConnParams> {
```

with:

```typescript
type ConnInput = Pick<CreateAccountInput, 'provider' | 'region' | 'endpoint' | 'forcePathStyle'>;

function resolveConnParams(input: ConnInput): Result<ConnParams> {
```

(The function body already only reads `provider`, `region`, `endpoint`, `forcePathStyle`, so no other change is needed.)

- [ ] **Step 4: Add the update handler**

In `src/main/ipc/register.ts`, add the handler immediately after the `CH.accountsCreate` handler block (after its closing `});`):

```typescript
  h(CH.accountsUpdate, (input: UpdateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const account = deps.db.transaction(() => {
      const updated = deps.accounts.update(input.id, {
        label: input.label,
        provider: input.provider,
        endpoint: params.data.endpoint,
        region: input.region,
        accessKeyId: input.accessKeyId,
        forcePathStyle: params.data.forcePathStyle,
      });
      if (input.secretAccessKey) {
        deps.secrets.set(input.id, input.secretAccessKey);
      }
      return updated;
    })();
    return ok(account);
  });
```

- [ ] **Step 5: Update the test handler to fall back to the stored secret**

In `src/main/ipc/register.ts`, replace the entire `h(CH.accountsTest, …)` block with:

```typescript
  h(CH.accountsTest, async (input: TestAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const secretAccessKey =
      input.secretAccessKey || (input.id ? deps.secrets.get(input.id) : undefined);
    if (!secretAccessKey) {
      return err('MissingSecret', 'A secret access key is required to test the connection');
    }
    const client = createClient({
      provider: input.provider,
      region: input.region,
      endpoint: params.data.endpoint,
      forcePathStyle: params.data.forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey,
    });
    const r = await listBuckets(client);
    return r.ok ? ok(true as const) : err(r.error.code, r.error.message);
  });
```

- [ ] **Step 6: Update the imports**

In `src/main/ipc/register.ts`, update the channels import on line 2 to include the new types:

```typescript
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL, type CreateAccountInput, type UpdateAccountInput, type TestAccountInput } from './channels';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (all tests, including "registers a handler for every channel").

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/register.ts src/main/ipc/register.test.ts
git commit -m "feat: add accounts:update handler and test-secret fallback"
```

---

### Task 4: Preload + React hooks

**Files:**
- Modify: `src/preload.ts`
- Modify: `src/renderer/hooks/useAccounts.ts`

- [ ] **Step 1: Expose `accounts.update` and retype `accounts.test` in preload**

In `src/preload.ts`, replace the `accounts` object (lines 12–17) with:

```typescript
  accounts: {
    list: () => invoke(CH.accountsList),
    create: (input: ApiMap[typeof CH.accountsCreate]['args'][0]) => invoke(CH.accountsCreate, input),
    update: (input: ApiMap[typeof CH.accountsUpdate]['args'][0]) => invoke(CH.accountsUpdate, input),
    remove: (id: string) => invoke(CH.accountsRemove, id),
    test: (input: ApiMap[typeof CH.accountsTest]['args'][0]) => invoke(CH.accountsTest, input),
  },
```

- [ ] **Step 2: Add `useUpdateAccount` and retype `useTestConnection`**

In `src/renderer/hooks/useAccounts.ts`, update the import on line 3 and add the hook. Replace line 3:

```typescript
import type { CreateAccountInput, UpdateAccountInput, TestAccountInput } from '../../main/ipc/channels';
```

Add `useUpdateAccount` after `useCreateAccount` (before `useRemoveAccount`):

```typescript
export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAccountInput) => unwrap(await window.s3.accounts.update(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}
```

Change `useTestConnection`'s mutation input type from `CreateAccountInput` to `TestAccountInput`:

```typescript
export function useTestConnection() {
  return useMutation({
    mutationFn: async (input: TestAccountInput) => unwrap(await window.s3.accounts.test(input)),
  });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/preload.ts src/renderer/hooks/useAccounts.ts
git commit -m "feat: expose accounts.update and useUpdateAccount"
```

---

### Task 5: Refactor AddAccountForm into AccountForm with edit mode

**Files:**
- Create: `src/renderer/components/accounts/AccountForm.tsx` (renamed from `AddAccountForm.tsx`)
- Delete: `src/renderer/components/accounts/AddAccountForm.tsx`
- Create: `src/renderer/components/accounts/AccountForm.test.tsx` (renamed from `AddAccountForm.test.tsx`)
- Delete: `src/renderer/components/accounts/AddAccountForm.test.tsx`

- [ ] **Step 1: Rename the files with git**

```bash
git mv src/renderer/components/accounts/AddAccountForm.tsx src/renderer/components/accounts/AccountForm.tsx
git mv src/renderer/components/accounts/AddAccountForm.test.tsx src/renderer/components/accounts/AccountForm.test.tsx
```

- [ ] **Step 2: Update the existing tests to the new name/props and add edit-mode cases**

Replace the entire contents of `src/renderer/components/accounts/AccountForm.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountForm } from './AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const existing: Account = {
  id: 'acc-1',
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AKIA',
  forcePathStyle: false,
  createdAt: 1,
};

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { test: vi.fn().mockResolvedValue({ ok: true, data: true }) },
  };
});

describe('AccountForm (add mode)', () => {
  it('submits the entered values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm onSubmit={onSubmit} onCancel={() => {}} />);

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
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection OK')).toBeInTheDocument();
  });

  it('shows the error message when the connection test fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { test: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'bad key' } }) },
    };
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('AccessDenied: bad key')).toBeInTheDocument();
  });

  it('hides custom fields unless the custom provider is selected', () => {
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
    expect(screen.queryByLabelText('Path-style addressing')).toBeNull();
  });

  it('reveals custom fields and prefills the region when custom is selected', async () => {
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Path-style addressing')).toBeInTheDocument();
    expect(screen.getByLabelText('Region')).toHaveValue('us-east-1');
  });

  it('submits the endpoint and path-style toggle for a custom provider', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Label'), 'MinIO');
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await userEvent.type(screen.getByLabelText('Endpoint URL'), 'https://minio.example.com:9000');
    await userEvent.click(screen.getByLabelText('Path-style addressing')); // default ON -> toggle OFF
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIA');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(onSubmit).toHaveBeenCalledWith({
      label: 'MinIO',
      provider: 'custom',
      region: 'us-east-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      endpoint: 'https://minio.example.com:9000',
      forcePathStyle: false,
    });
  });
});

describe('AccountForm (edit mode)', () => {
  it('prefills fields from the account and labels the submit button Save changes', () => {
    wrap(<AccountForm account={existing} onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByLabelText('Label')).toHaveValue('AWS prod');
    expect(screen.getByLabelText('Region')).toHaveValue('eu-central-1');
    expect(screen.getByLabelText('Access key ID')).toHaveValue('AKIA');
    expect(screen.getByLabelText('Secret access key')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('omits the secret when left blank and includes the id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm account={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.clear(screen.getByLabelText('Label'));
    await userEvent.type(screen.getByLabelText('Label'), 'AWS renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: 'acc-1',
      label: 'AWS renamed',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
    });
  });

  it('includes the secret when a new one is typed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm account={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Secret access key'), 'NEWSECRET');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: 'acc-1',
      label: 'AWS prod',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'NEWSECRET',
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/accounts/AccountForm.test.tsx`
Expected: FAIL — `AccountForm` is not exported (file still exports `AddAccountForm`).

- [ ] **Step 4: Rewrite the component with edit mode**

Replace the entire contents of `src/renderer/components/accounts/AccountForm.tsx` with:

```tsx
import { useState } from 'react';
import type { CreateAccountInput, UpdateAccountInput, TestAccountInput } from '../../../main/ipc/channels';
import type { Account } from '../../../main/storage/accountsRepo';
import { UI_PROVIDERS } from '../../lib/providers';
import { useTestConnection } from '../../hooks/useAccounts';

const fieldClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1';

export function AccountForm({
  account,
  onSubmit,
  onCancel,
}: {
  account?: Account;
  onSubmit: (input: CreateAccountInput | UpdateAccountInput) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = account !== undefined;
  const [label, setLabel] = useState(account?.label ?? '');
  const [provider, setProvider] = useState<CreateAccountInput['provider']>(
    account?.provider ?? UI_PROVIDERS[0].id,
  );
  const [region, setRegion] = useState(account?.region ?? '');
  const [accessKeyId, setAccessKeyId] = useState(account?.accessKeyId ?? '');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [endpoint, setEndpoint] = useState(account?.endpoint ?? '');
  const [forcePathStyle, setForcePathStyle] = useState(account?.forcePathStyle ?? true);
  const test = useTestConnection();

  const custom = provider === 'custom';
  const customFields = custom ? { endpoint, forcePathStyle } : {};
  const hasSecret = secretAccessKey.trim() !== '';

  const submitInput: CreateAccountInput | UpdateAccountInput = isEdit
    ? {
        id: account!.id,
        label,
        provider,
        region,
        accessKeyId,
        ...(hasSecret ? { secretAccessKey } : {}),
        ...customFields,
      }
    : {
        label,
        provider,
        region,
        accessKeyId,
        secretAccessKey,
        ...customFields,
      };

  const testInput: TestAccountInput = {
    ...(isEdit ? { id: account!.id } : {}),
    label,
    provider,
    region,
    accessKeyId,
    ...(hasSecret ? { secretAccessKey } : {}),
    ...customFields,
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(submitInput);
      }}
    >
      <label className="block">
        Label
        <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="block">
        Provider
        <select
          className={fieldClass}
          value={provider}
          onChange={(e) => {
            const next = e.target.value as CreateAccountInput['provider'];
            setProvider(next);
            if (next === 'custom' && region.trim() === '') setRegion('us-east-1');
          }}
        >
          {UI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {custom && (
        <>
          <label className="block">
            Endpoint URL
            <input
              className={fieldClass}
              placeholder="https://minio.example.com:9000"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(e) => setForcePathStyle(e.target.checked)}
            />
            Path-style addressing
          </label>
        </>
      )}
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
        <input
          type="password"
          className={fieldClass}
          placeholder={isEdit ? '••••• (unchanged)' : ''}
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          disabled={test.isPending}
          onClick={() => test.mutate(testInput)}
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
          {isEdit ? 'Save changes' : 'Add account'}
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/accounts/AccountForm.test.tsx`
Expected: PASS (add-mode and edit-mode describes).

Note: `ConnectionsScreen.tsx` still imports `AddAccountForm` and will not compile yet — that's fixed in Task 6. Do not run a full `tsc` here.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/accounts/AccountForm.tsx src/renderer/components/accounts/AccountForm.test.tsx
git commit -m "refactor: AddAccountForm -> AccountForm with edit mode"
```

---

### Task 6: Edit button + edit flow in ConnectionsScreen

**Files:**
- Modify: `src/renderer/components/connections/ConnectionsScreen.tsx`

- [ ] **Step 1: Rewrite the screen with edit state**

Replace the entire contents of `src/renderer/components/connections/ConnectionsScreen.tsx` with:

```tsx
import { useState } from 'react';
import { FiTrash2, FiEdit2 } from 'react-icons/fi';
import { useAccounts, useCreateAccount, useUpdateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from '../accounts/ProviderBadge';
import { AccountForm } from '../accounts/AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';

// null = list view; 'new' = add form; Account = edit form for that account
type Editing = null | 'new' | Account;

export function ConnectionsScreen({ onAccountRemoved }: { onAccountRemoved?: (id: string) => void } = {}) {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">Connections</h2>
        {editing === null && (
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            onClick={() => setEditing('new')}
          >
            + Add account
          </button>
        )}
      </div>

      {editing !== null ? (
        <div className="max-w-md">
          <AccountForm
            account={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => {
              if ('id' in input) {
                await updateAccount.mutateAsync(input);
              } else {
                await createAccount.mutateAsync(input);
              }
              setEditing(null);
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
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Edit ${acc.label}`}
                    className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setEditing(acc)}
                  >
                    <FiEdit2 className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${acc.label}`}
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() =>
                      removeAccount.mutate(acc.id, {
                        onSuccess: () => onAccountRemoved?.(acc.id),
                      })
                    }
                  >
                    <FiTrash2 className="h-4 w-4" aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the whole project compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no more references to `AddAccountForm`; the `'id' in input` narrowing typechecks against the `CreateAccountInput | UpdateAccountInput` union).

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all suites).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/connections/ConnectionsScreen.tsx
git commit -m "feat: edit a connection from the Connections screen"
```

---

### Task 7: Manual verification

**Files:** none (manual smoke test).

- [ ] **Step 1: Restart the app**

Per project guidance, main-process IPC changes require a full restart (Vite only HMRs the renderer). Stop any running dev server and run:

```bash
npm start
```

- [ ] **Step 2: Verify the edit flow**

In the running app, on the Connections screen:
1. Add an account (if none exists) and confirm it appears in the list.
2. Click the new **pencil/Edit** icon on a row → the form opens pre-filled, the secret field is empty with the `••••• (unchanged)` placeholder, and the submit button reads **Save changes**.
3. Change the label and click **Save changes** without touching the secret → the list shows the new label.
4. Edit again, click **Test connection** with the secret left blank → it reports **Connection OK** (using the stored secret), assuming valid stored credentials.
5. Edit again, type a new secret, **Save changes**, then **Test connection** → still OK.

Expected: all steps behave as described; no "No handler registered" errors in the console.

- [ ] **Step 3: Done**

No commit (no code change). The feature is complete.

---

## Self-Review Notes

- **Spec coverage:** repo `update` (Task 1) ✓; `accounts:update` channel + types + handler (Tasks 2–3) ✓; conditional secret (Task 3) ✓; test-with-stored-secret via optional `id` (Tasks 2–3) ✓; preload + `useUpdateAccount` (Task 4) ✓; reuse Add form as `AccountForm` with edit mode, `(unchanged)` placeholder, "Save changes" (Task 5) ✓; Edit button + flow (Task 6) ✓; tests at repo, IPC, and form level (Tasks 1, 3, 5) ✓.
- **Type consistency:** `update(id, input: NewAccount)` returns `Account`; `UpdateAccountInput` (required `id`, optional `secretAccessKey`) and `TestAccountInput` (optional `id`, optional `secretAccessKey`) match across channels/preload/hooks/form; the union `CreateAccountInput | UpdateAccountInput` is narrowed by `'id' in input` (CreateAccountInput has no `id`).
- **No placeholders:** every code step contains full code; commands have expected output.
