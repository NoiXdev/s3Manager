# S3 Manager — Local ↔ Bucket Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-way, additive sync between a local directory and a bucket/prefix in both directions (upload local→bucket, download bucket→local), with preview-then-run, live progress, and cancel — reusing the bucket-sync engine.

**Architecture:** A new `localSync.ts` reuses the pure `diffListings` core, all result/progress types, and `listAll` from the merged bucket sync. A `walkDir` enumerates the local side; per-object transfer is `uploadObject` (upload) or `mkdir -p` + `downloadObject` (download). `runPool` is extracted into a shared `pool.ts`. Two new IPC channels plus a folder-picker channel; the existing `sync:cancel` + progress event are reused. The UI adds a mode toggle in the Sync section.

**Tech Stack:** Electron 42, AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`), Node `fs`/`path`, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/sync.ts` exports `Endpoint`, `SyncPlan`, `SyncResult`, `SyncFailure`, `SyncProgress`, `listAll(client, bucket, prefix)`, and currently a private `runPool`. `src/main/s3/syncDiff.ts` exports `diffListings(source, dest)`, `SyncObject` (`{relKey,size}`), `SyncOp` (`{relKey,size,reason}`).
- `src/main/s3/objects.ts` exports `uploadObject(client, { bucket, key, filePath, contentType?, onProgress? }) → Result<{key}>`, `downloadObject(client, { bucket, key, destPath }) → Result<{path}>`, and `toErr(e)`.
- `src/main/shared/result.ts`: `ok`, `err`, `Result<T>`.
- `src/main/ipc/channels.ts`: `CH`, `ApiMap`, `SYNC_PROGRESS_CHANNEL`, re-exported `SyncProgress`. `src/main/ipc/register.ts`: `registerIpc(ipcMain, deps)`, `clientFor`, the `h(channel, fn)` helper (drops the event), the DIRECT `ipcMain.handle(CH.syncRun, async (event, ...args) => …)` pattern with a module-scoped `activeSync: AbortController | null` (supersede-prior-run + `finally` cleanup), and the `h(CH.syncCancel, () => { activeSync?.abort(); return ok(true as const); })` handler. `RegisterDeps` currently has `{ accounts, secrets, settings, crypto, db, saveDialog }`.
- `src/main.ts`: `initBackend()` builds `saveDialog` via `dialog.showSaveDialog` and calls `registerIpc(ipcMain, { …, saveDialog })`. `dialog` is already imported from `electron`.
- `src/preload.ts`: `invoke<C>(channel, ...args)`; sync methods `planSync`/`runSync`/`cancelSync`/`onSyncProgress` already exist; imports `{ CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL }` and `type { ApiMap, UploadProgress, SyncProgress }`.
- `src/main/ipc/register.test.ts`: `buildHarness()` returns `{ handlers, deps, progressEvents }`; its `deps` object lists every `RegisterDeps` field; the stub `ipcMain.handle` auto-injects `{ sender: { send } }`. Tests call `handlers.get(channel)!(argObj)`.
- Renderer: `useSync` (`src/renderer/hooks/useSync.ts`) shows the plan-mutation + run-with-progress-subscription + cancel pattern. `EndpointPicker` (`src/renderer/components/sync/EndpointPicker.tsx`): props `{ label, value: EndpointValue, onChange }`, aria-labels `"${label} account"`, `"${label} bucket"`, `"${label} prefix"`. `SyncScreen` (`src/renderer/components/sync/SyncScreen.tsx`) is the layout to mirror. `formatBytes` from `src/renderer/lib/format.ts`. `unwrap` from `src/renderer/lib/result.ts`.
- `src/renderer/App.tsx`: the `sync` branch currently renders `<SyncScreen initialAccountId={accountId} initialBucket={bucket} />`. `src/renderer/App.test.tsx`'s `beforeEach` `window.s3` stub already includes `accounts.list`, `listBuckets`, and `onSyncProgress`.

---

## File Structure

