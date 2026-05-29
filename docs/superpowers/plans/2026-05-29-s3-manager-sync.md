# S3 Manager — Bucket-to-Bucket Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way, additive bucket→bucket sync (any account/provider) with a preview-then-run flow, live progress, and cancel.

**Architecture:** A pure `diffListings` core + a `sync.ts` engine (`listAll`/`planSync`/`runSync`/`copyOne`) in the main process. Same-account object copies use server-side `CopyObject`; cross-account/provider copies stream `GetObject`→lib-storage `Upload`. Three IPC channels (`sync:plan`/`sync:run`/`sync:cancel`) plus a one-way `sync:syncProgress` event mirror the existing upload-progress mechanism. The renderer adds a Sync section: two endpoint pickers, a plan summary, and a progress/summary panel.

**Tech Stack:** Electron 42, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`), React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/shared/result.ts`: `ok(data)`, `err(code, message)`, `Result<T>`.
- `src/main/s3/objects.ts`: `toErr(e)`.
- `src/main/s3/transfer.ts`: `encodeCopyKey(key)` (exported) = `encodeURIComponent(key).replace(/%2F/g,'/')`.
- `src/main/ipc/register.ts`: `registerIpc(ipcMain, deps)` defines `clientFor(accountId)` and `h<T>(channel, fn)` — **`h` drops the Electron event**, so a handler that needs `event.sender` must call `ipcMain.handle(channel, async (event, ...args) => …)` directly (the `uploadObject` handler at `register.ts:128` is the model).
- `src/main/ipc/channels.ts`: `CH` const, `ApiMap`, and `UPLOAD_PROGRESS_CHANNEL = 's3:uploadProgress'` + `interface UploadProgress` (one-way channel, intentionally not in `CH`/`ApiMap`).
- `src/preload.ts`: `invoke<C>(channel, ...args)`; top-level methods like `listBuckets`, `createFolder`; nested `accounts.list()`; `onUploadProgress(cb)` uses `ipcRenderer.on(UPLOAD_PROGRESS_CHANNEL, listener)` and returns `() => ipcRenderer.removeListener(...)`. `invoke(CH.encryptionAvailable)` shows the no-arg call form.
- Renderer hooks: `useAccounts()` → query of `window.s3.accounts.list()`; `useBuckets(accountId)` → query of `window.s3.listBuckets(accountId!)` (enabled when accountId !== null). `useCors` shows the `{ query, save, clear }` mutation+`unwrap` pattern.
- Renderer types import from main via type-only paths (e.g. `useCors` imports `CorsRule` from `../../main/s3/cors`).
- `src/renderer/components/SectionNav.tsx`: `export type Section = 'files' | 'dashboard' | 'objectLock' | 'cors' | 'settings'` + a `SECTIONS` array.
- `src/renderer/App.tsx`: a `section`-switch; CORS renders `<CorsEditor initialAccountId={accountId} initialBucket={bucket} />`.
- `src/main/ipc/register.test.ts`: `buildHarness()` returns `{ handlers, deps, progressEvents }`; the stub `ipcMain.handle` auto-injects an event `{ sender: { send } }` that pushes to `progressEvents`, so a test calls `handlers.get(channel)!(argObj)` and the event is supplied automatically (works for both `h`-wrapped and direct handlers).

---

## File Structure

```
src/main/s3/syncDiff.ts          # CREATE: SyncObject, SyncOp, diffListings (pure)
src/main/s3/sync.ts              # CREATE: Endpoint, SyncPlan, SyncResult, SyncFailure, SyncProgress; listAll, planSync, runSync, copyOne
src/main/ipc/channels.ts         # MODIFY: 3 channels + ApiMap + SYNC_PROGRESS_CHANNEL + re-export SyncProgress
src/main/ipc/register.ts         # MODIFY: planSync/cancel handlers (h) + runSync handler (direct) + activeSync AbortController
src/preload.ts                   # MODIFY: planSync/runSync/cancelSync/onSyncProgress
src/renderer/hooks/useSync.ts                       # CREATE: plan mutation + run + progress + cancel
src/renderer/components/sync/EndpointPicker.tsx     # CREATE: account+bucket+prefix picker
src/renderer/components/sync/SyncScreen.tsx         # CREATE: pickers + preview + run + progress + summary
src/renderer/components/SectionNav.tsx              # MODIFY: add 'sync'
src/renderer/App.tsx                                # MODIFY: render SyncScreen for the sync section
```

---

## Task 1: syncDiff.ts — pure diff core

