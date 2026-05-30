# S3 Manager — Object Metadata Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit an object's Content-Type, Cache-Control, Content-Disposition, and custom user metadata via an "Edit metadata…" dialog, applied through a copy-to-self with `MetadataDirective: 'REPLACE'`.

**Architecture:** A dedicated `objectMetadata.ts` (`getEditableMetadata` → HeadObject mapping; `updateObjectMetadata` → HeadObject to capture preserved headers, then copy-to-self REPLACE) behind two IPC channels, a `useObjectMetadataEditor` hook, and a `MetadataDialog` launched from the panel. Isolated — leaves `headObject`/the panel's read-only view untouched.

**Tech Stack:** AWS SDK v3 (`HeadObjectCommand`/`CopyObjectCommand`), Electron IPC, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/objects.ts` exports `toErr`; `headObject` returns `ObjectMetadata { size, contentType, lastModified, storageClass, etag, metadata }` (NOT cache-control/content-disposition — unchanged by this feature). `src/main/s3/transfer.ts` exports `encodeCopyKey(key) = encodeURIComponent(key).replace(/%2F/g,'/')`. `src/main/shared/result.ts`: `ok`, `Result`. No circular import: `objectMetadata.ts` imports from `objects` + `transfer`; neither imports `objectMetadata`. `ok(true)` satisfies `Promise<Result<true>>` (verified).
- `@aws-sdk/client-s3` `CopyObjectCommand` accepts `MetadataDirective: 'COPY' | 'REPLACE'`, `ContentType`, `CacheControl`, `ContentDisposition`, `ContentEncoding`, `ContentLanguage`, `StorageClass`, `Metadata`. `HeadObjectCommand` output has `ContentType`/`CacheControl`/`ContentDisposition`/`Metadata`/`StorageClass`/`ContentEncoding`/`ContentLanguage`.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`; `Result` imported; per-object channels carry `{ accountId, bucket, key }`; type imports from `../s3/...`. `register.ts`: `h(channel, fn)` + `clientFor`. `register.test.ts`: `buildHarness()` → `{ handlers }`, `s3Mock = mockClient(S3Client)`, create account via `handlers.get(CH.accountsCreate)!({ label, provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' })`; every-channel test iterates `Object.values(CH)`.
- `src/preload.ts`: `(a) => invoke(CH.x, a)` methods.
- `src/renderer/hooks/useObjectAcl.ts` / `useObjectRetention.ts` show the query+mutation+`invalidateQueries` style; `unwrap` from `../lib/result`. The panel's read-only metadata query key is `['objectMetadata', accountId, bucket, key]` (from `useObjectDetails`).
- `src/renderer/components/files/MetadataPanel.tsx`: the actions row (`<div className="flex gap-1 border-b border-slate-200 p-2">`) has Download / Copy URL / Rename / Move / **Permissions…** / Delete buttons; state hooks (`renaming`, `moving`, `permissionsOpen`, …) are declared after `const { show } = useToast();`; dialog blocks (`{permissionsOpen && (<PermissionsDialog …/>)}`) render before the details body; `accountId`/`bucket` props are `string | null` (existing code passes `accountId ?? ''`).
- Renderer dialogs use `useToast()`; tests render within `ToastProvider`.

---

## File Structure

```
src/main/s3/objectMetadata.ts                          # CREATE: EditableMetadata + getEditableMetadata + updateObjectMetadata
src/main/ipc/channels.ts                               # MODIFY: 2 channels + ApiMap
src/main/ipc/register.ts                               # MODIFY: 2 handlers
src/preload.ts                                         # MODIFY: 2 methods
src/renderer/hooks/useObjectMetadataEditor.ts          # CREATE
src/renderer/components/files/MetadataDialog.tsx       # CREATE
src/renderer/components/files/MetadataPanel.tsx        # MODIFY: "Edit metadata…" button + dialog
```

---

## Task 1: objectMetadata.ts — backend ops

