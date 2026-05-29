# S3 Manager — CORS Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bucket CORS support — main-process `get`/`put`/`delete` CORS ops + a structured CORS editor UI (per-rule cards, read-only JSON preview, Save / Clear-all) replacing the CORS section's "Coming soon" placeholder.

**Architecture:** New `src/main/s3/cors.ts` ops wrap `GetBucketCorsCommand`/`PutBucketCorsCommand`/`DeleteBucketCorsCommand` (a missing CORS config maps to an empty rule set, not an error), wired through three new IPC channels + preload methods. The renderer adds a `useCors` hook and a `CorsEditor` view (own account/bucket dropdowns, `CorsRuleCard`s, reusable `StringListEditor`). All edits are local until Save.

**Tech Stack:** Electron 42, AWS SDK v3, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite (existing, do not redefine):**
- `src/main/s3/objects.ts` exports `toErr(e): Result<never>`. `src/main/shared/result.ts` exports `ok`/`err`/`Result`.
- `src/main/ipc/register.ts`: `registerIpc(ipcMain, deps)` with `clientFor(accountId)` and the generic `h(channel, fn)` helper (`ipcMain.handle(channel, async (_e, ...args) => …)`). `register.test.ts` has a `buildHarness()` (fake ipcMain capturing handlers; `s3Mock` reset each test) and an "every CH channel has a handler" test iterating `Object.values(CH)`.
- `src/main/ipc/channels.ts`: `CH` const + `ApiMap`. `src/preload.ts`: typed `window.s3` forwarding via `invoke`.
- Renderer: `useAccounts()` (`Account[]`), `useBuckets(accountId)` (`string[]`), `unwrap` (`src/renderer/lib/result.ts`), `ToastProvider`/`useToast`, `ConfirmDialog`. `App.tsx` owns `accountId`/`bucket` selection and renders `<… Coming soon …>` for `section === 'cors'`.
- `@aws-sdk/client-s3` exports `GetBucketCorsCommand`, `PutBucketCorsCommand`, `DeleteBucketCorsCommand`, and the `CORSRule` type (all confirmed present).

---

## File Structure

```
src/main/s3/cors.ts                            # getBucketCors / putBucketCors / deleteBucketCors + CorsRule
src/main/ipc/channels.ts                       # MODIFY: 3 CORS channels + ApiMap entries
src/main/ipc/register.ts                       # MODIFY: 3 CORS handlers
src/preload.ts                                 # MODIFY: 3 CORS methods
src/renderer/hooks/useCors.ts                  # query + save/clear mutations
src/renderer/components/cors/StringListEditor.tsx  # reusable add/remove string list
src/renderer/components/cors/CorsRuleCard.tsx      # one rule's fields
src/renderer/components/cors/CorsEditor.tsx        # pickers + working state + JSON + Save/Clear
src/renderer/App.tsx                           # MODIFY: render CorsEditor for section==='cors'
```

---

## Task 1: cors.ts — getBucketCors + CorsRule

**Files:**
- Create: `src/main/s3/cors.ts`
- Test: `src/main/s3/cors.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/cors.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { getBucketCors } from './cors';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getBucketCors', () => {
  it('maps SDK CORS rules to CorsRule[]', async () => {
    s3Mock.on(GetBucketCorsCommand).resolves({
      CORSRules: [
        { ID: 'r1', AllowedMethods: ['GET', 'PUT'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 },
      ],
    });
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({
      ok: true,
      data: [
        { id: 'r1', allowedMethods: ['GET', 'PUT'], allowedOrigins: ['*'], allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 },
      ],
    });
  });

  it('returns an empty rule set when the bucket has no CORS config', async () => {
    s3Mock.on(GetBucketCorsCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchCORSConfiguration' }));
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: [] });
  });

  it('maps other errors to err', async () => {
    s3Mock.on(GetBucketCorsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await getBucketCors(new S3Client({}), 'b');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/cors.test.ts`
Expected: FAIL — cannot find module `./cors`.

- [ ] **Step 3: Implement** — `src/main/s3/cors.ts`:

```ts
import { S3Client, GetBucketCorsCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export interface CorsRule {
  id: string | null;
  allowedMethods: string[];
  allowedOrigins: string[];
  allowedHeaders: string[];
  exposeHeaders: string[];
  maxAgeSeconds: number | null;
}

export async function getBucketCors(client: S3Client, bucket: string): Promise<Result<CorsRule[]>> {
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    const rules: CorsRule[] = (out.CORSRules ?? []).map((r) => ({
      id: r.ID ?? null,
      allowedMethods: r.AllowedMethods ?? [],
      allowedOrigins: r.AllowedOrigins ?? [],
      allowedHeaders: r.AllowedHeaders ?? [],
      exposeHeaders: r.ExposeHeaders ?? [],
      maxAgeSeconds: r.MaxAgeSeconds ?? null,
    }));
    return ok(rules);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (name === 'NoSuchCORSConfiguration') return ok([]);
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/cors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/cors.ts src/main/s3/cors.test.ts
git commit -m "feat: add getBucketCors (no-config maps to empty)"
```

---

## Task 2: cors.ts — putBucketCors + deleteBucketCors

**Files:**
- Modify: `src/main/s3/cors.ts`
- Modify: `src/main/s3/cors.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/cors.test.ts` (add `PutBucketCorsCommand`, `DeleteBucketCorsCommand` to the `@aws-sdk/client-s3` import; add `putBucketCors`, `deleteBucketCors` to the `./cors` import; add `type CorsRule` to the `./cors` import):

```ts
describe('putBucketCors', () => {
  it('maps CorsRule[] back to SDK rules, omitting empty/null optional fields', async () => {
    s3Mock.on(PutBucketCorsCommand).resolves({});
    const rules: CorsRule[] = [
      { id: 'r1', allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: ['*'], exposeHeaders: ['ETag'], maxAgeSeconds: 3600 },
      { id: null, allowedMethods: ['PUT'], allowedOrigins: ['https://x'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null },
    ];
    const r = await putBucketCors(new S3Client({}), 'b', rules);
    expect(r).toEqual({ ok: true, data: true });

    const sent = s3Mock.commandCalls(PutBucketCorsCommand)[0].args[0].input.CORSConfiguration!.CORSRules!;
    expect(sent[0]).toEqual({ ID: 'r1', AllowedMethods: ['GET'], AllowedOrigins: ['*'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 });
    expect(sent[1]).toEqual({ AllowedMethods: ['PUT'], AllowedOrigins: ['https://x'] }); // no ID/AllowedHeaders/ExposeHeaders/MaxAgeSeconds
  });
});

describe('deleteBucketCors', () => {
  it('sends the delete command and returns ok', async () => {
    s3Mock.on(DeleteBucketCorsCommand).resolves({});
    const r = await deleteBucketCors(new S3Client({}), 'b');
    expect(r).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(DeleteBucketCorsCommand).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/cors.test.ts`
Expected: FAIL — `putBucketCors`/`deleteBucketCors` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/cors.ts` add `PutBucketCorsCommand`, `DeleteBucketCorsCommand`, and `type CORSRule` to the `@aws-sdk/client-s3` import, then append:

```ts
function toSdkRule(rule: CorsRule): CORSRule {
  const out: CORSRule = {
    AllowedMethods: rule.allowedMethods,
    AllowedOrigins: rule.allowedOrigins,
  };
  if (rule.allowedHeaders.length) out.AllowedHeaders = rule.allowedHeaders;
  if (rule.exposeHeaders.length) out.ExposeHeaders = rule.exposeHeaders;
  if (rule.id) out.ID = rule.id;
  if (rule.maxAgeSeconds !== null) out.MaxAgeSeconds = rule.maxAgeSeconds;
  return out;
}