```
src/main/s3/pool.ts            # CREATE: runPool<T> (extracted from sync.ts)
src/main/s3/sync.ts            # MODIFY: import runPool from ./pool (remove local copy)
src/main/s3/localSync.ts       # CREATE: walkDir, contentTypeFor, LocalSyncArgs, planLocalSync, runLocalSync, uploadOne, downloadOne
src/main/ipc/channels.ts       # MODIFY: 3 channels + ApiMap + LocalSyncArgs import
src/main/ipc/register.ts       # MODIFY: 3 handlers + selectDirectory dep
src/main.ts                    # MODIFY: provide selectDirectory
src/preload.ts                 # MODIFY: localSyncPlan / localSyncRun / selectSyncDirectory
src/renderer/hooks/useLocalSync.ts                  # CREATE
src/renderer/components/sync/LocalFolderPicker.tsx  # CREATE
src/renderer/components/sync/LocalSyncScreen.tsx     # CREATE
src/renderer/components/sync/SyncSection.tsx         # CREATE
src/renderer/App.tsx           # MODIFY: render <SyncSection>
```

---

## Task 1: Extract runPool into a shared pool.ts

**Files:**
- Create: `src/main/s3/pool.ts`
- Create: `src/main/s3/pool.test.ts`
- Modify: `src/main/s3/sync.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/pool.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runPool } from './pool';

describe('runPool', () => {
  it('processes every item when there are more than the limit', async () => {
    const processed: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { processed.push(n); });
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/pool.test.ts`
Expected: FAIL — cannot find module `./pool`.

- [ ] **Step 3: Implement** — `src/main/s3/pool.ts`:

```ts
/** Run `worker` over `items` with at most `limit` in flight at once. */
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
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
```

Then in `src/main/s3/sync.ts`: delete the local `runPool` function (the `const CONCURRENCY = 6;` line stays) and add the import at the top alongside the other local imports:
```ts
import { runPool } from './pool';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/pool.test.ts src/main/s3/sync.test.ts`
Expected: PASS — `pool.test.ts` (2 tests) and the existing `sync.test.ts` (8 tests) all green. Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/pool.ts src/main/s3/pool.test.ts src/main/s3/sync.ts
git commit -m "refactor: extract runPool into shared pool.ts"
```

---

## Task 2: localSync.ts — walkDir + contentTypeFor

**Files:**
- Create: `src/main/s3/localSync.ts`
- Test: `src/main/s3/localSync.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/localSync.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkDir, contentTypeFor } from './localSync';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 's3m-walk-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('walkDir', () => {
  it('returns regular files with normalized relKeys and sizes', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello'); // 5 bytes
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b.txt'), 'hi'); // 2 bytes
    const out = (await walkDir(dir)).sort((x, y) => x.relKey.localeCompare(y.relKey));
    expect(out).toEqual([
      { relKey: 'a.txt', size: 5 },
      { relKey: 'sub/b.txt', size: 2 },
    ]);
  });

  it('returns an empty array for an empty directory', async () => {
    expect(await walkDir(dir)).toEqual([]);
  });
});

