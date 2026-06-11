# Dark Mode — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Add a user-selectable theme (System / Light / Dark) to the s3Manager Electron
app. "System" follows the OS appearance live. The choice persists across
restarts. Both the React UI and native window chrome (title bar, scrollbars,
native dialogs) reflect the chosen theme.

## Stack context

- Electron + React 19 + Tailwind CSS v4.
- Settings flow: `useSettings` (TanStack Query) → IPC (`window.s3.getSettings` /
  `setSettings`) → `src/main/settings/appSettings.ts` → SQLite settings repo.
- Styling: ~39 components using hardcoded light `slate-*` classes. No dark-mode
  infrastructure today; zero existing `dark:` usages.

## 1. Theme setting & persistence

Extend `AppSettings`:

```ts
export type ThemePreference = 'system' | 'light' | 'dark';
export interface AppSettings {
  presignExpirySeconds: number;
  theme: ThemePreference; // default 'system'
}
```

- `readSettings`: read `theme` key from repo; validate against the three allowed
  values; fall back to `'system'` on missing/invalid.
- `writeSettings`: when `patch.theme` is provided and valid, persist it via
  `repo.set('theme', patch.theme)`.
- No IPC surface changes — `getSettings`/`setSettings` already carry the whole
  `AppSettings` object, and `useSettings.save` accepts `Partial<AppSettings>`.

## 2. Applying the theme — two coordinated layers

### Tailwind layer (app content)

Configure Tailwind v4 to drive `dark:` off a `.dark` class instead of the OS
media query. One line in `src/renderer/index.css`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

A `useTheme` hook (renderer):

- Reads `settings.data.theme`.
- Resolves effective theme: `'system'` → `window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`; otherwise the forced value.
- Toggles the `dark` class on `document.documentElement`.
- When the preference is `'system'`, subscribes to the media query's `change`
  event so the class updates live as the OS theme changes; unsubscribes when the
  preference is not `'system'` or on unmount.

The hook is mounted once near the app root (e.g. in `App`).

### Native layer (window chrome)

On startup (after settings load) and whenever the theme setting changes, the
main process sets:

```ts
nativeTheme.themeSource = theme; // 'system' | 'light' | 'dark'
```

This themes the title bar, scrollbars, and native pickers, and makes the
renderer's `prefers-color-scheme` follow the chosen mode — keeping "System"
resolution consistent between the two layers.

Wiring: in the `setSettings` IPC handler, after writing settings, apply
`nativeTheme.themeSource` from the resulting theme. On app startup, apply it
once from the persisted settings.

## 3. Palette mapping (the component sweep)

The app is slate-based; dark mode stays slate. Apply a single consistent mapping
across all components by adding `dark:` counterparts next to existing classes.

| Light (current)                  | Dark variant to add                |
| -------------------------------- | ---------------------------------- |
| `bg-white` / `bg-slate-50`       | `dark:bg-slate-900`                |
| `bg-slate-100`                   | `dark:bg-slate-800`                |
| `bg-slate-200` (e.g. active nav) | `dark:bg-slate-700`                |
| `text-slate-800` / `-900`        | `dark:text-slate-100`              |
| `text-slate-700`                 | `dark:text-slate-200`              |
| `text-slate-600` / `-500`        | `dark:text-slate-400`              |
| `text-slate-400`                 | `dark:text-slate-500`              |
| `border-slate-200` / `-300`      | `dark:border-slate-700`            |
| `border-slate-100`               | `dark:border-slate-800`            |
| `hover:bg-slate-50` / `-100`     | `dark:hover:bg-slate-800`          |

### Special cases

- **Primary buttons** (`bg-slate-800 text-white hover:bg-slate-700`): these
  would blend into a dark background, so invert them to a light filled button in
  dark mode — `dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300`.
  Applies to the repeated primary-button pattern (CreateBucketDialog, NameDialog,
  FolderPicker, AccountForm, CorsEditor, ObjectLockEditor, PermissionsDialog,
  MetadataDialog, UploadLinkDialog, SyncScreen, LocalSyncScreen, and the
  segmented active-tab states using `bg-slate-800 text-white`).
- **Accents** — add lighter dark counterparts for contrast:
  - `text-red-600 → dark:text-red-400`, `bg-red-50 → dark:bg-red-950/50`,
    `border-red-300 → dark:border-red-800`, `bg-red-600/500` (badges) kept,
    `text-red`-style verified for contrast.
  - `emerald` fills → keep (already mid-tone, readable on dark).
  - `text-sky-700 → dark:text-sky-400`; `text-amber-700 → dark:text-amber-400`,
    `bg-amber-100 → dark:bg-amber-900/40`; `text-green-600 → dark:text-green-400`.
- **CORS JSON textarea** (`bg-slate-900 text-slate-100`): already dark; leave as
  is (optionally drop redundant dark overrides).
- **Toast** (`bg-slate-800` / `bg-red-600`): readable on both themes; keep.
- **App root container**: add base `dark:bg-slate-900 dark:text-slate-100` so
  layout gaps don't flash white.

## 4. Theme control in Settings

Add an "Appearance" section at the top of `SettingsScreen`, mirroring the
existing "Default link expiry" select pattern. A control offering **System /
Light / Dark** (segmented buttons or a `<select>`), saving via
`save.mutateAsync({ theme })` and showing the existing "Settings saved" toast.
The control itself is styled with the new `dark:` variants.

## 5. Testing

- **Unit (Vitest):**
  - `appSettings`: theme read defaults to `'system'`, rejects invalid values,
    round-trips valid values; existing `presignExpirySeconds` behavior unchanged.
  - `useTheme`: `'system'` resolves from a mocked `matchMedia`; `'light'`/`'dark'`
    force the class; toggles the `dark` class on the document element;
    subscribes to `matchMedia` `change` only when preference is `'system'` and
    cleans up on unmount/preference change.
- **Main wiring:** the `setSettings` handler sets `nativeTheme.themeSource` from
  the resolved theme (mock `nativeTheme`).
- **Component:** `SettingsScreen` renders the appearance control and calls
  `save` with the selected theme value.
- **Styling sweep:** not unit-tested; verified by running the app in all three
  modes and toggling the OS appearance while on "System".

## Out of scope (YAGNI)

- Per-component theme overrides or custom accent colors.
- Migrating to semantic color tokens (explicitly chose `dark:` variants).
- Animated theme transitions.
