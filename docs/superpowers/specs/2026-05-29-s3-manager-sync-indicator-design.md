# S3 Manager — Global Sync Status Indicator

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle: lift sync run state into an app-level provider and add a sidebar indicator that shows a running sync's progress from any section. Builds on the merged bucket and local↔bucket Sync features.

## Overview

Add a small **sidebar indicator** that is visible from any section while a sync is running: a pulsing dot plus `Listing…` (during the listing phase) or `Syncing… {copied}/{total}` (during copying). Clicking it switches to the Sync section. It disappears when the run finishes.

To make the run state readable from the sidebar (which sits outside the section content where the Sync screens live), the run state (`running`/`progress`/`result`) moves out of `SyncScreen`/`LocalSyncScreen` into a `SyncRunProvider` context mounted at the app root. The provider also owns the single `onSyncProgress` subscription and the completion toast, so notifications fire regardless of which section is showing.

## Goals

- Show a compact, clickable "a sync is running" indicator in the sidebar from **every** section.
- Display live progress in the indicator: `Listing…` then `Syncing… {copied}/{total}`.
- Clicking the indicator navigates to the Sync section.
- The indicator appears only while a run is active and hides when it finishes.
- Preserve all current behavior: progress/result survive navigation, the active sub-tab + endpoint selections + preview plan survive navigation, one run at a time, cancel via the Sync screen's Cancel button.

## Non-Goals (out of scope)

- A post-run **outcome chip** in the sidebar (e.g. "Synced 40" / "3 failed"). The Sync screen's result panel and the completion toast already report the outcome; the indicator is running-only.
- A **progress bar / percentage** in the sidebar (count only).
- Multiple concurrent runs (still one at a time — the main process already enforces a single `activeSync`).
- Any change to the sync engine, IPC channels, or transfer behavior.

## Why this approach

The sidebar `<aside>` and the section `<main>` are siblings under the app root; the Sync screens (holding the run state) live inside `<main>`, so the sidebar cannot read their state. A React context provider mounted at the root is the idiomatic way to share that state with both the sidebar and the screens without prop-drilling through `SyncSection`. Moving the single `onSyncProgress` subscription and the completion toast into the provider also fixes a latent rough edge: today each screen subscribes inside its `run()` and toasts locally, so a completion toast can be tied to a screen that may be hidden. A provider mounted once under `ToastProvider` always fires the toast.

The previously added "keep Sync mounted" behavior stays: it preserves the screens' **local** UI state (endpoint selections, the preview plan, the active sub-tab) across navigation. The **run** state moves to the provider so it is also visible to the sidebar. The two are complementary.

## Architecture

```
src/renderer/components/sync/SyncRunProvider.tsx  # CREATE: SyncRunProvider + useSyncRun()
src/renderer/components/sync/SyncStatus.tsx       # CREATE: sidebar indicator
src/renderer/hooks/useSync.ts                     # MODIFY: trim to { plan } (preview only)
src/renderer/hooks/useLocalSync.ts                # MODIFY: trim to { plan } (preview only)
src/renderer/components/sync/SyncScreen.tsx       # MODIFY: read run state from useSyncRun()
src/renderer/components/sync/LocalSyncScreen.tsx  # MODIFY: read run state from useSyncRun()
src/renderer/App.tsx                              # MODIFY: wrap root in <SyncRunProvider>; add <SyncStatus> to the aside
```

### `SyncRunProvider` + `useSyncRun`

Reuses the existing types: `SyncProgress`, `SyncResult` (and `SyncEndpoints`) from `../../main/s3/sync`; `LocalSyncArgs` from `../../main/s3/localSync`; `unwrap` from `../../lib/result`; `useToast` from `../ui/ToastProvider`.

```ts
interface SyncRunContext {
  running: boolean;
  progress: SyncProgress | null;
  result: SyncResult | null;
  runBucket: (args: SyncEndpoints) => Promise<SyncResult>;
  runLocal: (args: LocalSyncArgs) => Promise<SyncResult>;
  cancel: () => void;
  clearResult: () => void;
}
```

Where `SyncEndpoints = { source: Endpoint; dest: Endpoint }` (the shape `window.s3.runSync` already takes — re-exported from `sync.ts` or defined alongside the provider).

