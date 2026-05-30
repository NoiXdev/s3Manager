# S3 Manager — Settings Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire app settings end-to-end and build a Settings screen with one editable preference (default "Copy URL" expiry) plus a read-only About block, replacing the "Coming soon" placeholder.

**Architecture:** A typed `appSettings.ts` layer over the existing `settingsRepo` (read with defaults + clamping, write a patch), three IPC channels (`settings:get`/`settings:set`/`app:getInfo`), a `useSettings` hook, and a `SettingsScreen`. `useObjectActions.copyPresignedUrl` reads the persisted expiry.

**Tech Stack:** Electron IPC, SQLite (`app_settings` via `settingsRepo`), React 19, TanStack Query, Tailwind 4, Vitest + RTL.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/storage/settingsRepo.ts`: `createSettingsRepo(db)` → `{ get(key: string): string | undefined; set(key: string, value: string): void }` (on the `app_settings` table). `type SettingsRepo`.
- `src/main/ipc/register.ts`: `registerIpc(ipcMain, deps)`; `RegisterDeps` includes `{ accounts, secrets, settings, crypto, db, saveDialog, selectDirectory }`; `h(channel, fn)` helper; `clientFor`. `ok`/`toErr` imported. `deps.crypto.isEncryptionAvailable()` and `deps.accounts.list()` are available.
- `src/main.ts`: `import { app, BrowserWindow, ipcMain, safeStorage, dialog } from 'electron';` and a single `registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog, selectDirectory })` call.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`; `Result` imported. `src/main/ipc/register.test.ts`: `buildHarness()` builds a `deps` object (with `openDatabase(':memory:')` + `createSettingsRepo`) and there's a SECOND inline `deps` object in the "accounts:create is atomic" test — both must satisfy `RegisterDeps`. `fakeCrypto.isEncryptionAvailable: () => true`.
- `src/preload.ts`: no-arg methods use `() => invoke(CH.x)` (e.g. `accounts.list: () => invoke(CH.accountsList)`); arg methods `(a) => invoke(CH.x, a)`.
- `src/renderer/hooks/useObjectActions.ts`: `copyPresignedUrl(key)` currently calls `window.s3.presignGet({ accountId, bucket, key, expiresIn: 3600 })`. Its test (`useObjectActions.test.tsx`) stubs `window.s3` with `presignGet` (no `getSettings`) and asserts `expiresIn: 3600`.
- `src/renderer/App.tsx`: the section render ends with `) : section === 'sync' ? null : (<div …>Coming soon</div>)}` (followed by the keep-mounted `<SyncSection>` block). `useObjectDetails`-style hooks live in `src/renderer/hooks`.
- `SectionNav` already lists `settings` (label "Settings"); the nav button exists, only the screen is missing.

---

## File Structure

```
src/main/settings/appSettings.ts          # CREATE: AppSettings/AppInfo + readSettings/writeSettings
src/main/ipc/channels.ts                   # MODIFY: 3 channels + ApiMap
src/main/ipc/register.ts                   # MODIFY: 3 handlers + RegisterDeps.appVersion
src/main.ts                                # MODIFY: pass appVersion: app.getVersion()
src/preload.ts                             # MODIFY: getSettings / setSettings / getAppInfo
src/renderer/hooks/useSettings.ts          # CREATE
src/renderer/hooks/useObjectActions.ts     # MODIFY: copyPresignedUrl reads configured expiry
src/renderer/components/settings/SettingsScreen.tsx  # CREATE
src/renderer/App.tsx                       # MODIFY: render SettingsScreen for 'settings'
```

---

## Task 1: appSettings.ts — typed settings layer

**Files:**
- Create: `src/main/settings/appSettings.ts`
- Test: `src/main/settings/appSettings.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/settings/appSettings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readSettings, writeSettings } from './appSettings';

function fakeRepo() {
  const m = new Map<string, string>();
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => { m.set(k, v); } };
}

describe('readSettings', () => {
  it('returns the default expiry when unset', () => {
    expect(readSettings(fakeRepo())).toEqual({ presignExpirySeconds: 3600 });
  });

  it('returns a valid stored value', () => {
    const repo = fakeRepo();
    repo.set('presignExpirySeconds', '86400');
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400 });
  });

  it('falls back to the default for a non-numeric or out-of-range stored value', () => {
    const repo = fakeRepo();
    repo.set('presignExpirySeconds', 'nonsense');
    expect(readSettings(repo).presignExpirySeconds).toBe(3600);
    repo.set('presignExpirySeconds', '99999999');
    expect(readSettings(repo).presignExpirySeconds).toBe(3600);
  });
});

describe('writeSettings', () => {
  it('persists a value and returns the merged settings', () => {
    const repo = fakeRepo();
    const out = writeSettings(repo, { presignExpirySeconds: 86400 });
    expect(out).toEqual({ presignExpirySeconds: 86400 });
    expect(readSettings(repo)).toEqual({ presignExpirySeconds: 86400 });
  });

  it('clamps to the [1, 604800] range', () => {
    const repo = fakeRepo();
    expect(writeSettings(repo, { presignExpirySeconds: 99999999 }).presignExpirySeconds).toBe(604800);
    expect(writeSettings(repo, { presignExpirySeconds: 0 }).presignExpirySeconds).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/settings/appSettings.test.ts`
