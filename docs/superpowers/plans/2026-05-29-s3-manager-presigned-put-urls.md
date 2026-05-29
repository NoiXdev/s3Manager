# S3 Manager — Presigned Upload (PUT) URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a time-limited, credential-free presigned PUT URL for uploading a file to a chosen key, via an "Upload link…" dialog in the File Manager.

**Architecture:** Add `presignPutUrl` to `objects.ts` (mirrors `presignGetUrl`, signs a bare `PutObjectCommand`), expose it over an `s3:presignPut` IPC channel, and add a FileBrowser toolbar "Upload link…" button that opens a dialog (filename + expiry → generate → show & copy the URL).

**Tech Stack:** AWS SDK v3 (`PutObjectCommand`, `@aws-sdk/s3-request-presigner` `getSignedUrl`), Electron IPC, React 19, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/objects.ts` already imports `getSignedUrl` from `@aws-sdk/s3-request-presigner` and exports `presignGetUrl(client, { bucket, key, expiresIn }): Promise<Result<string>>` = `getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn })`. Its `@aws-sdk/client-s3` import does NOT include `PutObjectCommand` (add it). `ok`/`toErr`/`Result` are available there.
- `getSignedUrl` computes the URL offline from the client's region + credentials (no network, no `.send`), so `aws-sdk-client-mock` does not affect it; a test just needs a client built with explicit `region` + `credentials`.
- `src/main/ipc/channels.ts`: `CH.presignGet = 's3:presignGet'`; `[CH.presignGet]: { args: [{ accountId; bucket; key; expiresIn: number }]; res: Result<string> }`.
- `src/main/ipc/register.ts`: imports from `../s3/objects` include `presignGetUrl`; `h(CH.presignGet, (a) => presignGetUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }))`.
- `src/preload.ts`: `presignGet: (a: ApiMap[typeof CH.presignGet]['args'][0]) => invoke(CH.presignGet, a)`.
- `register.test.ts`: `buildHarness()` → `{ handlers }`; `handlers.get(CH.accountsCreate)!({ label, provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' })` creates an account whose `clientFor` client has those credentials + region.
- `src/renderer/components/files/FileBrowser.tsx`: header toolbar is `<div className="flex items-center justify-between border-b border-slate-200 p-2">` with `<Breadcrumb …/>` + a single "New folder" `<button onClick={() => setNewFolderOpen(true)}>`. State hooks (`newFolderOpen`, etc.) are declared ~lines 34–39, after `const { show } = useToast()`. The component early-returns when `bucket === null`, so below that `accountId`/`bucket` are effectively non-null but typed `string | null` (existing code passes `accountId ?? ''`). Dialog blocks (`{newFolderOpen && (<NameDialog …/>)}`) live near the end of the JSX.
- `FileBrowser.test.tsx` renders within a `ToastProvider` (the existing MoveDialog/NameDialog tests rely on `useToast`).
- Renderer dialogs call `window.s3` directly and use `useToast()` from `../ui/ToastProvider`. `navigator.clipboard.writeText` is the copy mechanism (see `useObjectActions.copyPresignedUrl`).

---

## File Structure

```
src/main/s3/objects.ts            # MODIFY: + presignPutUrl
src/main/ipc/channels.ts          # MODIFY: + CH.presignPut + ApiMap entry
src/main/ipc/register.ts          # MODIFY: + handler
src/preload.ts                    # MODIFY: + presignPut method
src/renderer/components/files/UploadLinkDialog.tsx       # CREATE
src/renderer/components/files/FileBrowser.tsx            # MODIFY: + "Upload link…" button + dialog
```

---

## Task 1: objects.ts — presignPutUrl

**Files:**
- Modify: `src/main/s3/objects.ts`
- Modify: `src/main/s3/objects.test.ts`

- [ ] **Step 1: Add the failing test** — append to `src/main/s3/objects.test.ts` (ensure `S3Client` is imported from `@aws-sdk/client-s3` — it already is — and add `presignPutUrl` to the `./objects` import):

```ts
describe('presignPutUrl', () => {
  it('returns a signed https PUT URL for the key with the requested expiry', async () => {
    const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' } });
    const r = await presignPutUrl(client, { bucket: 'b', key: 'images/report.pdf', expiresIn: 3600 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toMatch(/^https:\/\//);
      expect(r.data).toContain('report.pdf');
      expect(r.data).toContain('X-Amz-Expires=3600');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: FAIL — `presignPutUrl` not exported.

- [ ] **Step 3: Implement** — in `src/main/s3/objects.ts`: add `PutObjectCommand` to the `@aws-sdk/client-s3` import, then add beside `presignGetUrl`:

```ts
export async function presignPutUrl(
  client: S3Client,
  args: { bucket: string; key: string; expiresIn: number },
): Promise<Result<string>> {
  try {
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: args.bucket, Key: args.key }),
      { expiresIn: args.expiresIn },
    );
    return ok(url);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: PASS (the new test + existing). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/objects.test.ts
git commit -m "feat: add presignPutUrl (presigned upload URL)"
```

---

## Task 2: IPC wiring (channel + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add to `CH` (after `presignGet`):
```ts
  presignPut: 's3:presignPut',
```
Add to `ApiMap`:
```ts
  [CH.presignPut]: { args: [{ accountId: string; bucket: string; key: string; expiresIn: number }]; res: Result<string> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts`:

```ts
describe('presignPut handler', () => {
  it('s3:presignPut returns a signed upload URL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };

    const res = (await handlers.get(CH.presignPut)!({
      accountId: created.data.id, bucket: 'b', key: 'k.txt', expiresIn: 86400,
    })) as { ok: boolean; data: string };
    expect(res.ok).toBe(true);
    expect(res.data).toMatch(/^https:\/\//);
    expect(res.data).toContain('X-Amz-Expires=86400');
  });
});
```
(No `s3Mock` setup needed — presigning does not call `.send`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handler for `s3:presignPut` (and the every-channel test fails for the new channel).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`: add `presignPutUrl` to the `../s3/objects` import, and register the handler next to the `presignGet` one:
```ts
  h(CH.presignPut, (a: { accountId: string; bucket: string; key: string; expiresIn: number }) =>
    presignPutUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }),
  );
```

In `src/preload.ts`, add next to `presignGet`:
```ts
  presignPut: (a: ApiMap[typeof CH.presignPut]['args'][0]) => invoke(CH.presignPut, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire s3:presignPut IPC channel"
```

---

## Task 3: UploadLinkDialog

**Files:**
- Create: `src/renderer/components/files/UploadLinkDialog.tsx`
- Test: `src/renderer/components/files/UploadLinkDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/UploadLinkDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { UploadLinkDialog } from './UploadLinkDialog';

function wrap(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    presignPut: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed.example/upload?X-Amz-Expires=3600' }),
  };
});

describe('UploadLinkDialog', () => {
  it('disables Generate until a valid filename is entered', async () => {
    wrap(<UploadLinkDialog accountId="a" bucket="b" prefix="images/" onClose={() => {}} />);
    const gen = screen.getByRole('button', { name: 'Generate link' });
    expect(gen).toBeDisabled();
    await userEvent.type(screen.getByLabelText('File name'), 'a/b'); // slash invalid
    expect(gen).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('File name'));
    await userEvent.type(screen.getByLabelText('File name'), 'report.pdf');
    expect(gen).toBeEnabled();
  });

  it('generates a presigned PUT URL for prefix+filename and copies it', async () => {
    wrap(<UploadLinkDialog accountId="acc-1" bucket="assets" prefix="images/" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('File name'), 'report.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await waitFor(() =>
      expect(window.s3.presignPut).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'images/report.pdf', expiresIn: 3600 }),
    );
    const urlField = await screen.findByLabelText('Upload URL');
    expect(urlField).toHaveValue('https://signed.example/upload?X-Amz-Expires=3600');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed.example/upload?X-Amz-Expires=3600');
  });

  it('uses the chosen expiry', async () => {
    wrap(<UploadLinkDialog accountId="a" bucket="b" prefix="" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('File name'), 'f.bin');
    await userEvent.selectOptions(screen.getByLabelText('Expiry'), '604800');
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await waitFor(() =>
      expect(window.s3.presignPut).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'f.bin', expiresIn: 604800 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/UploadLinkDialog.test.tsx`
Expected: FAIL — cannot find module `./UploadLinkDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/UploadLinkDialog.tsx`:

```tsx
import { useState } from 'react';
import { useToast } from '../ui/ToastProvider';

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

export function UploadLinkDialog({
  accountId,
  bucket,
  prefix,
  onClose,
}: {
  accountId: string;
  bucket: string;
  prefix: string;
  onClose: () => void;
}) {
  const { show } = useToast();
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState(3600);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed !== '' && !trimmed.includes('/');

  const generate = async () => {
    setPending(true);
    try {
      const r = await window.s3.presignPut({ accountId, bucket, key: prefix + trimmed, expiresIn });
      if (r.ok) setUrl(r.data);
      else show(`${r.error.code}: ${r.error.message}`, 'error');
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    show('Upload link copied');
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Upload link</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>

        <label className="block text-sm">
          File name
          <input
            aria-label="File name"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            value={name}
            onChange={(e) => { setName(e.target.value); setUrl(null); }}
            autoFocus
          />
        </label>

        <label className="mt-3 block text-sm">
          Expiry
          <select
            aria-label="Expiry"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
            value={expiresIn}
            onChange={(e) => { setExpiresIn(Number(e.target.value)); setUrl(null); }}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <p className="pt-2 text-xs text-slate-500">
          Uploads to <span className="break-all font-mono text-slate-600">{prefix}{trimmed}</span>
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onClose}>Close</button>
          <button
            type="button"
            disabled={!valid || pending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
            onClick={generate}
          >
            Generate link
          </button>
        </div>

        {url && (
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3">
            <input readOnly aria-label="Upload URL" className="w-full rounded border border-slate-300 px-2 py-1 text-xs" value={url} />
            <button type="button" className="self-end rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={copy}>
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/UploadLinkDialog.test.tsx`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/UploadLinkDialog.tsx src/renderer/components/files/UploadLinkDialog.test.tsx
git commit -m "feat(ui): add UploadLinkDialog (presigned upload URL)"
```

---

## Task 4: FileBrowser — "Upload link…" toolbar button

**Files:**
- Modify: `src/renderer/components/files/FileBrowser.tsx`
- Modify: `src/renderer/components/files/FileBrowser.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/components/files/FileBrowser.test.tsx` (mirror the existing tests' `wrap`/`baseProps` and `window.s3` stub style; the dialog only calls `presignPut` on Generate, so opening it needs no extra stub):

```tsx
describe('FileBrowser upload link', () => {
  it('opens the Upload link dialog from the toolbar', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
      getDropPath: vi.fn(), uploadObject: vi.fn(), onUploadProgress: vi.fn(() => () => {}),
    };
    wrap(<FileBrowser {...baseProps} />);
    await screen.findByText('This folder is empty');
    await userEvent.click(screen.getByRole('button', { name: 'Upload link…' }));
    expect(screen.getByLabelText('File name')).toBeInTheDocument();
  });
});
```
(If `baseProps`/`wrap` differ in the file, adapt — the assertion is: clicking "Upload link…" reveals the dialog's "File name" input. Ensure the test render wraps in `ToastProvider` as the existing dialog tests do.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: FAIL — no "Upload link…" button.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/FileBrowser.tsx`:

(a) Add the import (next to the other dialog imports like `NameDialog`):
```tsx
import { UploadLinkDialog } from './UploadLinkDialog';
```

(b) Add state next to the existing dialog states (after `const [itemToMove, …]`):
```tsx
  const [uploadLinkOpen, setUploadLinkOpen] = useState(false);
```

(c) Replace the header toolbar's single "New folder" button with a flex group containing both buttons. Change:
```tsx
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          onClick={() => setNewFolderOpen(true)}
        >
          New folder
        </button>
      </div>
```
to:
```tsx
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            onClick={() => setUploadLinkOpen(true)}
          >
            Upload link…
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            onClick={() => setNewFolderOpen(true)}
          >
            New folder
          </button>
        </div>
      </div>
```

(d) Add the dialog render near the other dialog blocks (e.g. after the `{newFolderOpen && (<NameDialog …/>)}` block):
```tsx
      {uploadLinkOpen && (
        <UploadLinkDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          prefix={prefix}
          onClose={() => setUploadLinkOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: PASS (existing + new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/FileBrowser.tsx src/renderer/components/files/FileBrowser.test.tsx
git commit -m "feat(ui): add Upload link button to the file browser toolbar"
```

---

## Manual smoke checklist (after Task 4)

`npm start` (full restart — main-process IPC handler added), with an account + a writable bucket:
1. Open a folder → click **Upload link…** → the dialog shows a File name input + Expiry dropdown.
2. Type a filename, pick an expiry → **Generate link** → a URL appears.
3. **Copy** → toast "Upload link copied".
4. From a terminal, `curl -X PUT --upload-file ./somefile "<the URL>"` within the window → the object appears in the bucket at `prefix/filename`.
5. After the expiry passes (or with a tampered URL), the PUT is rejected by S3 — generating the link created no object on its own.
6. Editing the filename or expiry after generating clears the shown URL (must regenerate).

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-presigned-put-urls-design.md`):**
- `presignPutUrl` (bare `PutObjectCommand`, `getSignedUrl`, returns the URL) → Task 1. ✅
- IPC `s3:presignPut` (channel + handler + preload) → Task 2. ✅
- `UploadLinkDialog` (filename + expiry 1h/24h/7d, Generate → show URL, Copy, validation, clear-on-edit) → Task 3. ✅
- FileBrowser "Upload link…" toolbar button opening the dialog for the current prefix → Task 4. ✅
- States/errors (Generate disabled until valid / while pending; presign error toast; editing clears URL; no object created) → Tasks 3 + the smoke checklist. ✅
- Out of scope (content-type/size constraints, presigned POST, folder/bulk, listing/revoking, app-side upload) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. Task 4 gives the full before/after toolbar block and exact insertion points.

**Type consistency:** `presignPutUrl(args: { bucket; key; expiresIn })` → `Result<string>` matches across `objects.ts` (Task 1), the `ApiMap`/register/preload arg shape `{ accountId, bucket, key, expiresIn }` (Task 2), and the dialog's `window.s3.presignPut({ accountId, bucket, key: prefix + name, expiresIn })` call (Task 3). The dialog's expiry values (3600 / 86400 / 604800) match the `EXPIRY_OPTIONS`. The FileBrowser passes `accountId ?? ''`/`bucket ?? ''` + `prefix` to `UploadLinkDialog`, matching its `{ accountId: string; bucket: string; prefix: string; onClose }` props (consistent with how FileBrowser already passes `accountId ?? ''` to `useObjectActions`/`useTransfer`).

**Notes for implementers:** No existing presign test to copy — Task 1/Task 2 tests construct the signing client with explicit `region` + `credentials` (`getSignedUrl` signs offline; `aws-sdk-client-mock` is irrelevant). Task 2 adds a main-process handler, so the manual smoke needs a full `npm start` restart.
