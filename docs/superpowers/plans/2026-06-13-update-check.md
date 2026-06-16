# GitHub Update Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check the running app version against the latest GitHub release, surface a "Check for updates" button + Download link in Settings, and auto-check once per day on startup with an informational toast.

**Architecture:** A pure main-process module fetches `releases/latest` and compares semver; a new IPC channel exposes it. Settings gains `autoCheckUpdates` + `lastUpdateCheckAt`. The renderer adds a throttle helper, a mutation hook, Settings UI, and a render-null startup component (inside `ToastProvider`) that fires the daily check and toasts.

**Tech Stack:** Electron Forge, TypeScript, Node global `fetch` (no new dependency), TanStack Query, react-i18next (6 locales), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-13-update-check-design.md`

**Conventions:**
- Tests load real i18n in English (`vitest.setup.ts`); queries assert English strings.
- `Result<T>` via `ok(data)` / `err(code, message)` from `src/main/shared/result.ts`; renderer unwraps with `unwrap()` from `src/renderer/lib/result.ts` (throws on error).
- Single file: `npx vitest run <path>`. Full suite: `npm test`. Lint: `npm run lint`. Types: `npx tsc --noEmit`.
- Conventional Commits, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No pushing. Branch: `feat/update-check`.

---

### Task 1: Main — `checkForUpdate` module

**Files:**
- Create: `src/main/update/checkForUpdate.ts`
- Test: `src/main/update/checkForUpdate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/update/checkForUpdate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { compareVersions, checkForUpdate } from './checkForUpdate';

function fakeFetch(impl: { status: number; body?: unknown; throwError?: string }) {
  return vi.fn().mockImplementation(async () => {
    if (impl.throwError) throw new Error(impl.throwError);
    return {
      status: impl.status,
      ok: impl.status >= 200 && impl.status < 300,
      json: async () => impl.body,
    } as Response;
  }) as unknown as typeof fetch;
}

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });
  it('treats equal versions as 0 and strips a leading v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
  it('ignores a pre-release suffix on the core comparison', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
  });
  it('reports an older version as negative', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
  });
});