**Files:**
- Create: `src/main/s3/syncDiff.ts`
- Test: `src/main/s3/syncDiff.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/syncDiff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffListings } from './syncDiff';

describe('diffListings', () => {
  it('flags keys missing on the destination', () => {
    const ops = diffListings([{ relKey: 'a.txt', size: 10 }], []);
    expect(ops).toEqual([{ relKey: 'a.txt', size: 10, reason: 'missing' }]);
  });

  it('flags keys whose size differs', () => {
    const ops = diffListings([{ relKey: 'a.txt', size: 10 }], [{ relKey: 'a.txt', size: 9 }]);
    expect(ops).toEqual([{ relKey: 'a.txt', size: 10, reason: 'size' }]);
  });

  it('skips keys present with matching size, and ignores destination-only keys', () => {
    const ops = diffListings(
      [{ relKey: 'same.txt', size: 5 }],
      [{ relKey: 'same.txt', size: 5 }, { relKey: 'destonly.txt', size: 7 }],
    );
    expect(ops).toEqual([]);
  });

  it('returns ops in source order', () => {
    const ops = diffListings(
      [{ relKey: 'a', size: 1 }, { relKey: 'b', size: 2 }],
      [{ relKey: 'b', size: 2 }],
    );
    expect(ops.map((o) => o.relKey)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/syncDiff.test.ts`
Expected: FAIL — cannot find module `./syncDiff`.

- [ ] **Step 3: Implement** — `src/main/s3/syncDiff.ts`:

```ts
export interface SyncObject {
  /** Object key with the endpoint prefix stripped (the part compared across the two sides). */
  relKey: string;
  size: number;
}

export interface SyncOp {
  relKey: string;
  size: number;
  reason: 'missing' | 'size';
}

/** Additive one-way diff: returns source objects absent on the destination or differing in size. */
export function diffListings(source: SyncObject[], dest: SyncObject[]): SyncOp[] {
  const destSize = new Map<string, number>();
  for (const d of dest) destSize.set(d.relKey, d.size);

  const ops: SyncOp[] = [];
  for (const s of source) {
    if (!destSize.has(s.relKey)) {
      ops.push({ relKey: s.relKey, size: s.size, reason: 'missing' });
    } else if (destSize.get(s.relKey) !== s.size) {
      ops.push({ relKey: s.relKey, size: s.size, reason: 'size' });
    }
  }
  return ops;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/syncDiff.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/syncDiff.ts src/main/s3/syncDiff.test.ts
git commit -m "feat: add pure diffListings sync core"
```

---

## Task 2: sync.ts — types, listAll, planSync

**Files:**
- Create: `src/main/s3/sync.ts`
- Test: `src/main/s3/sync.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/sync.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { listAll, planSync } from './sync';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('listAll', () => {
  it('paginates, strips the prefix, and skips the folder marker equal to the prefix', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'p/', Size: 0 }, { Key: 'p/a.txt', Size: 10 }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'p/sub/b.txt', Size: 20 }] });
    const out = await listAll(new S3Client({}), 'bucket', 'p/');
    expect(out).toEqual([
      { relKey: 'a.txt', size: 10 },
      { relKey: 'sub/b.txt', size: 20 },
    ]);
  });
});

describe('planSync', () => {
  it('summarizes objects to copy vs up-to-date and totals the bytes', async () => {
    // source listing
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({
      Contents: [{ Key: 'a/one.txt', Size: 100 }, { Key: 'a/two.txt', Size: 50 }],
    });
    // dest listing — one already present with matching size
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({
      Contents: [{ Key: 'b/two.txt', Size: 50 }],
    });
    const r = await planSync(
      new S3Client({}),
      new S3Client({}),
      { accountId: 'acc', bucket: 'src', prefix: 'a/' },
      { accountId: 'acc', bucket: 'dst', prefix: 'b/' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.toCopy).toBe(1);
      expect(r.data.upToDate).toBe(1);
      expect(r.data.bytesToCopy).toBe(100);
      expect(r.data.sample).toEqual([{ relKey: 'one.txt', size: 100, reason: 'missing' }]);
    }
  });

  it('returns an error Result when listing fails', async () => {
    s3Mock.on(ListObjectsV2Command).rejects(new Error('AccessDenied'));
    const r = await planSync(
      new S3Client({}),
      new S3Client({}),
      { accountId: 'a', bucket: 'src', prefix: '' },
      { accountId: 'a', bucket: 'dst', prefix: '' },
    );
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/sync.test.ts`
Expected: FAIL — cannot find module `./sync`.

- [ ] **Step 3: Implement** — `src/main/s3/sync.ts` (this task adds types + `listAll` + `planSync`; `runSync`/`copyOne` come in Task 3):

