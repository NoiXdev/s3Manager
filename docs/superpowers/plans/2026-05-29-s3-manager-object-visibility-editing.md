# S3 Manager — Object Visibility Editing (ACL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an object's visibility editable (private ↔ public-read) via a canned ACL, surfaced as a toggle in the metadata panel's Visibility row (with a confirm when going public).

**Architecture:** Add a `setObjectVisibility` op to the existing `visibility.ts` (`PutObjectAcl` with canned `public-read`/`private`), expose it over one IPC channel, add a `setVisibility` mutation to `useObjectDetails` that invalidates the visibility query, and make the metadata panel's read-only badge editable.

**Tech Stack:** AWS SDK v3 (`PutObjectAclCommand`), Electron IPC, React 19, TanStack Query, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/visibility.ts` exports `type Visibility = 'public' | 'private' | 'unknown'`, `getObjectVisibility`, and module-private `ALL_USERS` + `ACL_UNSUPPORTED` (`Set(['AccessControlListNotSupported','NotImplemented'])`). It imports `{ S3Client, GetObjectAclCommand }` from `@aws-sdk/client-s3` and `{ ok, type Result }` from `../shared/result` + `toErr` from `./objects`. `err` is also exported from `../shared/result`.
- `src/main/ipc/channels.ts`: `CH`, `ApiMap`, and `import type { Visibility } from '../s3/visibility'`. `objectVisibility` channel exists: `[CH.objectVisibility]: { args: [{ accountId; bucket; key }]; res: Result<Visibility> }`.
- `src/main/ipc/register.ts`: `import { getObjectVisibility } from '../s3/visibility'`; `h(CH.objectVisibility, (a) => getObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key }))`. `h` + `clientFor` available.
- `src/preload.ts`: `objectVisibility: (a) => invoke(CH.objectVisibility, a)`.
- `src/renderer/hooks/useObjectDetails.ts`: `useObjectDetails(accountId, bucket, key)` returns `{ metadata, visibility }` (two `useQuery`s; the visibility query key is `['objectVisibility', accountId, bucket, key]`). Uses `unwrap` from `../lib/result`.
- `src/renderer/components/files/MetadataPanel.tsx`: imports `ConfirmDialog`, `useToast` (`{ show }`), `useObjectDetails`. Has a `confirming` state (for delete) and the Visibility row at lines ~116–133 rendering the badge / `unavailable` / `…`. `useObjectDetails` is destructured as `{ metadata, visibility }`.
- `MetadataPanel.test.tsx`: `wrap(node)` = `QueryClientProvider` only; `beforeEach` stubs `window.s3` with `headObject` + `objectVisibility` (it does NOT stub `setObjectVisibility` — only the new tests need it). Existing tests use `objectVisibility → 'public'`.
- `register.test.ts`: `buildHarness()` → `{ handlers, deps }`; tests create an account then call `handlers.get(CH.x)!(args)`. `PutObjectCommand` etc. imported from `@aws-sdk/client-s3`.

---

## File Structure

```
src/main/s3/visibility.ts                 # MODIFY: + setObjectVisibility
src/main/ipc/channels.ts                  # MODIFY: + CH.setObjectVisibility + ApiMap entry
src/main/ipc/register.ts                  # MODIFY: + handler
src/preload.ts                            # MODIFY: + setObjectVisibility method
src/renderer/hooks/useObjectDetails.ts    # MODIFY: + setVisibility mutation
src/renderer/components/files/MetadataPanel.tsx  # MODIFY: editable Visibility toggle + confirm
```

---

## Task 1: visibility.ts — setObjectVisibility

**Files:**
- Modify: `src/main/s3/visibility.ts`
- Modify: `src/main/s3/visibility.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/visibility.test.ts` (add `PutObjectAclCommand` to the `@aws-sdk/client-s3` import in that file, and `setObjectVisibility` to the `./visibility` import):

```ts
describe('setObjectVisibility', () => {
  it('sets the public-read canned ACL and returns public', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'public' });
    expect(r).toEqual({ ok: true, data: 'public' });
    expect(s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input.ACL).toBe('public-read');
  });

  it('sets the private canned ACL and returns private', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'private' });
    expect(r).toEqual({ ok: true, data: 'private' });
    expect(s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input.ACL).toBe('private');
  });

  it('maps an ACL-unsupported error to AclUnsupported', async () => {
    s3Mock.on(PutObjectAclCommand).rejects(Object.assign(new Error('no'), { name: 'AccessControlListNotSupported' }));
    const r = await setObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k', visibility: 'public' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AclUnsupported');
  });
});
```

(If `visibility.test.ts` does not yet exist, create it with the standard header used by other backend tests:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectVisibility, setObjectVisibility } from './visibility';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());
```
then add the describe block above. Otherwise just extend the existing imports + append the block.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/visibility.test.ts`
Expected: FAIL — `setObjectVisibility` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/visibility.ts`: add `PutObjectAclCommand` to the `@aws-sdk/client-s3` import, add `err` to the `../shared/result` import, then append:

```ts
export async function setObjectVisibility(
  client: S3Client,
  args: { bucket: string; key: string; visibility: 'public' | 'private' },
): Promise<Result<Visibility>> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: args.bucket,
        Key: args.key,
        ACL: args.visibility === 'public' ? 'public-read' : 'private',
      }),
    );
    return ok(args.visibility);
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (ACL_UNSUPPORTED.has(name)) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/visibility.test.ts`
Expected: PASS (the 3 new tests + any existing). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/visibility.ts src/main/s3/visibility.test.ts
git commit -m "feat: add setObjectVisibility (canned ACL public-read/private)"
```

---

## Task 2: IPC wiring (channel + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to `CH` (after `objectVisibility`):
```ts
  setObjectVisibility: 's3:setObjectVisibility',
```
Add to `ApiMap`:
```ts
  [CH.setObjectVisibility]: { args: [{ accountId: string; bucket: string; key: string; visibility: 'public' | 'private' }]; res: Result<Visibility> };
```
(`Visibility` is already imported in `channels.ts`.)

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `PutObjectAclCommand` to the `@aws-sdk/client-s3` import if not present):

```ts
describe('setObjectVisibility handler', () => {
  it('s3:setObjectVisibility sets the ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectAclCommand).resolves({});

    const res = (await handlers.get(CH.setObjectVisibility)!({
      accountId: created.data.id, bucket: 'b', key: 'k', visibility: 'public',
    })) as { ok: boolean; data: string };
    expect(res).toEqual({ ok: true, data: 'public' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `s3:setObjectVisibility` (and the every-channel test fails for the new channel).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`: change the visibility import to include the setter:
```ts
import { getObjectVisibility, setObjectVisibility } from '../s3/visibility';
```
and register the handler next to the `objectVisibility` one:
```ts
  h(CH.setObjectVisibility, (a: { accountId: string; bucket: string; key: string; visibility: 'public' | 'private' }) =>
    setObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key, visibility: a.visibility }),
  );
```

In `src/preload.ts`, add next to `objectVisibility`:
```ts
  setObjectVisibility: (a: ApiMap[typeof CH.setObjectVisibility]['args'][0]) => invoke(CH.setObjectVisibility, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire s3:setObjectVisibility IPC channel"
```

---

## Task 3: useObjectDetails — setVisibility mutation

**Files:**
- Modify: `src/renderer/hooks/useObjectDetails.ts`
- Modify: `src/renderer/hooks/useObjectDetails.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/hooks/useObjectDetails.test.tsx`. First READ the file to match its existing imports/wrapper. Ensure the test module exposes the `QueryClient` so `invalidateQueries` can be spied (mirror the pattern below; adapt to the file's existing helpers). Add:

```tsx
describe('useObjectDetails setVisibility', () => {
  let client: QueryClient;
  function spyWrapper() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  beforeEach(() => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      setObjectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
    };
  });

  it('setVisibility calls window.s3.setObjectVisibility and invalidates the visibility query', async () => {
    const { result } = renderHook(() => useObjectDetails('a', 'b', 'k'), { wrapper: spyWrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.setVisibility.mutateAsync('public');
    expect(window.s3.setObjectVisibility).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', visibility: 'public' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectVisibility', 'a', 'b', 'k'] });
  });
});
```
(Ensure `QueryClient`, `QueryClientProvider`, `renderHook`, `vi`, `beforeEach`, and `type { ReactNode }` are imported — add any missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectDetails.test.tsx`
Expected: FAIL — `result.current.setVisibility` is undefined.

- [ ] **Step 3: Implement** — replace `src/renderer/hooks/useObjectDetails.ts` with:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useObjectDetails(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;

  const metadata = useQuery({
    queryKey: ['objectMetadata', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.headObject({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const visibility = useQuery({
    queryKey: ['objectVisibility', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.objectVisibility({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const setVisibility = useMutation({
    mutationFn: async (v: 'public' | 'private') =>
      unwrap(await window.s3.setObjectVisibility({ accountId: accountId!, bucket: bucket!, key: key!, visibility: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectVisibility', accountId, bucket, key] }),
  });

  return { metadata, visibility, setVisibility };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectDetails.test.tsx`
Expected: PASS (existing + the new test). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectDetails.ts src/renderer/hooks/useObjectDetails.test.tsx
git commit -m "feat(ui): add setVisibility mutation to useObjectDetails"
```

---

## Task 4: MetadataPanel — editable visibility toggle

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

- [ ] **Step 1: Add the failing tests** — append to `src/renderer/components/files/MetadataPanel.test.tsx`:

```tsx
describe('MetadataPanel visibility editing', () => {
  it('makes a private object public after confirmation', async () => {
    const setObjectVisibility = vi.fn().mockResolvedValue({ ok: true, data: 'public' });
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      setObjectVisibility,
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make public' }));
    // The trigger hides while confirming, so this resolves the dialog's confirm button.
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    await waitFor(() => expect(setObjectVisibility).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'k', visibility: 'public' }));
  });

  it('makes a public object private immediately (no confirm)', async () => {
    const setObjectVisibility = vi.fn().mockResolvedValue({ ok: true, data: 'private' });
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
      setObjectVisibility,
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make private' }));
    await waitFor(() => expect(setObjectVisibility).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'k', visibility: 'private' }));
  });

  it('shows no visibility toggle when ACLs are unsupported', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'unknown' }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('unknown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make public' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — no "Make public"/"Make private" toggle.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`:

(a) Change the `useObjectDetails` destructure to include `setVisibility`:
```tsx
  const { metadata, visibility, setVisibility } = useObjectDetails(accountId, bucket, objectKey);
```

(b) Add a confirm-state for going public, next to the existing `confirming` state:
```tsx
  const [confirmingPublic, setConfirmingPublic] = useState(false);
```

(c) Replace the Visibility row (the `<div className="flex flex-col border-b border-slate-100 py-1.5">` containing the `Visibility` label + badge span) with one that adds the toggle button:
```tsx
        <div className="flex flex-col border-b border-slate-100 py-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400">Visibility</span>
          <span>
            {visibility.isSuccess ? (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                  visibility.data === 'public' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {visibility.data}
              </span>
            ) : visibility.isError ? (
              <span className="text-xs text-slate-400">unavailable</span>
            ) : (
              '…'
            )}
          </span>
          {visibility.isSuccess && (visibility.data === 'public' || visibility.data === 'private') && !confirmingPublic && (
            <button
              type="button"
              disabled={setVisibility.isPending}
              className="mt-1 self-start rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
              onClick={async () => {
                if (visibility.data === 'private') {
                  setConfirmingPublic(true);
                  return;
                }
                try {
                  await setVisibility.mutateAsync('private');
                  show('Made private');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              {visibility.data === 'public' ? 'Make private' : 'Make public'}
            </button>
          )}
        </div>
```

(d) Add the confirm dialog (place it after the existing `{moving && (…)}` block):
```tsx
      {confirmingPublic && (
        <ConfirmDialog
          message="Make this object publicly readable by anyone?"
          confirmLabel="Make public"
          onCancel={() => setConfirmingPublic(false)}
          onConfirm={async () => {
            setConfirmingPublic(false);
            try {
              await setVisibility.mutateAsync('public');
              show('Made public');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing + 3 new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): editable visibility toggle in the metadata panel"
```

---

## Manual smoke checklist (after Task 4)

`npm start` (full restart — main-process IPC handlers changed), with an account + a bucket that allows ACLs (AWS with ACLs enabled / not bucket-owner-enforced):
1. Select a **private** object → the Visibility row shows `private` + a **Make public** button.
2. Click **Make public** → confirm dialog → confirm → badge flips to `public`, toast "Made public"; verify the object is publicly readable.
3. Select that object → **Make private** → badge flips to `private` immediately, toast "Made private".
4. Select an object in a bucket with ACLs disabled (Object Ownership = bucket-owner-enforced, or Hetzner if unsupported) → the badge shows `unknown`/`unavailable` and **no toggle** appears.
5. Trigger an error (e.g. read-only credentials) → error toast; the badge stays at its real value.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-object-visibility-editing-design.md`):**
- `setObjectVisibility` (canned `public-read`/`private`, returns `Visibility`, `AclUnsupported` mapping) → Task 1. ✅
- IPC channel + register handler + preload → Task 2. ✅
- `useObjectDetails.setVisibility` (calls the API, invalidates the visibility query) → Task 3. ✅
- MetadataPanel editable toggle: Make-public with confirm, Make-private instant, hidden when `unknown`, disabled while pending, toast on success → Task 4. ✅
- No optimistic update (badge reflects real ACL via the invalidate→refetch) → Task 3 (`onSuccess` invalidate) + Task 4 (no local visibility state). ✅
- Error handling (error toast, badge unchanged) → Task 4 catch + provider behavior. ✅
- Out of scope (per-grantee grants, bucket ACLs, other canned ACLs, bulk/folder, presigned PUT) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. The MODIFY-panel task gives the full replacement Visibility-row block + the confirm block + exact insertion points.

**Type consistency:** `setObjectVisibility(args: { bucket; key; visibility: 'public' | 'private' })` → `Result<Visibility>` is identical across `visibility.ts` (Task 1), the `ApiMap`/register/preload arg shape (Task 2 — `{ accountId, bucket, key, visibility: 'public' | 'private' }`), and `useObjectDetails.setVisibility` (Task 3 — mutation arg `'public' | 'private'`, calling `window.s3.setObjectVisibility` with the account-scoped args). The MetadataPanel calls `setVisibility.mutateAsync('public' | 'private')` (Task 4) — matches. The confirm dialog's confirm label and the trigger label are both "Make public"; the trigger is hidden while `confirmingPublic` so the test's `getByRole('button', { name: 'Make public' })` is unambiguous (mirrors the existing Delete `{!confirming && …}` pattern). The visibility query key `['objectVisibility', accountId, bucket, key]` matches between the query and the invalidate.

**Note for implementers:** Task 2 adds a main-process handler, so the manual smoke needs a full `npm start` restart. `visibility.test.ts` may not exist yet — Task 1 Step 1 covers creating it with the standard backend-test header if so.
