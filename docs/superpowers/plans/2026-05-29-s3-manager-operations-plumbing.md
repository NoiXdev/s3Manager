# S3 Manager — Operations Plumbing (Plan 2b-2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the main-process + preload plumbing the operations UI needs: a byte-level upload-progress event channel, a native save-dialog-driven download (dependency-injected so the IPC layer stays unit-testable), and a dropped-file path bridge.

**Architecture:** Extend the existing `window.s3` bridge. Upload progress flows one-way main→renderer via `webContents.send` on a dedicated event channel, wired to `uploadObject`'s existing `onProgress` callback; the renderer correlates events to files via a caller-supplied `uploadId`. The native save dialog is injected into `registerIpc` as a `saveDialog` dependency (created in `main.ts`, where Electron is available) so `register.ts` never imports `electron` and stays testable under Vitest. Dropped-file absolute paths are resolved in the preload via `webUtils.getPathForFile` (Electron 32+ replacement for the removed `File.path`).

**Tech Stack:** Electron 42 (`ipcMain`/`webContents`/`dialog`/`webUtils`), TypeScript, Vitest + `aws-sdk-client-mock`.

**Prerequisite:** Plans 1, 2a, 2b-1 merged. Current relevant code:
- `src/main/ipc/channels.ts` — `CH` constants + `ApiMap`. `uploadObject` args today: `{ accountId; bucket; key; filePath; contentType? }` → `Result<{ key: string }>`. `downloadObject` args today: `{ accountId; bucket; key; destPath }` → `Result<{ path: string }>`.
- `src/main/ipc/register.ts` — `registerIpc(ipcMain: IpcMainLike, deps: RegisterDeps)`. `RegisterDeps = { accounts, secrets, settings, crypto, db }`. Generic helper `h(channel, fn)` wraps `ipcMain.handle(channel, async (_e, ...args) => …)` and maps throws via `toErr`. Upload/download are currently registered via `h`.
- `src/main/s3/objects.ts` — `uploadObject(client, { bucket, key, filePath, contentType?, onProgress?(loaded, total) })`, `downloadObject(client, { bucket, key, destPath })`.
- `src/preload.ts` — typed `window.s3`; `uploadObject`/`downloadObject` forward `ApiMap[...]['args'][0]` to `invoke`.
- `src/main.ts` — `initBackend()` builds deps and calls `registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db })`.

---

## File Structure (all modifications)

```
src/main/ipc/channels.ts        # uploadObject args + uploadId; downloadObject args (drop destPath) + nullable path; UPLOAD_PROGRESS_CHANNEL + UploadProgress
src/main/ipc/register.ts        # upload handler emits progress via event.sender; download handler uses injected saveDialog; RegisterDeps.saveDialog
src/main/ipc/register.test.ts   # harness event with sender.send + saveDialog; upload + download tests
src/preload.ts                  # onUploadProgress subscription; getDropPath(file); download/upload arg types flow from ApiMap
src/main.ts                     # implement saveDialog via dialog.showSaveDialog; inject into registerIpc
```

No renderer files change in this plan; the UI consumes this in Plan 2b-2b.

---

## Task 1: Upload-progress event channel + `uploadId`

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/ipc/register.test.ts`
- Modify: `src/preload.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`, (a) add `uploadId: string` to the `uploadObject` args, and (b) append the event-channel constant + payload type after the `ApiMap` interface.

Change the `uploadObject` line in `ApiMap` to:
```ts
  [CH.uploadObject]: { args: [{ accountId: string; bucket: string; key: string; filePath: string; contentType?: string; uploadId: string }]; res: Result<{ key: string }> };
```

Append at the end of the file:
```ts
/** One-way main→renderer channel for upload progress (not an invoke channel,
 *  so intentionally not part of CH/ApiMap). */
export const UPLOAD_PROGRESS_CHANNEL = 's3:uploadProgress';

