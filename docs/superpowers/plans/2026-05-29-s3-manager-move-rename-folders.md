# S3 Manager — Move / Rename / Create Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create-folder and within-bucket rename/move for files and folders.

**Architecture:** New `src/main/s3/transfer.ts` ops — `createFolder` (empty `…/` marker), `moveObject` (Copy+Delete), `moveFolder` (recursive Copy+batched-Delete) — wired through three IPC channels + preload. The renderer adds a `useTransfer` hook, a key-path util, a generic `NameDialog`, a `FolderPicker`/`MoveDialog`, a New-folder toolbar button, file Rename/Move in the metadata panel, and folder-row Rename/Move buttons.

**Tech Stack:** Electron 42, AWS SDK v3, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite (existing, do not redefine):**
- `src/main/s3/objects.ts` exports `toErr`; `src/main/shared/result.ts` exports `ok`/`err`/`Result`.
- `src/main/ipc/register.ts`: `h(channel, fn)` + `clientFor(accountId)`. `register.test.ts`: `buildHarness()` + "every CH channel has a handler" test.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`; `src/preload.ts`: typed `window.s3` via `invoke`.
- Renderer: `useObjects(accountId, bucket, prefix)` → `{ query, folders, files }` (`folders: { name, prefix }[]`); `unwrap`; `ToastProvider`/`useToast`; `Breadcrumb` (`{ prefix, onNavigate }`); `ConfirmDialog`.
- `FileBrowser` and `MetadataPanel` current code is as read during planning (folder rows have a Delete ✕ via `useObjectActions`; the panel has an actions row with Download/Copy URL/Delete + a `confirming` state).
- `@aws-sdk/client-s3` exports `CopyObjectCommand`, `PutObjectCommand`, `DeleteObjectCommand`, `DeleteObjectsCommand`, `ListObjectsV2Command` (all present).

---

## File Structure

```
src/main/s3/transfer.ts                         # createFolder / moveObject / moveFolder + encodeCopyKey
src/main/ipc/channels.ts                        # MODIFY: 3 channels + ApiMap entries
src/main/ipc/register.ts                        # MODIFY: 3 handlers
src/preload.ts                                  # MODIFY: 3 methods
src/renderer/lib/keys.ts                        # parentPrefix / baseName (pure)
src/renderer/hooks/useTransfer.ts               # createFolder / moveObject / moveFolder mutations
src/renderer/components/transfer/NameDialog.tsx # generic name prompt
src/renderer/components/transfer/FolderPicker.tsx  # in-dialog bucket folder browser
src/renderer/components/transfer/MoveDialog.tsx    # wraps FolderPicker; resolves destination
src/renderer/components/files/FileBrowser.tsx   # MODIFY: New-folder button; folder-row Rename/Move
src/renderer/components/files/MetadataPanel.tsx # MODIFY: file Rename/Move actions
```

---

## Task 1: transfer.ts — createFolder

**Files:**
- Create: `src/main/s3/transfer.ts`
- Test: `src/main/s3/transfer.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/transfer.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createFolder } from './transfer';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('createFolder', () => {
  it('puts an empty object at prefix+name+"/"', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: 'images/', name: 'new' });
    expect(r).toEqual({ ok: true, data: { key: 'images/new/' } });
    const input = s3Mock.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input.Bucket).toBe('b');
    expect(input.Key).toBe('images/new/');
  });

  it('rejects an empty name', async () => {
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: '', name: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidName');
  });

  it('rejects a name containing a slash', async () => {
    const r = await createFolder(new S3Client({}), { bucket: 'b', prefix: '', name: 'a/b' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidName');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: FAIL — cannot find module `./transfer`.

- [ ] **Step 3: Implement** — `src/main/s3/transfer.ts`:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { toErr } from './objects';

export async function createFolder(
  client: S3Client,
  args: { bucket: string; prefix: string; name: string },
): Promise<Result<{ key: string }>> {
  const name = args.name.trim();
  if (name === '' || name.includes('/')) {
    return err('InvalidName', 'Folder name must be non-empty and contain no "/"');
  }
  try {
    const key = `${args.prefix}${name}/`;
    await client.send(new PutObjectCommand({ Bucket: args.bucket, Key: key, Body: '' }));
    return ok({ key });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/transfer.ts src/main/s3/transfer.test.ts
git commit -m "feat: add createFolder transfer op"
```

---

## Task 2: transfer.ts — moveObject (+ encodeCopyKey)

**Files:**
- Modify: `src/main/s3/transfer.ts`
- Modify: `src/main/s3/transfer.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/transfer.test.ts` (add `CopyObjectCommand`, `DeleteObjectCommand` to the `@aws-sdk/client-s3` import; add `moveObject` to the `./transfer` import):

```ts
describe('moveObject', () => {
  it('copies (encoded source) then deletes the original', async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'a/old name.txt', destKey: 'a/new.txt' });
    expect(r).toEqual({ ok: true, data: { key: 'a/new.txt' } });
    const copy = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(copy.CopySource).toBe('b/a/old%20name.txt'); // spaces encoded, slashes preserved
    expect(copy.Key).toBe('a/new.txt');
    expect(s3Mock.commandCalls(DeleteObjectCommand)[0].args[0].input.Key).toBe('a/old name.txt');
  });

  it('rejects when destKey equals sourceKey or is empty', async () => {
    const same = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'k', destKey: 'k' });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.code).toBe('InvalidDestination');
    const empty = await moveObject(new S3Client({}), { bucket: 'b', sourceKey: 'k', destKey: '' });
    expect(empty.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: FAIL — `moveObject` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/transfer.ts` add `CopyObjectCommand`, `DeleteObjectCommand` to the import, then append:

```ts
/** Build a CopySource that encodes special chars but preserves the "/" path separators. */
export function encodeCopyKey(key: string): string {
  return encodeURIComponent(key).replace(/%2F/g, '/');
}

export async function moveObject(
  client: S3Client,
  args: { bucket: string; sourceKey: string; destKey: string },
): Promise<Result<{ key: string }>> {
  if (args.destKey === '' || args.destKey === args.sourceKey) {
    return err('InvalidDestination', 'Destination must be non-empty and different from the source');
  }
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: args.bucket,
        CopySource: `${args.bucket}/${encodeCopyKey(args.sourceKey)}`,
        Key: args.destKey,
      }),
    );
    await client.send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.sourceKey }));
    return ok({ key: args.destKey });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/transfer.ts src/main/s3/transfer.test.ts
