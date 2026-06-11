# Open-Source Licenses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show users the full tree of open-source libraries the app uses — name, version, license, and repo link — in a searchable, collapsible list inside Settings → About.

**Architecture:** A build-time Node script scans the installed dependency tree via `license-checker-rseidelsohn` and writes a compact, committed JSON file. The renderer statically imports that JSON and renders it through a pure `LicensesList` component embedded in `SettingsScreen`. A minimal `shell:openExternal` IPC channel opens repo URLs in the user's browser.

**Tech Stack:** Electron + electron-forge (Vite), React 19, TypeScript, Vitest, Tailwind. New dev dep: `license-checker-rseidelsohn`.

**Design doc:** `docs/superpowers/specs/2026-06-11-open-source-licenses-design.md`

## File Structure

- `src/main/ipc/channels.ts` — **modify**: add `openExternal` channel + ApiMap entry.
- `src/main/ipc/register.ts` — **modify**: add `openExternal` to `RegisterDeps`; register handler (validate http(s), call `deps.openExternal`).
- `src/main/ipc/register.test.ts` — **modify**: add `openExternal` to test deps; cover the handler.
- `src/main.ts` — **modify**: wire `openExternal` dep to Electron `shell.openExternal`.
- `src/preload.ts` — **modify**: expose `openExternal` on the `s3` bridge.
- `scripts/licenses-transform.mjs` — **create**: pure `transform(raw)` (verbose checker output → compact sorted array).
- `scripts/licenses-transform.test.mjs` — **create**: unit tests for `transform`.
- `vitest.config.ts` — **modify**: include `scripts/**/*.test.mjs` in the node project.
- `scripts/generate-licenses.mjs` — **create**: runs the checker, calls `transform`, writes the JSON.
- `package.json` — **modify**: add `license-checker-rseidelsohn` devDep, `generate:licenses` and `prepackage` scripts.
- `src/renderer/components/settings/licenses.generated.json` — **create** (generated, committed).
- `src/renderer/components/settings/LicensesList.tsx` — **create**: pure list component + `LicenseEntry` type.
- `src/renderer/components/settings/LicensesList.test.tsx` — **create**.
- `src/renderer/components/settings/SettingsScreen.tsx` — **modify**: collapsible disclosure wiring.
- `src/renderer/components/settings/SettingsScreen.test.tsx` — **modify**: add disclosure coverage + `openExternal` mock.

---

## Task 1: `shell:openExternal` IPC channel

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/ipc/register.test.ts`
- Modify: `src/main.ts`
- Modify: `src/preload.ts`

- [ ] **Step 1: Add the channel + ApiMap entry**

In `src/main/ipc/channels.ts`, add to the `CH` object (after `getAppInfo`):

```ts
  openExternal: 'shell:openExternal',
```

And add to the `ApiMap` interface (after the `getAppInfo` line):

```ts
  [CH.openExternal]: { args: [string]; res: Result<true> };
```

- [ ] **Step 2: Add `openExternal` to `RegisterDeps`**

In `src/main/ipc/register.ts`, add to the `RegisterDeps` interface (after `appVersion`):

```ts
  /** Opens a URL in the user's default browser (Electron shell.openExternal), injected by main.ts. */
  openExternal: (url: string) => Promise<void>;
```

- [ ] **Step 3: Write the failing handler test**

In `src/main/ipc/register.test.ts`, add `openExternal: vi.fn().mockResolvedValue(undefined)` to the `deps` object inside `buildHarness` (alongside `selectDirectory`). Then add this test inside the `describe('registerIpc', ...)` block:

```ts
it('shell:openExternal opens http(s) urls', async () => {
  const { handlers, deps } = buildHarness();
  const res = await handlers.get(CH.openExternal)!('https://github.com/facebook/react');
  expect(res).toEqual({ ok: true, data: true });
  expect(deps.openExternal).toHaveBeenCalledWith('https://github.com/facebook/react');
});