**Files:**
- Create: `src/main/s3/objectMetadata.ts`
- Test: `src/main/s3/objectMetadata.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/objectMetadata.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getEditableMetadata, updateObjectMetadata } from './objectMetadata';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getEditableMetadata', () => {
  it('maps the editable fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentType: 'text/plain', CacheControl: 'max-age=60', ContentDisposition: 'inline', Metadata: { owner: 'me' } });
    const r = await getEditableMetadata(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { contentType: 'text/plain', cacheControl: 'max-age=60', contentDisposition: 'inline', metadata: { owner: 'me' } } });
  });

  it('maps absent fields to null / empty', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const r = await getEditableMetadata(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { contentType: null, cacheControl: null, contentDisposition: null, metadata: {} } });
  });
});

describe('updateObjectMetadata', () => {
  it('heads then copies-to-self with REPLACE, applying edits and preserving system headers', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ StorageClass: 'STANDARD_IA', ContentEncoding: 'gzip', ContentLanguage: 'en' });
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await updateObjectMetadata(new S3Client({}), {
      bucket: 'b',
      key: 'dir/a b.txt',
      contentType: 'application/json',
      cacheControl: 'no-cache',
      contentDisposition: 'attachment',
      metadata: { author: 'x' },
    });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.MetadataDirective).toBe('REPLACE');
    expect(input.CopySource).toBe('b/dir/a%20b.txt');
    expect(input.Key).toBe('dir/a b.txt');
    expect(input.ContentType).toBe('application/json');
    expect(input.CacheControl).toBe('no-cache');
    expect(input.ContentDisposition).toBe('attachment');
    expect(input.Metadata).toEqual({ author: 'x' });
    expect(input.StorageClass).toBe('STANDARD_IA');
    expect(input.ContentEncoding).toBe('gzip');
    expect(input.ContentLanguage).toBe('en');
  });

  it('sends undefined for cleared (empty) header fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).resolves({});
    await updateObjectMetadata(new S3Client({}), { bucket: 'b', key: 'k', contentType: '', cacheControl: null, contentDisposition: '', metadata: {} });
    const input = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(input.ContentType).toBeUndefined();
    expect(input.CacheControl).toBeUndefined();
    expect(input.ContentDisposition).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objectMetadata.test.ts`
Expected: FAIL — cannot find module `./objectMetadata`.

- [ ] **Step 3: Implement** — `src/main/s3/objectMetadata.ts`:

```ts
import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { encodeCopyKey } from './transfer';

export interface EditableMetadata {
  contentType: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  metadata: Record<string, string>;
}

export async function getEditableMetadata(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<EditableMetadata>> {
  try {
    const out = await client.send(new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }));
    return ok({
      contentType: out.ContentType ?? null,
      cacheControl: out.CacheControl ?? null,
      contentDisposition: out.ContentDisposition ?? null,
      metadata: out.Metadata ?? {},
    });
  } catch (e) {
    return toErr(e);
  }
}

export async function updateObjectMetadata(
  client: S3Client,
  args: {
    bucket: string;
    key: string;
    contentType: string | null;
    cacheControl: string | null;
    contentDisposition: string | null;
    metadata: Record<string, string>;
  },
): Promise<Result<true>> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }));
    await client.send(
      new CopyObjectCommand({
        Bucket: args.bucket,
        Key: args.key,
        CopySource: `${args.bucket}/${encodeCopyKey(args.key)}`,
        MetadataDirective: 'REPLACE',
        ContentType: args.contentType || undefined,
        CacheControl: args.cacheControl || undefined,
        ContentDisposition: args.contentDisposition || undefined,
        ContentEncoding: head.ContentEncoding,
        ContentLanguage: head.ContentLanguage,
        StorageClass: head.StorageClass,
        Metadata: args.metadata,
      }),
    );
    return ok(true);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objectMetadata.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objectMetadata.ts src/main/s3/objectMetadata.test.ts
git commit -m "feat: add object metadata edit ops (head + copy-to-self REPLACE)"
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
import type { EditableMetadata } from '../s3/objectMetadata';
```
Add to `CH`:
```ts
  getEditableMetadata: 's3:getEditableMetadata',
  updateObjectMetadata: 's3:updateObjectMetadata',
```
Add to `ApiMap`:
```ts
  [CH.getEditableMetadata]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<EditableMetadata> };
  [CH.updateObjectMetadata]: { args: [{ accountId: string; bucket: string; key: string; contentType: string | null; cacheControl: string | null; contentDisposition: string | null; metadata: Record<string, string> }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `HeadObjectCommand`, `CopyObjectCommand` to the `@aws-sdk/client-s3` import if not present):

```ts
describe('metadata edit handlers', () => {
  it('s3:getEditableMetadata returns the mapped fields via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(HeadObjectCommand).resolves({ ContentType: 'text/plain', Metadata: { a: '1' } });

    const res = (await handlers.get(CH.getEditableMetadata)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { contentType: string | null; metadata: Record<string, string> };
    };
    expect(res.ok).toBe(true);
    expect(res.data.contentType).toBe('text/plain');
    expect(res.data.metadata).toEqual({ a: '1' });
  });

  it('s3:updateObjectMetadata copies-to-self and returns ok', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(HeadObjectCommand).resolves({});
    s3Mock.on(CopyObjectCommand).resolves({});

    const res = (await handlers.get(CH.updateObjectMetadata)!({
      accountId: created.data.id, bucket: 'b', key: 'k',
      contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: {},
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handlers (and the every-channel test fails for the 2 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`: add the import:
```ts
import { getEditableMetadata, updateObjectMetadata } from '../s3/objectMetadata';
```
Register the handlers (near the headObject/visibility handlers):
```ts
  h(CH.getEditableMetadata, (a: { accountId: string; bucket: string; key: string }) =>
    getEditableMetadata(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.updateObjectMetadata, (a: { accountId: string; bucket: string; key: string; contentType: string | null; cacheControl: string | null; contentDisposition: string | null; metadata: Record<string, string> }) =>
    updateObjectMetadata(clientFor(a.accountId), {
      bucket: a.bucket, key: a.key, contentType: a.contentType, cacheControl: a.cacheControl, contentDisposition: a.contentDisposition, metadata: a.metadata,
    }),
  );
```

In `src/preload.ts`, add:
```ts
  getEditableMetadata: (a: ApiMap[typeof CH.getEditableMetadata]['args'][0]) => invoke(CH.getEditableMetadata, a),
  updateObjectMetadata: (a: ApiMap[typeof CH.updateObjectMetadata]['args'][0]) => invoke(CH.updateObjectMetadata, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire object metadata edit IPC channels"
```

---

## Task 3: useObjectMetadataEditor hook

**Files:**
- Create: `src/renderer/hooks/useObjectMetadataEditor.ts`
- Test: `src/renderer/hooks/useObjectMetadataEditor.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectMetadataEditor.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectMetadataEditor } from './useObjectMetadataEditor';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const EDITABLE = { contentType: 'text/plain', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getEditableMetadata: vi.fn().mockResolvedValue({ ok: true, data: EDITABLE }),
    updateObjectMetadata: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectMetadataEditor', () => {
  it('loads the editable metadata', async () => {
    const { result } = renderHook(() => useObjectMetadataEditor('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.editable.isSuccess).toBe(true));
    expect(result.current.editable.data).toEqual(EDITABLE);
  });

  it('update calls updateObjectMetadata and invalidates editable + objectMetadata queries', async () => {
    const { result } = renderHook(() => useObjectMetadataEditor('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.update.mutateAsync({ contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } });
    expect(window.s3.updateObjectMetadata).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', contentType: 'application/json', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['editableMetadata', 'a', 'b', 'k'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectMetadata', 'a', 'b', 'k'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectMetadataEditor.test.tsx`
Expected: FAIL — cannot find module `./useObjectMetadataEditor`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectMetadataEditor.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { EditableMetadata } from '../../main/s3/objectMetadata';

export interface MetadataUpdate {
  contentType: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  metadata: Record<string, string>;
}

export function useObjectMetadataEditor(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const editableKey = ['editableMetadata', accountId, bucket, key] as const;

  const editable = useQuery({
    queryKey: editableKey,
    enabled,
    queryFn: async (): Promise<EditableMetadata> =>
      unwrap(await window.s3.getEditableMetadata({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const update = useMutation({
    mutationFn: async (v: MetadataUpdate) =>
      unwrap(await window.s3.updateObjectMetadata({ accountId: accountId!, bucket: bucket!, key: key!, ...v })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: editableKey });
      qc.invalidateQueries({ queryKey: ['objectMetadata', accountId, bucket, key] });
    },
  });

  return { editable, update };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectMetadataEditor.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectMetadataEditor.ts src/renderer/hooks/useObjectMetadataEditor.test.tsx
git commit -m "feat(ui): add useObjectMetadataEditor hook"
```

---

## Task 4: MetadataDialog component

**Files:**
- Create: `src/renderer/components/files/MetadataDialog.tsx`
- Test: `src/renderer/components/files/MetadataDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/MetadataDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { MetadataDialog } from './MetadataDialog';

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
    getEditableMetadata: vi.fn().mockResolvedValue({
      ok: true,
      data: { contentType: 'text/plain', cacheControl: null, contentDisposition: null, metadata: { owner: 'me' } },
    }),
    updateObjectMetadata: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('MetadataDialog', () => {
  it('seeds the Content-Type and existing custom metadata', async () => {
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByLabelText('Content-Type')).toHaveValue('text/plain');
    expect(screen.getByLabelText('Metadata key 1')).toHaveValue('owner');
    expect(screen.getByLabelText('Metadata value 1')).toHaveValue('me');
  });

  it('edits the content-type, adds a custom pair, and saves', async () => {
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    const ct = await screen.findByLabelText('Content-Type');
    await userEvent.clear(ct);
    await userEvent.type(ct, 'application/json');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await userEvent.type(screen.getByLabelText('Metadata key 2'), 'author');
    await userEvent.type(screen.getByLabelText('Metadata value 2'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save metadata' }));
    await waitFor(() => expect(window.s3.updateObjectMetadata).toHaveBeenCalled());
    const arg = (window.s3.updateObjectMetadata as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg).toMatchObject({ accountId: 'a', bucket: 'b', key: 'k', contentType: 'application/json' });
    expect(arg.metadata).toEqual({ owner: 'me', author: 'x' });
  });

  it('shows a message when the metadata fails to load', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getEditableMetadata: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'denied' } }),
    });
    wrap(<MetadataDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText(/denied/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save metadata' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataDialog.test.tsx`
Expected: FAIL — cannot find module `./MetadataDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/MetadataDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useObjectMetadataEditor } from '../../hooks/useObjectMetadataEditor';
import { useToast } from '../ui/ToastProvider';

interface Pair {
  key: string;
  value: string;
}

export function MetadataDialog({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string;
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const { editable, update } = useObjectMetadataEditor(accountId, bucket, objectKey);
  const { show } = useToast();
  const [contentType, setContentType] = useState('');
  const [cacheControl, setCacheControl] = useState('');
  const [contentDisposition, setContentDisposition] = useState('');
  const [pairs, setPairs] = useState<Pair[]>([]);

  useEffect(() => {
    if (editable.data) {
      setContentType(editable.data.contentType ?? '');
      setCacheControl(editable.data.cacheControl ?? '');
      setContentDisposition(editable.data.contentDisposition ?? '');
      setPairs(Object.entries(editable.data.metadata).map(([key, value]) => ({ key, value })));
    }
  }, [editable.data]);

  const onSave = async () => {
    const metadata: Record<string, string> = {};
    for (const p of pairs) {
      const k = p.key.trim();
      if (k) metadata[k] = p.value;
    }
    try {
      await update.mutateAsync({
        contentType: contentType.trim() || null,
        cacheControl: cacheControl.trim() || null,
        contentDisposition: contentDisposition.trim() || null,
        metadata,
      });
      show('Metadata saved');
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-[34rem] overflow-auto rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Edit metadata</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>

        {editable.isLoading && <p className="py-4 text-sm text-slate-500">Loading metadata…</p>}
        {editable.isError && <p className="py-4 text-sm text-red-600">{(editable.error as Error).message}</p>}

        {editable.isSuccess && (
          <>
            <label className="block text-sm">
              Content-Type
              <input aria-label="Content-Type" className={field} value={contentType} onChange={(e) => setContentType(e.target.value)} />
            </label>
            <label className="mt-2 block text-sm">
              Cache-Control
              <input aria-label="Cache-Control" className={field} value={cacheControl} onChange={(e) => setCacheControl(e.target.value)} />
            </label>
            <label className="mt-2 block text-sm">
              Content-Disposition
              <input aria-label="Content-Disposition" className={field} value={contentDisposition} onChange={(e) => setContentDisposition(e.target.value)} />
            </label>

            <p className="mt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom metadata</p>
            <div className="flex flex-col gap-1">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Metadata key ${i + 1}`}
                    className="w-1/3 rounded border border-slate-300 px-1 py-0.5 text-xs"
                    placeholder="key"
                    value={p.key}
                    onChange={(e) => setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Metadata value ${i + 1}`}
                    className="flex-1 rounded border border-slate-300 px-1 py-0.5 text-xs"
                    placeholder="value"
                    value={p.value}
                    onChange={(e) => setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    aria-label={`Remove metadata ${i + 1}`}
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="mt-1 self-start rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50" onClick={() => setPairs((prev) => [...prev, { key: '', value: '' }])}>
                Add field
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-400">Saving rewrites the object’s metadata (its ETag and last-modified change).</p>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onClose}>Cancel</button>
              <button type="button" disabled={update.isPending} className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40" onClick={onSave}>
                Save metadata
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataDialog.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataDialog.tsx src/renderer/components/files/MetadataDialog.test.tsx
git commit -m "feat(ui): add MetadataDialog (object metadata editor)"
```

---

## Task 5: MetadataPanel — "Edit metadata…" button

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/components/files/MetadataPanel.test.tsx`:

```tsx
describe('MetadataPanel edit metadata', () => {
  it('opens the Edit metadata dialog from the actions row', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: 'text/plain', lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
      getEditableMetadata: vi.fn().mockResolvedValue({ ok: true, data: { contentType: 'text/plain', cacheControl: null, contentDisposition: null, metadata: {} } }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit metadata…' }));
    expect(await screen.findByText('Edit metadata')).toBeInTheDocument();
    expect(await screen.findByLabelText('Content-Type')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — no "Edit metadata…" button.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`:

(a) Add the import (near the other dialog imports):
```tsx
import { MetadataDialog } from './MetadataDialog';
```
(b) Add state next to the other dialog states (e.g. after `const [permissionsOpen, setPermissionsOpen] = useState(false);`):
```tsx
  const [metadataOpen, setMetadataOpen] = useState(false);
```
(c) In the actions row, add an "Edit metadata…" button after the "Permissions…" button:
```tsx
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setMetadataOpen(true)}>
          Edit metadata…
        </button>
```
(d) Add the dialog render near the other dialog blocks (e.g. after the `{permissionsOpen && (<PermissionsDialog …/>)}` block):
```tsx
      {metadataOpen && (
        <MetadataDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          objectKey={objectKey}
          onClose={() => setMetadataOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing + new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): add Edit metadata… button opening the metadata editor"
```

---

## Manual smoke checklist (after Task 5)

`npm start` (full restart — main-process IPC handlers added), with an account + a writable bucket and an object:
1. Select an object → **Edit metadata…** → the dialog shows the current Content-Type, Cache-Control, Content-Disposition, and any custom metadata.
2. Change the Content-Type (e.g. to `application/json`), add a custom pair, **Save metadata** → toast; the panel's Content-Type row updates and the custom field appears under metadata.
3. Verify (e.g. `aws s3api head-object`) that the object's Content-Type/metadata changed and its storage class/content-encoding were preserved.
4. **Cancel** after edits → nothing changes.
5. Edit an object under an active retention/legal hold or in GLACIER → Save surfaces an error toast; the dialog stays open.

---

## Self-Review

**Spec coverage (against `2026-05-30-s3-manager-metadata-editor-design.md`):**
- `objectMetadata.ts` (`getEditableMetadata` maps the fields; `updateObjectMetadata` heads then copies-to-self `REPLACE`, applying edits + preserving StorageClass/ContentEncoding/ContentLanguage; empty headers → undefined) → Task 1. ✅
- IPC `s3:getEditableMetadata`/`s3:updateObjectMetadata` + register + preload → Task 2. ✅
- `useObjectMetadataEditor` (editable query; update invalidates editable + objectMetadata) → Task 3. ✅
- `MetadataDialog` (seeds Content-Type/Cache-Control/Content-Disposition + custom-metadata table; edit/add/remove; Save → updateObjectMetadata; empty-key rows dropped; load-error message; rewrite caption) → Task 4. ✅
- MetadataPanel "Edit metadata…" button opens the dialog → Task 5. ✅
- States/errors (loading/error; no optimistic update; Cancel discards; preserve-on-replace) → Tasks 1/3/4. ✅
- Out of scope (bulk/folder, immutable fields, content-encoding/language editing, storage-class change, versioning) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `EditableMetadata` (`{ contentType, cacheControl, contentDisposition, metadata }`) is defined once in `objectMetadata.ts` (Task 1) and imported by `channels.ts` (Task 2) and `useObjectMetadataEditor` (Task 3). `updateObjectMetadata`'s arg shape (`{ bucket, key, contentType, cacheControl, contentDisposition, metadata }`) matches the `ApiMap`/register/preload `{ accountId, bucket, key, … }` (Task 2) and the hook's `MetadataUpdate` (`{ contentType, cacheControl, contentDisposition, metadata }`) spread into `window.s3.updateObjectMetadata` (Task 3); the dialog calls `update.mutateAsync({ contentType, cacheControl, contentDisposition, metadata })` (Task 4) — matches. The editable query key `['editableMetadata', …]` matches between query and invalidate; the panel-refresh invalidate uses `['objectMetadata', …]`, which is the existing `useObjectDetails` head query key. The dialog's `aria-label`s ("Content-Type", "Metadata key N"/"Metadata value N") match the tests. `ok(true)` returns `Result<true>` (consistent with existing put-ops). `encodeCopyKey` is imported from `./transfer` (no circular import).

**Notes for implementers:** Task 2 adds main-process handlers, so the manual smoke needs a full `npm start` restart. The dialog test asserts on the `updateObjectMetadata` mock call args (robust to ordering). The MetadataPanel new test stubs `getEditableMetadata` (and `getObjectLockConfig`, since the panel mounts `useObjectLock`); existing MetadataPanel tests don't click "Edit metadata…", so they never call `getEditableMetadata` and remain unaffected.
```
