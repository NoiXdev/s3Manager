# GitHub update check — design

## Summary

Add a lightweight update checker that compares the running app version against
the latest GitHub release. It surfaces a **"Check for updates"** button in
Settings (with a Download link when a newer version exists) and a **once-per-day
automatic check on startup** that shows an informational toast when an update is
available. No auto-download/install — just notify and link.

## Decisions made

- **Version check only, not a native auto-updater.** Electron's built-in
  `autoUpdater` (Squirrel) supports only macOS + Windows, requires macOS code
  signing, and has no Linux support; it also fits poorly with the Electron Forge
  build (no hosted feed). A GitHub Releases version check works identically on
  all platforms, needs no signing, and adds no npm dependency (Node's global
  `fetch` is available in the main process).
- **Trigger:** manual button in Settings **plus** an automatic startup check
  throttled to **at most once per 24 hours**.
- **No new dependency.** Uses `globalThis.fetch`, the existing `app.getVersion()`
  injection, and the existing `openExternal` IPC.
- **Toasts are text-only** (current `ToastProvider`), so the startup toast is
  purely informational; the actionable Download link lives in Settings.

## Data source

`GET https://api.github.com/repos/NoiXdev/s3Manager/releases/latest` with headers
`Accept: application/vnd.github+json` and a `User-Agent` (GitHub requires one).
`/releases/latest` excludes drafts and pre-releases. Response of interest:
`tag_name` (e.g. `v1.2.0`) and `html_url` (the release page). A **404** means no
published release yet → treat as "up to date". Unauthenticated rate limit is
60 req/h — ample for occasional checks.

## Components

### Main — `src/main/update/checkForUpdate.ts`

- `const GITHUB_REPO = 'NoiXdev/s3Manager'`.
- `compareVersions(a, b): number` — strips a leading `v` and any `-prerelease`
  suffix, compares `major.minor.patch` numerically (so `1.10.0 > 1.9.0`).
  Returns `>0` if `a` is newer, `0` if equal, `<0` if older.
- `interface UpdateInfo { currentVersion: string; latestVersion: string | null; updateAvailable: boolean; releaseUrl: string }`.
- `async function checkForUpdate({ fetchImpl, currentVersion }): Promise<Result<UpdateInfo>>`:
  - Fetches the latest-release endpoint via `fetchImpl`.
  - On HTTP 404 → `ok({ currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases' })`.
  - On non-OK (e.g. 403 rate-limit, 5xx) → `err(...)` with a readable message.
  - On OK → parse `tag_name`/`html_url`; `updateAvailable = compareVersions(tag, currentVersion) > 0`; `releaseUrl = html_url ?? <releases page>`.
  - On thrown fetch/parse error → `err(message)`.

### Main — IPC wiring

- New channel `checkForUpdate: 'app:checkForUpdate'`, `{ args: []; res: Result<UpdateInfo> }`. `UpdateInfo` is imported from the update module into `channels.ts`.
- `RegisterDeps` gains `fetchImpl?: typeof fetch` (optional; defaults to `globalThis.fetch`). `main.ts` injects `fetchImpl: (...a) => globalThis.fetch(...a)` (or omits it to use the default).
- Handler: `h(CH.checkForUpdate, () => checkForUpdate({ fetchImpl: deps.fetchImpl ?? globalThis.fetch, currentVersion: deps.appVersion }))`. The handler is **pure** — it does not persist anything (the daily-throttle timestamp is owned by the renderer; see below).
- `preload.ts`: `checkForUpdate: () => invoke(CH.checkForUpdate)`.

### Settings persistence — `src/main/settings/appSettings.ts`

- `AppSettings` gains `autoCheckUpdates: boolean` (default **true**) and
  `lastUpdateCheckAt: number | null` (default **null**).
- `readSettings`: parse `autoCheckUpdates` from `'true'`/`'false'` (default true);
  parse `lastUpdateCheckAt` as a finite number ≥ 0 or null.
- `writeSettings`: handle `autoCheckUpdates` (store `String(boolean)`) and
  `lastUpdateCheckAt` (store `String(number)` when a finite number ≥ 0).

### Renderer — throttle helper `src/renderer/lib/updateThrottle.ts`

