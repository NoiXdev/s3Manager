# S3 Manager — Global Sync Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift sync run state into an app-level `SyncRunProvider` and add a sidebar indicator that shows a running sync's progress (clickable to open Sync) from any section.

**Architecture:** A React context (`SyncRunProvider`) mounted at the app root owns `running`/`progress`/`result`, the single `onSyncProgress` subscription, the `runBucket`/`runLocal`/`cancel` actions, and the completion toast. The two Sync screens read run state from `useSyncRun()` (keeping only preview/endpoint state local); a `SyncStatus` component in the sidebar reads the same context. No backend/IPC changes.

**Tech Stack:** React 19 context, TanStack Query, Tailwind 4, Vitest + RTL.

**Prerequisite facts (verified, do not re-derive):**
- `src/renderer/hooks/useSync.ts` currently exports `useSync()` → `{ plan, run, cancel, progress, resetProgress }` and `interface SyncEndpoints { source: Endpoint; dest: Endpoint }`. `useLocalSync.ts` mirrors it → `{ plan, run, cancel, progress, resetProgress }`.
- Types in `src/main/s3/sync.ts`: `Endpoint`, `SyncPlan`, `SyncResult`, `SyncProgress`. `LocalSyncArgs` in `src/main/s3/localSync.ts`.
- `window.s3` sync API: `planSync(args)`, `runSync(args)`, `localSyncPlan(args)`, `localSyncRun(args)`, `cancelSync()`, `onSyncProgress(cb) → unsubscribe`. `args` for runSync/planSync is `{ source: Endpoint; dest: Endpoint }` (= `SyncEndpoints`).
- `src/renderer/lib/result.ts` exports `unwrap`. `src/renderer/components/ui/ToastProvider.tsx` exports `ToastProvider` + `useToast()` → `{ show(message, kind?: 'success'|'error') }`.
- `src/renderer/App.tsx`: returns `<ToastProvider><div className="flex h-full text-sm text-slate-800"> <aside …><h1>…</h1><SectionNav active={section} onSelect={goToSection} /></aside> <main …>…</main> </div></ToastProvider>`. It has `goToSection(s)` and a `syncVisited` keep-mounted block for `<SyncSection>`.
- `SyncScreen.tsx` / `LocalSyncScreen.tsx` currently own local `running`/`result`/`plan` state and use `useSync()`/`useLocalSync()` `.run`/`.progress`/`.cancel`/`.resetProgress`. Their progress panel shows `Listing both sides…` (listing) or `{copied} / {total} objects · …`.
- `App.test.tsx` `beforeEach` `window.s3` stub already includes `accounts.list` (account id `'a'`, label `'AWS prod'`), `listBuckets` (`['assets']`), and `onSyncProgress: vi.fn(() => () => {})`.

---

## File Structure

```
src/renderer/components/sync/SyncRunProvider.tsx  # CREATE: SyncRunProvider + useSyncRun()
src/renderer/components/sync/SyncStatus.tsx       # CREATE: sidebar indicator
src/renderer/App.tsx                              # MODIFY: wrap root in <SyncRunProvider> (Task 2); add <SyncStatus> (Task 7)
src/renderer/components/sync/SyncScreen.tsx       # MODIFY: read run state from useSyncRun()
src/renderer/components/sync/LocalSyncScreen.tsx  # MODIFY: read run state from useSyncRun()
src/renderer/hooks/useSync.ts                     # MODIFY: trim to { plan }
src/renderer/hooks/useLocalSync.ts                # MODIFY: trim to { plan }
```

Task order keeps the full test suite green at every commit: provider → wrap App → indicator component → refactor each screen → trim hooks → wire indicator into the sidebar.

---

## Task 1: SyncRunProvider + useSyncRun