it('shell:openExternal rejects non-http schemes', async () => {
  const { handlers, deps } = buildHarness();
  const res = await handlers.get(CH.openExternal)!('file:///etc/passwd');
  expect(res.ok).toBe(false);
  expect(deps.openExternal).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- src/main/ipc/register.test.ts`
Expected: FAIL — the `shell:openExternal` handler isn't registered (`handlers.get(...)` is undefined), and the "registers a handler for every channel" test also fails for the new channel.

- [ ] **Step 5: Register the handler**

In `src/main/ipc/register.ts`, inside `registerIpc`, add after the `h(CH.encryptionAvailable, ...)` line (reuses the existing `isHttpUrl` helper):

```ts
  h(CH.openExternal, async (url: string) => {
    if (!isHttpUrl(url)) return err('InvalidUrl', 'Only http(s) URLs can be opened externally');
    await deps.openExternal(url);
    return ok(true as const);
  });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/main/ipc/register.test.ts`
Expected: PASS (all tests, including "registers a handler for every channel").

- [ ] **Step 7: Wire the dep in main.ts**

In `src/main.ts`, change the import on line 1 to include `shell`:

```ts
import { app, BrowserWindow, ipcMain, safeStorage, dialog, shell } from 'electron';
```

Then update the `registerIpc(...)` call to pass `openExternal`:

```ts
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage, db, saveDialog, selectDirectory, appVersion: app.getVersion(), openExternal: (url) => shell.openExternal(url) });
```

- [ ] **Step 8: Expose on the preload bridge**

In `src/preload.ts`, add to the `api` object (after `updateObjectMetadata`, before `onSyncProgress`):

```ts
  openExternal: (url: string) => invoke(CH.openExternal, url),
```

- [ ] **Step 9: Lint + full test run**

Run: `npm run lint && npm test`
Expected: PASS, no lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/main.ts src/preload.ts
git commit -m "feat: add shell:openExternal IPC channel"
```

> Note (project memory): after this task, fully restart `npm start` — Vite HMR won't register the new main-process handler.

---

## Task 2: License data generator

**Files:**
- Create: `scripts/licenses-transform.mjs`
- Create: `scripts/licenses-transform.test.mjs`
- Modify: `vitest.config.ts`
- Create: `scripts/generate-licenses.mjs`
- Modify: `package.json`
- Create: `src/renderer/components/settings/licenses.generated.json` (via the script)

- [ ] **Step 1: Add `scripts/**/*.test.mjs` to the vitest node project**

In `vitest.config.ts`, change the node project's `include` line to:

```ts
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
```

- [ ] **Step 2: Write the failing transform test**

Create `scripts/licenses-transform.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { transform } from './licenses-transform.mjs';

describe('transform', () => {
  it('maps verbose checker output to a compact sorted array', () => {
    const raw = {
      'react@19.2.0': { licenses: 'MIT', repository: 'https://github.com/facebook/react' },
      '@aws-sdk/client-s3@3.500.0': { licenses: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
    };
    expect(transform(raw)).toEqual([
      { name: '@aws-sdk/client-s3', version: '3.500.0', license: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
      { name: 'react', version: '19.2.0', license: 'MIT', repository: 'https://github.com/facebook/react' },
    ]);
  });

  it('joins array licenses and defaults missing fields', () => {
    const raw = {
      'dual@1.0.0': { licenses: ['MIT', 'ISC'] },
      'bare@2.0.0': {},
    };
    expect(transform(raw)).toEqual([
      { name: 'bare', version: '2.0.0', license: 'UNKNOWN', repository: null },
      { name: 'dual', version: '1.0.0', license: 'MIT OR ISC', repository: null },
    ]);
  });

  it('splits scoped names on the last @', () => {
    const raw = { '@scope/pkg@1.2.3': { licenses: 'MIT' } };
    expect(transform(raw)[0]).toEqual({ name: '@scope/pkg', version: '1.2.3', license: 'MIT', repository: null });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- scripts/licenses-transform.test.mjs`
Expected: FAIL — cannot resolve `./licenses-transform.mjs` (module not found).

- [ ] **Step 4: Implement the transform**

Create `scripts/licenses-transform.mjs`:

```js
/**
 * Convert license-checker-rseidelsohn's verbose output
 * ({ "name@version": { licenses, repository, ... } }) into a compact,
 * name-then-version sorted array of { name, version, license, repository }.
 */
export function transform(raw) {
  return Object.entries(raw)
    .map(([key, info]) => {
      const at = key.lastIndexOf('@');
      const name = key.slice(0, at);
      const version = key.slice(at + 1);
      const licenses = info.licenses;
      const license = Array.isArray(licenses)
        ? licenses.join(' OR ')
        : (licenses || 'UNKNOWN');
      const repository = typeof info.repository === 'string' ? info.repository : null;
      return { name, version, license, repository };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- scripts/licenses-transform.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 6: Install the checker dev dependency**

Run: `npm install --save-dev license-checker-rseidelsohn`
Expected: package added to `devDependencies`.

- [ ] **Step 7: Write the generator script**

Create `scripts/generate-licenses.mjs`:

```js
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import checker from 'license-checker-rseidelsohn';
import { transform } from './licenses-transform.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'src/renderer/components/settings/licenses.generated.json');