describe('checkForUpdate', () => {
  it('reports an available update from a newer tag', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({ status: 200, body: { tag_name: 'v2.0.0', html_url: 'https://example/r' } }),
      currentVersion: '1.0.0',
    });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' } });
  });

  it('reports up to date when the tag matches', async () => {
    const res = await checkForUpdate({
      fetchImpl: fakeFetch({ status: 200, body: { tag_name: 'v1.0.0', html_url: 'https://example/r' } }),
      currentVersion: '1.0.0',
    });
    expect(res.ok && res.data.updateAvailable).toBe(false);
  });

  it('treats a 404 (no releases) as up to date with the releases page url', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 404 }), currentVersion: '1.0.0' });
    expect(res).toEqual({ ok: true, data: { currentVersion: '1.0.0', latestVersion: null, updateAvailable: false, releaseUrl: 'https://github.com/NoiXdev/s3Manager/releases' } });
  });

  it('returns an error on a non-OK response', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 403 }), currentVersion: '1.0.0' });
    expect(res.ok).toBe(false);
  });

  it('returns an error when the request throws', async () => {
    const res = await checkForUpdate({ fetchImpl: fakeFetch({ status: 0, throwError: 'offline' }), currentVersion: '1.0.0' });
    expect(res.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/update/checkForUpdate.test.ts`
Expected: FAIL — cannot resolve `./checkForUpdate`.

- [ ] **Step 3: Implement the module**

Create `src/main/update/checkForUpdate.ts`:

```ts
import { ok, err, type Result } from '../shared/result';

export const GITHUB_REPO = 'NoiXdev/s3Manager';
const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
}

/** Parse "v1.2.3" / "1.2.3-beta.1" into [1,2,3]; ignores a leading v and any -prerelease suffix. */
function parseVersion(v: string): number[] {
  const core = v.replace(/^v/i, '').split('-')[0];
  return core.split('.').map((p) => Number.parseInt(p, 10) || 0);
}

/** >0 if a is newer than b, 0 if equal, <0 if older. Compares major.minor.patch numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdate({
  fetchImpl,
  currentVersion,
}: {
  fetchImpl: typeof fetch;
  currentVersion: string;
}): Promise<Result<UpdateInfo>> {
  let res: Response;
  try {
    res = await fetchImpl(LATEST_RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 's3Manager-update-check' },
    });
  } catch (e) {
    return err('UpdateCheckFailed', (e as Error).message);
  }
  if (res.status === 404) {
    return ok({ currentVersion, latestVersion: null, updateAvailable: false, releaseUrl: RELEASES_PAGE });
  }
  if (!res.ok) {
    return err('UpdateCheckFailed', `GitHub responded ${res.status}`);
  }
  let body: { tag_name?: string; html_url?: string };
  try {
    body = (await res.json()) as { tag_name?: string; html_url?: string };
  } catch (e) {
    return err('UpdateCheckFailed', (e as Error).message);
  }
  const tag = body.tag_name ?? '';
  const latestVersion = tag.replace(/^v/i, '') || null;
  const updateAvailable = tag !== '' && compareVersions(tag, currentVersion) > 0;
  return ok({ currentVersion, latestVersion, updateAvailable, releaseUrl: body.html_url ?? RELEASES_PAGE });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/update/checkForUpdate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` (0 errors), then:

```bash
git add src/main/update/checkForUpdate.ts src/main/update/checkForUpdate.test.ts
git commit -m "feat(update): add GitHub release version-check module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Settings schema — `autoCheckUpdates` + `lastUpdateCheckAt`

**Files:**
- Modify: `src/main/settings/appSettings.ts`
- Modify: `src/main/settings/appSettings.test.ts`

- [ ] **Step 1: Update existing assertions + add new failing tests**

In `src/main/settings/appSettings.test.ts`, the existing exact-equality assertions must include the new fields. Apply these replacements:

Replace each occurrence of `{ presignExpirySeconds: 3600, theme: 'system', language: 'system' }` with `{ presignExpirySeconds: 3600, theme: 'system', language: 'system', autoCheckUpdates: true, lastUpdateCheckAt: null }`.

Replace each occurrence of `{ presignExpirySeconds: 86400, theme: 'system', language: 'system' }` with `{ presignExpirySeconds: 86400, theme: 'system', language: 'system', autoCheckUpdates: true, lastUpdateCheckAt: null }`.

Then append a new describe block at the end of the file:

```ts
describe('update-check settings', () => {
  function fresh() {
    const m = new Map<string, string>();
    return { get: (k: string) => m.get(k), set: (k: string, v: string) => { m.set(k, v); } };
  }

  it('defaults autoCheckUpdates to true and lastUpdateCheckAt to null', () => {
    const s = readSettings(fresh());
    expect(s.autoCheckUpdates).toBe(true);
    expect(s.lastUpdateCheckAt).toBeNull();
  });

  it('persists autoCheckUpdates=false', () => {
    const repo = fresh();
    expect(writeSettings(repo, { autoCheckUpdates: false }).autoCheckUpdates).toBe(false);
    expect(readSettings(repo).autoCheckUpdates).toBe(false);
  });

  it('persists a numeric lastUpdateCheckAt and ignores invalid values', () => {
    const repo = fresh();
    expect(writeSettings(repo, { lastUpdateCheckAt: 1700000000000 }).lastUpdateCheckAt).toBe(1700000000000);
    repo.set('lastUpdateCheckAt', 'nonsense');
    expect(readSettings(repo).lastUpdateCheckAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/settings/appSettings.test.ts`
Expected: FAIL — `autoCheckUpdates`/`lastUpdateCheckAt` undefined; updated `toEqual`s fail.

- [ ] **Step 3: Implement the schema changes**

In `src/main/settings/appSettings.ts`:

Add to the `AppSettings` interface (after `language`):

```ts
  autoCheckUpdates: boolean;
  lastUpdateCheckAt: number | null;
```

In `readSettings`, before the `return`, add:

```ts
  const storedAuto = repo.get('autoCheckUpdates');
  const autoCheckUpdates = storedAuto === undefined ? true : storedAuto === 'true';
  const storedLast = repo.get('lastUpdateCheckAt');
  const lastN = storedLast !== undefined ? Number(storedLast) : NaN;
  const lastUpdateCheckAt = Number.isFinite(lastN) && lastN >= 0 ? lastN : null;
```

and change the return to:

```ts
  return { presignExpirySeconds, theme, language, autoCheckUpdates, lastUpdateCheckAt };
```

In `writeSettings`, before the final `return readSettings(repo);`, add:

```ts
  if (patch.autoCheckUpdates !== undefined) {
    repo.set('autoCheckUpdates', String(Boolean(patch.autoCheckUpdates)));
  }
  if (
    patch.lastUpdateCheckAt !== undefined &&
    patch.lastUpdateCheckAt !== null &&
    Number.isFinite(patch.lastUpdateCheckAt) &&
    patch.lastUpdateCheckAt >= 0
  ) {
    repo.set('lastUpdateCheckAt', String(Math.round(patch.lastUpdateCheckAt)));
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/settings/appSettings.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` (0 errors), then:

```bash
git add src/main/settings/appSettings.ts src/main/settings/appSettings.test.ts
git commit -m "feat(settings): add autoCheckUpdates and lastUpdateCheckAt" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC wiring — channel, handler, preload

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

Note: `main.ts` needs **no change** — the handler defaults `fetchImpl` to `globalThis.fetch`.

- [ ] **Step 1: Add the failing handler test**

In `src/main/ipc/register.test.ts`, change the `buildHarness` signature to accept overrides. Replace:

```ts
function buildHarness() {
```

with:

```ts
function buildHarness(overrides: Record<string, unknown> = {}) {
```

and in the same function, replace the deps tail line:

```ts
    openExternal: vi.fn().mockResolvedValue(undefined),
  };
```

with:

```ts
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
```

Then add this test inside the `describe('registerIpc', ...)` block:

```ts
  it('app:checkForUpdate reports a newer release as available', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ tag_name: 'v9.9.9', html_url: 'https://example/release' }),
    });
    const { handlers } = buildHarness({ fetchImpl });
    const res = (await handlers.get(CH.checkForUpdate)!()) as {
      ok: boolean;
      data: { updateAvailable: boolean; latestVersion: string };
    };
    expect(res.ok).toBe(true);
    expect(res.data.updateAvailable).toBe(true);
    expect(res.data.latestVersion).toBe('9.9.9');
  });
```

(The harness `appVersion` is `'1.2.3'`, so `9.9.9` is newer.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `CH.checkForUpdate` is `undefined`; also the "registers a handler for every channel" loop is unaffected yet.

- [ ] **Step 3: Add the channel**

In `src/main/ipc/channels.ts`:

Add the import (after the existing `AppSettings, AppInfo` import line):

```ts
import type { UpdateInfo } from '../update/checkForUpdate';
```

In the `CH` object, add after `openExternal: 'shell:openExternal',`:

```ts
  checkForUpdate: 'app:checkForUpdate',
```

In the `ApiMap` type, add after the `[CH.openExternal]` line:

```ts
  [CH.checkForUpdate]: { args: []; res: Result<UpdateInfo> };
```

- [ ] **Step 4: Add the handler**

In `src/main/ipc/register.ts`:

Add the import (after the `createBucket` import near the top, any import line is fine):

```ts
import { checkForUpdate } from '../update/checkForUpdate';
```

In the `RegisterDeps` interface, add after the `openExternal` field:

```ts
  /** Fetch implementation for the update check; defaults to globalThis.fetch. Injectable for tests. */
  fetchImpl?: typeof fetch;
```

After the `h(CH.getAppInfo, …)` handler block (just before the closing `}` of `registerIpc`), add:

```ts
  h(CH.checkForUpdate, () =>
    checkForUpdate({ fetchImpl: deps.fetchImpl ?? globalThis.fetch, currentVersion: deps.appVersion }),
  );
```

- [ ] **Step 5: Expose in preload**

In `src/preload.ts`, add after the `getAppInfo` line:

```ts
  checkForUpdate: () => invoke(CH.checkForUpdate),
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the new test and the every-channel loop).