**Files:**
- Create: `src/renderer/components/sync/SyncRunProvider.tsx`
- Test: `src/renderer/components/sync/SyncRunProvider.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/SyncRunProvider.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncProgress } from '../../../main/s3/sync';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncRunProvider, useSyncRun } from './SyncRunProvider';

const ARGS = { source: { accountId: 's', bucket: 'src', prefix: '' }, dest: { accountId: 'd', bucket: 'dst', prefix: '' } };
const LARGS = { direction: 'upload' as const, localPath: '/data', remote: { accountId: 'a', bucket: 'b', prefix: '' } };
const RESULT = { copied: 3, bytesCopied: 30, failed: [], canceled: false };

function Harness() {
  const sr = useSyncRun();
  return (
    <div>
      <span data-testid="running">{String(sr.running)}</span>
      <span data-testid="phase">{sr.progress?.phase ?? 'none'}</span>
      <span data-testid="copied">{sr.result?.copied ?? -1}</span>
      <button onClick={() => void sr.runBucket(ARGS).catch(() => {})}>runBucket</button>
      <button onClick={() => void sr.runLocal(LARGS).catch(() => {})}>runLocal</button>
      <button onClick={sr.cancel}>cancel</button>
      <button onClick={sr.clearResult}>clearResult</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <SyncRunProvider><Harness /></SyncRunProvider>
    </ToastProvider>,
  );
}

let progressCb: ((p: SyncProgress) => void) | undefined;
beforeEach(() => {
  progressCb = undefined;
  (window as unknown as { s3: unknown }).s3 = {
    onSyncProgress: vi.fn((cb: (p: SyncProgress) => void) => { progressCb = cb; return () => {}; }),
    runSync: vi.fn().mockResolvedValue({ ok: true, data: RESULT }),
    localSyncRun: vi.fn().mockResolvedValue({ ok: true, data: { ...RESULT, copied: 2 } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('SyncRunProvider', () => {
  it('runBucket stores the result, ends not-running, and toasts success', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runBucket' }));
    expect(window.s3.runSync).toHaveBeenCalledWith(ARGS);
    expect(screen.getByTestId('running')).toHaveTextContent('false');
    expect(screen.getByTestId('copied')).toHaveTextContent('3');
    expect(await screen.findByText('Synced 3 object(s)')).toBeInTheDocument();
  });

  it('runLocal calls window.s3.localSyncRun', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runLocal' }));
    expect(window.s3.localSyncRun).toHaveBeenCalledWith(LARGS);
  });

  it('toasts an error when the run fails', async () => {
    (window.s3.runSync as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'nope' } });
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runBucket' }));
    expect(await screen.findByText('nope')).toBeInTheDocument();
    expect(screen.getByTestId('running')).toHaveTextContent('false');
  });

  it('updates progress from the onSyncProgress subscription', async () => {
    renderHarness();
    act(() => progressCb!({ phase: 'copying', copied: 4, total: 9, bytesCopied: 0, bytesTotal: 0, failed: 0 }));
    expect(screen.getByTestId('phase')).toHaveTextContent('copying');
  });

  it('cancel calls window.s3.cancelSync', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/SyncRunProvider.test.tsx`
Expected: FAIL — cannot find module `./SyncRunProvider`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/SyncRunProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { unwrap } from '../../lib/result';
import { useToast } from '../ui/ToastProvider';
import type { SyncProgress, SyncResult } from '../../../main/s3/sync';
import type { SyncEndpoints } from '../../hooks/useSync';
import type { LocalSyncArgs } from '../../../main/s3/localSync';

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

interface SyncRunContextValue {
  running: boolean;
  progress: SyncProgress | null;
  result: SyncResult | null;
  runBucket: (args: SyncEndpoints) => Promise<SyncResult>;
  runLocal: (args: LocalSyncArgs) => Promise<SyncResult>;
  cancel: () => void;
  clearResult: () => void;
}

const SyncRunContext = createContext<SyncRunContextValue | null>(null);