checker.init({ start: root, direct: false }, (err, packages) => {
  if (err) {
    console.error('license generation failed:', err);
    process.exit(1);
  }
  const entries = transform(packages);
  writeFileSync(outFile, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Wrote ${entries.length} license entries to ${outFile}`);
});
```

- [ ] **Step 8: Add npm scripts**

In `package.json` `scripts`, add:

```json
    "generate:licenses": "node scripts/generate-licenses.mjs",
    "prepackage": "npm run generate:licenses",
```

- [ ] **Step 9: Generate the JSON file**

Run: `npm run generate:licenses`
Expected: prints `Wrote <N> license entries ...` and creates `src/renderer/components/settings/licenses.generated.json` (a sorted JSON array).

- [ ] **Step 10: Sanity-check the output**

Run: `node -e "const a=require('./src/renderer/components/settings/licenses.generated.json'); console.log(a.length, a[0])"`
Expected: a count in the hundreds and a well-formed first entry `{ name, version, license, repository }`.

- [ ] **Step 11: Commit**

```bash
git add scripts/licenses-transform.mjs scripts/licenses-transform.test.mjs scripts/generate-licenses.mjs vitest.config.ts package.json package-lock.json src/renderer/components/settings/licenses.generated.json
git commit -m "feat: generate third-party license data at build time"
```

---

## Task 3: `LicensesList` component

**Files:**
- Create: `src/renderer/components/settings/LicensesList.tsx`
- Create: `src/renderer/components/settings/LicensesList.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `src/renderer/components/settings/LicensesList.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LicensesList, type LicenseEntry } from './LicensesList';

const FIXTURE: LicenseEntry[] = [
  { name: 'react', version: '19.2.0', license: 'MIT', repository: 'https://github.com/facebook/react' },
  { name: '@aws-sdk/client-s3', version: '3.500.0', license: 'Apache-2.0', repository: 'https://github.com/aws/aws-sdk-js-v3' },
  { name: 'no-repo-pkg', version: '1.0.0', license: 'ISC', repository: null },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = { openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }) };
});