Expected: FAIL — cannot find module `./appSettings`.

- [ ] **Step 3: Implement** — `src/main/settings/appSettings.ts`:

```ts
import type { SettingsRepo } from '../storage/settingsRepo';

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/settings/appSettings.test.ts`
Expected: PASS (5 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/settings/appSettings.ts src/main/settings/appSettings.test.ts
git commit -m "feat: add typed app settings layer (read/write over settingsRepo)"
```

---

## Task 2: IPC wiring (channels + register + main + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add a type import near the other imports:
```ts
import type { AppSettings, AppInfo } from '../settings/appSettings';
```
Add to `CH`:
```ts
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  getAppInfo: 'app:getInfo',
```
Add to `ApiMap`:
```ts
  [CH.getSettings]: { args: []; res: Result<AppSettings> };
  [CH.setSettings]: { args: [Partial<AppSettings>]; res: Result<AppSettings> };
  [CH.getAppInfo]: { args: []; res: Result<AppInfo> };
```

- [ ] **Step 2: Add the failing test** — in `src/main/ipc/register.test.ts`:

First, add `appVersion: '1.2.3'` to BOTH `deps` objects (the one in `buildHarness()` and the inline one in the "accounts:create is atomic" test). Then append:

```ts
describe('settings & app info handlers', () => {
  it('settings:get returns the default and settings:set persists a new value', async () => {
    const { handlers } = buildHarness();
    const before = (await handlers.get(CH.getSettings)!()) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(before).toEqual({ ok: true, data: { presignExpirySeconds: 3600 } });

    const saved = (await handlers.get(CH.setSettings)!({ presignExpirySeconds: 86400 })) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(saved.data.presignExpirySeconds).toBe(86400);

    const after = (await handlers.get(CH.getSettings)!()) as { ok: boolean; data: { presignExpirySeconds: number } };
    expect(after.data.presignExpirySeconds).toBe(86400);
  });

  it('app:getInfo returns version, encryption status, and account count', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.getAppInfo)!()) as {
      ok: boolean; data: { version: string; encryptionAvailable: boolean; accountCount: number };
    };
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ version: '1.2.3', encryptionAvailable: true, accountCount: 0 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handlers for the new channels (and the every-channel test fails for the 3 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`:
- Add imports:
```ts
import { readSettings, writeSettings } from '../settings/appSettings';
import type { AppSettings } from '../settings/appSettings';
```
- Add to `RegisterDeps`:
```ts
  /** The app version string (Electron app.getVersion()), injected by main.ts. */
  appVersion: string;
```
- Register the handlers (anywhere in `registerIpc`, e.g. after the accounts handlers):
```ts
  h(CH.getSettings, () => ok(readSettings(deps.settings)));
  h(CH.setSettings, (patch: Partial<AppSettings>) => ok(writeSettings(deps.settings, patch)));
  h(CH.getAppInfo, () =>
    ok({
      version: deps.appVersion,
      encryptionAvailable: deps.crypto.isEncryptionAvailable(),
      accountCount: deps.accounts.list().length,
    }),
  );
```

In `src/main.ts`, change the `registerIpc(...)` call to include `appVersion`:
```ts
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog, selectDirectory, appVersion: app.getVersion() });
```

In `src/preload.ts`, add to the `api` object:
```ts
  getSettings: () => invoke(CH.getSettings),
  setSettings: (a: ApiMap[typeof CH.setSettings]['args'][0]) => invoke(CH.setSettings, a),
  getAppInfo: () => invoke(CH.getAppInfo),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire settings + app info IPC channels"
```

---

## Task 3: useSettings hook

**Files:**
- Create: `src/renderer/hooks/useSettings.ts`
- Test: `src/renderer/hooks/useSettings.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useSettings.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSettings } from './useSettings';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.2.3', encryptionAvailable: true, accountCount: 2 } }),
  };
});