- `const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000`.
- `shouldAutoCheck({ autoCheckUpdates, lastUpdateCheckAt, now, intervalMs = UPDATE_CHECK_INTERVAL_MS }): boolean` →
  `autoCheckUpdates && (lastUpdateCheckAt == null || now - lastUpdateCheckAt >= intervalMs)`.

### Renderer — hook `src/renderer/hooks/useUpdateCheck.ts`

- A TanStack `useMutation` whose `mutationFn` calls `unwrap(window.s3.checkForUpdate())`.
- `onSuccess` records the check time for the daily throttle by calling
  `window.s3.setSettings({ lastUpdateCheckAt: Date.now() })` (fire-and-forget;
  no settings-query invalidation needed — the value is read fresh on next launch).
- Returns the mutation (`mutate`, `data`, `isPending`, `isError`, `error`).

### Renderer — Settings UI (`SettingsScreen.tsx`, "About" area)

- A **"Check for updates"** button → `check.mutate()`. Inline status from the
  mutation state:
  - pending → `settings.checkingUpdates`
  - success + `!updateAvailable` → `settings.upToDate`
  - success + `updateAvailable` → `settings.updateAvailable` (with version) and a
    **Download** link/button → `window.s3.openExternal(data.releaseUrl)`
  - error → `settings.updateCheckFailed`
- A checkbox toggle **"Check for updates on startup"** bound to
  `autoCheckUpdates` (saved via the existing `save` mutation).

### Renderer — startup auto-check (`App.tsx`)

- Instantiate `const check = useUpdateCheck()`.
- One-shot `useEffect` guarded by a `useRef(false)`: when `settings.isSuccess`
  and `shouldAutoCheck({ autoCheckUpdates, lastUpdateCheckAt, now: Date.now() })`,
  call `check.mutate()` once.
- A second `useEffect`: when `check.data?.updateAvailable` is true, `show(t('updates.available', { version: check.data.latestVersion }))` once. Auto-check errors are ignored (no toast — don't nag offline users).

## i18n (all six locales)

`settings.checkUpdates`, `settings.checkingUpdates`, `settings.upToDate`,
`settings.updateAvailable` ("Version {{version}} available"),
`settings.updateDownload`, `settings.updateCheckFailed`,
`settings.autoCheck` (toggle label), `settings.autoCheckHelp`,
`updates.available` (toast, "Update available: {{version}}").

## Error handling & edge cases

- **Offline / network error:** manual → inline `updateCheckFailed`; auto → silent.
- **No releases yet (404):** treated as up to date.
- **Rate limited (403):** `err` → manual shows failure; auto silent.
- **Pre-releases:** excluded by `/releases/latest`.
- **Dev build:** `app.getVersion()` returns the `package.json` version; comparison still works.

## Testing (TDD)

- `checkForUpdate.test.ts`: stubbed `fetchImpl` for update-available, up-to-date,
  404-no-release, non-OK (403/500), and thrown-error cases; `compareVersions`
  unit cases incl. `1.10.0 > 1.9.0`, equal, `v`-prefix, pre-release suffix.
- `appSettings.test.ts`: `autoCheckUpdates` default true and persists false;
  `lastUpdateCheckAt` default null and persists a number; ignores invalid values.
- `register.test.ts`: a `checkForUpdate` handler test with a stubbed `fetchImpl`
  returning a newer tag → `updateAvailable: true`.
- `updateThrottle.test.ts`: `shouldAutoCheck` true when never checked, true when
  ≥24h, false when <24h, false when `autoCheckUpdates` is false.
- `useUpdateCheck.test.tsx`: mocks `window.s3.checkForUpdate` + `setSettings`;
  asserts data flows through and `setSettings` is called with `lastUpdateCheckAt`.
- `SettingsScreen.test.tsx`: button → up-to-date and update-available states;
  Download calls `openExternal`; toggle persists `autoCheckUpdates`.
- `App.test.tsx`: with `checkForUpdate` returning `updateAvailable` and a
  due/never `lastUpdateCheckAt`, a toast appears; with a recent `lastUpdateCheckAt`,
  no auto-check fires (`checkForUpdate` not called).

## Out of scope

- Auto-download/install, delta updates, release-notes rendering in-app.
- Per-channel (beta) updates.
- Reminders/snooze beyond the 24h startup throttle.

## Open questions

None.