export interface UploadProgress {
  uploadId: string;
  loaded: number;
  total: number | null;
}
```

- [ ] **Step 2: Add the failing test** — in `src/main/ipc/register.test.ts`:

First update the fake `ipcMain` in `buildHarness` so each handler receives an event whose `sender.send` is recorded. Replace the existing `handlers`/`ipcMain` setup inside `buildHarness` with:
```ts
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const progressEvents: { channel: string; payload: unknown }[] = [];
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) =>
      handlers.set(channel, (...a) =>
        listener({ sender: { send: (c: string, p: unknown) => progressEvents.push({ channel: c, payload: p }) } }, ...a),
      ),
  };
```
and add `progressEvents` to the returned object: `return { handlers, deps, progressEvents };`

Then append this test (add `UPLOAD_PROGRESS_CHANNEL` to the `./channels` import, and these to the top-level imports if missing: `import { writeFileSync, mkdtempSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os'; import { PutObjectCommand } from '@aws-sdk/client-s3';`):
```ts
describe('uploadObject handler progress', () => {
  it('uploads and emits a progress event carrying the uploadId', async () => {
    const { handlers, progressEvents } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectCommand).resolves({});

    const dir = mkdtempSync(join(tmpdir(), 's3m-up-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello world');

    const res = (await handlers.get(CH.uploadObject)!({
      accountId: created.data.id, bucket: 'b', key: 'hello.txt', filePath: file, uploadId: 'up-1',
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(progressEvents.every((e) => e.channel === UPLOAD_PROGRESS_CHANNEL)).toBe(true);
    expect(progressEvents.every((e) => (e.payload as { uploadId: string }).uploadId === 'up-1')).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — the upload handler ignores the event and doesn't emit progress (and `uploadId`/`UPLOAD_PROGRESS_CHANNEL` wiring is absent).

- [ ] **Step 4: Implement** — in `src/main/ipc/register.ts`:

Add `UPLOAD_PROGRESS_CHANNEL` to the `./channels` import. Replace the existing `h(CH.uploadObject, …)` registration with a direct registration that uses the IPC event's `sender`:
```ts
  ipcMain.handle(CH.uploadObject, async (event, ...args) => {
    const a = args[0] as {
      accountId: string; bucket: string; key: string; filePath: string; contentType?: string; uploadId: string;
    };
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    try {
      return await uploadObject(clientFor(a.accountId), {
        bucket: a.bucket,
        key: a.key,
        filePath: a.filePath,
        contentType: a.contentType,
        onProgress: (loaded, total) =>
          sender.send(UPLOAD_PROGRESS_CHANNEL, { uploadId: a.uploadId, loaded, total: total ?? null }),
      });
    } catch (e) {
      return toErr(e);
    }
  });
```
(Leave all other `h(...)` registrations as they are.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS. (The small file may emit one or more progress events; the assertions only require that any emitted events use the right channel and `uploadId`, and that the upload resolves ok.)

- [ ] **Step 6: Add the preload subscription** — in `src/preload.ts`:

Add to the imports:
```ts
import { CH, UPLOAD_PROGRESS_CHANNEL } from './main/ipc/channels';
import type { ApiMap, UploadProgress } from './main/ipc/channels';
```
(Merge with the existing `CH`/`ApiMap` imports — do not duplicate.)

Add this method to the `api` object (e.g. after `uploadObject`):
```ts
  onUploadProgress: (cb: (progress: UploadProgress) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload as UploadProgress);
    ipcRenderer.on(UPLOAD_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPLOAD_PROGRESS_CHANNEL, listener);
  },
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: 0 errors.
Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/preload.ts
git commit -m "feat: add upload-progress IPC event channel with uploadId correlation"
```

---

## Task 2: Download via injected native save dialog

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/ipc/register.test.ts`
- Modify: `src/main.ts`