describe('useSettings', () => {
  it('loads settings and app info', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.settings.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.info.isSuccess).toBe(true));
    expect(result.current.settings.data).toEqual({ presignExpirySeconds: 3600 });
    expect(result.current.info.data?.version).toBe('1.2.3');
  });

  it('save calls setSettings and invalidates the settings query', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.save.mutateAsync({ presignExpirySeconds: 86400 });
    expect(window.s3.setSettings).toHaveBeenCalledWith({ presignExpirySeconds: 86400 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useSettings.test.tsx`
Expected: FAIL — cannot find module `./useSettings`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useSettings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { AppSettings } from '../../main/settings/appSettings';

export function useSettings() {
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await window.s3.getSettings()),
  });

  const info = useQuery({
    queryKey: ['appInfo'],
    queryFn: async () => unwrap(await window.s3.getAppInfo()),
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => unwrap(await window.s3.setSettings(patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return { settings, info, save };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useSettings.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useSettings.ts src/renderer/hooks/useSettings.test.tsx
git commit -m "feat(ui): add useSettings hook"
```

---

## Task 4: useObjectActions — copyPresignedUrl reads the configured expiry

**Files:**
- Modify: `src/renderer/hooks/useObjectActions.ts`
- Modify: `src/renderer/hooks/useObjectActions.test.tsx`

- [ ] **Step 1: Update the tests** — in `src/renderer/hooks/useObjectActions.test.tsx`:

Add `getSettings` to the shared `window.s3` stub (next to `presignGet`):
```ts
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
```
Replace the existing `copyPresignedUrl` test with one asserting the configured expiry + a fallback case:
```ts
  it('copyPresignedUrl signs with the configured expiry and copies to the clipboard', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.copyPresignedUrl('logo.png');
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 86400 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed/x');
  });

  it('copyPresignedUrl falls back to 3600 when getSettings fails', async () => {
    (window.s3.getSettings as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: 'X', message: 'no' } });
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.copyPresignedUrl('logo.png');
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 3600 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectActions.test.tsx`
Expected: FAIL — the configured-expiry test expects `expiresIn: 86400` but the code still sends `3600` (and `getSettings` isn't called yet).

- [ ] **Step 3: Implement** — in `src/renderer/hooks/useObjectActions.ts`, change `copyPresignedUrl`:

```ts
    async copyPresignedUrl(key: string) {
      const s = await window.s3.getSettings();
      const expiresIn = s.ok ? s.data.presignExpirySeconds : 3600;
      const r = await window.s3.presignGet({ accountId, bucket, key, expiresIn });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      await navigator.clipboard.writeText(r.data);
      show('Signed URL copied');
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectActions.test.tsx`
Expected: PASS (all tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectActions.ts src/renderer/hooks/useObjectActions.test.tsx
git commit -m "feat(ui): copyPresignedUrl uses the configured default expiry"
```

---

## Task 5: SettingsScreen component

**Files:**
- Create: `src/renderer/components/settings/SettingsScreen.tsx`
- Test: `src/renderer/components/settings/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/settings/SettingsScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SettingsScreen } from './SettingsScreen';

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
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.2.3', encryptionAvailable: true, accountCount: 2 } }),
  };
});

describe('SettingsScreen', () => {
  it('shows the About info', async () => {
    wrap(<SettingsScreen />);
    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('reflects the current expiry and saves a new choice', async () => {
    wrap(<SettingsScreen />);
    const select = await screen.findByLabelText('Default link expiry');
    expect(select).toHaveValue('3600');
    await userEvent.selectOptions(select, '86400');
    await waitFor(() => expect(window.s3.setSettings).toHaveBeenCalledWith({ presignExpirySeconds: 86400 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: FAIL — cannot find module `./SettingsScreen`.

- [ ] **Step 3: Implement** — `src/renderer/components/settings/SettingsScreen.tsx`:

```tsx
import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../ui/ToastProvider';

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800">{value}</span>
    </div>
  );
}

export function SettingsScreen() {
  const { settings, info, save } = useSettings();
  const { show } = useToast();

  const expiry = settings.data?.presignExpirySeconds ?? 3600;

  const onChangeExpiry = async (value: number) => {
    try {
      await save.mutateAsync({ presignExpirySeconds: value });
      show('Settings saved');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Settings</h2>

      <div className="max-w-md">
        <label className="block text-sm">
          Default link expiry
          <select
            aria-label="Default link expiry"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={expiry}
            disabled={!settings.isSuccess || save.isPending}
            onChange={(e) => void onChangeExpiry(Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="pt-1 text-xs text-slate-500">Applies to “Copy URL” links generated from the metadata panel.</p>
      </div>

      <h3 className="pb-1 pt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">About</h3>
      <div className="max-w-md text-sm">
        {info.isSuccess ? (
          <>
            <InfoRow label="Version" value={info.data.version} />
            <InfoRow label="Secrets encryption" value={info.data.encryptionAvailable ? 'Enabled' : 'Unavailable'} />
            <InfoRow label="Accounts" value={String(info.data.accountCount)} />
          </>
        ) : (
          <p className="py-2 text-slate-500">Loading…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/SettingsScreen.tsx src/renderer/components/settings/SettingsScreen.test.tsx
git commit -m "feat(ui): add SettingsScreen"
```

---

## Task 6: App — render SettingsScreen for the settings section

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the failing test** — in `src/renderer/App.test.tsx`:

The existing "still shows Coming soon for non-Files sections" test clicks **Settings** and asserts "Coming soon" — that behavior changes, so UPDATE that test to assert the Settings screen instead (find it and change its body), OR if it targets a different section, leave it. Concretely, replace the Settings-clicking assertion with:
```tsx
  it('renders the Settings screen for the Settings section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Default link expiry')).toBeInTheDocument();
  });
```
Add `getSettings`/`getAppInfo`/`setSettings` to the App test's shared `window.s3` stub (so SettingsScreen's queries resolve):
```ts
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '0.0.0', encryptionAvailable: true, accountCount: 1 } }),
```
(If a prior test asserted `getByText('Coming soon')` for Settings specifically, remove/replace it; "Coming soon" is now unreachable via the nav. If it used a different always-"Coming soon" section, keep it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — Settings still renders "Coming soon"; no "Default link expiry" control.

- [ ] **Step 3: Implement** — in `src/renderer/App.tsx`:
- Add the import:
```tsx
import { SettingsScreen } from './components/settings/SettingsScreen';
```
- Change the tail of the section ternary so `settings` renders the screen (the generic fallback stays for any other section):
```tsx
          ) : section === 'sync' ? null : section === 'settings' ? (
            <SettingsScreen />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS. Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): render the Settings screen for the settings section"
```

---

## Manual smoke checklist (after Task 6)

`npm start` (full restart — main-process IPC handlers added):
1. Open **Settings** → see the **Default link expiry** dropdown (default "1 hour") and an **About** block (version, "Secrets encryption: Enabled" on a keychain-capable OS, account count).
2. Change the dropdown to "24 hours" → "Settings saved" toast.
3. Go to Files, select an object → **Copy URL** → the copied presigned GET URL carries `X-Amz-Expires=86400`.
4. Restart the app → Settings still shows "24 hours" (persisted in SQLite).

---

## Self-Review

**Spec coverage (against `2026-05-30-s3-manager-settings-screen-design.md`):**
- `appSettings.ts` (`readSettings` defaults/clamps, `writeSettings` persists + clamps + merges; `AppSettings`/`AppInfo`) → Task 1. ✅
- IPC `settings:get`/`settings:set`/`app:getInfo` + `RegisterDeps.appVersion` + `main.ts` injection + preload → Task 2. ✅
- `useSettings` (settings + info queries, save mutation invalidating) → Task 3. ✅
- `copyPresignedUrl` reads the configured expiry, falls back to 3600 → Task 4. ✅
- `SettingsScreen` (editable expiry dropdown → save + toast; read-only About) → Task 5. ✅
- App renders SettingsScreen for the settings section (replaces "Coming soon") → Task 6. ✅
- States/errors (loading states; save error toast; copy fallback; defensive clamp) → Tasks 1/4/5. ✅
- Out of scope (theme, download folder, other prefs, import/export, per-account) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands. Task 6 flags the existing "Coming soon" Settings test for update with the exact replacement.

**Type consistency:** `AppSettings` (`{ presignExpirySeconds: number }`) and `AppInfo` (`{ version, encryptionAvailable, accountCount }`) are defined once in `appSettings.ts` (Task 1) and imported by `channels.ts` (Task 2), `useSettings` (Task 3), and consumed by `SettingsScreen` (Task 5). `setSettings` takes `Partial<AppSettings>` consistently across the op (Task 1), `ApiMap`/register/preload (Task 2), the hook's `save` (Task 3), and the screen's `save.mutateAsync({ presignExpirySeconds })` (Task 5). The settings query key `['settings']` matches between the query (Task 3) and its invalidate. `window.s3.getSettings/setSettings/getAppInfo` names match across preload (Task 2), `useSettings` (Task 3), `useObjectActions` (Task 4), and all test stubs. `RegisterDeps.appVersion` (Task 2) is provided by `main.ts` and both test `deps` objects.

**Notes for implementers:** Task 2 adds a new `RegisterDeps` field, so BOTH `deps` objects in `register.test.ts` (the `buildHarness` one and the inline atomicity-test one) must gain `appVersion` or `tsc`/tests break — called out in the task. Task 2 adds main-process handlers, so the manual smoke needs a full `npm start` restart. Task 6 updates the App test that previously asserted "Coming soon" for Settings.