export function SyncRunProvider({ children }: { children: ReactNode }) {
  const { show } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    return () => { unsubscribe(); };
  }, []);

  const execute = useCallback(
    async (runFn: () => Promise<SyncResult>): Promise<SyncResult> => {
      setRunning(true);
      setResult(null);
      setProgress(LISTING);
      try {
        const r = await runFn();
        setResult(r);
        show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`);
        return r;
      } catch (e) {
        show((e as Error).message, 'error');
        throw e;
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [show],
  );

  const runBucket = useCallback(
    (args: SyncEndpoints) => execute(async () => unwrap(await window.s3.runSync(args))),
    [execute],
  );
  const runLocal = useCallback(
    (args: LocalSyncArgs) => execute(async () => unwrap(await window.s3.localSyncRun(args))),
    [execute],
  );
  const cancel = useCallback(() => { void window.s3.cancelSync(); }, []);
  const clearResult = useCallback(() => setResult(null), []);

  return (
    <SyncRunContext.Provider value={{ running, progress, result, runBucket, runLocal, cancel, clearResult }}>
      {children}
    </SyncRunContext.Provider>
  );
}

export function useSyncRun(): SyncRunContextValue {
  const ctx = useContext(SyncRunContext);
  if (!ctx) throw new Error('useSyncRun must be used within a SyncRunProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/SyncRunProvider.test.tsx`
Expected: PASS (5 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/SyncRunProvider.tsx src/renderer/components/sync/SyncRunProvider.test.tsx
git commit -m "feat(ui): add SyncRunProvider for app-level sync run state"
```

---

## Task 2: Wrap App root in SyncRunProvider

**Files:**
- Modify: `src/renderer/App.tsx`

This is a transparent wrap (screens don't consume it yet) so the provider is available for the screen refactors in Tasks 4–5. The provider mounts its `onSyncProgress` subscription (the App test stub already provides `onSyncProgress`).

- [ ] **Step 1: Implement.**

In `src/renderer/App.tsx`:
- Add the import:
```tsx
import { SyncRunProvider } from './components/sync/SyncRunProvider';
```
- Wrap the root `<div className="flex h-full text-sm text-slate-800">…</div>` with `<SyncRunProvider>` inside `<ToastProvider>`:
```tsx
  return (
    <ToastProvider>
      <SyncRunProvider>
        <div className="flex h-full text-sm text-slate-800">
          {/* …unchanged… */}
        </div>
      </SyncRunProvider>
    </ToastProvider>
  );
```

- [ ] **Step 2: Run tests to verify nothing broke**

Run: `npx vitest run src/renderer/App.test.tsx` — all pass (the provider is transparent; its subscription uses the stubbed `onSyncProgress`). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ui): mount SyncRunProvider at the app root"
```

---

## Task 3: SyncStatus sidebar indicator

**Files:**
- Create: `src/renderer/components/sync/SyncStatus.tsx`
- Test: `src/renderer/components/sync/SyncStatus.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/sync/SyncStatus.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncProgress } from '../../../main/s3/sync';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncRunProvider, useSyncRun } from './SyncRunProvider';
import { SyncStatus } from './SyncStatus';

const ARGS = { source: { accountId: 's', bucket: 'src', prefix: '' }, dest: { accountId: 'd', bucket: 'dst', prefix: '' } };

function Starter() {
  const sr = useSyncRun();
  return <button onClick={() => void sr.runBucket(ARGS).catch(() => {})}>start</button>;
}

let progressCb: ((p: SyncProgress) => void) | undefined;
beforeEach(() => {
  progressCb = undefined;
  (window as unknown as { s3: unknown }).s3 = {
    onSyncProgress: vi.fn((cb: (p: SyncProgress) => void) => { progressCb = cb; return () => {}; }),
    runSync: vi.fn(() => new Promise(() => {})), // hangs: run stays active
    cancelSync: vi.fn(),
  };
});

function renderWithRun(onOpen: () => void) {
  return render(
    <ToastProvider>
      <SyncRunProvider>
        <Starter />
        <SyncStatus onOpen={onOpen} />
      </SyncRunProvider>
    </ToastProvider>,
  );
}

describe('SyncStatus', () => {
  it('renders nothing when idle', () => {
    render(
      <ToastProvider>
        <SyncRunProvider><SyncStatus onOpen={() => {}} /></SyncRunProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Listing… then Syncing count, and calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    renderWithRun(onOpen);
    await userEvent.click(screen.getByRole('button', { name: 'start' }));
    expect(await screen.findByRole('button', { name: 'Listing…' })).toBeInTheDocument();
    act(() => progressCb!({ phase: 'copying', copied: 3, total: 10, bytesCopied: 0, bytesTotal: 0, failed: 0 }));
    const status = screen.getByRole('button', { name: 'Syncing… 3/10' });
    await userEvent.click(status);
    expect(onOpen).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/SyncStatus.test.tsx`
Expected: FAIL — cannot find module `./SyncStatus`.

- [ ] **Step 3: Implement** — `src/renderer/components/sync/SyncStatus.tsx`:

```tsx
import { useSyncRun } from './SyncRunProvider';

export function SyncStatus({ onOpen }: { onOpen: () => void }) {
  const { running, progress } = useSyncRun();
  if (!running) return null;

  const label =
    progress?.phase === 'copying' ? `Syncing… ${progress.copied}/${progress.total}` : 'Listing…';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-600 hover:bg-slate-100"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/sync/SyncStatus.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/SyncStatus.tsx src/renderer/components/sync/SyncStatus.test.tsx
git commit -m "feat(ui): add SyncStatus sidebar indicator"
```

---

## Task 4: Refactor SyncScreen to use the provider

**Files:**
- Modify: `src/renderer/components/sync/SyncScreen.tsx`
- Modify: `src/renderer/components/sync/SyncScreen.test.tsx`

- [ ] **Step 1: Update the test wrapper.** In `src/renderer/components/sync/SyncScreen.test.tsx`, import the provider and wrap the rendered tree (the test's `window.s3` stub already includes `runSync`, `cancelSync`, `onSyncProgress`). Change the `wrap` helper:

Add import:
```tsx
import { SyncRunProvider } from './SyncRunProvider';
```
Change `wrap` to nest the provider inside `ToastProvider`:
```tsx
function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SyncRunProvider>{node}</SyncRunProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
```
(No assertion changes — the run path now flows through the provider but uses the same mocked `window.s3.runSync` and renders the same result/progress panels.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/sync/SyncScreen.test.tsx`
Expected: FAIL — `SyncScreen` still calls `useSync().run`/`.progress`/`.cancel` (which still exist) but does not yet read the provider; tests pass currently, so to make this a true red→green, first apply the test wrapper AND the implementation in this task. (If the wrapper alone leaves tests green, that's fine — proceed to Step 3; the meaningful check is Step 4 after the rewrite.)

- [ ] **Step 3: Implement** — replace `src/renderer/components/sync/SyncScreen.tsx` with:

```tsx
import { useState } from 'react';
import { useSync } from '../../hooks/useSync';
import { useSyncRun } from './SyncRunProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import type { Endpoint, SyncPlan } from '../../../main/s3/sync';

export function SyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [source, setSource] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const [dest, setDest] = useState<EndpointValue>({ accountId: null, bucket: null, prefix: '' });
  const { plan: planMutation } = useSync();
  const run = useSyncRun();
  const [plan, setPlan] = useState<SyncPlan | null>(null);

  const bothChosen = !!(source.accountId && source.bucket && dest.accountId && dest.bucket);
  const sameBucket = source.accountId === dest.accountId && source.bucket === dest.bucket;
  const identical = sameBucket && source.prefix === dest.prefix;
  const overlap = sameBucket && (dest.prefix.startsWith(source.prefix) || source.prefix.startsWith(dest.prefix));
  const canPreview = bothChosen && !identical && !overlap && !run.running && !planMutation.isPending;

  const toEndpoint = (v: EndpointValue): Endpoint => ({ accountId: v.accountId!, bucket: v.bucket!, prefix: v.prefix });
  const clearOutputs = () => { setPlan(null); run.clearResult(); };

  const onPreview = async () => {
    run.clearResult();
    try {
      setPlan(await planMutation.mutateAsync({ source: toEndpoint(source), dest: toEndpoint(dest) }));
    } catch {
      // planMutation errors surface via its thrown error; show nothing extra here
    }
  };

  const onRun = async () => {
    try {
      await run.runBucket({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setPlan(null);
    } catch {
      // error toasted by the provider
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (bucket → bucket)</h2>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <EndpointPicker label="Source" value={source} onChange={(v) => { setSource(v); clearOutputs(); }} />
        <EndpointPicker label="Destination" value={dest} onChange={(v) => { setDest(v); clearOutputs(); }} />
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
        {run.running && (
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={run.cancel}>
            Cancel
          </button>
        )}
      </div>

      {planMutation.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !run.running && (
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

      {run.running && run.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {run.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{run.progress.copied} / {run.progress.total} objects · {formatBytes(run.progress.bytesCopied)} / {formatBytes(run.progress.bytesTotal)}</p>
              {run.progress.currentKey && <p className="truncate text-xs text-slate-400">{run.progress.currentKey}</p>}
            </>
          )}
        </div>
      )}

      {run.result && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm">
          <p className="text-slate-700">
            {run.result.canceled ? 'Canceled — ' : ''}Copied {run.result.copied} object(s), {formatBytes(run.result.bytesCopied)}
            {run.result.failed.length > 0 ? ` · ${run.result.failed.length} failed` : ''}
          </p>
          {run.result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600">
              {run.result.failed.map((f) => (
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
Expected: PASS (all existing SyncScreen tests, now via the provider). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/SyncScreen.tsx src/renderer/components/sync/SyncScreen.test.tsx
git commit -m "refactor(ui): SyncScreen reads run state from SyncRunProvider"
```

---

## Task 5: Refactor LocalSyncScreen to use the provider

**Files:**
- Modify: `src/renderer/components/sync/LocalSyncScreen.tsx`
- Modify: `src/renderer/components/sync/LocalSyncScreen.test.tsx`

- [ ] **Step 1: Update the test wrapper.** In `src/renderer/components/sync/LocalSyncScreen.test.tsx`, add the provider import and wrap the tree (the stub already has `onSyncProgress`/`cancelSync`):

Add import:
```tsx
import { SyncRunProvider } from './SyncRunProvider';
```
Change `wrap`:
```tsx
function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SyncRunProvider>{node}</SyncRunProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
```

- [ ] **Step 2: Run test to verify current state**

Run: `npx vitest run src/renderer/components/sync/LocalSyncScreen.test.tsx`
Expected: passes with the wrapper (the rewrite in Step 3 is the substantive change; Step 4 is the real verification).

- [ ] **Step 3: Implement** — replace `src/renderer/components/sync/LocalSyncScreen.tsx` with:

```tsx
import { useState } from 'react';
import { useLocalSync } from '../../hooks/useLocalSync';
import { useSyncRun } from './SyncRunProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import { LocalFolderPicker } from './LocalFolderPicker';
import type { SyncPlan } from '../../../main/s3/sync';
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
  const { plan: planMutation } = useLocalSync();
  const run = useSyncRun();
  const [plan, setPlan] = useState<SyncPlan | null>(null);

  const ready = !!(localPath && remote.accountId && remote.bucket);
  const canPreview = ready && !run.running && !planMutation.isPending;
  const clearOutputs = () => { setPlan(null); run.clearResult(); };

  const toArgs = (): LocalSyncArgs => ({
    direction,
    localPath: localPath!,
    remote: { accountId: remote.accountId!, bucket: remote.bucket!, prefix: remote.prefix },
  });

  const onPreview = async () => {
    run.clearResult();
    try {
      setPlan(await planMutation.mutateAsync(toArgs()));
    } catch {
      // planMutation errors surface via its thrown error
    }
  };

  const onRun = async () => {
    try {
      await run.runLocal(toArgs());
      setPlan(null);
    } catch {
      // error toasted by the provider
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
        {run.running && (
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={run.cancel}>
            Cancel
          </button>
        )}
      </div>

      {planMutation.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !run.running && (
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

      {run.running && run.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {run.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{run.progress.copied} / {run.progress.total} objects · {formatBytes(run.progress.bytesCopied)} / {formatBytes(run.progress.bytesTotal)}</p>
              {run.progress.currentKey && <p className="truncate text-xs text-slate-400">{run.progress.currentKey}</p>}
            </>
          )}
        </div>
      )}

      {run.result && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm">
          <p className="text-slate-700">
            {run.result.canceled ? 'Canceled — ' : ''}Copied {run.result.copied} object(s), {formatBytes(run.result.bytesCopied)}
            {run.result.failed.length > 0 ? ` · ${run.result.failed.length} failed` : ''}
          </p>
          {run.result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600">
              {run.result.failed.map((f) => (
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
Expected: PASS (all existing LocalSyncScreen tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/sync/LocalSyncScreen.tsx src/renderer/components/sync/LocalSyncScreen.test.tsx
git commit -m "refactor(ui): LocalSyncScreen reads run state from SyncRunProvider"
```

---

## Task 6: Trim useSync / useLocalSync to plan-only

**Files:**
- Modify: `src/renderer/hooks/useSync.ts`
- Modify: `src/renderer/hooks/useLocalSync.ts`
- Modify: `src/renderer/hooks/useSync.test.tsx`
- Modify: `src/renderer/hooks/useLocalSync.test.tsx`

The screens (Tasks 4–5) no longer use `run`/`progress`/`cancel`/`resetProgress`, so those move out (they live in the provider now). The hooks keep only the preview `plan` mutation.

- [ ] **Step 1: Update the tests** — replace `src/renderer/hooks/useSync.test.tsx` with a plan-only test:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
  };
});

describe('useSync', () => {
  it('plan calls window.s3.planSync', async () => {
    const { result } = renderHook(() => useSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync({ source, dest });
    expect(window.s3.planSync).toHaveBeenCalledWith({ source, dest });
    expect(plan.toCopy).toBe(2);
  });
});
```

Replace `src/renderer/hooks/useLocalSync.test.tsx` with a plan-only test:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
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
  };
});

describe('useLocalSync', () => {
  it('plan calls window.s3.localSyncPlan', async () => {
    const { result } = renderHook(() => useLocalSync(), { wrapper: wrapper() });
    const plan = await result.current.plan.mutateAsync(args);
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith(args);
    expect(plan.toCopy).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/hooks/useSync.test.tsx src/renderer/hooks/useLocalSync.test.tsx`
Expected: the trimmed tests pass against the CURRENT (still-full) hooks (plan is unchanged), so they may already be green. The substantive change is Step 3 removing the now-dead members; verify with Step 4 + the full suite.

- [ ] **Step 3: Implement** — replace `src/renderer/hooks/useSync.ts` with:

```ts
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { Endpoint, SyncPlan } from '../../main/s3/sync';

export interface SyncEndpoints {
  source: Endpoint;
  dest: Endpoint;
}

export function useSync() {
  const plan = useMutation({
    mutationFn: async (v: SyncEndpoints): Promise<SyncPlan> => unwrap(await window.s3.planSync(v)),
  });
  return { plan };
}
```

Replace `src/renderer/hooks/useLocalSync.ts` with:

```ts
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { SyncPlan } from '../../main/s3/sync';
import type { LocalSyncArgs } from '../../main/s3/localSync';

export function useLocalSync() {
  const plan = useMutation({
    mutationFn: async (v: LocalSyncArgs): Promise<SyncPlan> => unwrap(await window.s3.localSyncPlan(v)),
  });
  return { plan };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/hooks/useSync.test.tsx src/renderer/hooks/useLocalSync.test.tsx`
Expected: PASS (1 test each). Then `npx tsc --noEmit` — 0 errors (confirms nothing else referenced the removed members).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useSync.ts src/renderer/hooks/useLocalSync.ts src/renderer/hooks/useSync.test.tsx src/renderer/hooks/useLocalSync.test.tsx
git commit -m "refactor(ui): trim useSync/useLocalSync to the preview plan mutation"
```

---

## Task 7: Wire SyncStatus into the sidebar

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the failing test** — append to the `App — Sync` describe block in `src/renderer/App.test.tsx`:

```tsx
  it('shows a sidebar sync indicator while a run is active and clicking it opens Sync', async () => {
    const s3 = window.s3 as unknown as Record<string, ReturnType<typeof vi.fn>>;
    s3.selectSyncDirectory = vi.fn().mockResolvedValue({ ok: true, data: '/data' });
    s3.localSyncPlan = vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 1, upToDate: 0, bytesToCopy: 10, sample: [] } });
    s3.localSyncRun = vi.fn(() => new Promise(() => {})); // hangs: run stays active

    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await userEvent.click(screen.getByRole('button', { name: 'Local ↔ Bucket' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByText('/data');
    await userEvent.selectOptions(screen.getByLabelText('Bucket account'), 'a');
    await userEvent.selectOptions(await screen.findByLabelText('Bucket bucket'), 'assets');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run sync' }));

    // Navigate away; the sidebar indicator stays visible.
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const indicator = await screen.findByRole('button', { name: 'Listing…' });
    await userEvent.click(indicator);

    // Clicking the indicator returns to the Sync section.
    expect(screen.getByText('Sync (local ↔ bucket)')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — there is no `Listing…` button in the sidebar (SyncStatus not wired in).

- [ ] **Step 3: Implement.** In `src/renderer/App.tsx`:
- Add the import:
```tsx
import { SyncStatus } from './components/sync/SyncStatus';
```
- In the `<aside>`, add the indicator under `<SectionNav>`:
```tsx
        <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
          <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
          <SectionNav active={section} onSelect={goToSection} />
          <SyncStatus onOpen={() => goToSection('sync')} />
        </aside>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS. Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): show the sync indicator in the sidebar"
```

---

## Manual smoke checklist (after Task 7)

`npm start` (renderer-only changes — HMR is enough, but a fresh start is fine), with an account + a writable bucket and a local folder:
1. Start a sync (bucket or local) → a green pulsing dot + `Listing…` then `Syncing… N/M` appears under the nav in the sidebar.
2. Navigate to Dashboard/Files/etc. → the indicator stays visible; the count keeps updating.
3. Click the indicator → it jumps back to the Sync section showing the full progress panel.
4. Let it finish → the indicator disappears, the completion toast fires (even if you're on another section), and the result panel remains on the Sync screen.
5. Start a run and click Cancel on the Sync screen → the run stops and the indicator disappears.

---

## Self-Review

**Spec coverage (against `2026-05-29-s3-manager-sync-indicator-design.md`):**
- `SyncRunProvider` + `useSyncRun` (running/progress/result, single `onSyncProgress` subscription, `runBucket`/`runLocal`/`cancel`/`clearResult`, completion toast) → Task 1. ✅
- Provider mounted at the app root inside `ToastProvider` → Tasks 2 (wrap) + 7 (already wrapped). ✅
- `SyncStatus` indicator (hidden when idle, `Listing…` / `Syncing… N/M`, click → open Sync, running-only) → Task 3 + wired in Task 7. ✅
- Screens read run state from the provider; preview/endpoint state stays local; keep-mounted retained → Tasks 4–5 (the App keep-mounted block from the prior fix is untouched). ✅
- Hooks trimmed to `{ plan }` → Task 6. ✅
- No backend/IPC changes → confirmed (no files under `src/main` touched). ✅
- Out of scope (outcome chip, percentage bar, concurrent runs) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. The two MODIFY-screen tasks give the full replacement file.

**Type consistency:** `SyncEndpoints` stays defined+exported in `useSync.ts` (Task 6) and imported as a type by the provider (Task 1) and used by `SyncScreen`'s `runBucket` call (Task 4). `useSyncRun()` returns `{ running, progress, result, runBucket, runLocal, cancel, clearResult }` — the exact members consumed by `SyncStatus` (Task 3) and both screens (Tasks 4–5). `runBucket(args: SyncEndpoints)` / `runLocal(args: LocalSyncArgs)` match `window.s3.runSync`/`localSyncRun` arg shapes. The screens use `planMutation` (renamed local binding of `useSync().plan`) — no remaining references to the removed `useSync().run`/`progress`/`cancel`/`resetProgress`. Progress/result/running now all read off `run.*` (the provider), and the rendered strings (`Listing both sides…`, `{copied} / {total} objects`, `Copied N object(s)`) are unchanged so existing screen tests keep matching.

**Note for implementers:** Tasks 4–6 each leave the full suite green because the screens stop using the hooks' run members (Tasks 4–5) before those members are removed (Task 6); the provider is already mounted in App (Task 2) before the screens depend on it (Tasks 4–5). These are renderer-only changes — no `npm start` restart semantics needed beyond normal HMR, though the post-Task-7 smoke can use a fresh start.
