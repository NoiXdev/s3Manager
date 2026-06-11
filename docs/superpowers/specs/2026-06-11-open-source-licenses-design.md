# Open-Source Licenses (Third-Party Acknowledgements)

**Date:** 2026-06-11
**Status:** Approved design, ready for implementation plan

## Goal

Show users the open-source libraries the app is built on, with each
package's name, version, license, and a link to its source repository.
This is a standard third-party acknowledgements / "Open Source Licenses"
list, displayed inside the existing Settings screen.

## Scope

- **Coverage:** the *entire* installed dependency tree — `dependencies`,
  `devDependencies`, and all transitive packages (hundreds of entries).
- **Per package:** name, version, license (SPDX string), repository URL.
- **Not included:** full license text. Decision: ship metadata + repo link
  only, which is what most desktop apps do. Bundling full text for the whole
  tree would bloat the renderer for marginal benefit. (Revisit later if strict
  attribution requires verbatim notices.)

## Architecture

Three pieces: a build-time generator, a generated data file, and a
presentational UI component, plus one small IPC channel for opening links.

```
scripts/generate-licenses.mjs   (build-time, Node)
        │  scans node_modules via license-checker-rseidelsohn
        ▼
src/renderer/components/settings/licenses.generated.json   (committed)
        │  static import
        ▼
SettingsScreen ──passes array──▶ LicensesList (pure component)
                                      │ row click
                                      ▼
                            api.openExternal(url)  ──IPC──▶ shell.openExternal
```

## 1. Data generation (build-time)

- **New dev dependency:** `license-checker-rseidelsohn`.
- **Script:** `scripts/generate-licenses.mjs`, exposed as
  `"generate:licenses"` in package.json `scripts`.
  - Runs the checker over the full tree (start path = project root,
    no production-only filter).
  - Transforms the checker's verbose `{ "name@version": {...} }` output into
    a compact, **name-sorted** array:
    ```json
    [
      { "name": "react", "version": "19.2.0", "license": "MIT",
        "repository": "https://github.com/facebook/react" }
    ]
    ```
  - Missing fields degrade gracefully: unknown license → `"UNKNOWN"`,
    missing repository → `null` (rendered as non-clickable name).
  - The transform (verbose object → compact sorted array) is a **pure
    exported function** in the script module so it can be unit-tested
    independently of running the checker.
- **Output file:** `src/renderer/components/settings/licenses.generated.json`.

### Freshness wiring

- Add `"prepackage": "npm run generate:licenses"` so every packaged build
  regenerates the file from the actual installed tree.
- **Also commit** `licenses.generated.json`. Rationale: the renderer
  statically imports it, so `npm start`, Vite builds, and Vitest all need the
  file to exist. Gitignoring it would break dev start and tests. Committing it
  *and* regenerating on package keeps the repo runnable while guaranteeing
  shipped builds are fresh.

## 2. UI — collapsible list in Settings → About

Extend `SettingsScreen` (`src/renderer/components/settings/SettingsScreen.tsx`):
below the existing About `InfoRow`s, add an "Open source licenses" disclosure.

- **Toggle button** showing the count: `Show licenses (312)` /
  `Hide licenses (312)`. Collapsed by default.
- **When expanded**, render `<LicensesList licenses={...} />`.

### `LicensesList` component

New file `src/renderer/components/settings/LicensesList.tsx`. Pure /
data-in (matches the existing testable component style — no data fetching
inside).

- **Props:** `{ licenses: LicenseEntry[] }` where
  `LicenseEntry = { name: string; version: string; license: string; repository: string | null }`.
- **Search box:** filters by package name, case-insensitive substring.
- **List:** scrollable; each row shows `name · version` on the left and the
  license SPDX on the right. If `repository` is non-null, the name is a button/
  link that calls `openExternal(repository)`; otherwise it's plain text.
- **Empty filtered result:** show "No packages match."

The `LicenseEntry` type is declared once and shared between the component and
the JSON import site.

## 3. External links — `shell:openExternal` IPC

A minimal channel so the renderer can open repo URLs in the user's browser
safely (no new BrowserWindow, no nav hijack).

- **`channels.ts`:** add `openExternal: 'shell:openExternal'` to `CH` and
  `[CH.openExternal]: { args: [string]; res: Result<true> }` to `ApiMap`.
- **`register.ts`:** handler calls Electron `shell.openExternal(url)` and
  returns a `Result`. Validate the URL is `http(s):` before opening; reject
  anything else as an error Result (avoid opening arbitrary schemes).
- **`preload.ts`:** expose `openExternal: (url: string) => invoke(CH.openExternal, url)`.
- Reusable later for the app's own GitHub repo / issues links.

> Note (per project memory): changing main-process IPC requires a full
> `npm start` restart — Vite HMR only reloads the renderer, so a new handler
> won't register until restart.

## Testing (TDD)

- **`LicensesList.test.tsx`** — fixture array (a handful of entries):
  - renders all rows;
  - search filters by name (case-insensitive);
  - empty-match shows the empty state;
  - clicking a row with a repository calls a mocked `openExternal` with the URL;
  - a row with `repository: null` renders the name as non-clickable.
- **Generator transform test** — feed a small sample of verbose checker output
  to the exported transform; assert compact shape, name sort, and graceful
  defaults (UNKNOWN license, null repository).
- **`register.test.ts`** — extend with the `shell:openExternal` handler:
  http(s) URL → calls `shell.openExternal` and returns ok; non-http scheme →
  error Result without calling `shell.openExternal`.
- The generated JSON itself is **not** asserted (it changes with deps).

## Out of scope

- Full verbatim license texts.
- A dedicated nav section / standalone screen (chosen: collapsible in Settings).
- Surfacing that s3Manager itself is open source (repo/issues links) — the
  `openExternal` channel makes this easy to add later.
