# S3 Manager — Settings Screen

**Date:** 2026-05-30
**Status:** Approved design
**Scope:** A single feature cycle: wire app settings end-to-end and build the Settings screen (one editable preference + a read-only About block), replacing the "Coming soon" placeholder.

## Overview

The app has a `settings` nav section showing "Coming soon" and a `settingsRepo` (a `key→value` string store on the `app_settings` SQLite table) that is injected into the IPC layer but never exposed. This cycle adds a typed settings layer over that repo, three IPC channels, a `useSettings` hook, and a `SettingsScreen` with:

- **Default "Copy URL" link expiry** (editable) — the validity window for presigned GET URLs, replacing the hardcoded 1 hour in `useObjectActions.copyPresignedUrl`.
- **About** (read-only) — app version, secrets-encryption status (OS keychain available?), and account count.

## Goals

- Persist a default presigned-GET expiry preference in SQLite and apply it to "Copy URL".
- Show read-only app info (version, encryption status, account count).
- Establish the settings plumbing (typed `AppSettings`, IPC, hook) so future preferences are easy to add.

## Non-Goals (out of scope)

- Theme / dark mode.
- A default download folder (skipping the save dialog).
- Sync concurrency or other tuning knobs.
- Import/export of settings; per-account settings.

## Why this approach

`settingsRepo` already persists `key→value` strings on `app_settings` and is wired into `RegisterDeps`, but nothing reads or writes it over IPC. A thin typed layer (`appSettings.ts`) gives the renderer a real `AppSettings` object (with defaults + clamping) instead of raw strings, mirroring how the rest of the app keeps storage in the main process behind typed IPC. The single editable preference — the presigned-GET expiry — is the one clearly-hardcoded value (`3600` in `useObjectActions`), so it's concrete and immediately useful. App version comes from Electron's `app.getVersion()`, injected from `main.ts` into `RegisterDeps` (keeping `register.ts` Electron-free), alongside the already-available `crypto.isEncryptionAvailable()` and `accounts.list()` for the read-only info.

## Architecture

```
src/main/settings/appSettings.ts          # CREATE: AppSettings/AppInfo types + readSettings/writeSettings
src/main/ipc/channels.ts                   # MODIFY: settings:get / settings:set / app:getInfo + ApiMap
src/main/ipc/register.ts                   # MODIFY: 3 handlers + RegisterDeps.appVersion
src/main.ts                                # MODIFY: inject appVersion = app.getVersion()
src/preload.ts                             # MODIFY: getSettings / setSettings / getAppInfo
src/renderer/hooks/useSettings.ts          # CREATE: settings query + save mutation + appInfo query
src/renderer/hooks/useObjectActions.ts     # MODIFY: copyPresignedUrl reads the configured expiry
src/renderer/components/settings/SettingsScreen.tsx  # CREATE
src/renderer/App.tsx                       # MODIFY: render SettingsScreen for the 'settings' section
```

### Backend (`src/main/settings/appSettings.ts`)

Reuses `SettingsRepo` (from `../storage/settingsRepo`) — shape `{ get(key): string | undefined; set(key, value): void }`.

```ts
export interface AppSettings {
  presignExpirySeconds: number;
}
export interface AppInfo {
  version: string;
  encryptionAvailable: boolean;
  accountCount: number;
}

const DEFAULT_EXPIRY = 3600;
const MAX_EXPIRY = 604800; // S3's 7-day presign cap

export function readSettings(repo: SettingsRepo): AppSettings {
  const raw = repo.get('presignExpirySeconds');
  const n = raw !== undefined ? Number(raw) : NaN;
  const presignExpirySeconds = Number.isFinite(n) && n >= 1 && n <= MAX_EXPIRY ? n : DEFAULT_EXPIRY;
  return { presignExpirySeconds };
}

export function writeSettings(repo: SettingsRepo, patch: Partial<AppSettings>): AppSettings {
  if (patch.presignExpirySeconds !== undefined) {
    const clamped = Math.min(MAX_EXPIRY, Math.max(1, Math.round(patch.presignExpirySeconds)));
    repo.set('presignExpirySeconds', String(clamped));
  }
  return readSettings(repo);
}
```

- `readSettings` returns the default when unset or stored invalid (defends against hand-edited DB rows).
- `writeSettings` clamps to `[1, 604800]`, persists, and returns the merged settings.

### IPC wiring

- `channels.ts`: `CH.getSettings = 'settings:get'`, `CH.setSettings = 'settings:set'`, `CH.getAppInfo = 'app:getInfo'`. `ApiMap`:
  - `[CH.getSettings]: { args: []; res: Result<AppSettings> }`
  - `[CH.setSettings]: { args: [Partial<AppSettings>]; res: Result<AppSettings> }`
  - `[CH.getAppInfo]: { args: []; res: Result<AppInfo> }`
  - Imports `AppSettings`, `AppInfo` (types) from `../settings/appSettings`.