```ts
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';
import { diffListings, type SyncObject, type SyncOp } from './syncDiff';

export interface Endpoint {
  accountId: string;
  bucket: string;
  prefix: string;
}

export interface SyncPlan {
  toCopy: number;
  upToDate: number;
  bytesToCopy: number;
  sample: SyncOp[];
}

export interface SyncFailure {
  key: string;
  code: string;
  message: string;
}

export interface SyncResult {
  copied: number;
  bytesCopied: number;
  failed: SyncFailure[];
  canceled: boolean;
}

export interface SyncProgress {
  phase: 'listing' | 'copying' | 'done';
  copied: number;
  total: number;
  bytesCopied: number;
  bytesTotal: number;
  failed: number;
  currentKey?: string;
}

const SAMPLE_LIMIT = 100;

/** Fully (recursively) list a bucket/prefix, returning objects with the prefix stripped from each key. */
export async function listAll(client: S3Client, bucket: string, prefix: string): Promise<SyncObject[]> {
  const out: SyncObject[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix || undefined, ContinuationToken: token }),
    );
    for (const c of r.Contents ?? []) {
      const key = c.Key!;
      const relKey = key.slice(prefix.length);
      if (relKey === '') continue; // skip a folder marker whose key equals the prefix
      out.push({ relKey, size: c.Size ?? 0 });
    }
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

export async function planSync(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
): Promise<Result<SyncPlan>> {
  try {
    const [srcList, dstList] = await Promise.all([
      listAll(srcClient, source.bucket, source.prefix),
      listAll(dstClient, dest.bucket, dest.prefix),
    ]);
    const ops = diffListings(srcList, dstList);
    const bytesToCopy = ops.reduce((n, o) => n + o.size, 0);
    return ok({
      toCopy: ops.length,
      upToDate: srcList.length - ops.length,
      bytesToCopy,
      sample: ops.slice(0, SAMPLE_LIMIT),
    });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/sync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/sync.ts src/main/s3/sync.test.ts
git commit -m "feat: add sync types, listAll, and planSync"
```

---

## Task 3: sync.ts — runSync + copyOne

**Files:**
- Modify: `src/main/s3/sync.ts`
- Modify: `src/main/s3/sync.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/sync.test.ts`. Add `CopyObjectCommand`, `GetObjectCommand`, `PutObjectCommand` to the `@aws-sdk/client-s3` import, add `runSync` to the `./sync` import, and add `import { Readable } from 'node:stream';` at the top:

```ts
describe('runSync', () => {
  const source = { accountId: 'a', bucket: 'src', prefix: 'a/' };
  const dest = { accountId: 'a', bucket: 'dst', prefix: 'b/' };

  function listings() {
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({ Contents: [{ Key: 'a/one.txt', Size: 4 }] });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({ Contents: [] });
  }

  it('same-account copies use server-side CopyObject (no GetObject)', async () => {
    listings();
    s3Mock.on(CopyObjectCommand).resolves({});
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, { sameAccount: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatchObject({ copied: 1, bytesCopied: 4, failed: [], canceled: false });
    const copy = s3Mock.commandCalls(CopyObjectCommand)[0].args[0].input;
    expect(copy.Bucket).toBe('dst');
    expect(copy.CopySource).toBe('src/a/one.txt');
    expect(copy.Key).toBe('b/one.txt');
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });

  it('cross-account copies stream GetObject -> Upload (PutObject), not CopyObject', async () => {
    listings();
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from(Buffer.from('data')) as never, ContentType: 'text/plain' });
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await runSync(new S3Client({ region: 'us-east-1' }), new S3Client({ region: 'us-east-1' }), source, dest, {
      sameAccount: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(1);
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(1);
    expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThanOrEqual(1);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it('records a per-object failure and still completes the run', async () => {
    s3Mock.on(ListObjectsV2Command, { Bucket: 'src', Prefix: 'a/' }).resolves({
      Contents: [{ Key: 'a/ok.txt', Size: 1 }, { Key: 'a/bad.txt', Size: 1 }],
    });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'dst', Prefix: 'b/' }).resolves({ Contents: [] });
    s3Mock.on(CopyObjectCommand, { Key: 'b/ok.txt' }).resolves({});
    s3Mock.on(CopyObjectCommand, { Key: 'b/bad.txt' }).rejects(new Error('AccessDenied'));
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, { sameAccount: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.copied).toBe(1);
      expect(r.data.failed).toHaveLength(1);
      expect(r.data.failed[0].key).toBe('a/bad.txt');
    }
  });

  it('an already-aborted signal copies nothing and reports canceled', async () => {
    listings();
    s3Mock.on(CopyObjectCommand).resolves({});
    const controller = new AbortController();
    controller.abort();
    const r = await runSync(new S3Client({}), new S3Client({}), source, dest, {
      sameAccount: true,
      signal: controller.signal,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.canceled).toBe(true);
      expect(r.data.copied).toBe(0);
    }
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/sync.test.ts`
Expected: FAIL — `runSync` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/sync.ts`: extend the `@aws-sdk/client-s3` import to `{ S3Client, ListObjectsV2Command, CopyObjectCommand, GetObjectCommand }`, add `import { Upload } from '@aws-sdk/lib-storage';`, `import { encodeCopyKey } from './transfer';`, and `import type { Readable } from 'node:stream';`. Then append:

```ts
const CONCURRENCY = 6;

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next;
      next += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export async function copyOne(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
  op: SyncOp,
  sameAccount: boolean,
): Promise<void> {
  const sourceKey = source.prefix + op.relKey;
  const destKey = dest.prefix + op.relKey;
  if (sameAccount) {
    await dstClient.send(
      new CopyObjectCommand({
        Bucket: dest.bucket,
        CopySource: `${source.bucket}/${encodeCopyKey(sourceKey)}`,
        Key: destKey,
      }),
    );
    return;
  }
  const out = await srcClient.send(new GetObjectCommand({ Bucket: source.bucket, Key: sourceKey }));
  await new Upload({
    client: dstClient,
    params: { Bucket: dest.bucket, Key: destKey, Body: out.Body as Readable, ContentType: out.ContentType },
  }).done();
}

