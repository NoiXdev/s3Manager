# S3 Manager — Create Bucket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new bucket in the selected account's region — with optional Object Lock and versioning — from a "+ Create bucket" dialog in the buckets pane.

**Architecture:** A new `createBucket` op (`CreateBucketCommand` + optional `PutBucketVersioningCommand`) behind an IPC channel whose handler resolves the account's region/provider to compute the AWS `LocationConstraint` (isolated in a tested `bucketLocationConstraint` helper), a `useCreateBucket` mutation, and a `CreateBucketDialog` launched from `BucketsPane`.

**Tech Stack:** AWS SDK v3 (`CreateBucketCommand`, `PutBucketVersioningCommand`), Electron IPC, React 19, TanStack Query, Tailwind 4, `react-icons/fi`, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/providers.ts` exports `type ProviderId = 'amazon-s3' | 'hetzner'`, `PROVIDERS`, `getProvider`, `resolveEndpoint`. Its test `providers.test.ts` imports `{ PROVIDERS, getProvider, resolveEndpoint } from './providers'` and uses `describe/it/expect` only.
- `src/main/s3/objects.ts` exports `toErr(e): Result<never>` and `listBuckets` (listing stays here — do NOT move it). It imports `ok, err, type Result` from `../shared/result`.
- `src/main/shared/result.ts`: `ok`, `err`, `type Result`.
- `src/main/ipc/register.ts`: imports `import { ok, err, type Result } from '../shared/result';` and `import { resolveEndpoint, getProvider, PROVIDERS } from '../s3/providers';` and `import { createClientForAccount } from '../s3/accountClients';`. Inside `registerIpc(ipcMain, deps)`: `const clientFor = (accountId) => createClientForAccount(accountId, deps);` and `const h = <T>(channel, fn) => ipcMain.handle(...)`. `deps.accounts.get(id): Account | undefined` exists and returns `{ id, label, provider: string, endpoint, region: string, accessKeyId, createdAt }`.
- `src/main/ipc/register.test.ts`: `const s3Mock = mockClient(S3Client); beforeEach(() => s3Mock.reset());`, `function buildHarness()` returns `{ handlers, deps }`, account created via `handlers.get(CH.accountsCreate)!({ label, provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK' })` → `{ data: { id } }`. The `@aws-sdk/client-s3` import there already includes commands like `HeadObjectCommand`/`CopyObjectCommand`. An every-channel test iterates `Object.values(CH)`.
- `src/preload.ts` methods look like `getEditableMetadata: (a: ApiMap[typeof CH.getEditableMetadata]['args'][0]) => invoke(CH.getEditableMetadata, a)`.
- `src/renderer/hooks/useBuckets.ts` exports `bucketsKey(accountId) => ['buckets', accountId] as const` and `useBuckets`.
- `src/renderer/components/buckets/BucketsPane.tsx`: header is `<div className="border-b border-slate-200 p-2"><span …>Buckets</span></div>`; props `{ accountId: string | null; selectedBucket: string | null; onSelect: (bucket: string) => void }`; renders `🪣` list. `BucketsPane.test.tsx` has a `wrap()` helper WITHOUT ToastProvider and stubs `window.s3 = { listBuckets: … }`.
- The AccountsPane "+ Add account" button style: `className="rounded px-2 py-0.5 text-sm hover:bg-slate-100"`.
- Dialog conventions (see `MetadataDialog.tsx`): outer `fixed inset-0 z-10 flex items-center justify-center bg-black/30` with `role="dialog" aria-modal="true"`; `useToast()` → `const { show } = useToast()`; `show(msg)` / `show(msg, 'error')`; the ✕ close button uses `FiX` from `react-icons/fi`. `react-icons` is installed (^5.6.0).
- `unwrap` is exported from `src/renderer/lib/result.ts`. `window.s3`'s type is derived from the preload object, so new preload methods are automatically typed once added.

---

## File Structure

```
src/main/s3/providers.ts                                 # MODIFY: bucketLocationConstraint helper (+ test)
src/main/s3/buckets.ts                                   # CREATE: createBucket op (+ test)
src/main/ipc/channels.ts                                 # MODIFY: CH.createBucket + ApiMap
src/main/ipc/register.ts                                 # MODIFY: createBucket handler
src/preload.ts                                           # MODIFY: createBucket method
src/renderer/hooks/useCreateBucket.ts                    # CREATE (+ test)
src/renderer/components/buckets/CreateBucketDialog.tsx   # CREATE (+ test)
src/renderer/components/buckets/BucketsPane.tsx          # MODIFY: "+ Create bucket" button + dialog
```

---

## Task 1: `bucketLocationConstraint` helper

**Files:**
- Modify: `src/main/s3/providers.ts`
- Test: `src/main/s3/providers.test.ts`

- [ ] **Step 1: Add the failing test** — append to `src/main/s3/providers.test.ts`:

```ts
import { bucketLocationConstraint } from './providers';

describe('bucketLocationConstraint', () => {
  it('returns the region for amazon-s3 outside us-east-1', () => {
    expect(bucketLocationConstraint('amazon-s3', 'eu-central-1')).toBe('eu-central-1');
  });
  it('returns undefined for amazon-s3 us-east-1', () => {
    expect(bucketLocationConstraint('amazon-s3', 'us-east-1')).toBeUndefined();
  });
  it('returns undefined for hetzner', () => {
    expect(bucketLocationConstraint('hetzner', 'fsn1')).toBeUndefined();
  });
});
```

(If the existing top-of-file import `import { PROVIDERS, getProvider, resolveEndpoint } from './providers';` is present, add `bucketLocationConstraint` to it instead of adding a second import line.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: FAIL — `bucketLocationConstraint` is not exported.

- [ ] **Step 3: Implement** — append to `src/main/s3/providers.ts`:

```ts
export function bucketLocationConstraint(id: ProviderId, region: string): string | undefined {
  if (id !== 'amazon-s3') return undefined; // Hetzner: the endpoint already targets the region
  return region === 'us-east-1' ? undefined : region; // AWS: must omit LocationConstraint for us-east-1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/providers.ts src/main/s3/providers.test.ts
git commit -m "feat: add bucketLocationConstraint provider helper"
```

---

## Task 2: `createBucket` backend op

**Files:**
- Create: `src/main/s3/buckets.ts`
- Test: `src/main/s3/buckets.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/buckets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand } from '@aws-sdk/client-s3';
import { createBucket } from './buckets';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('createBucket', () => {
  it('creates with a LocationConstraint when set, no versioning by default', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    const r = await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: 'eu-central-1' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.CreateBucketConfiguration).toEqual({ LocationConstraint: 'eu-central-1' });
    expect(input.ObjectLockEnabledForBucket).toBeUndefined();
    expect(s3Mock.commandCalls(PutBucketVersioningCommand)).toHaveLength(0);
  });

  it('omits CreateBucketConfiguration when locationConstraint is undefined', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: undefined });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.CreateBucketConfiguration).toBeUndefined();
  });

  it('enables object lock and versioning when requested', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});
    s3Mock.on(PutBucketVersioningCommand).resolves({});
    await createBucket(new S3Client({}), { bucket: 'b', objectLock: true, versioning: true, locationConstraint: undefined });
    const create = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(create.ObjectLockEnabledForBucket).toBe(true);
    const ver = s3Mock.commandCalls(PutBucketVersioningCommand)[0].args[0].input;
    expect(ver.Bucket).toBe('b');
    expect(ver.VersioningConfiguration).toEqual({ Status: 'Enabled' });
  });

  it('returns an error result when the create fails', async () => {
    s3Mock.on(CreateBucketCommand).rejects(new Error('BucketAlreadyExists'));
    const r = await createBucket(new S3Client({}), { bucket: 'b', objectLock: false, versioning: false, locationConstraint: undefined });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/buckets.test.ts`
Expected: FAIL — cannot find module `./buckets`.

- [ ] **Step 3: Implement** — `src/main/s3/buckets.ts`:

```ts
import { S3Client, CreateBucketCommand, PutBucketVersioningCommand, type BucketLocationConstraint } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export async function createBucket(
  client: S3Client,
  args: { bucket: string; objectLock: boolean; versioning: boolean; locationConstraint: string | undefined },
): Promise<Result<true>> {
  try {
    await client.send(
      new CreateBucketCommand({
        Bucket: args.bucket,
        CreateBucketConfiguration: args.locationConstraint
          ? { LocationConstraint: args.locationConstraint as BucketLocationConstraint }
          : undefined,
        ObjectLockEnabledForBucket: args.objectLock || undefined,
      }),
    );
    if (args.versioning) {
      await client.send(
        new PutBucketVersioningCommand({ Bucket: args.bucket, VersioningConfiguration: { Status: 'Enabled' } }),
      );
    }
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/buckets.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/buckets.ts src/main/s3/buckets.test.ts
git commit -m "feat: add createBucket op (create + optional object lock/versioning)"
```

---

## Task 3: IPC wiring

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to `CH` (near `listBuckets`):
```ts
  createBucket: 's3:createBucket',
```
Add to `ApiMap`:
```ts
  [CH.createBucket]: { args: [{ accountId: string; bucket: string; objectLock: boolean; versioning: boolean }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `CreateBucketCommand` to the existing `@aws-sdk/client-s3` import):

```ts
describe('create bucket handler', () => {
  it('creates a bucket in the account region and returns ok', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(CreateBucketCommand).resolves({});

    const res = (await handlers.get(CH.createBucket)!({
      accountId: created.data.id, bucket: 'new-bucket', objectLock: false, versioning: false,
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CreateBucketCommand)[0].args[0].input;
    expect(input.Bucket).toBe('new-bucket');
    expect(input.CreateBucketConfiguration).toEqual({ LocationConstraint: 'eu-central-1' });
  });

  it('returns an error result for an unknown account', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.createBucket)!({
      accountId: 'nope', bucket: 'b', objectLock: false, versioning: false,
    })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no `createBucket` handler (and the every-channel test fails for the new channel).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`:
- Add `bucketLocationConstraint` and `type ProviderId` to the existing providers import:
  ```ts
  import { resolveEndpoint, getProvider, PROVIDERS, bucketLocationConstraint, type ProviderId } from '../s3/providers';
  ```
- Add the op import:
  ```ts
  import { createBucket } from '../s3/buckets';
  ```
- Register the handler (place near `h(CH.listBuckets, …)`):
  ```ts
  h(CH.createBucket, (a: { accountId: string; bucket: string; objectLock: boolean; versioning: boolean }) => {
    const account = deps.accounts.get(a.accountId);
    if (!account) return err('AccountNotFound', `Unknown account: ${a.accountId}`);
    const locationConstraint = bucketLocationConstraint(account.provider as ProviderId, account.region);
    return createBucket(clientFor(a.accountId), {
      bucket: a.bucket, objectLock: a.objectLock, versioning: a.versioning, locationConstraint,
    });
  });
  ```

In `src/preload.ts`, add:
```ts
  createBucket: (a: ApiMap[typeof CH.createBucket]['args'][0]) => invoke(CH.createBucket, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire createBucket IPC channel"
```

---

## Task 4: `useCreateBucket` hook

**Files:**
- Create: `src/renderer/hooks/useCreateBucket.ts`
- Test: `src/renderer/hooks/useCreateBucket.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useCreateBucket.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCreateBucket } from './useCreateBucket';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    createBucket: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useCreateBucket', () => {
  it('calls createBucket and invalidates the buckets query', async () => {
    const { result } = renderHook(() => useCreateBucket('acc-1'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.mutateAsync({ bucket: 'b', objectLock: true, versioning: true });
    expect(window.s3.createBucket).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', objectLock: true, versioning: true });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['buckets', 'acc-1'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useCreateBucket.test.tsx`
Expected: FAIL — cannot find module `./useCreateBucket`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useCreateBucket.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { bucketsKey } from './useBuckets';

export interface CreateBucketArgs {
  bucket: string;
  objectLock: boolean;
  versioning: boolean;
}

export function useCreateBucket(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateBucketArgs) =>
      unwrap(await window.s3.createBucket({ accountId, ...args })),
    onSuccess: () => qc.invalidateQueries({ queryKey: bucketsKey(accountId) }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useCreateBucket.test.tsx`
Expected: PASS. Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useCreateBucket.ts src/renderer/hooks/useCreateBucket.test.tsx
git commit -m "feat(ui): add useCreateBucket hook"
```

---

## Task 5: `CreateBucketDialog`

**Files:**
- Create: `src/renderer/components/buckets/CreateBucketDialog.tsx`
- Test: `src/renderer/components/buckets/CreateBucketDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/buckets/CreateBucketDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { CreateBucketDialog } from './CreateBucketDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return { createBucket: vi.fn().mockResolvedValue({ ok: true, data: true }), ...over };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('CreateBucketDialog', () => {
  it('disables Create until the name is valid', async () => {
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={() => {}} />);
    const create = screen.getByRole('button', { name: 'Create bucket' });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    expect(create).toBeEnabled();
  });

  it('checking Object Lock checks and disables versioning', async () => {
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={() => {}} />);
    const versioning = screen.getByLabelText('Enable versioning');
    expect(versioning).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('Enable Object Lock'));
    expect(versioning).toBeChecked();
    expect(versioning).toBeDisabled();
  });

  it('submits with the entered name and toggles, then calls onCreated', async () => {
    const onCreated = vi.fn();
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    await userEvent.click(screen.getByLabelText('Enable Object Lock'));
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    await waitFor(() => expect(window.s3.createBucket).toHaveBeenCalled());
    expect(window.s3.createBucket).toHaveBeenCalledWith({ accountId: 'a', bucket: 'my-bucket', objectLock: true, versioning: true });
    expect(onCreated).toHaveBeenCalledWith('my-bucket');
  });

  it('shows an error and stays open when creation fails', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      createBucket: vi.fn().mockResolvedValue({ ok: false, error: { code: 'BucketAlreadyExists', message: 'bucket exists' } }),
    });
    const onClose = vi.fn();
    wrap(<CreateBucketDialog accountId="a" onClose={onClose} onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(await screen.findByText(/bucket exists/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/buckets/CreateBucketDialog.test.tsx`
Expected: FAIL — cannot find module `./CreateBucketDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/buckets/CreateBucketDialog.tsx`:

```tsx
import { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { useCreateBucket } from '../../hooks/useCreateBucket';
import { useToast } from '../ui/ToastProvider';

export function isValidBucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name);
}

export function CreateBucketDialog({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (bucket: string) => void;
}) {
  const create = useCreateBucket(accountId);
  const { show } = useToast();
  const [name, setName] = useState('');
  const [objectLock, setObjectLock] = useState(false);
  const [versioning, setVersioning] = useState(false);

  const trimmed = name.trim();
  const valid = isValidBucketName(trimmed);

  const onSubmit = async () => {
    try {
      await create.mutateAsync({ bucket: trimmed, objectLock, versioning: objectLock || versioning });
      show('Bucket created');
      onCreated(trimmed);
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-96 rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Create bucket</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <label className="block text-sm">
          Bucket name
          <input
            aria-label="Bucket name"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        {trimmed.length > 0 && !valid && (
          <p className="mt-1 text-xs text-red-600">
            3–63 characters, lowercase letters, numbers, hyphens or dots, starting and ending with a letter or number.
          </p>
        )}

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Enable Object Lock" checked={objectLock} onChange={(e) => setObjectLock(e.target.checked)} />
          Enable Object Lock
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Enable versioning"
            checked={objectLock || versioning}
            disabled={objectLock}
            onChange={(e) => setVersioning(e.target.checked)}
          />
          Enable versioning
        </label>
        <p className="mt-3 text-xs text-slate-400">
          The bucket is created in this account’s region. Object Lock can only be enabled at creation and requires versioning.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!valid || create.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
            onClick={onSubmit}
          >
            Create bucket
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/buckets/CreateBucketDialog.test.tsx`
Expected: PASS (4 tests). Then `npx tsc --noEmit` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/buckets/CreateBucketDialog.tsx src/renderer/components/buckets/CreateBucketDialog.test.tsx
git commit -m "feat(ui): add CreateBucketDialog"
```

---

## Task 6: BucketsPane "+ Create bucket" button

**Files:**
- Modify: `src/renderer/components/buckets/BucketsPane.tsx`
- Modify: `src/renderer/components/buckets/BucketsPane.test.tsx`

- [ ] **Step 1: Add the failing tests** — first update the `wrap` helper in `src/renderer/components/buckets/BucketsPane.test.tsx` to provide a ToastProvider (the dialog uses `useToast`), then append two tests.

Replace the existing `wrap` and imports block top so it reads:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { BucketsPane } from './BucketsPane';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}
```

Append these tests:
```tsx
describe('BucketsPane create bucket', () => {
  it('does not show Create bucket when no account is selected', () => {
    wrap(<BucketsPane accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: '+ Create bucket' })).toBeNull();
  });

  it('opens the create bucket dialog when an account is selected', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      createBucket: vi.fn().mockResolvedValue({ ok: true, data: true }),
    };
    wrap(<BucketsPane accountId="acc-1" selectedBucket={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Create bucket' }));
    expect(await screen.findByLabelText('Bucket name')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/buckets/BucketsPane.test.tsx`
Expected: FAIL — no "+ Create bucket" button.

- [ ] **Step 3: Implement** — modify `src/renderer/components/buckets/BucketsPane.tsx`:

(a) Replace the import line and add state. The top becomes:
```tsx
import { useState } from 'react';
import { useBuckets } from '../../hooks/useBuckets';
import { CreateBucketDialog } from './CreateBucketDialog';
```
(b) Inside the component body (after `const buckets = useBuckets(accountId);`):
```tsx
  const [creating, setCreating] = useState(false);
```
(c) Replace the header block:
```tsx
      <div className="border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buckets</span>
      </div>
```
with:
```tsx
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buckets</span>
        {accountId !== null && (
          <button type="button" className="rounded px-2 py-0.5 text-sm hover:bg-slate-100" onClick={() => setCreating(true)}>
            + Create bucket
          </button>
        )}
      </div>
```
(d) Add the dialog render just before the closing `</div>` of the root element (after the `<ul>…</ul>`):
```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/buckets/BucketsPane.test.tsx`
Expected: PASS (existing + 2 new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors). If `EndpointPicker.test.tsx` flakes on timing, re-run it in isolation to confirm it's pre-existing — do not "fix" unrelated tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/buckets/BucketsPane.tsx src/renderer/components/buckets/BucketsPane.test.tsx
git commit -m "feat(ui): add + Create bucket button opening the create dialog"
```

---

## Manual smoke checklist (after Task 6)

`npm start` (full restart — main-process IPC handler added), with an account selected:
1. Click **+ Create bucket** → dialog opens; Create is disabled until a valid name is typed (try `AB` or `_x` → stays disabled with the hint; `my-new-bucket` → enabled).
2. Check **Enable Object Lock** → the versioning checkbox becomes checked and disabled.
3. Create with a unique name → toast "Bucket created"; the bucket appears in the list and is selected.
4. Try creating a name that already exists (or one you don't own) → error toast; the dialog stays open.
5. (AWS us-east-1 account, if available) Create a bucket → succeeds (no `InvalidLocationConstraint` error), confirming the omitted `LocationConstraint`.

---

## Self-Review

**Spec coverage (against `2026-05-31-s3-manager-create-bucket-design.md`):**
- `bucketLocationConstraint` helper (AWS non-us-east-1 → region; us-east-1 → undefined; hetzner → undefined) → Task 1. ✅
- `buckets.ts` `createBucket` (CreateBucket with/without LocationConstraint; ObjectLockEnabledForBucket; PutBucketVersioning when versioning; ok/toErr) → Task 2. ✅
- IPC `s3:createBucket` (+ ApiMap, register handler resolving `deps.accounts.get` region/provider, preload) → Task 3. ✅
- `useCreateBucket` (mutation + `['buckets', accountId]` invalidation) → Task 4. ✅
- `CreateBucketDialog` (name validation gating, Object-Lock-forces-versioning, submit args, success → onCreated/close, error → toast stays open, ✕ via FiX) → Task 5. ✅
- BucketsPane "+ Create bucket" (shown only with an account, opens dialog, onCreated selects) → Task 6. ✅
- States/errors (validation hint, AccessDenied/BucketAlreadyExists surfaced, no optimistic update, objectLock implies versioning) → Tasks 2/5. ✅
- Out of scope (region picker, delete/rename, encryption/tags/lifecycle, per-provider toggle hiding) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `createBucket`'s arg shape `{ bucket, objectLock, versioning, locationConstraint }` (Task 2) matches the handler's call (Task 3). The IPC arg shape `{ accountId, bucket, objectLock, versioning }` is identical across `ApiMap` (Task 3), preload (Task 3), `CreateBucketArgs` + the `{ accountId, ...args }` spread in `useCreateBucket` (Task 4), and the dialog's `mutateAsync` call (Task 5). `bucketLocationConstraint(id: ProviderId, region)` (Task 1) is called with `account.provider as ProviderId` (Task 3). `bucketsKey(accountId)` returns `['buckets', accountId]`, matching the hook test's invalidation assertion (Task 4). The dialog submit sends `versioning: objectLock || versioning`, matching the Task 5 test that expects `versioning: true` when Object Lock is checked. The submit button accessible name `Create bucket` and the pane button `+ Create bucket` are distinct strings (Tasks 5/6), so the BucketsPane test's `findByLabelText('Bucket name')` (not the title text) avoids the title/button text collision.

**Notes for implementers:** Task 3 adds a main-process handler → the manual smoke needs a full `npm start` restart. Task 6 updates the shared `BucketsPane.test` `wrap` to add `ToastProvider` because the dialog calls `useToast()`; the two pre-existing BucketsPane tests don't open the dialog, so they're unaffected. The dialog title `<p>` and submit `<button>` both read "Create bucket" — query the button by role (`getByRole('button', { name: 'Create bucket' })`) and the open-dialog assertion by the `Bucket name` label, never by `getByText('Create bucket')` (which would match both).
```