git commit -m "feat: add moveObject transfer op (copy+delete)"
```

---

## Task 3: transfer.ts — moveFolder

**Files:**
- Modify: `src/main/s3/transfer.ts`
- Modify: `src/main/s3/transfer.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/transfer.test.ts` (add `ListObjectsV2Command`, `DeleteObjectsCommand` to the `@aws-sdk/client-s3` import; add `moveFolder` to the `./transfer` import):

```ts
describe('moveFolder', () => {
  it('copies every key rebased onto destPrefix, deletes originals, returns the count', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'old/a' }, { Key: 'old/sub/b' }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'old/c' }] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: 'new/' });
    expect(r).toEqual({ ok: true, data: { count: 3 } });
    const copyKeys = s3Mock.commandCalls(CopyObjectCommand).map((c) => c.args[0].input.Key);
    expect(copyKeys).toEqual(['new/a', 'new/sub/b', 'new/c']);
  });

  it('rejects an empty/root prefix', async () => {
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: '', destPrefix: 'new/' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidDestination');
  });

  it('rejects moving a folder into itself', async () => {
    const r = await moveFolder(new S3Client({}), { bucket: 'b', sourcePrefix: 'old/', destPrefix: 'old/sub/' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('InvalidDestination');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: FAIL — `moveFolder` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/transfer.ts` add `ListObjectsV2Command`, `DeleteObjectsCommand` to the import, then append:

```ts
export async function moveFolder(
  client: S3Client,
  args: { bucket: string; sourcePrefix: string; destPrefix: string },
): Promise<Result<{ count: number }>> {
  const { bucket, sourcePrefix, destPrefix } = args;
  if (!sourcePrefix.trim() || sourcePrefix === '/' || !destPrefix.trim() || destPrefix === '/') {
    return err('InvalidDestination', 'Source and destination prefixes are required');
  }
  if (destPrefix.startsWith(sourcePrefix)) {
    return err('InvalidDestination', 'Cannot move a folder into itself');
  }
  try {
    let token: string | undefined;
    let count = 0;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: sourcePrefix, ContinuationToken: token }),
      );
      const keys = (listed.Contents ?? []).map((c) => c.Key!).filter(Boolean);
      for (const key of keys) {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${encodeCopyKey(key)}`,
            Key: destPrefix + key.slice(sourcePrefix.length),
          }),
        );
      }
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }),
        );
        count += batch.length;
      }
      token = listed.NextContinuationToken;
    } while (token);
    return ok({ count });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/transfer.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/transfer.ts src/main/s3/transfer.test.ts
git commit -m "feat: add moveFolder transfer op (recursive copy+delete)"
```

---

## Task 4: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to `CH` (after the Object Lock channels):
```ts
  createFolder: 's3:createFolder',
  moveObject: 's3:moveObject',
  moveFolder: 's3:moveFolder',
```
Add to `ApiMap`:
```ts
  [CH.createFolder]: { args: [{ accountId: string; bucket: string; prefix: string; name: string }]; res: Result<{ key: string }> };
  [CH.moveObject]: { args: [{ accountId: string; bucket: string; sourceKey: string; destKey: string }]; res: Result<{ key: string }> };
  [CH.moveFolder]: { args: [{ accountId: string; bucket: string; sourcePrefix: string; destPrefix: string }]; res: Result<{ count: number }> };
```
(No new type import needed — these args/res are inline.)

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `PutObjectCommand` to the `@aws-sdk/client-s3` import if not already present):

```ts
describe('transfer handlers', () => {
  it('s3:createFolder creates the folder marker via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectCommand).resolves({});

    const res = (await handlers.get(CH.createFolder)!({ accountId: created.data.id, bucket: 'b', prefix: 'p/', name: 'new' })) as {
      ok: boolean; data: { key: string };
    };
    expect(res).toEqual({ ok: true, data: { key: 'p/new/' } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `s3:createFolder` (and the every-channel test fails for the 3 new channels).

- [ ] **Step 4: Implement** — in `src/main/ipc/register.ts` add the import:
```ts
import { createFolder, moveObject, moveFolder } from '../s3/transfer';
```
and register the three handlers (next to the existing ones):
```ts
  h(CH.createFolder, (a: { accountId: string; bucket: string; prefix: string; name: string }) =>
    createFolder(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix, name: a.name }),
  );

  h(CH.moveObject, (a: { accountId: string; bucket: string; sourceKey: string; destKey: string }) =>
    moveObject(clientFor(a.accountId), { bucket: a.bucket, sourceKey: a.sourceKey, destKey: a.destKey }),
  );

  h(CH.moveFolder, (a: { accountId: string; bucket: string; sourcePrefix: string; destPrefix: string }) =>
    moveFolder(clientFor(a.accountId), { bucket: a.bucket, sourcePrefix: a.sourcePrefix, destPrefix: a.destPrefix }),
  );
```

Then in `src/preload.ts` add to the `api` object:
```ts
  createFolder: (a: ApiMap[typeof CH.createFolder]['args'][0]) => invoke(CH.createFolder, a),
  moveObject: (a: ApiMap[typeof CH.moveObject]['args'][0]) => invoke(CH.moveObject, a),
  moveFolder: (a: ApiMap[typeof CH.moveFolder]['args'][0]) => invoke(CH.moveFolder, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the "every channel" test for all 22 channels). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire createFolder/moveObject/moveFolder IPC channels"
```

---

## Task 5: keys.ts — parentPrefix / baseName

**Files:**
- Create: `src/renderer/lib/keys.ts`
- Test: `src/renderer/lib/keys.test.ts`

- [ ] **Step 1: Write the failing test** — `src/renderer/lib/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parentPrefix, baseName } from './keys';

describe('baseName', () => {
  it('returns the final segment for files, folders, and top-level items', () => {
    expect(baseName('images/logo.png')).toBe('logo.png');
    expect(baseName('images/old/')).toBe('old');
    expect(baseName('logo.png')).toBe('logo.png');
    expect(baseName('old/')).toBe('old');
  });
});

describe('parentPrefix', () => {
  it('returns the prefix up to the final segment', () => {
    expect(parentPrefix('images/logo.png')).toBe('images/');
    expect(parentPrefix('images/old/')).toBe('images/');
    expect(parentPrefix('logo.png')).toBe('');
    expect(parentPrefix('old/')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/keys.test.ts`
Expected: FAIL — cannot find module `./keys`.

- [ ] **Step 3: Implement** — `src/renderer/lib/keys.ts`:

```ts
function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** The final path segment of a key or folder prefix (no trailing slash). */
export function baseName(keyOrPrefix: string): string {
  const trimmed = trimTrailingSlash(keyOrPrefix);
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** The prefix up to and including the slash before the final segment ('' at top level). */
export function parentPrefix(keyOrPrefix: string): string {
  const trimmed = trimTrailingSlash(keyOrPrefix);
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? '' : trimmed.slice(0, i + 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/keys.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/keys.ts src/renderer/lib/keys.test.ts
git commit -m "feat(ui): add parentPrefix/baseName key helpers"
```

---

## Task 6: useTransfer hook

**Files:**
- Create: `src/renderer/hooks/useTransfer.ts`
- Test: `src/renderer/hooks/useTransfer.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useTransfer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTransfer } from './useTransfer';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    createFolder: vi.fn().mockResolvedValue({ ok: true, data: { key: 'p/new/' } }),
    moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'a/new.txt' } }),
    moveFolder: vi.fn().mockResolvedValue({ ok: true, data: { count: 2 } }),
  };
});

describe('useTransfer', () => {
  it('createFolder calls window.s3.createFolder and invalidates objects', async () => {
    const { result } = renderHook(() => useTransfer('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.createFolder.mutateAsync({ prefix: 'p/', name: 'new' });
    expect(window.s3.createFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'p/', name: 'new' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });

  it('moveObject and moveFolder forward their args', async () => {
    const { result } = renderHook(() => useTransfer('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.moveObject.mutateAsync({ sourceKey: 'a/old.txt', destKey: 'a/new.txt' });
    expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'a/old.txt', destKey: 'a/new.txt' });
    await result.current.moveFolder.mutateAsync({ sourcePrefix: 'old/', destPrefix: 'new/' });
    expect(window.s3.moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'old/', destPrefix: 'new/' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useTransfer.test.tsx`
Expected: FAIL — cannot find module `./useTransfer`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useTransfer.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useTransfer(accountId: string, bucket: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });

  const createFolder = useMutation({
    mutationFn: async (a: { prefix: string; name: string }) =>
      unwrap(await window.s3.createFolder({ accountId, bucket, prefix: a.prefix, name: a.name })),
    onSuccess: invalidate,
  });

  const moveObject = useMutation({
    mutationFn: async (a: { sourceKey: string; destKey: string }) =>
      unwrap(await window.s3.moveObject({ accountId, bucket, sourceKey: a.sourceKey, destKey: a.destKey })),
    onSuccess: invalidate,
  });

  const moveFolder = useMutation({
    mutationFn: async (a: { sourcePrefix: string; destPrefix: string }) =>
      unwrap(await window.s3.moveFolder({ accountId, bucket, sourcePrefix: a.sourcePrefix, destPrefix: a.destPrefix })),
    onSuccess: invalidate,
  });

  return { createFolder, moveObject, moveFolder };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useTransfer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useTransfer.ts src/renderer/hooks/useTransfer.test.tsx
git commit -m "feat(ui): add useTransfer (createFolder/moveObject/moveFolder)"
```

---

## Task 7: NameDialog

**Files:**
- Create: `src/renderer/components/transfer/NameDialog.tsx`
- Test: `src/renderer/components/transfer/NameDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/transfer/NameDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameDialog } from './NameDialog';

describe('NameDialog', () => {
  it('emits the trimmed name on confirm', async () => {
    const onConfirm = vi.fn();
    render(<NameDialog title="New folder" initialValue="" confirmLabel="Create" onConfirm={onConfirm} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Name'), '  reports  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onConfirm).toHaveBeenCalledWith('reports');
  });

  it('disables confirm for empty and slash-containing names', async () => {
    render(<NameDialog title="Rename" initialValue="logo.png" confirmLabel="Rename" onConfirm={() => {}} onCancel={() => {}} />);
    const confirm = screen.getByRole('button', { name: 'Rename' });
    expect(confirm).toBeEnabled();
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    expect(confirm).toBeDisabled();
    await userEvent.type(input, 'a/b');
    expect(confirm).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/transfer/NameDialog.test.tsx`
Expected: FAIL — cannot find module `./NameDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/transfer/NameDialog.tsx`:

```tsx
import { useState } from 'react';

export function NameDialog({
  title,
  initialValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const valid = trimmed !== '' && !trimmed.includes('/');

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <form
        className="w-80 rounded bg-white p-4 shadow-lg"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(trimmed);
        }}
      >
        <p className="pb-2 text-sm font-medium text-slate-800">{title}</p>
        <label className="block text-sm">
          Name
          <input className="mt-1 w-full rounded border border-slate-300 px-2 py-1" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!valid} className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40">
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/transfer/NameDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/transfer/NameDialog.tsx src/renderer/components/transfer/NameDialog.test.tsx
git commit -m "feat(ui): add NameDialog"
```

---

## Task 8: FolderPicker

**Files:**
- Create: `src/renderer/components/transfer/FolderPicker.tsx`
- Test: `src/renderer/components/transfer/FolderPicker.test.tsx`

Browses the bucket's folders for a move destination. Uses `useObjects` for the picker's current prefix; `canPick(prefix)` gates the "Move here" button.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/transfer/FolderPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FolderPicker } from './FolderPicker';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: { folders: [{ name: 'docs', prefix: 'docs/' }], files: [], nextToken: null },
    }),
  };
});

describe('FolderPicker', () => {
  it('picks the current prefix (root by default) via Move here', async () => {
    const onPick = vi.fn();
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => true} onPick={onPick} />);
    await screen.findByRole('button', { name: 'docs' });
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(onPick).toHaveBeenCalledWith('');
  });

  it('navigates into a folder and picks that prefix', async () => {
    const onPick = vi.fn();
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => true} onPick={onPick} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(onPick).toHaveBeenCalledWith('docs/');
  });

  it('disables Move here when canPick returns false', async () => {
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => false} onPick={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Move here' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/transfer/FolderPicker.test.tsx`
Expected: FAIL — cannot find module `./FolderPicker`.

- [ ] **Step 3: Implement** — `src/renderer/components/transfer/FolderPicker.tsx`:

```tsx
import { useState } from 'react';
import { useObjects } from '../../hooks/useObjects';
import { Breadcrumb } from '../files/Breadcrumb';

export function FolderPicker({
  accountId,
  bucket,
  canPick,
  onPick,
}: {
  accountId: string;
  bucket: string;
  canPick: (prefix: string) => boolean;
  onPick: (prefix: string) => void;
}) {
  const [prefix, setPrefix] = useState('');
  const { query, folders } = useObjects(accountId, bucket, prefix);

  return (
    <div className="flex flex-col gap-2">
      <Breadcrumb prefix={prefix} onNavigate={setPrefix} />
      <div className="h-48 overflow-auto rounded border border-slate-200">
        {query.isLoading && <p className="p-2 text-sm text-slate-500">Loading…</p>}
        {query.isSuccess && folders.length === 0 && <p className="p-2 text-sm text-slate-400">No subfolders</p>}
        <ul>
          {folders.map((folder) => (
            <li key={folder.prefix}>
              <button type="button" className="block w-full px-2 py-1 text-left text-sm hover:bg-slate-50" onClick={() => setPrefix(folder.prefix)}>
                📁 {folder.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        disabled={!canPick(prefix)}
        className="self-end rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
        onClick={() => onPick(prefix)}
      >
        Move here
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/transfer/FolderPicker.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/transfer/FolderPicker.tsx src/renderer/components/transfer/FolderPicker.test.tsx
git commit -m "feat(ui): add FolderPicker"
```

---

## Task 9: MoveDialog

**Files:**
- Create: `src/renderer/components/transfer/MoveDialog.tsx`
- Test: `src/renderer/components/transfer/MoveDialog.test.tsx`

Hosts `FolderPicker`, computes `canPick`, and on pick calls the right `useTransfer` mutation (file → `moveObject`, folder → `moveFolder`), toasts, and closes.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/transfer/MoveDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { MoveDialog } from './MoveDialog';

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
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'docs', prefix: 'docs/' }], files: [], nextToken: null } }),
    moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'docs/logo.png' } }),
    moveFolder: vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } }),
  };
});