export interface RunSyncOptions {
  sameAccount: boolean;
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
}

export async function runSync(
  srcClient: S3Client,
  dstClient: S3Client,
  source: Endpoint,
  dest: Endpoint,
  opts: RunSyncOptions,
): Promise<Result<SyncResult>> {
  const { sameAccount, onProgress, signal } = opts;
  try {
    onProgress?.({ phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 });
    const [srcList, dstList] = await Promise.all([
      listAll(srcClient, source.bucket, source.prefix),
      listAll(dstClient, dest.bucket, dest.prefix),
    ]);
    const ops = diffListings(srcList, dstList);
    const total = ops.length;
    const bytesTotal = ops.reduce((n, o) => n + o.size, 0);

    let copied = 0;
    let bytesCopied = 0;
    let canceled = false;
    const failed: SyncFailure[] = [];
    const emit = (currentKey?: string) =>
      onProgress?.({ phase: 'copying', copied, total, bytesCopied, bytesTotal, failed: failed.length, currentKey });

    await runPool(ops, CONCURRENCY, async (op) => {
      if (signal?.aborted) {
        canceled = true;
        return;
      }
      try {
        await copyOne(srcClient, dstClient, source, dest, op, sameAccount);
        copied += 1;
        bytesCopied += op.size;
        emit(op.relKey);
      } catch (e) {
        failed.push({
          key: source.prefix + op.relKey,
          code: (e as { name?: string })?.name ?? 'UnknownError',
          message: (e as { message?: string })?.message ?? 'Unexpected error',
        });
        emit(op.relKey);
      }
    });

    onProgress?.({ phase: 'done', copied, total, bytesCopied, bytesTotal, failed: failed.length });
    return ok({ copied, bytesCopied, failed, canceled });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/sync.test.ts`
Expected: PASS (7 tests total). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/sync.ts src/main/s3/sync.test.ts
git commit -m "feat: add runSync (copy pool, server-side + streaming, cancel)"
```

---

## Task 4: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add a type import near the other main-type imports:
```ts
import type { Endpoint, SyncPlan, SyncResult } from '../s3/sync';
```
Add to the `CH` object (after `moveFolder`):
```ts
  syncPlan: 'sync:plan',
  syncRun: 'sync:run',
  syncCancel: 'sync:cancel',
```
Add to `ApiMap`:
```ts
  [CH.syncPlan]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncPlan> };
  [CH.syncRun]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncResult> };
  [CH.syncCancel]: { args: []; res: Result<true> };
```
At the bottom (next to `UPLOAD_PROGRESS_CHANNEL`), add the one-way progress channel and re-export the payload type for the preload/renderer:
```ts
/** One-way main→renderer channel for sync progress (mirrors UPLOAD_PROGRESS_CHANNEL). */
export const SYNC_PROGRESS_CHANNEL = 's3:syncProgress';
export type { SyncProgress } from '../s3/sync';
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `ListObjectsV2Command` to the `@aws-sdk/client-s3` import):

```ts
describe('sync handlers', () => {
  it('sync:plan diffs source vs destination via the account clients', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(ListObjectsV2Command, { Bucket: 'b', Prefix: 'a/' }).resolves({ Contents: [{ Key: 'a/one.txt', Size: 10 }] });
    s3Mock.on(ListObjectsV2Command, { Bucket: 'b', Prefix: 'dst/' }).resolves({ Contents: [] });

    const res = (await handlers.get(CH.syncPlan)!({
      source: { accountId: created.data.id, bucket: 'b', prefix: 'a/' },
      dest: { accountId: created.data.id, bucket: 'b', prefix: 'dst/' },
    })) as { ok: boolean; data: { toCopy: number; bytesToCopy: number } };
    expect(res.ok).toBe(true);
    expect(res.data.toCopy).toBe(1);
    expect(res.data.bytesToCopy).toBe(10);
  });

  it('sync:cancel returns ok even when nothing is running', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.syncCancel)!()) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `sync:plan` (and the every-channel test fails for the 3 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`:
- Extend the channels import to include the new constant:
```ts
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL, type CreateAccountInput } from './channels';
```
- Add engine + type imports:
```ts
import { planSync, runSync, type Endpoint } from '../s3/sync';
```
- At the end of `registerIpc` (after the `moveFolder` handler, before the closing `}`), add:
```ts
  let activeSync: AbortController | null = null;

  h(CH.syncPlan, (a: { source: Endpoint; dest: Endpoint }) =>
    planSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest),
  );

  ipcMain.handle(CH.syncRun, async (event, ...args) => {
    const a = args[0] as { source: Endpoint; dest: Endpoint };
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    const controller = new AbortController();
    activeSync = controller;
    try {
      return await runSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest, {
        sameAccount: a.source.accountId === a.dest.accountId,
        signal: controller.signal,
        onProgress: (p) => sender.send(SYNC_PROGRESS_CHANNEL, p),
      });
    } catch (e) {
      return toErr(e);
    } finally {
      if (activeSync === controller) activeSync = null;
    }
  });

  h(CH.syncCancel, () => {
    activeSync?.abort();
    return ok(true);
  });