- [ ] **Step 7: Types + lint + commit**

Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors), then:

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat(ipc): expose app:checkForUpdate channel" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Renderer — throttle helper

**Files:**
- Create: `src/renderer/lib/updateThrottle.ts`
- Test: `src/renderer/lib/updateThrottle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/lib/updateThrottle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldAutoCheck, UPDATE_CHECK_INTERVAL_MS } from './updateThrottle';

describe('shouldAutoCheck', () => {
  const now = 1_000_000_000_000;

  it('is true when auto-check is on and it was never checked', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: null, now })).toBe(true);
  });

  it('is true when the last check was at least the interval ago', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: now - UPDATE_CHECK_INTERVAL_MS, now })).toBe(true);
  });

  it('is false when the last check was within the interval', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: now - 1000, now })).toBe(false);
  });

  it('is false when auto-check is disabled', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: false, lastUpdateCheckAt: null, now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/lib/updateThrottle.test.ts`
Expected: FAIL — cannot resolve `./updateThrottle`.

- [ ] **Step 3: Implement**

Create `src/renderer/lib/updateThrottle.ts`:

```ts
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldAutoCheck({
  autoCheckUpdates,
  lastUpdateCheckAt,
  now,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
}: {
  autoCheckUpdates: boolean;
  lastUpdateCheckAt: number | null;
  now: number;
  intervalMs?: number;
}): boolean {
  if (!autoCheckUpdates) return false;
  if (lastUpdateCheckAt === null) return true;
  return now - lastUpdateCheckAt >= intervalMs;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/lib/updateThrottle.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/updateThrottle.ts src/renderer/lib/updateThrottle.test.ts
git commit -m "feat(update): add daily auto-check throttle helper" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Renderer — `useUpdateCheck` hook

**Files:**
- Create: `src/renderer/hooks/useUpdateCheck.ts`
- Test: `src/renderer/hooks/useUpdateCheck.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/hooks/useUpdateCheck.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateCheck } from './useUpdateCheck';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const info = { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    checkForUpdate: vi.fn().mockResolvedValue({ ok: true, data: info }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  };
});

