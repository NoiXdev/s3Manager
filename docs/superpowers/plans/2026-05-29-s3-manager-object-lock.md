# S3 Manager — Object Lock (Default Retention) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View a bucket's Object Lock status and configure its default retention (mode + days/years), replacing the Object Lock section's "Coming soon" placeholder.

**Architecture:** New `src/main/s3/objectLock.ts` ops wrap `GetObjectLockConfigurationCommand`/`PutObjectLockConfigurationCommand` (a non-lock-enabled bucket maps to an informational `enabled:false` state, not an error), wired through two new IPC channels + preload methods. The renderer adds a `useObjectLock` hook and an `ObjectLockEditor` view (own account/bucket dropdowns, read-only not-enabled panel, default-retention form with Save / Remove). Mirrors the CORS feature.

**Tech Stack:** Electron 42, AWS SDK v3, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite (existing, do not redefine):**
- `src/main/s3/objects.ts` exports `toErr`. `src/main/shared/result.ts` exports `ok`/`Result`.
- `src/main/ipc/register.ts`: `registerIpc(ipcMain, deps)` with `clientFor(accountId)` + the `h(channel, fn)` helper. `register.test.ts` has `buildHarness()` (fake ipcMain capturing handlers; `s3Mock` reset each test) + an "every CH channel has a handler" test iterating `Object.values(CH)`.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`. `src/preload.ts`: typed `window.s3` forwarding via `invoke`.
- Renderer: `useAccounts()` (`Account[]`), `useBuckets(accountId)` (`string[]`), `unwrap` (`src/renderer/lib/result.ts`), `ToastProvider`/`useToast`, `ConfirmDialog`. `App.tsx` owns `accountId`/`bucket` selection and renders the `cors` branch then a `Coming soon` fallback for `objectLock`/`settings`.
- `@aws-sdk/client-s3` exports `GetObjectLockConfigurationCommand`, `PutObjectLockConfigurationCommand`, and the `ObjectLockConfiguration` type (confirmed present).
- The CORS feature (Plan `…-cors.md`) is merged; this plan follows the same structure (`objectLock.ts` ≈ `cors.ts`, `useObjectLock` ≈ `useCors`, `ObjectLockEditor` ≈ `CorsEditor`).

---

## File Structure

```
src/main/s3/objectLock.ts                          # getObjectLockConfig / putObjectLockConfig + types
src/main/ipc/channels.ts                           # MODIFY: 2 channels + ApiMap entries
src/main/ipc/register.ts                           # MODIFY: 2 handlers
src/preload.ts                                     # MODIFY: 2 methods
src/renderer/hooks/useObjectLock.ts                # query + save/clear mutations
src/renderer/components/objectlock/ObjectLockEditor.tsx  # pickers + status + form + Save/Remove
src/renderer/App.tsx                               # MODIFY: render ObjectLockEditor for section==='objectLock'
```

---

## Task 1: objectLock.ts — getObjectLockConfig + types

**Files:**
- Create: `src/main/s3/objectLock.ts`
- Test: `src/main/s3/objectLock.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/objectLock.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { getObjectLockConfig } from './objectLock';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getObjectLockConfig', () => {
  it('maps an enabled config with a default retention', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } },
    });
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } } });
  });

  it('maps enabled with no default retention rule', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({ ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled' } });
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: true, defaultRetention: null } });
  });

  it('treats ObjectLockConfigurationNotFoundError as not-enabled', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).rejects(Object.assign(new Error('none'), { name: 'ObjectLockConfigurationNotFoundError' }));
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: { enabled: false, defaultRetention: null } });
  });

  it('maps other errors to err', async () => {
    s3Mock.on(GetObjectLockConfigurationCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await getObjectLockConfig(new S3Client({}), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objectLock.test.ts`
Expected: FAIL — cannot find module `./objectLock`.

- [ ] **Step 3: Implement** — `src/main/s3/objectLock.ts`:

```ts
import { S3Client, GetObjectLockConfigurationCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface DefaultRetention {
  mode: 'GOVERNANCE' | 'COMPLIANCE';
  days: number | null;
  years: number | null;
}

export interface ObjectLockStatus {
  enabled: boolean;
  defaultRetention: DefaultRetention | null;
}

export async function getObjectLockConfig(client: S3Client, bucket: string): Promise<Result<ObjectLockStatus>> {
  try {
    const out = await client.send(new GetObjectLockConfigurationCommand({ Bucket: bucket }));
    const cfg = out.ObjectLockConfiguration;
    const enabled = cfg?.ObjectLockEnabled === 'Enabled';
    const dr = cfg?.Rule?.DefaultRetention;
    const defaultRetention: DefaultRetention | null = dr
      ? { mode: dr.Mode as 'GOVERNANCE' | 'COMPLIANCE', days: dr.Days ?? null, years: dr.Years ?? null }
      : null;
    return ok({ enabled, defaultRetention });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'ObjectLockConfigurationNotFoundError') return ok({ enabled: false, defaultRetention: null });
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objectLock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objectLock.ts src/main/s3/objectLock.test.ts
git commit -m "feat: add getObjectLockConfig (not-found maps to not-enabled)"
```

---

## Task 2: objectLock.ts — putObjectLockConfig

**Files:**
- Modify: `src/main/s3/objectLock.ts`
- Modify: `src/main/s3/objectLock.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/objectLock.test.ts` (add `PutObjectLockConfigurationCommand` to the `@aws-sdk/client-s3` import; add `putObjectLockConfig` and `type DefaultRetention` to the `./objectLock` import):

```ts
describe('putObjectLockConfig', () => {
  it('sends Days when days is set (no Years)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const retention: DefaultRetention = { mode: 'GOVERNANCE', days: 30, years: null };
    const r = await putObjectLockConfig(new S3Client({}), 'b', retention);
    expect(r).toEqual({ ok: true, data: true });
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } });
  });

  it('sends Years when years is set (no Days)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const retention: DefaultRetention = { mode: 'COMPLIANCE', days: null, years: 2 };
    await putObjectLockConfig(new S3Client({}), 'b', retention);
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Years: 2 } } });
  });

  it('clears the default retention when retention is null (no Rule)', async () => {
    s3Mock.on(PutObjectLockConfigurationCommand).resolves({});
    const r = await putObjectLockConfig(new S3Client({}), 'b', null);
    expect(r).toEqual({ ok: true, data: true });
    const cfg = s3Mock.commandCalls(PutObjectLockConfigurationCommand)[0].args[0].input.ObjectLockConfiguration!;
    expect(cfg).toEqual({ ObjectLockEnabled: 'Enabled' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objectLock.test.ts`
Expected: FAIL — `putObjectLockConfig` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/objectLock.ts` add `PutObjectLockConfigurationCommand` and `type ObjectLockConfiguration` to the `@aws-sdk/client-s3` import, then append:

```ts
export async function putObjectLockConfig(
  client: S3Client,
  bucket: string,
  retention: DefaultRetention | null,
): Promise<Result<true>> {
  try {
    const configuration: ObjectLockConfiguration = { ObjectLockEnabled: 'Enabled' };
    if (retention) {
      const dr: { Mode: 'GOVERNANCE' | 'COMPLIANCE'; Days?: number; Years?: number } = { Mode: retention.mode };
      if (retention.days !== null) dr.Days = retention.days;
      else if (retention.years !== null) dr.Years = retention.years;
      configuration.Rule = { DefaultRetention: dr };
    }
    await client.send(new PutObjectLockConfigurationCommand({ Bucket: bucket, ObjectLockConfiguration: configuration }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objectLock.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objectLock.ts src/main/s3/objectLock.test.ts
git commit -m "feat: add putObjectLockConfig (set/clear default retention)"
```

---

## Task 3: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to the `CH` object (after the CORS channels):
```ts
  getObjectLockConfig: 's3:getObjectLockConfig',
  putObjectLockConfig: 's3:putObjectLockConfig',
```
Add a type-only import at the top:
```ts
import type { ObjectLockStatus, DefaultRetention } from '../s3/objectLock';
```
Add to the `ApiMap` interface:
```ts
  [CH.getObjectLockConfig]: { args: [{ accountId: string; bucket: string }]; res: Result<ObjectLockStatus> };
  [CH.putObjectLockConfig]: { args: [{ accountId: string; bucket: string; retention: DefaultRetention | null }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `GetObjectLockConfigurationCommand` to the `@aws-sdk/client-s3` import):

```ts
describe('Object Lock handlers', () => {
  it('s3:getObjectLockConfig returns the bucket lock status via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectLockConfigurationCommand).resolves({
      ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } } },
    });

    const res = (await handlers.get(CH.getObjectLockConfig)!({ accountId: created.data.id, bucket: 'b' })) as {
      ok: boolean; data: { enabled: boolean; defaultRetention: { days: number | null } | null };
    };
    expect(res.ok).toBe(true);
    expect(res.data.enabled).toBe(true);
    expect(res.data.defaultRetention?.days).toBe(30);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `s3:getObjectLockConfig` (and the every-channel test fails for the 2 new channels).

- [ ] **Step 4: Implement** — in `src/main/ipc/register.ts` add the import:
```ts
import { getObjectLockConfig, putObjectLockConfig } from '../s3/objectLock';
import type { DefaultRetention } from '../s3/objectLock';
```
and register the two handlers (next to the CORS handlers):
```ts
  h(CH.getObjectLockConfig, (a: { accountId: string; bucket: string }) =>
    getObjectLockConfig(clientFor(a.accountId), a.bucket),
  );

  h(CH.putObjectLockConfig, (a: { accountId: string; bucket: string; retention: DefaultRetention | null }) =>
    putObjectLockConfig(clientFor(a.accountId), a.bucket, a.retention),
  );
```

Then in `src/preload.ts` add the two methods to the `api` object (after the CORS methods):
```ts
  getObjectLockConfig: (a: ApiMap[typeof CH.getObjectLockConfig]['args'][0]) => invoke(CH.getObjectLockConfig, a),
  putObjectLockConfig: (a: ApiMap[typeof CH.putObjectLockConfig]['args'][0]) => invoke(CH.putObjectLockConfig, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the "every channel" test for all 19 channels). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire Object Lock get/put IPC channels"
```

---

## Task 4: useObjectLock hook

**Files:**
- Create: `src/renderer/hooks/useObjectLock.ts`
- Test: `src/renderer/hooks/useObjectLock.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectLock.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectLock } from './useObjectLock';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const status = { enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: status }),
    putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectLock', () => {
  it('loads the bucket lock status', async () => {
    const { result } = renderHook(() => useObjectLock('acc-1', 'assets'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual(status);
  });

  it('is idle when bucket is null', () => {
    const get = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { getObjectLockConfig: get };
    const { result } = renderHook(() => useObjectLock('acc-1', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('save sends the retention; clear sends null', async () => {
    const { result } = renderHook(() => useObjectLock('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.save.mutateAsync({ mode: 'COMPLIANCE', days: null, years: 1 });
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: { mode: 'COMPLIANCE', days: null, years: 1 } });
    await result.current.clear.mutateAsync();
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectLock.test.tsx`
Expected: FAIL — cannot find module `./useObjectLock`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectLock.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { DefaultRetention } from '../../main/s3/objectLock';

export function objectLockKey(accountId: string | null, bucket: string | null) {
  return ['objectLock', accountId, bucket] as const;
}

export function useObjectLock(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null;
  const invalidate = () => qc.invalidateQueries({ queryKey: objectLockKey(accountId, bucket) });

  const query = useQuery({
    queryKey: objectLockKey(accountId, bucket),
    enabled,
    queryFn: async () => unwrap(await window.s3.getObjectLockConfig({ accountId: accountId!, bucket: bucket! })),
  });

  const save = useMutation({
    mutationFn: async (retention: DefaultRetention) =>
      unwrap(await window.s3.putObjectLockConfig({ accountId: accountId!, bucket: bucket!, retention })),
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: async () =>
      unwrap(await window.s3.putObjectLockConfig({ accountId: accountId!, bucket: bucket!, retention: null })),
    onSuccess: invalidate,
  });

  return { query, save, clear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectLock.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectLock.ts src/renderer/hooks/useObjectLock.test.tsx
git commit -m "feat(ui): add useObjectLock query + save/clear mutations"
```

---

## Task 5: ObjectLockEditor

**Files:**
- Create: `src/renderer/components/objectlock/ObjectLockEditor.tsx`
- Test: `src/renderer/components/objectlock/ObjectLockEditor.test.tsx`

Owns the account/bucket dropdowns (seeded from props), shows the not-enabled panel or the default-retention form, and Save / Remove-default.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/objectlock/ObjectLockEditor.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ObjectLockEditor } from './ObjectLockEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

function setS3(lock: unknown) {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: lock }),
    putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
}

describe('ObjectLockEditor', () => {
  beforeEach(() => setS3({ enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } }));

  it('shows the read-only info panel when Object Lock is not enabled', async () => {
    setS3({ enabled: false, defaultRetention: null });
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    expect(await screen.findByText(/Object Lock is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('loads the default retention and saves an edited period', async () => {
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    const period = await screen.findByLabelText('Retention period');
    expect(period).toHaveValue(30);
    await userEvent.clear(period);
    await userEvent.type(period, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({
      accountId: 'acc-1', bucket: 'assets', retention: { mode: 'GOVERNANCE', days: 60, years: null },
    });
  });

  it('removes the default retention after confirmation', async () => {
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    await screen.findByLabelText('Retention period');
    await userEvent.click(screen.getByRole('button', { name: 'Remove default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove default retention' }));
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: null });
  });

  it('disables Save when the period is empty', async () => {
    setS3({ enabled: true, defaultRetention: null });
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/objectlock/ObjectLockEditor.test.tsx`
Expected: FAIL — cannot find module `./ObjectLockEditor`.

- [ ] **Step 3: Implement** — `src/renderer/components/objectlock/ObjectLockEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';
import { useObjectLock } from '../../hooks/useObjectLock';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

type Unit = 'days' | 'years';

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

  const [mode, setMode] = useState<'GOVERNANCE' | 'COMPLIANCE'>('GOVERNANCE');
  const [period, setPeriod] = useState('');
  const [unit, setUnit] = useState<Unit>('days');
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const dr = lock.query.data?.defaultRetention;
    if (!lock.query.data) return;
    if (dr) {
      setMode(dr.mode);
      if (dr.days !== null) {
        setPeriod(String(dr.days));
        setUnit('days');
      } else if (dr.years !== null) {
        setPeriod(String(dr.years));
        setUnit('years');
      }
    } else {
      setMode('GOVERNANCE');
      setPeriod('');
      setUnit('days');
    }
  }, [lock.query.data]);

  const selectAccount = (id: string | null) => {
    setAccountId(id);
    setBucket(null);
  };

  const periodNum = Number(period);
  const periodValid = period.trim() !== '' && Number.isInteger(periodNum) && periodNum > 0;

  const fieldClass = 'rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Object Lock</h2>

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

      {bucket === null && <p className="mt-4 text-slate-500">Select a bucket to view its Object Lock settings.</p>}

      {bucket !== null && lock.query.isLoading && <p className="mt-4 text-slate-500">Loading Object Lock…</p>}
      {bucket !== null && lock.query.isError && <p className="mt-4 text-red-600">{(lock.query.error as Error).message}</p>}

      {bucket !== null && lock.query.isSuccess && !lock.query.data.enabled && (
        <p className="mt-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Object Lock is not enabled on this bucket. It can only be enabled when a bucket is created.
        </p>
      )}

      {bucket !== null && lock.query.isSuccess && lock.query.data.enabled && (
        <div className="mt-4 flex max-w-md flex-col gap-3">
          <p className="text-sm text-slate-600">Default retention applied to new objects:</p>

          <label className="block text-sm">
            Mode
            <select aria-label="Retention mode" className={`${fieldClass} mt-1 block`} value={mode} onChange={(e) => setMode(e.target.value as 'GOVERNANCE' | 'COMPLIANCE')}>
              <option value="GOVERNANCE">Governance</option>
              <option value="COMPLIANCE">Compliance</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="block text-sm">
              Period
              <input aria-label="Retention period" type="number" min="1" className={`${fieldClass} mt-1 block w-28`} value={period} onChange={(e) => setPeriod(e.target.value)} />
            </label>
            <label className="block text-sm">
              Unit
              <select aria-label="Period unit" className={`${fieldClass} mt-1 block`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="days">Days</option>
                <option value="years">Years</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!periodValid}
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
              onClick={async () => {
                try {
                  await lock.save.mutateAsync({
                    mode,
                    days: unit === 'days' ? periodNum : null,
                    years: unit === 'years' ? periodNum : null,
                  });
                  show('Object Lock saved');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              Save
            </button>
            <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmRemove(true)}>
              Remove default
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove the default retention from this bucket? Object Lock stays enabled."
          confirmLabel="Remove default retention"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            try {
              await lock.clear.mutateAsync();
              show('Default retention removed');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/objectlock/ObjectLockEditor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/objectlock/ObjectLockEditor.tsx src/renderer/components/objectlock/ObjectLockEditor.test.tsx
git commit -m "feat(ui): add ObjectLockEditor"
```

---

## Task 6: Wire ObjectLockEditor into App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/App.test.tsx`. First add these to the existing `beforeEach` `window.s3` object literal: `getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }), putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),`. Then append:

```tsx
describe('App — Object Lock', () => {
  it('renders the Object Lock editor for the Object Lock section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Object Lock' }));
    expect(await screen.findByText('Object Lock')).toBeInTheDocument();
    expect(screen.getByLabelText('Account')).toBeInTheDocument();
  });
});
```

(Note: the section nav button and the editor heading are both "Object Lock". `findByText('Object Lock')` resolves the heading element; the nav `button` is matched by role elsewhere. If `findByText('Object Lock')` reports multiple matches in this environment, change the assertion to `expect(await screen.findByRole('heading', { name: 'Object Lock' })).toBeInTheDocument();` — the editor's `<h2>` — which is unambiguous. Use the `heading` form to be safe.)

Use the heading form:
```tsx
    expect(await screen.findByRole('heading', { name: 'Object Lock' })).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — the Object Lock section still renders "Coming soon".

- [ ] **Step 3: Implement** — in `src/renderer/App.tsx` add the import:
```tsx
import { ObjectLockEditor } from './components/objectlock/ObjectLockEditor';
```
and add an `objectLock` branch before the final `Coming soon` else. Change:
```tsx
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}
```
to:
```tsx
          ) : section === 'objectLock' ? (
            <ObjectLockEditor initialAccountId={accountId} initialBucket={bucket} />
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
git commit -m "feat(ui): wire ObjectLockEditor into the Object Lock section"
```

---

## Manual smoke checklist (after Task 6)

`npm start` (full restart — main-process IPC handlers changed), with an account + bucket:
1. Click **Object Lock** → account/bucket dropdowns (seeded from current selection).
2. Pick a bucket **without** Object Lock → "Object Lock is not enabled on this bucket…" panel, no form.
3. Pick a bucket **with** Object Lock → form shows current default (or empty); set mode + period + unit, **Save** → toast "Object Lock saved".
4. Reselect the bucket → the saved default appears.
5. **Remove default** → confirm → toast "Default retention removed".
6. Empty period → **Save** is disabled.
7. On a provider that rejects (e.g. `NotImplemented`) → Save shows an error toast; form values stay.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-object-lock-design.md`):**
- `getObjectLockConfig` (not-found → not-enabled) + `putObjectLockConfig` (set/clear, Days-XOR-Years) + `ObjectLockStatus`/`DefaultRetention` → Tasks 1, 2. ✅
- IPC channels + register handlers + preload methods → Task 3. ✅
- `useObjectLock` query + save/clear with invalidation → Task 4. ✅
- Own account/bucket dropdowns seeded from selection → Task 5 (+ App wiring Task 6). ✅
- Read-only not-enabled panel → Task 5. ✅
- Default-retention form (mode, period, days/years unit) → Task 5. ✅
- Save / Remove-default (confirm) + toasts → Task 5. ✅
- Period validation (positive integer; Save disabled otherwise) → Task 5. ✅
- States (no-bucket prompt, loading, not-enabled, enabled-no-default, enabled-with-default, query error, save/clear error toast) → Tasks 4, 5. ✅
- Replace "Coming soon" for Object Lock → Task 6. ✅
- Out of scope (enabling lock at creation, per-object retention/legal-hold, governance bypass) → none added. ✅

**Placeholder scan:** none — every step has complete, runnable code/commands.

**Type consistency:** `DefaultRetention` (`{mode, days, years}`) and `ObjectLockStatus` (`{enabled, defaultRetention}`) defined in Task 1 (`objectLock.ts`), imported type-only by `channels.ts`/`register.ts` (Task 3), `useObjectLock.ts` (Task 4), and used in `ObjectLockEditor` (Task 5). The two `CH` channels + `ApiMap` shapes match the `register` handlers and `preload` methods. `useObjectLock` returns `{ query, save, clear }` consumed by `ObjectLockEditor`; `save` takes a `DefaultRetention`, `clear` takes no args (sends `retention: null`). `ConfirmDialog`/`ToastProvider`/`useToast` match existing definitions. The Remove trigger ("Remove default") and dialog confirm ("Remove default retention") have distinct accessible names so tests are unambiguous.

**Note for implementers:** the `App` integration test uses `findByRole('heading', { name: 'Object Lock' })` (the editor's `<h2>`) because the nav also has an "Object Lock" button — the heading role disambiguates. After Task 3 changes main-process handlers, the manual smoke requires a full `npm start` restart (renderer HMR alone won't register the new IPC handlers).