- `register.ts`: add `appVersion: string` to `RegisterDeps`; handlers:
  - `h(CH.getSettings, () => ok(readSettings(deps.settings)))`
  - `h(CH.setSettings, (patch: Partial<AppSettings>) => ok(writeSettings(deps.settings, patch)))`
  - `h(CH.getAppInfo, () => ok({ version: deps.appVersion, encryptionAvailable: deps.crypto.isEncryptionAvailable(), accountCount: deps.accounts.list().length }))`
- `main.ts`: import `app` (already imported) and pass `appVersion: app.getVersion()` in the `registerIpc(ipcMain, { … })` deps.
- `preload.ts`: `getSettings: () => invoke(CH.getSettings)`, `setSettings: (a) => invoke(CH.setSettings, a)`, `getAppInfo: () => invoke(CH.getAppInfo)`.

No secrets cross the boundary.

### Renderer

**`useSettings()`**:
- `settings` query (`['settings']` → `window.s3.getSettings()`).
- `save` mutation (`Partial<AppSettings>` → `window.s3.setSettings(patch)`; `onSuccess` invalidates `['settings']`).
- `info` query (`['appInfo']` → `window.s3.getAppInfo()`).

**`useObjectActions.copyPresignedUrl`** — change the hardcoded expiry to the persisted value:
```ts
async copyPresignedUrl(key: string) {
  const s = await window.s3.getSettings();
  const expiresIn = s.ok ? s.data.presignExpirySeconds : 3600;
  const r = await window.s3.presignGet({ accountId, bucket, key, expiresIn });
  if (!r.ok) { show(`${r.error.code}: ${r.error.message}`, 'error'); return; }
  await navigator.clipboard.writeText(r.data);
  show('Signed URL copied');
}
```

**`SettingsScreen`** (no props): uses `useSettings()` + `useToast()`.
- Heading "Settings".
- **Default link expiry**: a `<select aria-label="Default link expiry">` with options `1 hour` (3600), `24 hours` (86400), `7 days` (604800); `value` from `settings.data?.presignExpirySeconds ?? 3600`; `onChange` → `save.mutateAsync({ presignExpirySeconds: Number(value) })` then `show('Settings saved')` (catch → error toast). A short caption explains it applies to "Copy URL" links.
- **About**: when `info.data` is loaded, read-only rows — Version (`info.data.version`), Secrets encryption (`info.data.encryptionAvailable ? 'Enabled' : 'Unavailable'`), Accounts (`info.data.accountCount`).

**App** — replace the `settings`-section render: the chained ternary's branch for `section === 'settings'` renders `<SettingsScreen />`; the generic "Coming soon" fallback remains for any other (currently unreachable) section.

## Data flow

1. Open **Settings** → `useSettings` loads the current expiry + app info.
2. Change the expiry dropdown → `settings:set` clamps + persists to SQLite → "Settings saved" toast → `['settings']` refetches.
3. Next time the user clicks **Copy URL**, `copyPresignedUrl` reads the persisted expiry and signs the GET URL for that window.

## States & error handling

- Settings/info queries show a brief "Loading…" until resolved; the About block renders once `info.data` is present.
- The expiry `<select>` reflects the persisted value (after the query); a save error → error toast, and the displayed value stays consistent with the (unchanged) persisted state on the next refetch — no optimistic divergence.
- `copyPresignedUrl` falls back to `3600` if `getSettings` errors, so copying a URL never breaks because of settings.
- `writeSettings` clamps out-of-range values defensively even though the UI only offers valid options.

## Testing

Vitest + RTL against mocked `window.s3` (renderer) and a fake/in-memory `SettingsRepo` or the in-memory DB (backend).

- **`appSettings.ts`**: `readSettings` returns the default (3600) when unset and when the stored value is non-numeric/out-of-range; returns a valid stored value; `writeSettings` persists a value, clamps `>604800`/`<1`, and returns the merged settings. (Use a Map-backed fake repo: `{ get, set }`.)
- **IPC `register.test.ts`**: `settings:get` returns `{ presignExpirySeconds: 3600 }` by default; `settings:set` with `{ presignExpirySeconds: 86400 }` then `settings:get` reflects 86400; `app:getInfo` returns the injected `appVersion`, `encryptionAvailable: true` (fake crypto), and the current account count. (`buildHarness` and the inline atomicity-test deps gain `appVersion: '1.2.3'`.)
- **`useSettings`**: `settings`/`info` queries call the right `window.s3` methods; `save` calls `setSettings` and invalidates `['settings']`.
- **`useObjectActions`**: `copyPresignedUrl` reads `window.s3.getSettings()` and calls `presignGet` with the configured `expiresIn` (e.g. 86400), and falls back to 3600 when `getSettings` returns an error.
- **`SettingsScreen`**: renders the About info (version/encryption/accounts) and the current expiry; selecting "24 hours" calls `save` with `{ presignExpirySeconds: 86400 }`.
- **App**: the Settings section renders the Settings screen (its "Settings" heading), not "Coming soon".

## Dependencies

None new. Uses the existing `settingsRepo`/`app_settings` table, Electron `app.getVersion()` (injected), the existing `crypto.isEncryptionAvailable()` + `accounts.list()`, `ToastProvider`, TanStack Query, and the existing IPC/`Result` patterns.