```

In `src/preload.ts`:
- Extend the channels imports:
```ts
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL } from './main/ipc/channels';
import type { ApiMap, UploadProgress, SyncProgress } from './main/ipc/channels';
```
- Add to the `api` object (next to `moveFolder`):
```ts
  planSync: (a: ApiMap[typeof CH.syncPlan]['args'][0]) => invoke(CH.syncPlan, a),
  runSync: (a: ApiMap[typeof CH.syncRun]['args'][0]) => invoke(CH.syncRun, a),
  cancelSync: () => invoke(CH.syncCancel),
  onSyncProgress: (cb: (p: SyncProgress) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload as SyncProgress);
    ipcRenderer.on(SYNC_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SYNC_PROGRESS_CHANNEL, listener);
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test for all 25 channels). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire sync:plan/run/cancel IPC channels + progress event"
```

---

## Task 5: useSync hook

**Files:**
- Create: `src/renderer/hooks/useSync.ts`
- Test: `src/renderer/hooks/useSync.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useSync.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSync } from './useSync';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const source = { accountId: 's', bucket: 'src', prefix: '' };
const dest = { accountId: 'd', bucket: 'dst', prefix: '' };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 1, bytesToCopy: 100, sample: [] } }),
    runSync: vi.fn().mockResolvedValue({ ok: true, data: { copied: 2, bytesCopied: 100, failed: [], canceled: false } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('useSync', () => {
  it('plan calls window.s3.planSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync({ source, dest });
    expect(window.s3.planSync).toHaveBeenCalledWith({ source, dest });
    expect(plan.toCopy).toBe(2);
  });

  it('run subscribes to progress, calls runSync, and resolves with the result', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    let res!: { copied: number };
    await act(async () => {
      res = await result.current.run({ source, dest });
    });
    expect(window.s3.onSyncProgress).toHaveBeenCalled();
    expect(window.s3.runSync).toHaveBeenCalledWith({ source, dest });
    expect(res.copied).toBe(2);
  });

  it('cancel calls window.s3.cancelSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    await act(async () => {
      result.current.cancel();
    });
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useSync.test.tsx`
Expected: FAIL — cannot find module `./useSync`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useSync.ts`:

```ts
import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { Endpoint, SyncPlan, SyncResult, SyncProgress } from '../../main/s3/sync';

export interface SyncEndpoints {
  source: Endpoint;
  dest: Endpoint;
}

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

export function useSync() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const plan = useMutation({
    mutationFn: async (v: SyncEndpoints): Promise<SyncPlan> => unwrap(await window.s3.planSync(v)),
  });

  const run = useCallback(async (v: SyncEndpoints): Promise<SyncResult> => {
    setProgress(LISTING);
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    try {
      return unwrap(await window.s3.runSync(v));
    } finally {
      unsubscribe();
    }
  }, []);

  const cancel = useCallback(() => {
    void window.s3.cancelSync();
  }, []);

  const resetProgress = useCallback(() => setProgress(null), []);

  return { plan, run, cancel, progress, resetProgress };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useSync.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useSync.ts src/renderer/hooks/useSync.test.tsx
git commit -m "feat(ui): add useSync hook"
```

---

## Task 6: EndpointPicker

**Files:**
- Create: `src/renderer/components/sync/EndpointPicker.tsx`
- Test: `src/renderer/components/sync/EndpointPicker.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/EndpointPicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'acc-1', label: 'AWS' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['bucket-a', 'bucket-b'] }),
  };
});

const empty: EndpointValue = { accountId: null, bucket: null, prefix: '' };

describe('EndpointPicker', () => {
  it('selecting an account emits a reset endpoint with that account', async () => {
    const onChange = vi.fn();
    wrap(<EndpointPicker label="Source" value={empty} onChange={onChange} />);
    await screen.findByRole('option', { name: 'AWS' });
    await userEvent.selectOptions(screen.getByLabelText('Source account'), 'acc-1');
    expect(onChange).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: null, prefix: '' });
  });

  it('editing the prefix emits the updated value', async () => {
    const onChange = vi.fn();
    wrap(<EndpointPicker label="Destination" value={{ accountId: 'acc-1', bucket: 'bucket-a', prefix: '' }} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Destination prefix'), 'x');
    expect(onChange).toHaveBeenLastCalledWith({ accountId: 'acc-1', bucket: 'bucket-a', prefix: 'x' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/EndpointPicker.test.tsx`
Expected: FAIL — cannot find module `./EndpointPicker`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/EndpointPicker.tsx`:

```tsx
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';

export interface EndpointValue {
  accountId: string | null;
  bucket: string | null;
  prefix: string;
}

export function EndpointPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: EndpointValue;
  onChange: (v: EndpointValue) => void;
}) {
  const accounts = useAccounts();
  const buckets = useBuckets(value.accountId);
  const field = 'rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-slate-700">{label}</h3>
      <select
        aria-label={`${label} account`}
        className={field}
        value={value.accountId ?? ''}
        onChange={(e) => onChange({ accountId: e.target.value || null, bucket: null, prefix: '' })}
      >
        <option value="">Select account…</option>
        {accounts.data?.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      <select
        aria-label={`${label} bucket`}
        className={field}
        value={value.bucket ?? ''}
        disabled={value.accountId === null}
        onChange={(e) => onChange({ ...value, bucket: e.target.value || null, prefix: '' })}
      >
        <option value="">Select bucket…</option>
        {buckets.data?.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <input
        aria-label={`${label} prefix`}
        className={field}
        placeholder="prefix/ (optional)"
        value={value.prefix}
        onChange={(e) => onChange({ ...value, prefix: e.target.value })}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/EndpointPicker.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/EndpointPicker.tsx src/renderer/components/sync/EndpointPicker.test.tsx
git commit -m "feat(ui): add EndpointPicker"
```

---

## Task 7: SyncScreen

**Files:**
- Create: `src/renderer/components/sync/SyncScreen.tsx`
- Test: `src/renderer/components/sync/SyncScreen.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/SyncScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncScreen } from './SyncScreen';

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
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', label: 'AWS' }, { id: 'a2', label: 'Hetzner' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['src', 'dst'] }),
    onSyncProgress: vi.fn(() => () => {}),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

async function pickBothEndpoints() {
  await screen.findAllByRole('option', { name: 'AWS' });
  await userEvent.selectOptions(screen.getByLabelText('Source account'), 'a1');
  await userEvent.selectOptions(await screen.findByLabelText('Source bucket'), 'src');
  await userEvent.selectOptions(screen.getByLabelText('Destination account'), 'a2');
  await userEvent.selectOptions(await screen.findByLabelText('Destination bucket'), 'dst');
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('SyncScreen', () => {
  it('Preview shows the plan summary', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 3, upToDate: 1, bytesToCopy: 4096, sample: [{ relKey: 'a.txt', size: 4096, reason: 'missing' }] } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/3 to copy/)).toBeInTheDocument();
    expect(screen.getByText(/1 up-to-date/)).toBeInTheDocument();
  });

  it('an empty plan disables Run sync', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 0, upToDate: 5, bytesToCopy: 0, sample: [] } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Already in sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeDisabled();
  });

  it('Run sync shows the final summary including failures', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 0, bytesToCopy: 20, sample: [] } }),
      runSync: vi.fn().mockResolvedValue({ ok: true, data: { copied: 1, bytesCopied: 10, failed: [{ key: 'bad.txt', code: 'AccessDenied', message: 'denied' }], canceled: false } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run sync' }));
    expect(await screen.findByText(/Copied 1/)).toBeInTheDocument();
    expect(screen.getByText(/bad.txt/)).toBeInTheDocument();
  });

  it('refuses identical source and destination endpoints', async () => {
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await screen.findAllByRole('option', { name: 'AWS' });
    await userEvent.selectOptions(screen.getByLabelText('Source account'), 'a1');
    await userEvent.selectOptions(await screen.findByLabelText('Source bucket'), 'src');
    await userEvent.selectOptions(screen.getByLabelText('Destination account'), 'a1');
    await userEvent.selectOptions(await screen.findByLabelText('Destination bucket'), 'src');
    expect(screen.getByText(/Source and destination are the same/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/SyncScreen.test.tsx`
Expected: FAIL — cannot find module `./SyncScreen`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/SyncScreen.tsx`:

```tsx
import { useState } from 'react';
import { useSync } from '../../hooks/useSync';
import { useToast } from '../ui/ToastProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import type { Endpoint, SyncPlan, SyncResult } from '../../../main/s3/sync';

export function SyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [source, setSource] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const [dest, setDest] = useState<EndpointValue>({ accountId: null, bucket: null, prefix: '' });
  const sync = useSync();
  const { show } = useToast();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [running, setRunning] = useState(false);

  const bothChosen = !!(source.accountId && source.bucket && dest.accountId && dest.bucket);
  const sameBucket = source.accountId === dest.accountId && source.bucket === dest.bucket;
  const identical = sameBucket && source.prefix === dest.prefix;
  const overlap = sameBucket && (dest.prefix.startsWith(source.prefix) || source.prefix.startsWith(dest.prefix));
  const canPreview = bothChosen && !identical && !overlap && !running && !sync.plan.isPending;

  const toEndpoint = (v: EndpointValue): Endpoint => ({ accountId: v.accountId!, bucket: v.bucket!, prefix: v.prefix });

  const onPreview = async () => {
    setResult(null);
    try {
      const p = await sync.plan.mutateAsync({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setPlan(p);
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await sync.run({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setResult(r);
      setPlan(null);
      show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`);
    } catch (e) {
      show((e as Error).message, 'error');
    } finally {
      setRunning(false);
      sync.resetProgress();
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (bucket → bucket)</h2>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <EndpointPicker label="Source" value={source} onChange={(v) => { setSource(v); setPlan(null); }} />
        <EndpointPicker label="Destination" value={dest} onChange={(v) => { setDest(v); setPlan(null); }} />
      </div>

      {identical && <p className="mt-3 text-sm text-red-600">Source and destination are the same.</p>}
      {!identical && overlap && <p className="mt-3 text-sm text-red-600">Destination overlaps the source prefix in the same bucket.</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canPreview}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
          onClick={onPreview}
        >
          Preview
        </button>
        {running && (
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={sync.cancel}>
            Cancel
          </button>
        )}
      </div>

      {sync.plan.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !running && (
        <div className="mt-4 rounded border border-slate-200 p-3">
          {plan.toCopy === 0 ? (
            <p className="text-slate-600">Already in sync — nothing to copy ({plan.upToDate} up-to-date).</p>
          ) : (
            <p className="text-slate-700">
              <strong>{plan.toCopy}</strong> to copy · {plan.upToDate} up-to-date · {formatBytes(plan.bytesToCopy)} to transfer
            </p>
          )}
          {plan.sample.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-slate-500">
              {plan.sample.map((op) => (
                <li key={op.relKey}>{op.relKey} <span className="text-slate-400">({op.reason})</span></li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={plan.toCopy === 0}
            className="mt-3 rounded bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-600 disabled:opacity-40"
            onClick={onRun}
          >
            Run sync
          </button>
        </div>
      )}

      {running && sync.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {sync.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{sync.progress.copied} / {sync.progress.total} objects · {formatBytes(sync.progress.bytesCopied)} / {formatBytes(sync.progress.bytesTotal)}</p>
              {sync.progress.currentKey && <p className="truncate text-xs text-slate-400">{sync.progress.currentKey}</p>}
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm">
          <p className="text-slate-700">
            {result.canceled ? 'Canceled — ' : ''}Copied {result.copied} object(s), {formatBytes(result.bytesCopied)}
            {result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600">
              {result.failed.map((f) => (
                <li key={f.key}>{f.key} — {f.code}: {f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/SyncScreen.test.tsx`
Expected: PASS (4 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/SyncScreen.tsx src/renderer/components/sync/SyncScreen.test.tsx
git commit -m "feat(ui): add SyncScreen (preview, run, progress, summary)"
```

---

## Task 8: Section nav + App wiring

**Files:**
- Modify: `src/renderer/components/SectionNav.tsx`
- Modify: `src/renderer/components/SectionNav.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the failing tests.**

First READ `src/renderer/components/SectionNav.test.tsx` and `src/renderer/App.test.tsx` to match their existing setup (window.s3 stubs, render helpers). Then:

In `src/renderer/components/SectionNav.test.tsx`, append (adapt to the file's existing render style):
```tsx
it('renders a Sync section', () => {
  render(<SectionNav active="files" onSelect={() => {}} />);
  expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument();
});
```

In `src/renderer/App.test.tsx`, append a test that selecting Sync shows the screen (extend the existing `window.s3` stub used by App tests so it includes `accounts.list`, `listBuckets`, and `onSyncProgress` — mirror whatever the file already stubs):
```tsx
it('shows the Sync screen when the Sync nav item is clicked', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
  expect(await screen.findByText('Sync (bucket → bucket)')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx src/renderer/App.test.tsx`
Expected: FAIL — no "Sync" nav button / screen.

- [ ] **Step 3: Implement.**

In `src/renderer/components/SectionNav.tsx`:
- Extend the union: `export type Section = 'files' | 'dashboard' | 'objectLock' | 'cors' | 'sync' | 'settings';`
- Add to `SECTIONS` (before the `settings` entry): `{ id: 'sync', label: 'Sync' },`

In `src/renderer/App.tsx`:
- Add the import: `import { SyncScreen } from './components/sync/SyncScreen';`
- Add a branch to the section switch (alongside the `objectLock` branch), e.g. change the `objectLock` branch's `: (` tail so the order is `… : section === 'objectLock' ? (<ObjectLockEditor … />) : section === 'sync' ? (<SyncScreen initialAccountId={accountId} initialBucket={bucket} />) : (<div …>Coming soon</div>)`:
```tsx
          ) : section === 'sync' ? (
            <SyncScreen initialAccountId={accountId} initialBucket={bucket} />
          ) : (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx src/renderer/App.test.tsx`
Expected: PASS. Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SectionNav.tsx src/renderer/components/SectionNav.test.tsx src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): add Sync section to the nav and App"
```

---

## Manual smoke checklist (after Task 8)

`npm start` (full restart — main-process IPC handlers changed), with two accounts (ideally one AWS + one Hetzner) and writable buckets:
1. Open **Sync**. Pick a **Source** (account + bucket + optional prefix) and a **Destination**.
2. **Preview** → confirm the plan summary (N to copy, M up-to-date, bytes). Sample lists keys with `missing`/`size` reasons.
3. **Run sync** → progress shows objects + bytes + current key; final summary shows copied count.
4. **Same-account** pair (two buckets in one account) → objects copy server-side (fast).
5. **Cross-provider** pair (AWS ↔ Hetzner) → objects stream through and land on the destination.
6. Re-run Preview after a successful sync → "Already in sync" (Run disabled).
7. Pick identical source/dest → Preview disabled with the inline message. Same-bucket overlapping prefixes → refused.
8. Start a large run and click **Cancel** → it stops; summary shows the partial copied count.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-sync-design.md`):**
- Pure `diffListings` (missing/size, additive) → Task 1. ✅
- `Endpoint`/`SyncPlan`/`SyncResult`/`SyncFailure`/`SyncProgress` types, `listAll` (recursive, prefix-strip, skip marker), `planSync` summary → Task 2. ✅
- `runSync` (concurrency pool, per-object error isolation, cancel) + `copyOne` (same-account `CopyObject` / cross-account `GetObject`→`Upload`) → Task 3. ✅
- IPC `sync:plan`/`sync:run`/`sync:cancel` + `SYNC_PROGRESS_CHANNEL`, `sameAccount` computed in handler, `AbortController` cancel, progress via `event.sender.send` → Task 4. ✅
- `useSync` (plan/run/progress/cancel) → Task 5. ✅
- `EndpointPicker` (account+bucket+prefix) → Task 6. ✅
- `SyncScreen` (preview→run→progress→summary, empty-plan, identical/overlap guards, failures list) → Task 7. ✅
- Sync section in nav + App → Task 8. ✅
- States/validation/error handling (per-object failures, listing error, empty plan, cancel) → Tasks 3, 7. ✅
- Out of scope (two-way, delete/mirror, local↔bucket, persistence, ETag, concurrent runs, huge-bucket streaming diff) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. The two MODIFY tasks (4, 8) instruct READ-first and give exact insertion points/snippets.

**Type consistency:** `Endpoint`/`SyncPlan`/`SyncResult`/`SyncFailure`/`SyncProgress`/`SyncOp`/`SyncObject` are defined once (Tasks 1–2) and imported everywhere else (channels/register/preload Task 4; useSync Task 5; SyncScreen Task 7). `runSync` options shape `{ sameAccount, onProgress, signal }` matches between Task 3 (`RunSyncOptions`) and the Task 4 handler. `window.s3.planSync/runSync/cancelSync/onSyncProgress` names match across preload (Task 4), useSync (Task 5), and the test stubs. `EndpointValue` (Task 6) is consumed by SyncScreen (Task 7). `formatBytes` is the existing `src/renderer/lib/format.ts` export (used by FileBrowser). Channel string values (`sync:plan`/`sync:run`/`sync:cancel`, `s3:syncProgress`) are consistent between channels.ts and the preload/register references.

**Note for implementers:** Task 4 adds main-process handlers, so the manual smoke needs a full `npm start` restart. The `sync.ts` cross-account test relies on lib-storage issuing a single `PutObjectCommand` for a small streamed body — construct the clients with `new S3Client({ region: 'us-east-1' })` so lib-storage can resolve its config (same gotcha the existing `upload` test hit).