export async function putBucketCors(client: S3Client, bucket: string, rules: CorsRule[]): Promise<Result<true>> {
  try {
    await client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules.map(toSdkRule) } }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteBucketCors(client: S3Client, bucket: string): Promise<Result<true>> {
  try {
    await client.send(new DeleteBucketCorsCommand({ Bucket: bucket }));
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/cors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/cors.ts src/main/s3/cors.test.ts
git commit -m "feat: add putBucketCors and deleteBucketCors"
```

---

## Task 3: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to the `CH` object (after `downloadObject`):
```ts
  getBucketCors: 's3:getBucketCors',
  putBucketCors: 's3:putBucketCors',
  deleteBucketCors: 's3:deleteBucketCors',
```
Add a type-only import at the top:
```ts
import type { CorsRule } from '../s3/cors';
```
Add to the `ApiMap` interface:
```ts
  [CH.getBucketCors]: { args: [{ accountId: string; bucket: string }]; res: Result<CorsRule[]> };
  [CH.putBucketCors]: { args: [{ accountId: string; bucket: string; rules: CorsRule[] }]; res: Result<true> };
  [CH.deleteBucketCors]: { args: [{ accountId: string; bucket: string }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `GetBucketCorsCommand` to the `@aws-sdk/client-s3` import):

```ts
describe('CORS handlers', () => {
  it('s3:getBucketCors returns the bucket rules via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetBucketCorsCommand).resolves({
      CORSRules: [{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }],
    });

    const res = (await handlers.get(CH.getBucketCors)!({ accountId: created.data.id, bucket: 'b' })) as {
      ok: boolean; data: { allowedMethods: string[] }[];
    };
    expect(res.ok).toBe(true);
    expect(res.data[0].allowedMethods).toEqual(['GET']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `s3:getBucketCors` (and the "every channel" test now also fails for the 3 new channels).

- [ ] **Step 4: Implement** — in `src/main/ipc/register.ts` add the import:
```ts
import { getBucketCors, putBucketCors, deleteBucketCors } from '../s3/cors';
import type { CorsRule } from '../s3/cors';
```
and register the three handlers (next to the other `h(...)` calls):
```ts
  h(CH.getBucketCors, (a: { accountId: string; bucket: string }) =>
    getBucketCors(clientFor(a.accountId), a.bucket),
  );

  h(CH.putBucketCors, (a: { accountId: string; bucket: string; rules: CorsRule[] }) =>
    putBucketCors(clientFor(a.accountId), a.bucket, a.rules),
  );

  h(CH.deleteBucketCors, (a: { accountId: string; bucket: string }) =>
    deleteBucketCors(clientFor(a.accountId), a.bucket),
  );
```

Then in `src/preload.ts` add the three methods to the `api` object (after `downloadObject`):
```ts
  getBucketCors: (a: ApiMap[typeof CH.getBucketCors]['args'][0]) => invoke(CH.getBucketCors, a),
  putBucketCors: (a: ApiMap[typeof CH.putBucketCors]['args'][0]) => invoke(CH.putBucketCors, a),
  deleteBucketCors: (a: ApiMap[typeof CH.deleteBucketCors]['args'][0]) => invoke(CH.deleteBucketCors, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the "every channel" test for all 17 channels). Then run `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire CORS get/put/delete IPC channels"
```

---

## Task 4: useCors hook

**Files:**
- Create: `src/renderer/hooks/useCors.ts`
- Test: `src/renderer/hooks/useCors.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useCors.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCors } from './useCors';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const rule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useCors', () => {
  it('loads the bucket CORS rules', async () => {
    const { result } = renderHook(() => useCors('acc-1', 'assets'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.query.data).toEqual([rule]);
  });

  it('is idle when bucket is null', () => {
    const get = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { getBucketCors: get };
    const { result } = renderHook(() => useCors('acc-1', null), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });

  it('save calls putBucketCors; clear calls deleteBucketCors', async () => {
    const { result } = renderHook(() => useCors('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.save.mutateAsync([rule]);
    expect(window.s3.putBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', rules: [rule] });
    await result.current.clear.mutateAsync();
    expect(window.s3.deleteBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useCors.test.tsx`
Expected: FAIL — cannot find module `./useCors`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useCors.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { CorsRule } from '../../main/s3/cors';

export function corsKey(accountId: string | null, bucket: string | null) {
  return ['cors', accountId, bucket] as const;
}

export function useCors(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null;
  const invalidate = () => qc.invalidateQueries({ queryKey: corsKey(accountId, bucket) });

  const query = useQuery({
    queryKey: corsKey(accountId, bucket),
    enabled,
    queryFn: async () => unwrap(await window.s3.getBucketCors({ accountId: accountId!, bucket: bucket! })),
  });

  const save = useMutation({
    mutationFn: async (rules: CorsRule[]) =>
      unwrap(await window.s3.putBucketCors({ accountId: accountId!, bucket: bucket!, rules })),
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: async () => unwrap(await window.s3.deleteBucketCors({ accountId: accountId!, bucket: bucket! })),
    onSuccess: invalidate,
  });

  return { query, save, clear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useCors.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useCors.ts src/renderer/hooks/useCors.test.tsx
git commit -m "feat(ui): add useCors query + save/clear mutations"
```

---

## Task 5: StringListEditor

**Files:**
- Create: `src/renderer/components/cors/StringListEditor.tsx`
- Test: `src/renderer/components/cors/StringListEditor.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/cors/StringListEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StringListEditor } from './StringListEditor';

describe('StringListEditor', () => {
  it('adds a trimmed entry via the input + Add button', async () => {
    const onChange = vi.fn();
    render(<StringListEditor label="Allowed origins" values={['*']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Add to Allowed origins'), '  https://x  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add to Allowed origins' }));
    expect(onChange).toHaveBeenCalledWith(['*', 'https://x']);
  });

  it('removes an entry', async () => {
    const onChange = vi.fn();
    render(<StringListEditor label="Allowed origins" values={['*', 'https://x']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove https://x' }));
    expect(onChange).toHaveBeenCalledWith(['*']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/cors/StringListEditor.test.tsx`
Expected: FAIL — cannot find module `./StringListEditor`.

- [ ] **Step 3: Implement** — `src/renderer/components/cors/StringListEditor.tsx`:

```tsx
import { useState } from 'react';

export function StringListEditor({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft('');
  };

  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <ul className="mt-1 flex flex-wrap gap-1">
        {values.map((value, i) => (
          <li key={`${value}-${i}`} className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              className="text-slate-400 hover:text-red-600"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex gap-1">
        <input
          aria-label={`Add to ${label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs"
        />
        <button
          type="button"
          aria-label={`Add to ${label}`}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
          onClick={add}
        >
          Add
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/cors/StringListEditor.test.tsx`
Expected: PASS (2 tests). (Both the input and the Add button share the accessible name `Add to <label>`, but `getByLabelText` resolves the input and `getByRole('button', …)` resolves the button — unambiguous by role.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/cors/StringListEditor.tsx src/renderer/components/cors/StringListEditor.test.tsx
git commit -m "feat(ui): add StringListEditor"
```

---

## Task 6: CorsRuleCard

**Files:**
- Create: `src/renderer/components/cors/CorsRuleCard.tsx`
- Test: `src/renderer/components/cors/CorsRuleCard.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/cors/CorsRuleCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CorsRuleCard } from './CorsRuleCard';
import type { CorsRule } from '../../../main/s3/cors';

const rule: CorsRule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };

describe('CorsRuleCard', () => {
  it('toggles a method', async () => {
    const onChange = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={onChange} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUT' }));
    expect(onChange).toHaveBeenCalledWith({ ...rule, allowedMethods: ['GET', 'PUT'] });
  });

  it('updates max age', async () => {
    const onChange = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={onChange} onRemove={() => {}} />);
    await userEvent.type(screen.getByLabelText('Max age (seconds)'), '7200');
    expect(onChange).toHaveBeenLastCalledWith({ ...rule, maxAgeSeconds: 7200 });
  });

  it('calls onRemove', async () => {
    const onRemove = vi.fn();
    render(<CorsRuleCard rule={rule} onChange={() => {}} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove rule' }));
    expect(onRemove).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/cors/CorsRuleCard.test.tsx`
Expected: FAIL — cannot find module `./CorsRuleCard`.

- [ ] **Step 3: Implement** — `src/renderer/components/cors/CorsRuleCard.tsx`:

```tsx
import type { CorsRule } from '../../../main/s3/cors';
import { StringListEditor } from './StringListEditor';

const METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'] as const;

export function CorsRuleCard({
  rule,
  onChange,
  onRemove,
}: {
  rule: CorsRule;
  onChange: (rule: CorsRule) => void;
  onRemove: () => void;
}) {
  const toggleMethod = (m: string) => {
    const has = rule.allowedMethods.includes(m);
    onChange({
      ...rule,
      allowedMethods: has ? rule.allowedMethods.filter((x) => x !== m) : [...rule.allowedMethods, m],
    });
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rule</span>
        <button type="button" aria-label="Remove rule" className="text-slate-400 hover:text-red-600" onClick={onRemove}>
          ✕
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-sm">
        {METHODS.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input type="checkbox" checked={rule.allowedMethods.includes(m)} onChange={() => toggleMethod(m)} />
            {m}
          </label>
        ))}
      </div>

      <StringListEditor label="Allowed origins" values={rule.allowedOrigins} onChange={(v) => onChange({ ...rule, allowedOrigins: v })} />
      <StringListEditor label="Allowed headers" values={rule.allowedHeaders} onChange={(v) => onChange({ ...rule, allowedHeaders: v })} />
      <StringListEditor label="Expose headers" values={rule.exposeHeaders} onChange={(v) => onChange({ ...rule, exposeHeaders: v })} />

      <label className="mt-2 block text-sm">
        Max age (seconds)
        <input
          type="number"
          className="mt-1 block w-40 rounded border border-slate-300 px-2 py-1"
          value={rule.maxAgeSeconds ?? ''}
          onChange={(e) => onChange({ ...rule, maxAgeSeconds: e.target.value === '' ? null : Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/cors/CorsRuleCard.test.tsx`
Expected: PASS (3 tests). (The max-age test types `7200`; with a `number` input starting empty, `onChange` fires per keystroke and the last call carries `maxAgeSeconds: 7200`.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/cors/CorsRuleCard.tsx src/renderer/components/cors/CorsRuleCard.test.tsx
git commit -m "feat(ui): add CorsRuleCard"
```

---

## Task 7: CorsEditor

**Files:**
- Create: `src/renderer/components/cors/CorsEditor.tsx`
- Test: `src/renderer/components/cors/CorsEditor.test.tsx`

Owns the account/bucket dropdowns (seeded from props), the working rule set (local state, re-seeded from the loaded query), add/remove/update rules, the read-only JSON preview, and Save / Clear-all.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/cors/CorsEditor.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { CorsEditor } from './CorsEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const rule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('CorsEditor', () => {
  it('loads the seeded bucket rules and saves the working set', async () => {
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    // a rule card loads (GET method checked)
    expect(await screen.findByRole('checkbox', { name: 'GET' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.s3.putBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', rules: [rule] });
  });

  it('clears all rules after confirmation', async () => {
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all rules' })); // confirm
    expect(window.s3.deleteBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets' });
  });

  it('adds a rule via "+ Add rule"', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
      getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
      deleteBucketCors: vi.fn(),
    };
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add rule' }));
    // a new rule card appears with a Remove rule button
    expect(screen.getByRole('button', { name: 'Remove rule' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: FAIL — cannot find module `./CorsEditor`.

- [ ] **Step 3: Implement** — `src/renderer/components/cors/CorsEditor.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';
import { useCors } from '../../hooks/useCors';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CorsRuleCard } from './CorsRuleCard';
import type { CorsRule } from '../../../main/s3/cors';

const NEW_RULE: CorsRule = {
  id: null,
  allowedMethods: ['GET'],
  allowedOrigins: ['*'],
  allowedHeaders: [],
  exposeHeaders: [],
  maxAgeSeconds: null,
};

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

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">CORS configuration</h2>

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

      {bucket === null && <p className="mt-4 text-slate-500">Select a bucket to edit its CORS rules.</p>}

      {bucket !== null && cors.query.isLoading && <p className="mt-4 text-slate-500">Loading CORS…</p>}
      {bucket !== null && cors.query.isError && <p className="mt-4 text-red-600">{(cors.query.error as Error).message}</p>}

      {bucket !== null && cors.query.isSuccess && (
        <div className="mt-4 flex flex-col gap-3">
          {rules.map((rule, i) => (
            <CorsRuleCard
              key={i}
              rule={rule}
              onChange={(updated) => setRules(rules.map((r, j) => (j === i ? updated : r)))}
              onRemove={() => setRules(rules.filter((_, j) => j !== i))}
            />
          ))}

          <div className="flex gap-2">
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={() => setRules([...rules, { ...NEW_RULE }])}>
              + Add rule
            </button>
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={() => setShowJson((v) => !v)}>
              {showJson ? 'Hide JSON' : 'Show JSON'}
            </button>
          </div>

          {showJson && (
            <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(rules, null, 2)}</pre>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700"
              onClick={async () => {
                try {
                  await cors.save.mutateAsync(rules);
                  show('CORS saved');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              Save
            </button>
            <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          message="Remove all CORS rules from this bucket?"
          confirmLabel="Clear all rules"
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            try {
              await cors.clear.mutateAsync();
              setRules([]);
              show('CORS cleared');
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

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/cors/CorsEditor.tsx src/renderer/components/cors/CorsEditor.test.tsx
git commit -m "feat(ui): add CorsEditor"
```

---

## Task 8: Wire CorsEditor into App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/App.test.tsx`. First extend the `beforeEach` `window.s3` mock to add the CORS methods (add these three properties to the existing `window.s3` object literal): `getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [] }), putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }), deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),`. Then append:

```tsx
describe('App — CORS', () => {
  it('renders the CORS editor for the CORS section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'CORS' }));
    expect(await screen.findByText('CORS configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Account')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — CORS section still renders "Coming soon".

- [ ] **Step 3: Implement** — in `src/renderer/App.tsx` add the import:
```tsx
import { CorsEditor } from './components/cors/CorsEditor';
```
and add a `cors` branch to the section ternary, before the final `Coming soon` else. Change:
```tsx
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}
```
to:
```tsx
          ) : section === 'cors' ? (
            <CorsEditor initialAccountId={accountId} initialBucket={bucket} />
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
git commit -m "feat(ui): wire CorsEditor into the CORS section"
```

---

## Manual smoke checklist (after Task 8)

`npm start`, with an account + writable bucket:
1. Click **CORS** → account/bucket dropdowns (seeded from the current selection if any).
2. Pick a bucket with no CORS → empty editor + "+ Add rule".
3. Add a rule (check GET, origin `*`), **Save** → toast "CORS saved".
4. Reload the bucket (reselect) → the saved rule appears.
5. **Show JSON** → read-only preview matches the rules.
6. **Clear all** → confirm → toast "CORS cleared"; rules empty.
7. On a provider/bucket where you lack permission → Save shows an error toast; edits stay.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-cors-design.md`):**
- `getBucketCors` (no-config → `[]`), `putBucketCors`, `deleteBucketCors` + `CorsRule` shape & mapping → Tasks 1, 2. ✅
- IPC channels + register handlers + preload methods → Task 3. ✅
- `useCors` query + save/clear mutations w/ invalidation → Task 4. ✅
- Structured editor: methods, origins/headers/expose-headers lists, max-age, add/remove → Tasks 5, 6, 7. ✅
- Own account/bucket dropdowns seeded from current selection → Task 7 (+ App wiring Task 8). ✅
- Read-only JSON preview → Task 7. ✅
- Save / Clear-all (confirm) + toasts → Task 7. ✅
- States: no-bucket prompt, loading, no-CORS empty, query error, save/clear error toast → Tasks 4, 7. ✅
- Replace "Coming soon" for CORS → Task 8. ✅
- Out of scope (preflight testing, presets, editable JSON) → none added. ✅

**Placeholder scan:** none — every step has complete, runnable code/commands.

**Type consistency:** `CorsRule` (`{id, allowedMethods, allowedOrigins, allowedHeaders, exposeHeaders, maxAgeSeconds}`) defined in Task 1 (`cors.ts`) and imported type-only by `channels.ts` (Task 3), `register.ts` (Task 3), `useCors.ts` (Task 4), `CorsRuleCard.tsx` (Task 6), `CorsEditor.tsx` (Task 7), and the tests. The three `CH` channel names + `ApiMap` shapes (Task 3) match the `register` handlers and `preload` methods. `useCors` returns `{ query, save, clear }` consumed by `CorsEditor`. `ConfirmDialog` props (`message`, `confirmLabel`, `onConfirm`, `onCancel`) and `ToastProvider`/`useToast` match their existing definitions. The Clear-all trigger ("Clear all") and the dialog confirm ("Clear all rules") have distinct accessible names so both are unambiguous in tests.

**Note for implementers:** in `CorsEditor` the working `rules` are re-seeded from `cors.query.data` via `useEffect`; after Save the query invalidates and refetches, re-seeding to the just-saved state (no edit loss). Switching account/bucket clears the working set, which then reloads from the new target.