describe('LicensesList', () => {
  it('renders a row per package', () => {
    render(<LicensesList licenses={FIXTURE} />);
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('@aws-sdk/client-s3')).toBeInTheDocument();
    expect(screen.getByText('Apache-2.0')).toBeInTheDocument();
  });

  it('filters by name, case-insensitive', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.type(screen.getByPlaceholderText('Filter packages…'), 'AWS');
    expect(screen.getByText('@aws-sdk/client-s3')).toBeInTheDocument();
    expect(screen.queryByText('react')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.type(screen.getByPlaceholderText('Filter packages…'), 'zzzzz');
    expect(screen.getByText('No packages match.')).toBeInTheDocument();
  });

  it('opens the repository externally when a linked name is clicked', async () => {
    render(<LicensesList licenses={FIXTURE} />);
    await userEvent.click(screen.getByRole('button', { name: 'react' }));
    expect(window.s3.openExternal).toHaveBeenCalledWith('https://github.com/facebook/react');
  });

  it('renders names without a repository as plain text', () => {
    render(<LicensesList licenses={FIXTURE} />);
    expect(screen.queryByRole('button', { name: 'no-repo-pkg' })).not.toBeInTheDocument();
    expect(screen.getByText('no-repo-pkg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/renderer/components/settings/LicensesList.test.tsx`
Expected: FAIL — cannot resolve `./LicensesList`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/settings/LicensesList.tsx`:

```tsx
import { useMemo, useState } from 'react';

export interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  repository: string | null;
}

export function LicensesList({ licenses }: { licenses: LicenseEntry[] }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return licenses;
    return licenses.filter((l) => l.name.toLowerCase().includes(q));
  }, [licenses, query]);

  return (
    <div className="mt-2">
      <input
        type="search"
        placeholder="Filter packages…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-2 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
      {filtered.length === 0 ? (
        <p className="py-2 text-slate-500">No packages match.</p>
      ) : (
        <ul className="max-h-80 overflow-auto rounded border border-slate-100">
          {filtered.map((l) => (
            <li
              key={`${l.name}@${l.version}`}
              className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5 last:border-b-0"
            >
              <span className="truncate">
                {l.repository ? (
                  <button
                    type="button"
                    onClick={() => void window.s3.openExternal(l.repository as string)}
                    className="text-sky-700 hover:underline"
                  >
                    {l.name}
                  </button>
                ) : (
                  <span className="text-slate-800">{l.name}</span>
                )}
                <span className="pl-1.5 text-slate-400">{l.version}</span>
              </span>
              <span className="shrink-0 text-slate-500">{l.license}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/renderer/components/settings/LicensesList.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings/LicensesList.tsx src/renderer/components/settings/LicensesList.test.tsx
git commit -m "feat: add LicensesList component"
```

---

## Task 4: Wire the disclosure into SettingsScreen

**Files:**
- Modify: `src/renderer/components/settings/SettingsScreen.tsx`
- Modify: `src/renderer/components/settings/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing disclosure test**

In `src/renderer/components/settings/SettingsScreen.test.tsx`, add `openExternal: vi.fn().mockResolvedValue({ ok: true, data: true })` to the `window.s3` mock in `beforeEach`. Then add this test inside the `describe('SettingsScreen', ...)` block:

```ts
it('toggles the open-source licenses list', async () => {
  wrap(<SettingsScreen />);
  const toggle = await screen.findByRole('button', { name: /open source licenses/i });
  expect(screen.queryByPlaceholderText('Filter packages…')).not.toBeInTheDocument();
  await userEvent.click(toggle);
  expect(screen.getByPlaceholderText('Filter packages…')).toBeInTheDocument();
  await userEvent.click(toggle);
  expect(screen.queryByPlaceholderText('Filter packages…')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: FAIL — no button matching `/open source licenses/i`.

- [ ] **Step 3: Wire the disclosure into SettingsScreen**

In `src/renderer/components/settings/SettingsScreen.tsx`:

Add imports at the top (after the existing imports):

```ts
import { useState } from 'react';
import { LicensesList, type LicenseEntry } from './LicensesList';
import licensesData from './licenses.generated.json';

const LICENSES = licensesData as unknown as LicenseEntry[];
```

Inside `SettingsScreen`, add state at the top of the component body (after the existing `const expiry = ...` line):

```ts
  const [showLicenses, setShowLicenses] = useState(false);
```

Then, immediately before the closing `</div>` of the outer `<div className="h-full overflow-auto p-6">`, add the disclosure block (below the existing About `<div className="max-w-md text-sm">...</div>`):

```tsx
        <div className="max-w-md pt-4">
          <button
            type="button"
            onClick={() => setShowLicenses((v) => !v)}
            aria-expanded={showLicenses}
            className="text-sm text-sky-700 hover:underline"
          >
            {showLicenses ? 'Hide' : 'Show'} open source licenses ({LICENSES.length})
          </button>
          {showLicenses && <LicensesList licenses={LICENSES} />}
        </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/renderer/components/settings/SettingsScreen.test.tsx`
Expected: PASS (all tests, including the new toggle test).

- [ ] **Step 5: Lint + full test run**

Run: `npm run lint && npm test`
Expected: PASS, no lint errors.

- [ ] **Step 6: Manual verification**

Run: `npm start` (full restart — Task 1 changed main-process IPC). Open Settings → About, click "Show open source licenses (N)", confirm the list renders, the filter narrows it, and clicking a package name opens its repo in the browser.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/SettingsScreen.tsx src/renderer/components/settings/SettingsScreen.test.tsx
git commit -m "feat: show open source licenses in Settings"
```

---

## Self-Review Notes

- **Spec coverage:** generation tool + script (Task 2), entire-tree scope via `direct: false` (Task 2 Step 7), metadata-only no license text (transform shape, Task 2), committed JSON + `prepackage` freshness (Task 2 Steps 8–11), collapsible-in-Settings UI with search + count (Tasks 3–4), `shell:openExternal` with http(s) validation (Task 1), TDD coverage for component/transform/handler (all tasks). All spec sections map to a task.
- **Type consistency:** `LicenseEntry { name, version, license, repository }` is defined once in `LicensesList.tsx` and reused by the JSON cast in `SettingsScreen.tsx`; the transform in Task 2 emits exactly these keys.
- **Generated JSON not asserted:** by design — it changes with deps.