The renderer can't open a native dialog, and `register.ts` must not import `electron` (so it stays Vitest-loadable). So the dialog is a `saveDialog` dependency injected from `main.ts`; the download handler asks it for a path, then streams to it. A cancelled dialog returns `{ path: null }`.

- [ ] **Step 1: Update the contract** — in `src/main/ipc/channels.ts`, change the `downloadObject` line in `ApiMap` to drop `destPath` and allow a null path (cancelled):
```ts
  [CH.downloadObject]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<{ path: string | null }> };
```

- [ ] **Step 2: Add the failing test** — in `src/main/ipc/register.test.ts`:

Update `buildHarness` to give `deps` a default `saveDialog` mock. Add `saveDialog: vi.fn().mockResolvedValue(null)` to the `deps` object literal in `buildHarness`. Then append (add `GetObjectCommand` to the `@aws-sdk/client-s3` import, `Readable` via `import { Readable } from 'node:stream';`, and `readFileSync` to the `node:fs` import):
```ts
describe('downloadObject handler', () => {
  it('returns { path: null } and performs no download when the save dialog is cancelled', async () => {
    const { handlers, deps } = buildHarness();
    (deps.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.downloadObject)!({ accountId: created.data.id, bucket: 'b', key: 'x.txt' })) as {
      ok: boolean; data: { path: string | null };
    };
    expect(res).toEqual({ ok: true, data: { path: null } });
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
  });

  it('downloads to the chosen path when the dialog returns one', async () => {
    const { handlers, deps } = buildHarness();
    const dir = mkdtempSync(join(tmpdir(), 's3m-dl-'));
    const dest = join(dir, 'out.txt');
    (deps.saveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(dest);
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('payload')]) as never });
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.downloadObject)!({ accountId: created.data.id, bucket: 'b', key: 'docs/out.txt' })) as {
      ok: boolean; data: { path: string | null };
    };
    expect(res).toEqual({ ok: true, data: { path: dest } });
    expect(readFileSync(dest, 'utf8')).toBe('payload');
    expect(deps.saveDialog).toHaveBeenCalledWith('out.txt'); // default name = basename(key)
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `deps.saveDialog` isn't part of `RegisterDeps` yet and the download handler still expects `destPath`.

- [ ] **Step 4: Implement** — in `src/main/ipc/register.ts`:

Add `import { basename } from 'node:path';` at the top. Add `saveDialog` to `RegisterDeps`:
```ts
export interface RegisterDeps {
  accounts: AccountsRepo;
  secrets: SecretsStore;
  settings: SettingsRepo;
  crypto: Crypto;
  db: DB;
  /** Shows a native save dialog; resolves the chosen path, or null if cancelled. */
  saveDialog: (defaultFileName: string) => Promise<string | null>;
}
```
Replace the existing `h(CH.downloadObject, …)` registration with:
```ts
  h(CH.downloadObject, async (a: { accountId: string; bucket: string; key: string }) => {
    const dest = await deps.saveDialog(basename(a.key));
    if (!dest) return ok({ path: null });
    const r = await downloadObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key, destPath: dest });
    return r.ok ? ok({ path: dest as string | null }) : r;
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (both download tests + everything else).

- [ ] **Step 6: Provide the real dialog** — in `src/main.ts`:

Add `dialog` to the `electron` import:
```ts
import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';
```
Inside `initBackend()`, define `saveDialog` and pass it into `registerIpc`:
```ts
  const saveDialog = async (defaultFileName: string): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultFileName })
      : await dialog.showSaveDialog({ defaultPath: defaultFileName });
    return result.canceled || !result.filePath ? null : result.filePath;
  };
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog });
```
(Replace the existing `registerIpc(ipcMain, { … })` call with the one above.)

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit`
Expected: 0 errors.
Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/main.ts
git commit -m "feat: download via injected native save dialog (renderer-driven, cancellable)"
```

---

## Task 3: Dropped-file path bridge

**Files:**
- Modify: `src/preload.ts`