describe('contentTypeFor', () => {
  it('maps known extensions and returns undefined otherwise', () => {
    expect(contentTypeFor('logo.png')).toBe('image/png');
    expect(contentTypeFor('a/b/style.css')).toBe('text/css');
    expect(contentTypeFor('data.unknownext')).toBeUndefined();
    expect(contentTypeFor('noext')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/localSync.test.ts`
Expected: FAIL — cannot find module `./localSync`.

- [ ] **Step 3: Implement** — `src/main/s3/localSync.ts`:

```ts
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { SyncObject } from './syncDiff';

/** Recursively list regular files under `root` as SyncObjects (relKey uses '/'; dirs/symlinks skipped). */
export async function walkDir(root: string): Promise<SyncObject[]> {
  const out: SyncObject[] = [];
  async function recurse(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        const s = await stat(full);
        out.push({ relKey: relative(root, full).split(sep).join('/'), size: s.size });
      }
    }
  }
  await recurse(root);
  return out;
}

const MIME: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', zip: 'application/zip',
};

/** Best-effort Content-Type from a file's extension; undefined when unknown. */
export function contentTypeFor(name: string): string | undefined {
  const i = name.lastIndexOf('.');
  if (i === -1) return undefined;
  return MIME[name.slice(i + 1).toLowerCase()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/localSync.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/localSync.ts src/main/s3/localSync.test.ts
git commit -m "feat: add walkDir + contentTypeFor for local sync"
```

---

## Task 3: localSync.ts — planLocalSync + runLocalSync

**Files:**
- Modify: `src/main/s3/localSync.ts`
- Modify: `src/main/s3/localSync.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `src/main/s3/localSync.test.ts`. Add these imports at the top of the file (alongside the existing ones):

```ts
import { readFileSync, existsSync } from 'node:fs';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { planLocalSync, runLocalSync } from './localSync';

const s3Mock = mockClient(S3Client);
```

Add `beforeEach(() => s3Mock.reset());` (a second `beforeEach` is fine — Vitest runs both). Then append:

```ts
describe('planLocalSync (upload)', () => {
  it('counts local files missing on the bucket', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello'); // 5
    writeFileSync(join(dir, 'b.txt'), 'yo'); // 2
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    const r = await planLocalSync(new S3Client({}), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.toCopy).toBe(2);
      expect(r.data.bytesToCopy).toBe(7);
    }
  });
});

describe('runLocalSync (upload)', () => {
  it('uploads each local file to the bucket', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'b.txt'), 'yo');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});
    const r = await runLocalSync(new S3Client({ region: 'us-east-1' }), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: 'up/' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(2);
    const keys = s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Key).sort();
    expect(keys).toEqual(['up/a.txt', 'up/b.txt']);
  });

  it('an already-aborted signal copies nothing and reports canceled', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });
    s3Mock.on(PutObjectCommand).resolves({});
    const controller = new AbortController();
    controller.abort();
    const r = await runLocalSync(new S3Client({ region: 'us-east-1' }), { direction: 'upload', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, { signal: controller.signal });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.data.canceled).toBe(true); expect(r.data.copied).toBe(0); }
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });
});

describe('runLocalSync (download)', () => {
  it('writes each bucket object to disk, creating parent dirs', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'x.txt', Size: 5 }, { Key: 'nested/y.txt', Size: 3 }] });
    s3Mock.on(GetObjectCommand, { Key: 'x.txt' }).resolves({ Body: Readable.from(Buffer.from('hello')) as never });
    s3Mock.on(GetObjectCommand, { Key: 'nested/y.txt' }).resolves({ Body: Readable.from(Buffer.from('yo!')) as never });
    const r = await runLocalSync(new S3Client({}), { direction: 'download', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.copied).toBe(2);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('hello');
    expect(readFileSync(join(dir, 'nested', 'y.txt'), 'utf8')).toBe('yo!');
  });

  it('records a per-object failure and still completes', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [{ Key: 'ok.txt', Size: 2 }, { Key: 'bad.txt', Size: 2 }] });
    s3Mock.on(GetObjectCommand, { Key: 'ok.txt' }).resolves({ Body: Readable.from(Buffer.from('hi')) as never });
    s3Mock.on(GetObjectCommand, { Key: 'bad.txt' }).rejects(new Error('AccessDenied'));
    const r = await runLocalSync(new S3Client({}), { direction: 'download', localPath: dir, remote: { accountId: 'x', bucket: 'b', prefix: '' } }, {});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.copied).toBe(1);
      expect(r.data.failed).toHaveLength(1);
      expect(r.data.failed[0].key).toBe('bad.txt');
    }
    expect(existsSync(join(dir, 'ok.txt'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/localSync.test.ts`
Expected: FAIL — `planLocalSync`/`runLocalSync` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/localSync.ts`, add imports and append the functions. New imports at the top:

```ts
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { diffListings, type SyncOp } from './syncDiff';
import { listAll, type Endpoint, type SyncPlan, type SyncResult, type SyncFailure, type SyncProgress } from './sync';
import { uploadObject, downloadObject, toErr } from './objects';
import { runPool } from './pool';
```
(Keep the existing `readdir, stat` import from `node:fs/promises`; you can merge `mkdir` into it. Keep `join, relative, sep`; add `dirname`.)

Append:

```ts
export interface LocalSyncArgs {
  direction: 'upload' | 'download';
  localPath: string;
  remote: Endpoint;
}

const SAMPLE_LIMIT = 100;
const CONCURRENCY = 6;

async function sides(client: S3Client, args: LocalSyncArgs): Promise<{ source: SyncObject[]; dest: SyncObject[] }> {
  const [local, remote] = await Promise.all([
    walkDir(args.localPath),
    listAll(client, args.remote.bucket, args.remote.prefix),
  ]);
  return args.direction === 'upload' ? { source: local, dest: remote } : { source: remote, dest: local };
}

export async function planLocalSync(client: S3Client, args: LocalSyncArgs): Promise<Result<SyncPlan>> {
  try {
    const { source, dest } = await sides(client, args);
    const ops = diffListings(source, dest);
    return ok({
      toCopy: ops.length,
      upToDate: source.length - ops.length,
      bytesToCopy: ops.reduce((n, o) => n + o.size, 0),
      sample: ops.slice(0, SAMPLE_LIMIT),
    });
  } catch (e) {
    return toErr(e);
  }
}

function throwIfErr(r: Result<unknown>): void {
  if (!r.ok) throw Object.assign(new Error(r.error.message), { name: r.error.code });
}

export async function uploadOne(client: S3Client, args: LocalSyncArgs, op: SyncOp): Promise<void> {
  const filePath = join(args.localPath, ...op.relKey.split('/'));
  throwIfErr(
    await uploadObject(client, {
      bucket: args.remote.bucket,
      key: args.remote.prefix + op.relKey,
      filePath,
      contentType: contentTypeFor(op.relKey),
    }),
  );
}

export async function downloadOne(client: S3Client, args: LocalSyncArgs, op: SyncOp): Promise<void> {
  const destPath = join(args.localPath, ...op.relKey.split('/'));
  await mkdir(dirname(destPath), { recursive: true });
  throwIfErr(await downloadObject(client, { bucket: args.remote.bucket, key: args.remote.prefix + op.relKey, destPath }));
}

export interface RunLocalSyncOptions {
  onProgress?: (p: SyncProgress) => void;
  signal?: AbortSignal;
}

export async function runLocalSync(
  client: S3Client,
  args: LocalSyncArgs,
  opts: RunLocalSyncOptions,
): Promise<Result<SyncResult>> {
  const { onProgress, signal } = opts;
  try {
    onProgress?.({ phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 });
    const { source, dest } = await sides(client, args);
    const ops = diffListings(source, dest);
    const total = ops.length;
    const bytesTotal = ops.reduce((n, o) => n + o.size, 0);
    const transfer = args.direction === 'upload' ? uploadOne : downloadOne;

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
        await transfer(client, args, op);
        copied += 1;
        bytesCopied += op.size;
        emit(op.relKey);
      } catch (e) {
        failed.push({
          key: op.relKey,
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

Run: `npx vitest run src/main/s3/localSync.test.ts`
Expected: PASS (9 tests total). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/localSync.ts src/main/s3/localSync.test.ts
git commit -m "feat: add planLocalSync + runLocalSync (upload/download)"
```

---

## Task 4: IPC wiring (channels + register + main + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add a type import near the other `../s3` type imports:
```ts
import type { LocalSyncArgs } from '../s3/localSync';
```
Add to `CH` (after `syncCancel`):
```ts
  localSyncPlan: 'sync:localPlan',
  localSyncRun: 'sync:localRun',
  selectDirectory: 'sync:selectDirectory',
```
Add to `ApiMap`:
```ts
  [CH.localSyncPlan]: { args: [LocalSyncArgs]; res: Result<SyncPlan> };
  [CH.localSyncRun]: { args: [LocalSyncArgs]; res: Result<SyncResult> };
  [CH.selectDirectory]: { args: []; res: Result<string | null> };
```
(`SyncPlan`/`SyncResult` are already imported in `channels.ts` from `../s3/sync`.)

- [ ] **Step 2: Add the failing test** — in `src/main/ipc/register.test.ts`:

First, update `buildHarness()`'s `deps` object to include the new dep (add this line next to `saveDialog`):
```ts
    selectDirectory: vi.fn().mockResolvedValue('/picked/dir'),
```
Also update the inline `deps` object in the atomicity test ("accounts:create is atomic …") to add the same `selectDirectory: vi.fn().mockResolvedValue('/picked/dir'),` line (so it still satisfies `RegisterDeps`). Ensure `mkdtempSync`, `writeFileSync` (already imported), and `ListObjectsV2Command` are imported (add `ListObjectsV2Command` to the `@aws-sdk/client-s3` import). Then append:

```ts
describe('local sync handlers', () => {
  it('sync:localPlan diffs a local directory against the bucket', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    const dir = mkdtempSync(join(tmpdir(), 's3m-lp-'));
    writeFileSync(join(dir, 'a.txt'), 'hello');
    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [] });

    const res = (await handlers.get(CH.localSyncPlan)!({
      direction: 'upload', localPath: dir, remote: { accountId: created.data.id, bucket: 'b', prefix: '' },
    })) as { ok: boolean; data: { toCopy: number } };
    expect(res.ok).toBe(true);
    expect(res.data.toCopy).toBe(1);
  });

  it('sync:selectDirectory returns the chosen path from the dialog dep', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.selectDirectory)!()) as { ok: boolean; data: string | null };
    expect(res).toEqual({ ok: true, data: '/picked/dir' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `sync:localPlan`/`sync:selectDirectory` (and the every-channel test fails for the 3 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`:
- Add the engine import:
```ts
import { planLocalSync, runLocalSync } from '../s3/localSync';
```
- Add the dep to `RegisterDeps`:
```ts
  /** Shows a native folder picker; resolves the chosen directory, or null if cancelled. */
  selectDirectory: () => Promise<string | null>;
```
- After the existing `sync:cancel` handler (and reusing the same `activeSync` declared for `sync:run`), add:
```ts
  h(CH.localSyncPlan, (a: LocalSyncArgs) => planLocalSync(clientFor(a.remote.accountId), a));

  ipcMain.handle(CH.localSyncRun, async (event, ...args) => {
    const a = args[0] as LocalSyncArgs;
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    const controller = new AbortController();
    activeSync?.abort();
    activeSync = controller;
    try {
      return await runLocalSync(clientFor(a.remote.accountId), a, {
        signal: controller.signal,
        onProgress: (p) => sender.send(SYNC_PROGRESS_CHANNEL, p),
      });
    } catch (e) {
      return toErr(e);
    } finally {
      if (activeSync === controller) activeSync = null;
    }
  });

  h(CH.selectDirectory, async () => ok(await deps.selectDirectory()));
```
Add the `LocalSyncArgs` type import:
```ts
import type { LocalSyncArgs } from '../s3/localSync';
```
(`activeSync`, `SYNC_PROGRESS_CHANNEL`, `ok`, `toErr` are already in scope from the bucket-sync wiring.)

In `src/main.ts`, inside `initBackend()` after `saveDialog`:
```ts
  const selectDirectory = async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  };
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog, selectDirectory });
```
(Change the existing `registerIpc(...)` call to include `selectDirectory`.)

In `src/preload.ts`, add to the `api` object (next to `cancelSync`):
```ts
  localSyncPlan: (a: ApiMap[typeof CH.localSyncPlan]['args'][0]) => invoke(CH.localSyncPlan, a),
  localSyncRun: (a: ApiMap[typeof CH.localSyncRun]['args'][0]) => invoke(CH.localSyncRun, a),
  selectSyncDirectory: () => invoke(CH.selectDirectory),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test for all 28 channels). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire local sync IPC channels + folder picker dialog"
```

---

## Task 5: useLocalSync hook

**Files:**
- Create: `src/renderer/hooks/useLocalSync.ts`
- Test: `src/renderer/hooks/useLocalSync.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useLocalSync.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useLocalSync } from './useLocalSync';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const args = { direction: 'upload' as const, localPath: '/data', remote: { accountId: 'a', bucket: 'b', prefix: '' } };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 1, bytesToCopy: 100, sample: [] } }),
    localSyncRun: vi.fn().mockResolvedValue({ ok: true, data: { copied: 2, bytesCopied: 100, failed: [], canceled: false } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('useLocalSync', () => {
  it('plan calls window.s3.localSyncPlan', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync(args);
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith(args);
    expect(plan.toCopy).toBe(2);
  });

  it('run subscribes to progress, calls localSyncRun, and resolves with the result', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    let res!: { copied: number };
    await act(async () => { res = await result.current.run(args); });
    expect(window.s3.onSyncProgress).toHaveBeenCalled();
    expect(window.s3.localSyncRun).toHaveBeenCalledWith(args);
    expect(res.copied).toBe(2);
  });

  it('cancel calls window.s3.cancelSync', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    await act(async () => { result.current.cancel(); });
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useLocalSync.test.tsx`
Expected: FAIL — cannot find module `./useLocalSync`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useLocalSync.ts`:

```ts
import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { SyncPlan, SyncResult, SyncProgress } from '../../main/s3/sync';
import type { LocalSyncArgs } from '../../main/s3/localSync';

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

export function useLocalSync() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const plan = useMutation({
    mutationFn: async (v: LocalSyncArgs): Promise<SyncPlan> => unwrap(await window.s3.localSyncPlan(v)),
  });

  const run = useCallback(async (v: LocalSyncArgs): Promise<SyncResult> => {
    setProgress(LISTING);
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    try {
      return unwrap(await window.s3.localSyncRun(v));
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

Run: `npx vitest run src/renderer/hooks/useLocalSync.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useLocalSync.ts src/renderer/hooks/useLocalSync.test.tsx
git commit -m "feat(ui): add useLocalSync hook"
```

---

## Task 6: LocalFolderPicker

**Files:**
- Create: `src/renderer/components/sync/LocalFolderPicker.tsx`
- Test: `src/renderer/components/sync/LocalFolderPicker.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/LocalFolderPicker.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalFolderPicker } from './LocalFolderPicker';

describe('LocalFolderPicker', () => {
  it('calls selectSyncDirectory and reports the chosen path', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: '/picked/dir' }),
    };
    const onPick = vi.fn();
    render(<LocalFolderPicker path={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/picked/dir'));
  });

  it('shows the current path and does not call onPick when the dialog is cancelled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: null }),
    };
    const onPick = vi.fn();
    render(<LocalFolderPicker path="/data/photos" onPick={onPick} />);
    expect(screen.getByText('/data/photos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/LocalFolderPicker.test.tsx`
Expected: FAIL — cannot find module `./LocalFolderPicker`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/LocalFolderPicker.tsx`:

```tsx
import { unwrap } from '../../lib/result';

export function LocalFolderPicker({
  path,
  onPick,
}: {
  path: string | null;
  onPick: (p: string) => void;
}) {
  const choose = async () => {
    const picked = unwrap(await window.s3.selectSyncDirectory());
    if (picked) onPick(picked);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
        onClick={choose}
      >
        Choose folder…
      </button>
      <span className="truncate text-sm text-slate-600">{path ?? 'No folder chosen'}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/LocalFolderPicker.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/LocalFolderPicker.tsx src/renderer/components/sync/LocalFolderPicker.test.tsx
git commit -m "feat(ui): add LocalFolderPicker"
```

---

## Task 7: LocalSyncScreen

**Files:**
- Create: `src/renderer/components/sync/LocalSyncScreen.tsx`
- Test: `src/renderer/components/sync/LocalSyncScreen.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/LocalSyncScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { LocalSyncScreen } from './LocalSyncScreen';

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
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', label: 'AWS' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: '/data' }),
    onSyncProgress: vi.fn(() => () => {}),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

async function chooseFolderAndBucket() {
  await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
  await screen.findByText('/data');
  await screen.findByRole('option', { name: 'AWS' });
  await userEvent.selectOptions(screen.getByLabelText('Bucket account'), 'a1');
  await userEvent.selectOptions(await screen.findByLabelText('Bucket bucket'), 'assets');
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('LocalSyncScreen', () => {
  it('Preview shows the plan summary and sends upload args', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 0, bytesToCopy: 50, sample: [] } }),
    });
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    await chooseFolderAndBucket();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/2 to copy/)).toBeInTheDocument();
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith({
      direction: 'upload', localPath: '/data', remote: { accountId: 'a1', bucket: 'assets', prefix: '' },
    });
  });

  it('toggles the direction to download', async () => {
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    const dl = screen.getByRole('button', { name: 'Download (bucket → local)' });
    await userEvent.click(dl);
    expect(dl).toHaveAttribute('aria-pressed', 'true');
  });

  it('an empty plan disables Run sync', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 0, upToDate: 3, bytesToCopy: 0, sample: [] } }),
    });
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    await chooseFolderAndBucket();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Already in sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/LocalSyncScreen.test.tsx`
Expected: FAIL — cannot find module `./LocalSyncScreen`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/LocalSyncScreen.tsx`:

