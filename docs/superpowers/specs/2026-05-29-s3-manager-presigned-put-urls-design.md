# S3 Manager — Presigned Upload (PUT) URLs

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle: generate a presigned PUT URL that lets someone upload a file to a chosen key without credentials, via an "Upload link…" dialog in the File Manager. Builds on the existing presigned GET ("Copy URL") path.

## Overview

The app already generates presigned **GET** URLs (`presignGetUrl` → `s3:presignGet`, surfaced as "Copy URL" in the metadata panel). This feature adds the symmetric presigned **PUT** URL: a time-limited, credential-free link that authorizes uploading a file to one specific object key. From a FileBrowser toolbar action, the user types a filename, picks an expiry (1 hour / 24 hours / 7 days), and gets a URL to copy and hand to whoever will upload.

## Goals

- Generate a presigned **PUT** URL for `currentPrefix + filename` in the current folder.
- Let the user choose the validity window (1h / 24h / 7d; S3 caps presigned URLs at 7 days).
- Show the generated URL and offer a one-click **Copy**.
- Reuse the existing presign mechanism (`getSignedUrl`) and IPC patterns.

## Non-Goals (out of scope)

- **Content-type or size-constrained** upload links (the signed `PutObject` is bare — any content type, any size).
- **Presigned POST policies** (browser multi-field form uploads with conditions).
- Upload links for **folders / bulk** keys (single file only).
- **Listing or revoking** previously issued links (presigned URLs cannot be revoked individually — only by rotating the account's credentials; surfaced as guidance, not a feature).
- Uploading **through the app** to the link (the app already uploads directly via `uploadObject`; this feature only mints the URL for external use).

## Why this approach

`presignGetUrl` in `src/main/s3/objects.ts` already wraps `@aws-sdk/s3-request-presigner`'s `getSignedUrl` over a `GetObjectCommand`. A presigned PUT is the same call over a `PutObjectCommand`, so adding `presignPutUrl` beside it (and an `s3:presignPut` channel mirroring `s3:presignGet`) is minimal and consistent. Signing a **bare** `PutObjectCommand` (no `ContentType`, no ACL) yields the most flexible link: the holder may upload any file to that exact key. (If the command were signed with a `ContentType`, the uploader would be forced to send that exact header — avoided here for simplicity.) The toolbar dialog is its own focused unit because it needs two inputs (filename + expiry) and a result display, which the existing per-object quick-actions hook doesn't fit.

## Architecture

```
src/main/s3/objects.ts            # MODIFY: add presignPutUrl (getSignedUrl + PutObjectCommand)
src/main/ipc/channels.ts          # MODIFY: CH.presignPut + ApiMap entry
src/main/ipc/register.ts          # MODIFY: handler via h + clientFor
src/preload.ts                    # MODIFY: presignPut method
src/renderer/components/files/UploadLinkDialog.tsx  # CREATE: filename + expiry → generate + copy URL
src/renderer/components/files/FileBrowser.tsx       # MODIFY: "Upload link…" toolbar button + dialog
```

### Backend (`src/main/s3/objects.ts`)

Add beside `presignGetUrl` (reusing the existing `getSignedUrl` import; add `PutObjectCommand` to the `@aws-sdk/client-s3` import):

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

- The signed `PutObjectCommand` is bare (Bucket + Key only).
- Returns the URL string. Mirrors `presignGetUrl` exactly (same return shape, same error handling via `toErr`).

### IPC wiring

- `channels.ts`: `CH.presignPut = 's3:presignPut'`; `ApiMap`: `[CH.presignPut]: { args: [{ accountId: string; bucket: string; key: string; expiresIn: number }]; res: Result<string> }`. (Same shape as the existing `presignGet` entry.)
- `register.ts`: `h(CH.presignPut, (a) => presignPutUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }))` (add `presignPutUrl` to the existing `../s3/objects` import).
- `preload.ts`: `presignPut: (a) => invoke(CH.presignPut, a)`.

No secrets cross the boundary; the renderer passes account id + key + expiry and receives a URL string.

### Renderer

**`UploadLinkDialog`** (`{ accountId: string; bucket: string; prefix: string; onClose: () => void }`):
- State: `name` (string), `expiresIn` (number, default `3600`), `url` (`string | null`), `pending` (boolean).
- Inputs: a **filename** text input (aria-label "File name") and an **expiry** `<select>` (aria-label "Expiry") with options `1 hour` (3600), `24 hours` (86400), `7 days` (604800).
- `valid = name.trim() !== '' && !name.includes('/')`.
- **Generate link** button (disabled when `!valid || pending`): sets `pending`, calls `window.s3.presignPut({ accountId, bucket, key: prefix + name.trim(), expiresIn })`; on `ok` sets `url`; on error shows an error toast; clears `pending`.
- When `url` is set: a read-only text input showing the URL + a **Copy** button (`navigator.clipboard.writeText(url)` + "Upload link copied" toast).
- A **Close** button calls `onClose`. Changing the filename or expiry after generating clears the stale `url` (so a shown URL always matches the inputs).
- Uses `useToast`; reads `window.s3.presignPut` directly (the dialog is the feature's logic unit; consistent with how other dialogs call `window.s3`).

**`FileBrowser`** — add an **"Upload link…"** button in the header toolbar next to the existing "New folder" button; clicking sets `uploadLinkOpen` and renders `<UploadLinkDialog accountId={accountId} bucket={bucket} prefix={prefix} onClose={() => setUploadLinkOpen(false)} />` (accountId/bucket are non-null below the existing `bucket === null` guard — pass `accountId ?? ''`/`bucket ?? ''` to satisfy the types, matching the panel's existing pattern).

## Data flow

1. In a folder, click **Upload link…** → dialog opens.
2. Type a filename, pick an expiry → **Generate link** → `presignPut(prefix + name, expiresIn)` → URL shown.
3. **Copy** → clipboard + toast.
4. Hand the URL to the uploader; they `PUT` their file to it within the window. (Generating the link creates no object.)

## States & error handling

- Generate disabled while the filename is empty/contains `/` or a request is in flight.
- Editing filename/expiry after a generate clears the displayed URL (no stale mismatch).
- Presign failure (`AccessDenied`, network) → error toast; no URL shown.
- Closing and reopening the dialog starts fresh (no persisted URL).

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend).

- **`objects.ts` `presignPutUrl`**: returns `ok(url)` with an `https` URL string for a `PutObject` (mirror the existing `presignGetUrl` test — construct the client with a region + credentials so `getSignedUrl` can sign; assert the returned string is a non-empty URL containing the key).
- **IPC `register.test.ts`**: `s3:presignPut` calls the op with `clientFor(accountId)` and returns `ok(<url>)` (create an account, call the handler, assert `res.ok` and the URL is a string).
- **`UploadLinkDialog`**: empty filename → Generate disabled; entering a name + clicking Generate calls `window.s3.presignPut` with `{ accountId, bucket, key: prefix + name, expiresIn: 3600 }` and renders the returned URL; choosing "7 days" sends `expiresIn: 604800`; clicking Copy calls `navigator.clipboard.writeText` with the URL and toasts.
- **`FileBrowser`**: clicking "Upload link…" opens the dialog (shows the "File name" input).

## Dependencies

None new. Uses `@aws-sdk/client-s3` (`PutObjectCommand`) + `@aws-sdk/s3-request-presigner` (`getSignedUrl`, already used by `presignGetUrl`), the existing IPC/`Result` patterns, `ToastProvider`, and `navigator.clipboard` (already used by "Copy URL").