In a sandboxed Electron renderer, `File.path` is unavailable; `webUtils.getPathForFile(file)` (called in the preload) returns the absolute path for a dropped/selected `File`, which the upload flow needs. This is preload-only Electron glue with no Vitest coverage; it is verified by `tsc` and the app-boot smoke check.

- [ ] **Step 1: Implement** — in `src/preload.ts`:

Add `webUtils` to the `electron` import:
```ts
import { contextBridge, ipcRenderer, webUtils } from 'electron';
```
Add this method to the `api` object (e.g. after `onUploadProgress`):
```ts
  /** Resolve the absolute filesystem path of a dropped/selected File (sandbox-safe). */
  getDropPath: (file: File) => webUtils.getPathForFile(file),
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. (`webUtils.getPathForFile` is typed by Electron; `File` is in the DOM lib already enabled in `tsconfig`.)

- [ ] **Step 3: Full suite**

Run: `npm test`
Expected: all pass (no behavior change for existing tests).

- [ ] **Step 4: App-boot smoke check**

Run: `npm start`
Expected: the app launches with no main-process errors and the renderer loads (the Files view from Plan 2b-1). This confirms the expanded preload (`onUploadProgress`, `getDropPath`) and the `saveDialog`-wired `registerIpc` initialize without throwing. Quit the app after confirming.
(Note: `npm start` does not rebuild any native module now — the DB is WASM — so `npm test` continues to work afterward.)

- [ ] **Step 5: Commit**

```bash
git add src/preload.ts
git commit -m "feat: expose getDropPath (webUtils) for sandbox-safe drag-drop uploads"
```

---

## Self-Review

**Spec coverage (this plan = plumbing for the operations the spec's Files view lists):**
- Drag-and-drop upload, multi-file, with per-file **progress** → upload-progress event channel + `uploadId` correlation (Task 1). The UI/queue is Plan 2b-2b. ✅ (plumbing)
- **Download** files (native save dialog → streamed to disk) → injected `saveDialog` + handler (Task 2). ✅ (plumbing)
- Sandbox-safe local file paths for drag-drop → `getDropPath` (Task 3). ✅
- Copy presigned GET URL, delete file/folder → already fully supported by existing `presignGet`/`deleteObject`/`deleteFolder` channels (Plan 1); **no plumbing needed**, wired in the UI in Plan 2b-2b. (Not a gap.)

**Key design decisions (documented):**
- The save dialog is **injected** (`RegisterDeps.saveDialog`) rather than imported from `electron` in `register.ts`, so the IPC layer remains importable/testable under Vitest's Node environment. `main.ts` supplies the real Electron implementation.
- The progress channel is a **separate exported constant** (`UPLOAD_PROGRESS_CHANNEL`), deliberately not added to `CH`/`ApiMap`, so it isn't an invoke channel and the "every CH channel has a handler" test stays valid.
- `downloadObject` returns `{ path: string | null }` — `null` cleanly signals a user-cancelled dialog (no error, no download).
- `uploadObject` gains a caller-supplied `uploadId` so the renderer can correlate streamed progress events to the right file in a multi-file drop.

**Placeholder scan:** none — every step has complete, runnable code/commands. `getDropPath` and `onUploadProgress` are preload Electron glue verified by `tsc` + the boot smoke check (they can't run under jsdom/Node), which is the honest verification path for preload code.

**Type consistency:** `UPLOAD_PROGRESS_CHANNEL`/`UploadProgress`, the new `uploadObject` args (with `uploadId`), the `downloadObject` args (`{accountId,bucket,key}`) and `Result<{ path: string | null }>`, and `RegisterDeps.saveDialog: (defaultFileName: string) => Promise<string | null>` are defined once and referenced consistently across `channels.ts`, `register.ts`, `preload.ts`, `main.ts`, and the tests. The download handler maps the underlying `downloadObject` op's `Result<{ path: string }>` into the channel's `Result<{ path: string | null }>`.