Behavior:
- State: `running`, `progress: SyncProgress | null`, `result: SyncResult | null`.
- A single `useEffect` subscribes `window.s3.onSyncProgress((p) => setProgress(p))` on mount and unsubscribes on unmount.
- A private `execute(runFn)` helper: `setRunning(true); setResult(null); setProgress({ phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 });` then `try { const r = await runFn(); setResult(r); show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`); return r; } catch (e) { show((e as Error).message, 'error'); throw e; } finally { setRunning(false); setProgress(null); }`.
- `runBucket(args) = execute(() => unwrap(window.s3.runSync(args)) as Promise<SyncResult> ...)` — concretely `execute(async () => unwrap(await window.s3.runSync(args)))`.
- `runLocal(args) = execute(async () => unwrap(await window.s3.localSyncRun(args)))`.
- `cancel() = void window.s3.cancelSync()`.
- `clearResult() = setResult(null)`.
- `useSyncRun()` throws if used outside the provider.

### `SyncStatus`

```ts
function SyncStatus({ onOpen }: { onOpen: () => void }): JSX.Element | null
```

Reads `useSyncRun()`. If `!running` → returns `null`. Otherwise renders a clickable button (`onClick={onOpen}`) containing a pulsing dot (`animate-pulse`) and a label:
- `progress?.phase === 'copying'` → `Syncing… {progress.copied}/{progress.total}`
- otherwise → `Listing…`

Styled to sit under the `SectionNav` in the sidebar (e.g. `mt-3` separating it). Accessible name: the button text (so tests can `getByRole('button', { name: /Syncing…|Listing…/ })`).

### Screen changes

- `SyncScreen` / `LocalSyncScreen`: remove local `running`/`result` state and the `useSync().run`/`progress`/`cancel`/`resetProgress` usage. Instead:
  - `const run = useSyncRun();` → use `run.running`, `run.progress`, `run.result`, `run.cancel`, `run.clearResult`.
  - Preview stays local: keep `useSync()` (bucket) / `useLocalSync()` (local) — now exposing only `{ plan }` — and the local `plan` state + endpoint state.
  - `onRun` calls `run.runBucket(toEndpoint…)` / `run.runLocal(toArgs())`; it no longer toasts (the provider does) and no longer manages `running`/`progress`; on success it clears the local `plan` (so the result panel shows). Errors are toasted by the provider; the screen's `onRun` can simply `await run.runBucket(...).catch(() => {})` to swallow the rejection locally.
  - The progress panel reads `run.progress`; the result panel reads `run.result`; "Preview disabled while running" reads `run.running`.
  - Endpoint/direction/tab changes call `run.clearResult()` (replacing the old `setResult(null)`), and still clear the local `plan`.

### Hook changes

- `useSync` and `useLocalSync` are trimmed to expose only `plan` (the preview `useMutation`). The `run`/`progress`/`cancel`/`resetProgress` members and the `LISTING` constant are removed (that logic now lives in the provider).

### App changes

- Wrap the existing root tree in `<SyncRunProvider>` **inside** `<ToastProvider>` (the provider needs `useToast`):
  ```tsx
  <ToastProvider>
    <SyncRunProvider>
      <div className="flex h-full …"> … </div>
    </SyncRunProvider>
  </ToastProvider>
  ```
- In the `<aside>`, under `<SectionNav>`, add `<SyncStatus onOpen={() => goToSection('sync')} />`.

## Data flow

1. The user starts a sync from the Sync screen → `run.runBucket`/`run.runLocal` → provider sets `running=true`, `progress=listing`.
2. Main streams `SyncProgress` over `SYNC_PROGRESS_CHANNEL` → the provider's single subscription updates `progress` → `SyncStatus` shows `Syncing… {copied}/{total}` and the Sync screen's progress panel updates.
3. The user navigates to another section → `SyncStatus` stays visible in the sidebar (provider is app-level) → clicking it calls `goToSection('sync')`.
4. The run finishes → provider sets `result`, fires the outcome toast, clears `running`/`progress` → `SyncStatus` hides; the Sync screen shows the result panel.

## States & error handling

- `running` is the single source of truth for "a sync is active"; both the indicator and the screens' Preview-disabled/Cancel-shown logic read it.
- One run at a time is still enforced in the main process (`activeSync` supersede + the screen disables Preview while `running`).
- Listing/run errors → the provider catches, toasts the error, and clears `running`/`progress`; the screen's `onRun` swallows the rejection. Per-object failures are returned in the `SyncResult` and shown in the screen's result panel as today.
- Cancel is unchanged (`window.s3.cancelSync()` aborts the main-process `activeSync`); the indicator hides when the (canceled) run resolves.

## Testing

Vitest + RTL against a mocked `window.s3`, consistent with the codebase.

- **`SyncRunProvider` / `useSyncRun`**: `runBucket` sets `running` true then false, sets `result`, and fires a success toast; a rejected run toasts an error and clears `running`; `runLocal` calls `window.s3.localSyncRun`; `cancel` calls `window.s3.cancelSync`; `progress` updates when the subscribed `onSyncProgress` callback is invoked; `clearResult` clears the result. (Use a small consumer component or `renderHook` wrapped in `ToastProvider` + the provider.)
- **`SyncStatus`**: renders nothing when `running` is false; shows `Listing…` when running with a listing-phase progress; shows `Syncing… 3/10` for a copying-phase progress; clicking calls `onOpen`.
- **`SyncScreen` / `LocalSyncScreen`**: existing behaviors (preview → plan summary, empty plan disables Run, run → progress → result + failures, guards) still pass, now with the test render wrapping the component in `SyncRunProvider` (and `ToastProvider`). Run uses `window.s3.runSync`/`localSyncRun` exactly as before.
- **`useSync` / `useLocalSync`**: `plan` still calls `window.s3.planSync`/`localSyncPlan`; the removed `run`/`cancel` tests are deleted.
- **`App`**: while a (hanging) run is active, the sidebar shows a `Syncing…`/`Listing…` button and clicking it shows the Sync section; the existing navigation-persistence test still passes.

## Dependencies

None new. Uses React context, the existing `window.s3` sync API (`runSync`/`localSyncRun`/`cancelSync`/`onSyncProgress`), the existing sync types, `unwrap`, `ToastProvider`/`useToast`, and Tailwind. No backend/IPC changes.
