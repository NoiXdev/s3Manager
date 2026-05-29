# S3 Manager — Per-Object Retention & Legal Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View and edit a single object's Object Lock retention (GOVERNANCE set/extend) and legal hold (ON/OFF) in the metadata panel, shown only for Object-Lock-enabled buckets.

**Architecture:** A new `objectRetention.ts` (4 ops: get/put retention, get/put legal hold) behind 4 IPC channels, a `useObjectRetention` hook, and a `RetentionSection` component the MetadataPanel renders when the bucket's Object Lock is enabled (via the existing `useObjectLock`).

**Tech Stack:** AWS SDK v3 (`Get/PutObjectRetentionCommand`, `Get/PutObjectLegalHoldCommand`), Electron IPC, React 19, TanStack Query, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/objectLock.ts` is the sibling pattern: `ok`/`type Result` from `../shared/result`, `toErr` from `./objects`, error mapping via the caught error's `name`. `ok(true)` satisfies a `Promise<Result<true>>` return (verified — no `as const` needed).
- `src/main/s3/objectLock.test.ts` shows the backend test header: `mockClient(S3Client)` + `beforeEach(reset)`, and rejection mocks via `Object.assign(new Error('x'), { name: 'SomeError' })`.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`; per-object channels carry `{ accountId, bucket, key }`. `src/main/ipc/register.ts`: `h(channel, fn)` + `clientFor`. `register.test.ts`: `buildHarness()` → `{ handlers }`; `s3Mock = mockClient(S3Client)`; create an account via `handlers.get(CH.accountsCreate)!({ label, provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' })`; the every-channel test iterates `Object.values(CH)`.
- `src/preload.ts`: `invoke(CH.x, a)` methods.
- `src/renderer/hooks/useObjectLock.ts`: `useObjectLock(accountId, bucket)` → `{ query, save, clear }`; `query.data` is `ObjectLockStatus { enabled: boolean; defaultRetention }` (from `getObjectLockConfig`, which maps "not configured" → `{ enabled: false, … }`). `src/renderer/hooks/useObjectDetails.ts` shows the query+mutation+`invalidateQueries` hook style; `unwrap` from `../lib/result`.
- `src/renderer/components/files/MetadataPanel.tsx`: `const { metadata, visibility, setVisibility } = useObjectDetails(...)` (line 32); the Visibility row is a `<div className="flex flex-col border-b border-slate-100 py-1.5">…</div>` ending at line 172, inside the details body `<div className="flex-1 overflow-auto p-3 text-sm">`; the `{metadata.isLoading && …}` block starts at line 174. `ConfirmDialog` and `useToast` are already imported; `formatTimestamp` from `../../lib/format` is imported and used for dates.
- `MetadataPanel.test.tsx`: `wrap` = `QueryClientProvider` (+ the dialogs rely on `ToastContext`'s default no-op `show`, so a bare QueryClientProvider works); `beforeEach` stubs `window.s3` with `headObject` + `objectVisibility`.

---

## File Structure

```
src/main/s3/objectRetention.ts                      # CREATE: types + 4 ops
src/main/ipc/channels.ts                            # MODIFY: 4 channels + ApiMap
src/main/ipc/register.ts                            # MODIFY: 4 handlers
src/preload.ts                                      # MODIFY: 4 methods
src/renderer/hooks/useObjectRetention.ts            # CREATE
src/renderer/components/files/RetentionSection.tsx  # CREATE
src/renderer/components/files/MetadataPanel.tsx     # MODIFY: render RetentionSection when lock enabled
```

---

## Task 1: objectRetention.ts — backend ops

**Files:**
- Create: `src/main/s3/objectRetention.ts`
- Test: `src/main/s3/objectRetention.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/objectRetention.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectRetentionCommand,
  PutObjectRetentionCommand,
  GetObjectLegalHoldCommand,
  PutObjectLegalHoldCommand,
} from '@aws-sdk/client-s3';
import { getObjectRetention, putObjectRetention, getObjectLegalHold, putObjectLegalHold } from './objectRetention';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getObjectRetention', () => {
  it('maps a retention payload to mode + ISO date', async () => {
    s3Mock.on(GetObjectRetentionCommand).resolves({
      Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date('2026-07-01T00:00:00.000Z') },
    });
    const r = await getObjectRetention(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { mode: 'GOVERNANCE', retainUntil: '2026-07-01T00:00:00.000Z' } });
  });

  it('treats NoSuchObjectLockConfiguration as no retention', async () => {
    s3Mock.on(GetObjectRetentionCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));
    const r = await getObjectRetention(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { mode: null, retainUntil: null } });
  });
});

describe('getObjectLegalHold', () => {
  it('returns ON when held', async () => {
    s3Mock.on(GetObjectLegalHoldCommand).resolves({ LegalHold: { Status: 'ON' } });
    const r = await getObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'ON' });
  });

  it('returns OFF when not set', async () => {
    s3Mock.on(GetObjectLegalHoldCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));
    const r = await getObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'OFF' });
  });
});

describe('putObjectRetention', () => {
  it('sends a GOVERNANCE retention with the retain-until date', async () => {
    s3Mock.on(PutObjectRetentionCommand).resolves({});
    const r = await putObjectRetention(new S3Client({}), { bucket: 'b', key: 'k', retainUntil: '2026-07-01T00:00:00.000Z' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(PutObjectRetentionCommand)[0].args[0].input;
    expect(input.Retention?.Mode).toBe('GOVERNANCE');
    expect(input.Retention?.RetainUntilDate).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });
});

describe('putObjectLegalHold', () => {
  it('sends the legal hold status', async () => {
    s3Mock.on(PutObjectLegalHoldCommand).resolves({});
    const r = await putObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k', status: 'ON' });
    expect(r).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(PutObjectLegalHoldCommand)[0].args[0].input.LegalHold?.Status).toBe('ON');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objectRetention.test.ts`
Expected: FAIL — cannot find module `./objectRetention`.

- [ ] **Step 3: Implement** — `src/main/s3/objectRetention.ts`:

```ts
import {
  S3Client,
  GetObjectRetentionCommand,
  PutObjectRetentionCommand,
  GetObjectLegalHoldCommand,
  PutObjectLegalHoldCommand,
} from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface ObjectRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE' | null;
  retainUntil: string | null; // ISO string
}
export type LegalHoldStatus = 'ON' | 'OFF';

/** Error names that mean "no retention / legal hold is set on this object". */
const NOT_SET = new Set(['NoSuchObjectLockConfiguration']);

export async function getObjectRetention(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectRetention>> {
  try {
    const out = await client.send(new GetObjectRetentionCommand({ Bucket: args.bucket, Key: args.key }));
    const ret = out.Retention;
    return ok({
      mode: (ret?.Mode as 'GOVERNANCE' | 'COMPLIANCE' | undefined) ?? null,
      retainUntil: ret?.RetainUntilDate ? ret.RetainUntilDate.toISOString() : null,
    });
  } catch (e) {
    if (NOT_SET.has((e as { name?: string })?.name ?? '')) return ok({ mode: null, retainUntil: null });
    return toErr(e);
  }
}

export async function getObjectLegalHold(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<LegalHoldStatus>> {
  try {
    const out = await client.send(new GetObjectLegalHoldCommand({ Bucket: args.bucket, Key: args.key }));
    return ok(out.LegalHold?.Status === 'ON' ? 'ON' : 'OFF');
  } catch (e) {
    if (NOT_SET.has((e as { name?: string })?.name ?? '')) return ok('OFF');
    return toErr(e);
  }
}

export async function putObjectRetention(
  client: S3Client,
  args: { bucket: string; key: string; retainUntil: string },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectRetentionCommand({
        Bucket: args.bucket,
        Key: args.key,
        Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date(args.retainUntil) },
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function putObjectLegalHold(
  client: S3Client,
  args: { bucket: string; key: string; status: LegalHoldStatus },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectLegalHoldCommand({ Bucket: args.bucket, Key: args.key, LegalHold: { Status: args.status } }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objectRetention.test.ts`
Expected: PASS (6 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objectRetention.ts src/main/s3/objectRetention.test.ts
git commit -m "feat: add per-object retention + legal hold ops"
```

---

## Task 2: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add a type import near the other `../s3` imports:
```ts
import type { ObjectRetention, LegalHoldStatus } from '../s3/objectRetention';
```
Add to `CH`:
```ts
  getObjectRetention: 's3:getObjectRetention',
  putObjectRetention: 's3:putObjectRetention',
  getObjectLegalHold: 's3:getObjectLegalHold',
  putObjectLegalHold: 's3:putObjectLegalHold',
```
Add to `ApiMap`:
```ts
  [CH.getObjectRetention]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<ObjectRetention> };
  [CH.putObjectRetention]: { args: [{ accountId: string; bucket: string; key: string; retainUntil: string }]; res: Result<true> };
  [CH.getObjectLegalHold]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<LegalHoldStatus> };
  [CH.putObjectLegalHold]: { args: [{ accountId: string; bucket: string; key: string; status: LegalHoldStatus }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `GetObjectRetentionCommand`, `PutObjectLegalHoldCommand` to the `@aws-sdk/client-s3` import):

```ts
describe('retention & legal hold handlers', () => {
  it('s3:getObjectRetention returns none when unset', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectRetentionCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));

    const res = (await handlers.get(CH.getObjectRetention)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { mode: string | null; retainUntil: string | null };
    };
    expect(res).toEqual({ ok: true, data: { mode: null, retainUntil: null } });
  });

  it('s3:putObjectLegalHold sets the hold via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectLegalHoldCommand).resolves({});

    const res = (await handlers.get(CH.putObjectLegalHold)!({ accountId: created.data.id, bucket: 'b', key: 'k', status: 'ON' })) as {
      ok: boolean; data: boolean;
    };
    expect(res).toEqual({ ok: true, data: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handlers for the new channels (and the every-channel test fails for the 4 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`: add the import:
```ts
import { getObjectRetention, putObjectRetention, getObjectLegalHold, putObjectLegalHold } from '../s3/objectRetention';
import type { LegalHoldStatus } from '../s3/objectRetention';
```
and register the four handlers (next to the object-lock handlers):
```ts
  h(CH.getObjectRetention, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectRetention(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectRetention, (a: { accountId: string; bucket: string; key: string; retainUntil: string }) =>
    putObjectRetention(clientFor(a.accountId), { bucket: a.bucket, key: a.key, retainUntil: a.retainUntil }),
  );
  h(CH.getObjectLegalHold, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectLegalHold(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectLegalHold, (a: { accountId: string; bucket: string; key: string; status: LegalHoldStatus }) =>
    putObjectLegalHold(clientFor(a.accountId), { bucket: a.bucket, key: a.key, status: a.status }),
  );
```

In `src/preload.ts`, add:
```ts
  getObjectRetention: (a: ApiMap[typeof CH.getObjectRetention]['args'][0]) => invoke(CH.getObjectRetention, a),
  putObjectRetention: (a: ApiMap[typeof CH.putObjectRetention]['args'][0]) => invoke(CH.putObjectRetention, a),
  getObjectLegalHold: (a: ApiMap[typeof CH.getObjectLegalHold]['args'][0]) => invoke(CH.getObjectLegalHold, a),
  putObjectLegalHold: (a: ApiMap[typeof CH.putObjectLegalHold]['args'][0]) => invoke(CH.putObjectLegalHold, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire per-object retention & legal hold IPC channels"
```

---

## Task 3: useObjectRetention hook

**Files:**
- Create: `src/renderer/hooks/useObjectRetention.ts`
- Test: `src/renderer/hooks/useObjectRetention.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectRetention.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectRetention } from './useObjectRetention';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
    getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    putObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: true }),
    putObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectRetention', () => {
  it('setRetention calls putObjectRetention and invalidates the retention query', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.setRetention.mutateAsync({ retainUntil: '2027-01-01T00:00:00.000Z' });
    expect(window.s3.putObjectRetention).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', retainUntil: '2027-01-01T00:00:00.000Z' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectRetention', 'a', 'b', 'k'] });
  });

  it('setLegalHold calls putObjectLegalHold and invalidates the legal-hold query', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.setLegalHold.mutateAsync('ON');
    expect(window.s3.putObjectLegalHold).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', status: 'ON' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectLegalHold', 'a', 'b', 'k'] });
  });

  it('loads the current retention and legal-hold values', async () => {
    const { result } = renderHook(() => useObjectRetention('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.retention.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.legalHold.isSuccess).toBe(true));
    expect(result.current.retention.data).toEqual({ mode: null, retainUntil: null });
    expect(result.current.legalHold.data).toBe('OFF');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectRetention.test.tsx`
Expected: FAIL — cannot find module `./useObjectRetention`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectRetention.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { ObjectRetention, LegalHoldStatus } from '../../main/s3/objectRetention';

export function useObjectRetention(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const retentionKey = ['objectRetention', accountId, bucket, key] as const;
  const legalHoldKey = ['objectLegalHold', accountId, bucket, key] as const;

  const retention = useQuery({
    queryKey: retentionKey,
    enabled,
    queryFn: async (): Promise<ObjectRetention> =>
      unwrap(await window.s3.getObjectRetention({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const legalHold = useQuery({
    queryKey: legalHoldKey,
    enabled,
    queryFn: async (): Promise<LegalHoldStatus> =>
      unwrap(await window.s3.getObjectLegalHold({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const setRetention = useMutation({
    mutationFn: async (v: { retainUntil: string }) =>
      unwrap(await window.s3.putObjectRetention({ accountId: accountId!, bucket: bucket!, key: key!, retainUntil: v.retainUntil })),
    onSuccess: () => qc.invalidateQueries({ queryKey: retentionKey }),
  });

  const setLegalHold = useMutation({
    mutationFn: async (status: LegalHoldStatus) =>
      unwrap(await window.s3.putObjectLegalHold({ accountId: accountId!, bucket: bucket!, key: key!, status })),
    onSuccess: () => qc.invalidateQueries({ queryKey: legalHoldKey }),
  });

  return { retention, legalHold, setRetention, setLegalHold };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectRetention.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectRetention.ts src/renderer/hooks/useObjectRetention.test.tsx
git commit -m "feat(ui): add useObjectRetention hook"
```

---

## Task 4: RetentionSection component

**Files:**
- Create: `src/renderer/components/files/RetentionSection.tsx`
- Test: `src/renderer/components/files/RetentionSection.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/RetentionSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { RetentionSection } from './RetentionSection';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return {
    getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
    getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    putObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: true }),
    putObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('RetentionSection', () => {
  it('shows None / Off for an unset object', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('applies a governance retention after confirmation', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    await screen.findByText('None');
    fireEvent.change(screen.getByLabelText('Retain until'), { target: { value: '2027-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply retention' })); // confirm dialog
    await waitFor(() =>
      expect(window.s3.putObjectRetention).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', retainUntil: '2027-01-01T00:00:00.000Z' }),
    );
  });

  it('renders a COMPLIANCE retention read-only (no date input)', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: 'COMPLIANCE', retainUntil: '2030-01-01T00:00:00.000Z' } }),
    });
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    expect(await screen.findByText(/COMPLIANCE until/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Retain until')).toBeNull();
  });

  it('turns on legal hold without a confirm', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on legal hold' }));
    await waitFor(() =>
      expect(window.s3.putObjectLegalHold).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', status: 'ON' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/RetentionSection.test.tsx`
Expected: FAIL — cannot find module `./RetentionSection`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/RetentionSection.tsx`:

```tsx
import { useState } from 'react';
import { useObjectRetention } from '../../hooks/useObjectRetention';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatTimestamp } from '../../lib/format';

/** Tomorrow as a 'YYYY-MM-DD' string (UTC). */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function RetentionSection({
  accountId,
  bucket,
  objectKey,
}: {
  accountId: string;
  bucket: string;
  objectKey: string;
}) {
  const { retention, legalHold, setRetention, setLegalHold } = useObjectRetention(accountId, bucket, objectKey);
  const { show } = useToast();
  const [date, setDate] = useState('');
  const [confirming, setConfirming] = useState(false);

  const ret = retention.data;
  const isCompliance = ret?.mode === 'COMPLIANCE';
  const currentUntilDay = ret?.retainUntil ? ret.retainUntil.slice(0, 10) : null;
  const minDate = currentUntilDay && currentUntilDay > tomorrow() ? currentUntilDay : tomorrow();
  const canApply = date !== '' && date >= minDate && !setRetention.isPending;

  const retentionLabel = retention.isSuccess
    ? ret && ret.mode
      ? `${ret.mode} until ${formatTimestamp(ret.retainUntil)}`
      : 'None'
    : retention.isError
      ? 'unavailable'
      : '…';
  const holdLabel = legalHold.isSuccess
    ? legalHold.data === 'ON'
      ? 'On'
      : 'Off'
    : legalHold.isError
      ? 'unavailable'
      : '…';

  const applyRetention = async () => {
    setConfirming(false);
    try {
      await setRetention.mutateAsync({ retainUntil: `${date}T00:00:00.000Z` });
      show('Retention updated');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const toggleHold = async () => {
    const next = legalHold.data === 'ON' ? 'OFF' : 'ON';
    try {
      await setLegalHold.mutateAsync(next);
      show(next === 'ON' ? 'Legal hold on' : 'Legal hold off');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 py-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">Retention &amp; legal hold</span>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Retention: <span className="text-slate-700">{retentionLabel}</span></span>
        {retention.isSuccess && !isCompliance && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Retain until"
              min={minDate}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              disabled={!canApply}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setConfirming(true)}
            >
              Apply
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Legal hold: <span className="text-slate-700">{holdLabel}</span></span>
        {legalHold.isSuccess && (
          <button
            type="button"
            disabled={setLegalHold.isPending}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
            onClick={toggleHold}
          >
            {legalHold.data === 'ON' ? 'Turn off legal hold' : 'Turn on legal hold'}
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={`Lock this object from deletion until ${date}? You won't be able to shorten this here.`}
          confirmLabel="Apply retention"
          onCancel={() => setConfirming(false)}
          onConfirm={applyRetention}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/RetentionSection.test.tsx`
Expected: PASS (4 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/RetentionSection.tsx src/renderer/components/files/RetentionSection.test.tsx
git commit -m "feat(ui): add RetentionSection (per-object retention + legal hold)"
```

---

## Task 5: MetadataPanel — render RetentionSection when lock enabled

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

- [ ] **Step 1: Add the failing tests.**

First, in `src/renderer/components/files/MetadataPanel.test.tsx`, add `getObjectLockConfig` to the SHARED `beforeEach` `window.s3` stub so the new `useObjectLock` query has something to resolve in the existing tests (lock disabled by default → section absent, no behavior change):
```ts
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
```
Then append:
```tsx
describe('MetadataPanel retention section', () => {
  it('shows the Retention & legal hold section when the bucket has Object Lock enabled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: true, defaultRetention: null } }),
      getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
      getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('Retention & legal hold')).toBeInTheDocument();
  });

  it('hides the section when Object Lock is not enabled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('private')).toBeInTheDocument();
    expect(screen.queryByText('Retention & legal hold')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — the "shows the section" test fails (no Retention section rendered).

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`:

(a) Add imports:
```tsx
import { useObjectLock } from '../../hooks/useObjectLock';
import { RetentionSection } from './RetentionSection';
```

(b) After the `useObjectDetails` destructure line, add:
```tsx
  const lock = useObjectLock(accountId, bucket);
```

(c) Insert the section in the details body, immediately after the Visibility row's closing `</div>` (the one at the end of the Visibility block) and before the `{metadata.isLoading && …}` line:
```tsx
        {lock.query.data?.enabled && (
          <RetentionSection accountId={accountId ?? ''} bucket={bucket ?? ''} objectKey={objectKey} />
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing + 2 new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): show retention & legal hold in the metadata panel for lock-enabled buckets"
```

---

## Manual smoke checklist (after Task 5)

`npm start` (full restart — main-process IPC handlers added), with an account and a **bucket created with Object Lock enabled** plus an object in it:
1. Select the object → a **Retention & legal hold** section appears (Retention: None, Legal hold: Off).
2. Pick a future date → **Apply** → confirm → Retention shows `GOVERNANCE until <date>`; try to delete the object before then → blocked by S3.
3. The date input won't let you pick a date earlier than the current retain-until (extend-only).
4. **Turn on legal hold** → Legal hold: On; deletion blocked. **Turn off legal hold** → Off.
5. Select an object in a non-lock bucket → no Retention section appears.
6. If an object has a COMPLIANCE retention, it shows read-only (no date input).

---

## Self-Review

**Spec coverage (against `2026-05-30-s3-manager-object-retention-legal-hold-design.md`):**
- `objectRetention.ts` 4 ops (get maps "none" → null/OFF; put GOVERNANCE retention / legal-hold status) → Task 1. ✅
- IPC 4 channels + register + preload → Task 2. ✅
- `useObjectRetention` (queries + setRetention/setLegalHold invalidating) → Task 3. ✅
- `RetentionSection` (state display; GOVERNANCE set/extend with min-date extend-only + confirm; COMPLIANCE read-only; legal-hold toggle no-confirm; pending disables) → Task 4. ✅
- MetadataPanel gates the section on `useObjectLock` enabled → Task 5. ✅
- States/errors (extend-only via min-date, no optimistic update — refetch via invalidate, error toasts, section only on lock buckets) → Tasks 3/4/5. ✅
- Out of scope (COMPLIANCE set, bypass/shorten, bulk/folder, upload-time, non-lock buckets) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `ObjectRetention` (`{ mode: 'GOVERNANCE'|'COMPLIANCE'|null; retainUntil: string|null }`) and `LegalHoldStatus` (`'ON'|'OFF'`) are defined once in `objectRetention.ts` (Task 1) and imported by `channels.ts` (Task 2), `useObjectRetention` (Task 3), and used by `RetentionSection` via the hook (Task 4). `setRetention` takes `{ retainUntil: string }` and `setLegalHold` takes `LegalHoldStatus` — matched in the hook, the section's calls, and the `window.s3.put*` arg shapes / `ApiMap` (Task 2). The retention/legal-hold query keys (`['objectRetention', …]` / `['objectLegalHold', …]`) match between the queries and the `invalidateQueries` calls. `ok(true)` returns `Result<true>` (verified). `RetentionSection`'s confirm label "Apply retention" is distinct from the "Apply" trigger so tests disambiguate; values are wrapped in inner `<span>`s so `getByText('None')`/`'Off'`/`/COMPLIANCE until/` match single nodes.

**Notes for implementers:** Task 2 adds main-process handlers, so the manual smoke needs a full `npm start` restart. Task 5 adds `getObjectLockConfig` to the existing MetadataPanel test stub so the new `useObjectLock` query resolves cleanly in pre-existing tests (lock disabled → section absent → no behavior change). Object Lock can only be enabled at bucket creation, so the smoke test needs a lock-enabled bucket.