```tsx
import { useState } from 'react';
import { useLocalSync } from '../../hooks/useLocalSync';
import { useToast } from '../ui/ToastProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import { LocalFolderPicker } from './LocalFolderPicker';
import type { SyncPlan, SyncResult } from '../../../main/s3/sync';
import type { LocalSyncArgs } from '../../../main/s3/localSync';

export function LocalSyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [direction, setDirection] = useState<'upload' | 'download'>('upload');
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [remote, setRemote] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const lsync = useLocalSync();
  const { show } = useToast();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [running, setRunning] = useState(false);

  const ready = !!(localPath && remote.accountId && remote.bucket);
  const canPreview = ready && !running && !lsync.plan.isPending;
  const clearOutputs = () => { setPlan(null); setResult(null); };

  const toArgs = (): LocalSyncArgs => ({
    direction,
    localPath: localPath!,
    remote: { accountId: remote.accountId!, bucket: remote.bucket!, prefix: remote.prefix },
  });

  const onPreview = async () => {
    setResult(null);
    try {
      setPlan(await lsync.plan.mutateAsync(toArgs()));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await lsync.run(toArgs());
      setResult(r);
      setPlan(null);
      show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`);
    } catch (e) {
      show((e as Error).message, 'error');
    } finally {
      setRunning(false);
      lsync.resetProgress();
    }
  };

  const dirBtn = (d: 'upload' | 'download', label: string) => (
    <button
      type="button"
      aria-pressed={direction === d}
      onClick={() => { setDirection(d); clearOutputs(); }}
      className={`rounded border px-3 py-1 text-sm ${direction === d ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (local ↔ bucket)</h2>

      <div className="flex gap-2 pb-4">
        {dirBtn('upload', 'Upload (local → bucket)')}
        {dirBtn('download', 'Download (bucket → local)')}
      </div>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-slate-700">Local folder</h3>
          <LocalFolderPicker path={localPath} onPick={(p) => { setLocalPath(p); clearOutputs(); }} />
        </div>
        <EndpointPicker label="Bucket" value={remote} onChange={(v) => { setRemote(v); clearOutputs(); }} />
      </div>

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
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={lsync.cancel}>
            Cancel
          </button>
        )}
      </div>

      {lsync.plan.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !running && (
        <div className="mt-4 rounded border border-slate-200 p-3">
          {plan.toCopy === 0 ? (
            <p className="text-slate-600">Already in sync — nothing to copy ({plan.upToDate} up-to-date).</p>
          ) : (
            <p className="text-slate-700">{plan.toCopy} to copy · {plan.upToDate} up-to-date · {formatBytes(plan.bytesToCopy)} to transfer</p>
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

      {running && lsync.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {lsync.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{lsync.progress.copied} / {lsync.progress.total} objects · {formatBytes(lsync.progress.bytesCopied)} / {formatBytes(lsync.progress.bytesTotal)}</p>
              {lsync.progress.currentKey && <p className="truncate text-xs text-slate-400">{lsync.progress.currentKey}</p>}
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

Run: `npx vitest run src/renderer/components/sync/LocalSyncScreen.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/LocalSyncScreen.tsx src/renderer/components/sync/LocalSyncScreen.test.tsx
git commit -m "feat(ui): add LocalSyncScreen"
```

---

## Task 8: SyncSection mode toggle + App wiring

**Files:**
- Create: `src/renderer/components/sync/SyncSection.tsx`
- Create: `src/renderer/components/sync/SyncSection.test.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/SyncSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncSection } from './SyncSection';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('SyncSection', () => {
  it('shows bucket sync by default and toggles to local sync', async () => {
    wrap(<SyncSection initialAccountId={null} initialBucket={null} />);
    expect(screen.getByText('Sync (bucket → bucket)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Local ↔ Bucket' }));
    expect(screen.getByText('Sync (local ↔ bucket)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/SyncSection.test.tsx`
Expected: FAIL — cannot find module `./SyncSection`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/SyncSection.tsx`:

```tsx
import { useState } from 'react';
import { SyncScreen } from './SyncScreen';
import { LocalSyncScreen } from './LocalSyncScreen';

export function SyncSection({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [mode, setMode] = useState<'bucket' | 'local'>('bucket');

  const tab = (m: 'bucket' | 'local', label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`rounded px-3 py-1 text-sm ${mode === m ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-200 p-2">
        {tab('bucket', 'Bucket → Bucket')}
        {tab('local', 'Local ↔ Bucket')}
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === 'bucket' ? (
          <SyncScreen initialAccountId={initialAccountId} initialBucket={initialBucket} />
        ) : (
          <LocalSyncScreen initialAccountId={initialAccountId} initialBucket={initialBucket} />
        )}
      </div>
    </div>
  );
}
```

In `src/renderer/App.tsx`:
- Replace the import `import { SyncScreen } from './components/sync/SyncScreen';` with:
```tsx
import { SyncSection } from './components/sync/SyncSection';
```
- Replace the sync branch body `<SyncScreen initialAccountId={accountId} initialBucket={bucket} />` with:
```tsx
            <SyncSection initialAccountId={accountId} initialBucket={bucket} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/SyncSection.test.tsx src/renderer/App.test.tsx`
Expected: PASS (SyncSection 1 test; App tests stay green — the existing "shows the Sync screen" test still finds `Sync (bucket → bucket)` because SyncSection defaults to bucket mode). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/SyncSection.tsx src/renderer/components/sync/SyncSection.test.tsx src/renderer/App.tsx
git commit -m "feat(ui): add Sync mode toggle (bucket vs local)"
```

---

## Manual smoke checklist (after Task 8)

`npm start` (full restart — main-process IPC handlers changed), with an account + a writable bucket and a local folder of test files:
1. Open **Sync** → switch to **Local ↔ Bucket**.
2. **Upload**: direction Upload, choose a local folder, pick a bucket → **Preview** shows the plan (N to copy, bytes) → **Run sync** → progress → files appear in the bucket.
3. Re-run Preview after a successful upload → "Already in sync".
4. **Download**: switch to Download, choose an (empty) local folder, pick a bucket with objects → Preview → Run → files (and nested folders) appear on disk.
5. Cancel a large run → it stops; summary shows the partial copied count.
6. Toggle back to **Bucket → Bucket** → the bucket sync screen still works.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-local-sync-design.md`):**
- Shared `runPool` extracted to `pool.ts`; `sync.ts` imports it → Task 1. ✅
- `walkDir` (recursive, regular-files-only, `/`-normalized) + `contentTypeFor` → Task 2. ✅
- `LocalSyncArgs`, `planLocalSync`, `runLocalSync` (direction-aware), `uploadOne`/`downloadOne` (mkdir -p for download), per-object error isolation, cancel → Task 3. ✅
- IPC `sync:localPlan`/`sync:localRun`/`sync:selectDirectory`, reuse of `sync:cancel` + progress channel, `selectDirectory` dep in register + main → Task 4. ✅
- `useLocalSync` → Task 5. `LocalFolderPicker` → Task 6. `LocalSyncScreen` (direction toggle, pickers, preview/run/progress/summary) → Task 7. `SyncSection` mode toggle + App wiring → Task 8. ✅
- Additive-only / size-diff / preview-then-run semantics inherited via reused `diffListings` + the plan/run shape. ✅
- States/validation (preview gated on folder + remote; one run at a time via shared `activeSync`) and error handling (walk/list error → Result; per-file failure collected; download mkdir; cancel) → Tasks 3, 7. ✅
- Out of scope (delete/mirror, two-way, mtime/checksum, symlinks, persistence, concurrent runs) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. The MODIFY tasks (1, 4, 8) give exact insertion points and the surrounding existing code.

**Type consistency:** `LocalSyncArgs` (`{ direction, localPath, remote: Endpoint }`) is defined once in `localSync.ts` (Task 3) and imported by `channels.ts`/`register.ts` (Task 4), `useLocalSync` (Task 5), and `LocalSyncScreen` (Task 7). `runPool` signature is identical between `pool.ts` (Task 1) and its previous `sync.ts` definition. `walkDir`/`contentTypeFor` (Task 2) are used by `sides`/`uploadOne` (Task 3). `SyncPlan`/`SyncResult`/`SyncProgress`/`SyncFailure`/`SyncObject`/`SyncOp`/`Endpoint` are reused from the existing `sync.ts`/`syncDiff.ts` — not redefined. `window.s3.localSyncPlan/localSyncRun/selectSyncDirectory` names match across preload (Task 4), the hook (Task 5), and the picker (Task 6). The reused `onSyncProgress`/`cancelSync` keep their existing shapes. EndpointPicker aria-labels with `label="Bucket"` resolve to `"Bucket account"`/`"Bucket bucket"` — matched by the LocalSyncScreen test.

**Notes for implementers:** Task 1 must keep `sync.test.ts` green (behavior-preserving extraction). Task 4 adds main-process handlers and a new `RegisterDeps` field, so `buildHarness()` (and the inline deps in the atomicity test) MUST gain `selectDirectory` or `tsc`/tests break — this is called out in the task. The cross-process lib-storage upload test constructs the client with `new S3Client({ region: 'us-east-1' })` (same gotcha as the bucket-sync upload tests). After Task 4, the manual smoke needs a full `npm start` restart.