describe('MoveDialog', () => {
  it('moves a file into the picked folder', async () => {
    const onClose = vi.fn();
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'file', name: 'logo.png', parent: '', key: 'logo.png' }} onClose={onClose} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'logo.png', destKey: 'docs/logo.png' });
  });

  it('moves a folder into the picked folder', async () => {
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'folder', name: 'old', parent: '', prefix: 'old/' }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(window.s3.moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'old/', destPrefix: 'docs/old/' });
  });

  it('disables Move here at the item\'s current parent (no-op)', async () => {
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'file', name: 'logo.png', parent: '', key: 'logo.png' }} onClose={() => {}} />);
    // picker starts at root '' which equals the file's current parent → no-op
    expect(await screen.findByRole('button', { name: 'Move here' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/transfer/MoveDialog.test.tsx`
Expected: FAIL — cannot find module `./MoveDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/transfer/MoveDialog.tsx`:

```tsx
import { useTransfer } from '../../hooks/useTransfer';
import { useToast } from '../ui/ToastProvider';
import { FolderPicker } from './FolderPicker';

export type MoveItem =
  | { kind: 'file'; name: string; parent: string; key: string }
  | { kind: 'folder'; name: string; parent: string; prefix: string };

export function MoveDialog({
  accountId,
  bucket,
  item,
  onClose,
}: {
  accountId: string;
  bucket: string;
  item: MoveItem;
  onClose: () => void;
}) {
  const transfer = useTransfer(accountId, bucket);
  const { show } = useToast();

  const canPick = (dest: string) => {
    if (dest === item.parent) return false; // no-op
    if (item.kind === 'folder' && (dest === item.prefix || dest.startsWith(item.prefix))) return false; // into itself
    return true;
  };

  const onPick = async (dest: string) => {
    try {
      if (item.kind === 'file') {
        await transfer.moveObject.mutateAsync({ sourceKey: item.key, destKey: dest + item.name });
      } else {
        await transfer.moveFolder.mutateAsync({ sourcePrefix: item.prefix, destPrefix: `${dest}${item.name}/` });
      }
      show('Moved');
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-96 rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Move "{item.name}" to…</p>
          <button type="button" aria-label="Cancel" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
            ✕
          </button>
        </div>
        <FolderPicker accountId={accountId} bucket={bucket} canPick={canPick} onPick={onPick} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/transfer/MoveDialog.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/transfer/MoveDialog.tsx src/renderer/components/transfer/MoveDialog.test.tsx
git commit -m "feat(ui): add MoveDialog with folder picker"
```

---

## Task 10: FileBrowser — New folder + folder-row Rename/Move

**Files:**
- Modify: `src/renderer/components/files/FileBrowser.tsx`
- Modify: `src/renderer/components/files/FileBrowser.test.tsx`

READ the current `FileBrowser.tsx` first. Make these additive changes.

- [ ] **Step 1: Add the failing tests** — append to `src/renderer/components/files/FileBrowser.test.tsx` (ensure `fireEvent`/`waitFor` from `@testing-library/react` and `userEvent` are imported):

```tsx
describe('FileBrowser transfer ops', () => {
  it('creates a folder via the New folder button', async () => {
    const createFolder = vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/reports/' } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
      getDropPath: vi.fn(), uploadObject: vi.fn(), onUploadProgress: vi.fn(() => () => {}),
      createFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await screen.findByText('This folder is empty');
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Name'), 'reports');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/', name: 'reports' }));
  });

  it('renames a folder via the row Rename button', async () => {
    const moveFolder = vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }], files: [], nextToken: null } }),
      getDropPath: vi.fn(), uploadObject: vi.fn(), onUploadProgress: vi.fn(() => () => {}),
      moveFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename folder thumbs' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'thumbnails');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'images/thumbs/', destPrefix: 'images/thumbnails/' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: FAIL — no "New folder" / "Rename folder …" buttons.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/FileBrowser.tsx`:

(a) Add imports:
```tsx
import { useTransfer } from '../../hooks/useTransfer';
import { parentPrefix } from '../../lib/keys';
import { NameDialog } from '../transfer/NameDialog';
import { MoveDialog, type MoveItem } from '../transfer/MoveDialog';
import { useToast } from '../ui/ToastProvider';
```

(b) After the existing `const [folderToDelete, …]` state, add:
```tsx
  const transfer = useTransfer(accountId ?? '', bucket ?? '');
  const { show } = useToast();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<{ name: string; prefix: string } | null>(null);
  const [itemToMove, setItemToMove] = useState<MoveItem | null>(null);
```

(c) In the header `<div className="border-b border-slate-200 p-2">`, change it to a flex row with the breadcrumb and a New-folder button:
```tsx
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setNewFolderOpen(true)}>
          New folder
        </button>
      </div>
```

(d) In the folder row's third `<td>` (the one with the Delete ✕ button), add Rename + Move buttons *before* the existing Delete button, inside the same `<td>`:
```tsx
                  <td className="px-3 py-1.5 text-right">
                    <button type="button" aria-label={`Rename folder ${folder.name}`} className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); setFolderToRename(folder); }}>✎</button>
                    <button type="button" aria-label={`Move folder ${folder.name}`} className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={(e) => { e.stopPropagation(); setItemToMove({ kind: 'folder', name: folder.name, parent: parentPrefix(folder.prefix), prefix: folder.prefix }); }}>➜</button>
                    <button type="button" aria-label={`Delete folder ${folder.name}`} className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={(e) => { e.stopPropagation(); setFolderToDelete(folder); }}>✕</button>
                  </td>
```

(e) After the existing `{folderToDelete && (<ConfirmDialog … />)}` block, add the three new dialogs:
```tsx
      {newFolderOpen && (
        <NameDialog
          title="New folder"
          initialValue=""
          confirmLabel="Create"
          onCancel={() => setNewFolderOpen(false)}
          onConfirm={async (name) => {
            setNewFolderOpen(false);
            try {
              await transfer.createFolder.mutateAsync({ prefix, name });
              show('Folder created');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {folderToRename && (
        <NameDialog
          title={`Rename ${folderToRename.name}`}
          initialValue={folderToRename.name}
          confirmLabel="Rename"
          onCancel={() => setFolderToRename(null)}
          onConfirm={async (name) => {
            const target = folderToRename;
            setFolderToRename(null);
            try {
              await transfer.moveFolder.mutateAsync({ sourcePrefix: target.prefix, destPrefix: `${parentPrefix(target.prefix)}${name}/` });
              show('Renamed');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {itemToMove && (
        <MoveDialog accountId={accountId} bucket={bucket} item={itemToMove} onClose={() => setItemToMove(null)} />
      )}
```

(Note: `accountId`/`bucket` are non-null here — the component early-returns when `bucket === null`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/FileBrowser.tsx src/renderer/components/files/FileBrowser.test.tsx
git commit -m "feat(ui): add New folder + folder rename/move to FileBrowser"
```

---

## Task 11: MetadataPanel — file Rename / Move

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

READ the current `MetadataPanel.tsx` first. Add Rename + Move actions for the selected file.

- [ ] **Step 1: Add the failing tests** — append to `src/renderer/components/files/MetadataPanel.test.tsx` (the file has a `wrap` helper + `userEvent`):

```tsx
describe('MetadataPanel rename/move', () => {
  beforeEach(() => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/new.png' } }),
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
    };
  });

  it('renames a file and closes the panel', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'new.png');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'images/logo.png', destKey: 'images/new.png' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

(Note: after opening the dialog there are two "Rename" buttons — the panel trigger and the dialog confirm. Per Step 3, the panel trigger is hidden while the rename dialog is open, so `getByRole('button', { name: 'Rename' })` resolves the dialog's confirm on the second click.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — no "Rename"/"Move" actions.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`:

(a) Add imports:
```tsx
import { useTransfer } from '../../hooks/useTransfer';
import { useToast } from '../ui/ToastProvider';
import { parentPrefix, baseName } from '../../lib/keys';
import { NameDialog } from '../transfer/NameDialog';
import { MoveDialog } from '../transfer/MoveDialog';
```

(b) After the existing `const [confirming, setConfirming] = useState(false);`, add:
```tsx
  const transfer = useTransfer(accountId ?? '', bucket ?? '');
  const { show } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
```

(c) In the actions row `<div className="flex gap-1 border-b border-slate-200 p-2">`, add Rename + Move trigger buttons after "Copy URL" and before the Delete block. Wrap the Rename trigger so it hides while the rename dialog is open:
```tsx
        {!renaming && (
          <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setMoving(true)}>
          Move
        </button>
```

(d) Add the dialogs (e.g. right after the existing `{confirming && (<ConfirmDialog … />)}` block):
```tsx
      {renaming && (
        <NameDialog
          title={`Rename ${baseName(objectKey)}`}
          initialValue={baseName(objectKey)}
          confirmLabel="Rename"
          onCancel={() => setRenaming(false)}
          onConfirm={async (name) => {
            setRenaming(false);
            try {
              await transfer.moveObject.mutateAsync({ sourceKey: objectKey, destKey: `${parentPrefix(objectKey)}${name}` });
              show('Renamed');
              onClose();
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {moving && (
        <MoveDialog
          accountId={accountId}
          bucket={bucket}
          item={{ kind: 'file', name: baseName(objectKey), parent: parentPrefix(objectKey), key: objectKey }}
          onClose={() => {
            setMoving(false);
            onClose();
          }}
        />
      )}
```

(Note: `MoveDialog` requires non-null `accountId`/`bucket`; the panel is only rendered when a file is selected, which implies both are set. If TypeScript complains, pass `accountId ?? ''`/`bucket ?? ''` — but the panel's props type them as `string | null`, so use `accountId ?? ''` and `bucket ?? ''` to satisfy the compiler.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing + 1 new). Then `npm test` (full suite) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): add file Rename/Move to MetadataPanel"
```

---

## Manual smoke checklist (after Task 11)

`npm start` (full restart — main-process IPC handlers changed), with an account + writable bucket:
1. **New folder** → enter a name → folder appears.
2. Navigate into a folder; **New folder** creates a nested one.
3. Select a file → **Rename** → new name → file renamed (panel closes, listing refreshes).
4. Select a file → **Move** → pick a folder → "Move here" → file moves there.
5. Folder row **✎ Rename** → folder + all contents renamed.
6. Folder row **➜ Move** → pick a destination → folder + contents moved (the source folder and its descendants are not pickable).
7. Try renaming a file to a name with `/` → Confirm disabled.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-move-rename-folders-design.md`):**
- `createFolder` / `moveObject` (copy+delete, CopySource encoding) / `moveFolder` (recursive, into-itself guard) → Tasks 1, 2, 3. ✅
- IPC channels + register + preload → Task 4. ✅
- `parentPrefix`/`baseName` util → Task 5. ✅
- `useTransfer` mutations + invalidation → Task 6. ✅
- `NameDialog` (new folder + rename; empty/slash validation) → Task 7. ✅
- `FolderPicker` (browse + navigate + Move here + canPick gating) → Task 8. ✅
- `MoveDialog` (file → moveObject, folder → moveFolder; no-op + into-itself canPick) → Task 9. ✅
- FileBrowser: New folder button + folder-row Rename/Move → Task 10. ✅
- MetadataPanel: file Rename/Move (panel closes after) → Task 11. ✅
- States/validation/toasts → Tasks 7, 9, 10, 11. ✅
- Out of scope (cross-bucket, rollback, drag-drop) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `MoveItem` (the file/folder union) defined in `MoveDialog.tsx` (Task 9), constructed in FileBrowser (Task 10) and MetadataPanel (Task 11). `useTransfer` returns `{ createFolder, moveObject, moveFolder }` with mutation arg shapes (`{prefix,name}` / `{sourceKey,destKey}` / `{sourcePrefix,destPrefix}`) matched by the `window.s3` methods and the `ApiMap`/`register` handlers (Task 4). `encodeCopyKey` defined once in `transfer.ts` (Task 2), reused by `moveFolder` (Task 3). `parentPrefix`/`baseName` (Task 5) used by both wiring tasks. The Rename trigger ("Rename") is hidden while the rename dialog is open so the dialog's confirm "Rename" is unambiguous (mirrors the existing Delete pattern). `FolderPicker.canPick` predicate is provided by `MoveDialog`.

**Note for implementers:** Tasks 10/11 are additive edits to large existing files — READ each file first and splice in the changes at the anchors described (don't rewrite the whole component). After Task 4 (main-process handler changes), the manual smoke needs a full `npm start` restart.