describe('useUpdateCheck', () => {
  it('returns the update info and records the check time', async () => {
    const { result } = renderHook(() => useUpdateCheck(), { wrapper: wrapper() });
    result.current.mutate();
    await waitFor(() => expect(result.current.data).toEqual(info));
    const setSettings = (window.s3 as unknown as { setSettings: ReturnType<typeof vi.fn> }).setSettings;
    expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ lastUpdateCheckAt: expect.any(Number) }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/hooks/useUpdateCheck.test.tsx`
Expected: FAIL — cannot resolve `./useUpdateCheck`.

- [ ] **Step 3: Implement**

Create `src/renderer/hooks/useUpdateCheck.ts`:

```ts
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useUpdateCheck() {
  return useMutation({
    mutationFn: async () => unwrap(await window.s3.checkForUpdate()),
    onSuccess: () => {
      void window.s3.setSettings({ lastUpdateCheckAt: Date.now() });
    },
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/hooks/useUpdateCheck.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useUpdateCheck.ts src/renderer/hooks/useUpdateCheck.test.tsx
git commit -m "feat(update): add useUpdateCheck hook" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: i18n + Settings UI

**Files:**
- Modify: `src/renderer/i18n/locales/en.json`, `de.json`, `fr.json`, `pl.json`, `nl.json`, `ro.json`
- Modify: `src/renderer/components/settings/SettingsScreen.tsx`
- Modify: `src/renderer/components/settings/SettingsScreen.test.tsx`

- [ ] **Step 1: Add i18n keys to all six locales**

Add these keys inside the existing `settings` object, and add a new top-level `updates` object. Values per locale:

| Key | en | de |
| --- | --- | --- |
| `settings.checkUpdates` | `Check for updates` | `Nach Updates suchen` |
| `settings.checkingUpdates` | `Checking…` | `Wird geprüft…` |
| `settings.upToDate` | `You're on the latest version` | `Du nutzt die neueste Version` |
| `settings.updateAvailable` | `Version {{version}} available` | `Version {{version}} verfügbar` |
| `settings.updateDownload` | `Download` | `Herunterladen` |
| `settings.updateCheckFailed` | `Update check failed` | `Update-Prüfung fehlgeschlagen` |
| `settings.autoCheck` | `Check for updates on startup` | `Beim Start nach Updates suchen` |
| `settings.autoCheckHelp` | `At most once per day.` | `Höchstens einmal pro Tag.` |
| `updates.available` | `Update available: {{version}}` | `Update verfügbar: {{version}}` |

| Key | fr | pl |
| --- | --- | --- |
| `settings.checkUpdates` | `Rechercher des mises à jour` | `Sprawdź aktualizacje` |
| `settings.checkingUpdates` | `Vérification…` | `Sprawdzanie…` |
| `settings.upToDate` | `Vous utilisez la dernière version` | `Masz najnowszą wersję` |
| `settings.updateAvailable` | `Version {{version}} disponible` | `Dostępna wersja {{version}}` |
| `settings.updateDownload` | `Télécharger` | `Pobierz` |
| `settings.updateCheckFailed` | `Échec de la vérification des mises à jour` | `Sprawdzanie aktualizacji nie powiodło się` |
| `settings.autoCheck` | `Rechercher les mises à jour au démarrage` | `Sprawdzaj aktualizacje przy starcie` |
| `settings.autoCheckHelp` | `Au maximum une fois par jour.` | `Najwyżej raz dziennie.` |
| `updates.available` | `Mise à jour disponible : {{version}}` | `Dostępna aktualizacja: {{version}}` |

| Key | nl | ro |
| --- | --- | --- |
| `settings.checkUpdates` | `Controleren op updates` | `Caută actualizări` |
| `settings.checkingUpdates` | `Controleren…` | `Se verifică…` |
| `settings.upToDate` | `Je gebruikt de nieuwste versie` | `Folosești cea mai recentă versiune` |
| `settings.updateAvailable` | `Versie {{version}} beschikbaar` | `Versiunea {{version}} disponibilă` |
| `settings.updateDownload` | `Downloaden` | `Descarcă` |
| `settings.updateCheckFailed` | `Controle op updates mislukt` | `Verificarea actualizărilor a eșuat` |
| `settings.autoCheck` | `Bij opstarten op updates controleren` | `Caută actualizări la pornire` |
| `settings.autoCheckHelp` | `Hooguit één keer per dag.` | `Cel mult o dată pe zi.` |
| `updates.available` | `Update beschikbaar: {{version}}` | `Actualizare disponibilă: {{version}}` |

After editing, validate JSON: `node -e "['en','de','fr','pl','nl','ro'].forEach(l=>JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/'+l+'.json','utf8')))"` (exit 0).

- [ ] **Step 2: Write the failing Settings test**

Append to `src/renderer/components/settings/SettingsScreen.test.tsx` (inside the `describe('SettingsScreen', …)` block). It overrides `window.s3` with the update-check mocks:

```tsx
  it('checks for updates and offers a download when one is available', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, autoCheckUpdates: true } }),
      setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
      getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.0.0', encryptionAvailable: true, accountCount: 0 } }),
      openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }),
      checkForUpdate: vi.fn().mockResolvedValue({ ok: true, data: { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' } }),
    };
    wrap(<SettingsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Version 2.0.0 available')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(window.s3.openExternal).toHaveBeenCalledWith('https://example/r');
  });

  it('persists the auto-check toggle', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, autoCheckUpdates: true } }),
      setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, autoCheckUpdates: false } }),
      getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.0.0', encryptionAvailable: true, accountCount: 0 } }),
      openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }),
      checkForUpdate: vi.fn(),
    };
    wrap(<SettingsScreen />);
    const toggle = await screen.findByLabelText('Check for updates on startup');
    await userEvent.click(toggle);
    await waitFor(() => expect(window.s3.setSettings).toHaveBeenCalledWith({ autoCheckUpdates: false }));
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: FAIL — no "Check for updates" button yet.

- [ ] **Step 4: Implement the Settings UI**

In `src/renderer/components/settings/SettingsScreen.tsx`:

Add the import (after the existing hook imports):

```tsx
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
```

Inside the component, after `const [showLicenses, setShowLicenses] = useState(false);`, add:

```tsx
  const autoCheck = settings.data?.autoCheckUpdates ?? true;
  const check = useUpdateCheck();

  const onToggleAutoCheck = async (value: boolean) => {
    try {
      await save.mutateAsync({ autoCheckUpdates: value });
      show(t('common.settingsSaved'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };
```

Then, immediately **after** the About info `</div>` block (the one containing the `InfoRow`s) and **before** the licenses `<div className="max-w-md pt-4">` block, insert:

```tsx
      <div className="max-w-md pt-4">
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={check.isPending}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {t('settings.checkUpdates')}
        </button>
        <div className="pt-2 text-sm" aria-live="polite">
          {check.isPending && <span className="text-slate-500 dark:text-slate-400">{t('settings.checkingUpdates')}</span>}
          {check.isError && <span className="text-red-600 dark:text-red-400">{t('settings.updateCheckFailed')}</span>}
          {check.isSuccess && !check.data.updateAvailable && (
            <span className="text-slate-600 dark:text-slate-300">{t('settings.upToDate')}</span>
          )}
          {check.isSuccess && check.data.updateAvailable && (
            <span className="text-slate-800 dark:text-slate-100">
              {t('settings.updateAvailable', { version: check.data.latestVersion })}{' '}
              <button
                type="button"
                onClick={() => void window.s3.openExternal(check.data.releaseUrl)}
                className="text-sky-700 hover:underline dark:text-sky-400"
              >
                {t('settings.updateDownload')}
              </button>
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 pt-3 text-sm">
          <input
            type="checkbox"
            checked={autoCheck}
            disabled={save.isPending}
            onChange={(e) => void onToggleAutoCheck(e.target.checked)}
          />
          {t('settings.autoCheck')}
        </label>
        <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.autoCheckHelp')}</p>
      </div>
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: PASS (existing + 2 new tests).

- [ ] **Step 6: Types + lint + commit**

Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors), then:

```bash
git add src/renderer/i18n/locales/*.json src/renderer/components/settings/SettingsScreen.tsx src/renderer/components/settings/SettingsScreen.test.tsx
git commit -m "feat(settings): check-for-updates UI with download link and auto-check toggle" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Startup auto-check + toast

**Files:**
- Create: `src/renderer/components/StartupUpdateCheck.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

Why a separate component: `useToast()` must run **inside** `ToastProvider`, but `App` renders that provider, so the auto-check/toast logic lives in a render-null child mounted inside it.

- [ ] **Step 1: Write the failing App tests**

In `src/renderer/App.test.tsx`, add two tests in a new describe block (place after the existing describes). They set their own `getSettings`/`checkForUpdate` before `renderApp()`:

```tsx
describe('App — update check', () => {
  it('shows a toast when a due startup check finds an update', async () => {
    const s3 = window.s3 as unknown as Record<string, ReturnType<typeof vi.fn>>;
    s3.getSettings = vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system', autoCheckUpdates: true, lastUpdateCheckAt: null } });
    s3.setSettings = vi.fn().mockResolvedValue({ ok: true, data: {} });
    s3.checkForUpdate = vi.fn().mockResolvedValue({ ok: true, data: { currentVersion: '1.0.0', latestVersion: '2.0.0', updateAvailable: true, releaseUrl: 'https://example/r' } });
    renderApp();
    expect(await screen.findByText('Update available: 2.0.0')).toBeInTheDocument();
  });

  it('does not auto-check when the last check was recent', async () => {
    const s3 = window.s3 as unknown as Record<string, ReturnType<typeof vi.fn>>;
    s3.getSettings = vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system', autoCheckUpdates: true, lastUpdateCheckAt: Date.now() } });
    s3.checkForUpdate = vi.fn();
    renderApp();
    await screen.findByRole('button', { name: 'Files' });
    expect(s3.checkForUpdate).not.toHaveBeenCalled();
  });
});
```

Note: the existing shared `beforeEach` `getSettings` mock returns no `autoCheckUpdates`, so `shouldAutoCheck` returns false for all existing tests — they never call `checkForUpdate` and need no new mock.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — no toast (StartupUpdateCheck not wired yet).

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/StartupUpdateCheck.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../hooks/useSettings';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import { useToast } from './ui/ToastProvider';
import { shouldAutoCheck } from '../lib/updateThrottle';

/** Renders nothing; fires a daily-throttled update check on startup and toasts when one is available. */
export function StartupUpdateCheck() {
  const { settings } = useSettings();
  const check = useUpdateCheck();
  const { show } = useToast();
  const { t } = useTranslation();
  const fired = useRef(false);
  const toasted = useRef(false);

  useEffect(() => {
    if (fired.current || !settings.isSuccess) return;
    const due = shouldAutoCheck({
      autoCheckUpdates: settings.data.autoCheckUpdates,
      lastUpdateCheckAt: settings.data.lastUpdateCheckAt,
      now: Date.now(),
    });
    if (due) {
      fired.current = true;
      check.mutate();
    }
  }, [settings.isSuccess, settings.data, check]);

  useEffect(() => {
    if (toasted.current) return;
    if (check.data?.updateAvailable) {
      toasted.current = true;
      show(t('updates.available', { version: check.data.latestVersion }));
    }
  }, [check.data, show, t]);

  return null;
}
```

- [ ] **Step 4: Mount it inside ToastProvider in `App.tsx`**

Add the import (after the `SettingsScreen` import):

```tsx
import { StartupUpdateCheck } from './components/StartupUpdateCheck';
```

In the returned JSX, the outermost element is `<ToastProvider>`. Insert `<StartupUpdateCheck />` as its first child, immediately before `<SyncRunProvider>`:

```tsx
    <ToastProvider>
      <StartupUpdateCheck />
      <SyncRunProvider>
```

(Match the existing indentation; only that one line is added.)

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (existing 11 + 2 new).

- [ ] **Step 6: Full suite + types + lint**

Run: `npm test` (all green), `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/StartupUpdateCheck.tsx src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(update): daily startup update check with toast" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** check module + compareVersions (Task 1); IPC channel/handler/preload (Task 3); `autoCheckUpdates` + `lastUpdateCheckAt` (Task 2); throttle helper (Task 4); hook + timestamp recording (Task 5); Settings button/status/download/toggle + i18n (Task 6); startup auto-check + toast (Task 7). All spec sections covered.
- **Type consistency:** `UpdateInfo` defined in Task 1, imported in channels (Task 3); `checkForUpdate({ fetchImpl, currentVersion })` signature consistent across Tasks 1/3; `shouldAutoCheck({ autoCheckUpdates, lastUpdateCheckAt, now })` consistent across Tasks 4/7; `useUpdateCheck()` mutation API (`mutate`/`data`/`isPending`/`isError`/`isSuccess`) used consistently in Tasks 6/7.
- **No main.ts change:** handler defaults `fetchImpl` to `globalThis.fetch`; called out in Task 3.
- **Existing-test impact:** Task 2 updates the exact-equality `appSettings` assertions; Task 7 notes existing App tests don't trigger the auto-check (shared mock lacks `autoCheckUpdates`).
