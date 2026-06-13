# Sidebar logo, menu icons & nav reordering — design

## Summary

Three sidebar refinements: (1) add the brand icon to the sidebar header next to
the title, (2) give every navigation item a Feather icon, (3) reorder the menu
to Dashboard → S3 tools → Settings → Accounts, promoting the former "Manage
connections" button to a regular **Accounts** menu item and renaming the
user-facing label from "Connections" to "Accounts" ("Konten" in German).

## Decisions made

- **Logo:** square brand icon (the gradient badge from `build/icon.svg`) inlined
  as a React component, placed left of the existing title text. Not the full
  wordmark. The badge is self-contained color, so it needs no dark-mode theming;
  it is marked `aria-hidden` (decorative) because the adjacent title already
  announces "S3 Manager".
- **Rename scope:** user-facing labels only. The internal section id stays
  `connections` and the `ConnectionsScreen` component/files are unchanged. Only
  the nav label and the screen heading change to "Accounts"/"Konten"/…
- **"Manage connections" button is removed** — Accounts is now reached through the
  nav. The empty-state entry point (zero accounts) is preserved because the
  Accounts item is always visible in the menu.
- **One divider**, between the working area (Dashboard + tools) and app-level
  (Settings + Accounts). Dashboard sits at the top of the first group.

## Components

### New `src/renderer/components/AppLogo.tsx`

Inlines the square icon SVG (gradient rounded-rect with three white storage
layers and the amber status dot, matching `build/icon.svg`). Props: `className`
(forwarded to the `<svg>`, default sizing handled by the caller). The `<svg>`
carries `aria-hidden="true"` and `focusable="false"`. No i18n, no theming.

### `App.tsx`

- Header: replace the bare `<h1>` with a flex row:
  `<div className="flex items-center gap-2 px-2 pb-3"><AppLogo className="h-7 w-7 shrink-0" /><h1 className="text-base font-semibold">{t('app.title')}</h1></div>`
  (the current `px-2 pb-3` and title classes move onto this row / the `<h1>`).
- Remove the entire standalone "Manage connections" `<button>` block.
- The Account/Bucket selectors block stays where it is (between header and nav).
- No change to `goToSection`/section routing — `SectionNav` now emits
  `'connections'` directly when Accounts is clicked.

### `SectionNav.tsx`

- Each nav entry gains an `icon` field of type `IconType` (from `react-icons`).
- New ordered groups:
  - `PRIMARY`: Dashboard (`FiGrid`), Files (`FiFolder`), Object Lock (`FiLock`),
    CORS (`FiGlobe`), Sync (`FiRefreshCw`)
  - divider
  - `SECONDARY`: Settings (`FiSettings`), Accounts (`{ id: 'connections',
    key: 'nav.accounts', icon: FiUsers }`)
- `connections` is no longer excluded; the "standalone button" comment is removed.
- `renderItem` renders `<Icon className="h-4 w-4 shrink-0" aria-hidden /> {label}`
  inside the existing button, with `flex items-center gap-2` added to the button
  classes. The accessible name stays the label text (icon is `aria-hidden`), so
  role+name queries keep working.

## i18n

All six locales (en/de/fr/pl/nl/ro):

- **Add** `nav.accounts`: en `Accounts`, de `Konten`, fr `Comptes`, nl
  `Accounts`, pl `Konta`, ro `Conturi`.
- **Change** `connections.title` to the same per-locale values (screen heading
  consistency).
- **Remove** `app.manageConnections` (now unused — verify no other reference via
  `grep -rn "manageConnections" src/`).

## Testing

- **New `AppLogo.test.tsx`:** renders and contains an `<svg>` element.
- **`SectionNav.test.tsx`:** update the expected label set/order to
  `[Dashboard, Files, Object Lock, CORS, Sync, Settings, Accounts]`; replace the
  "does not render a Connections item" test with one asserting the **Accounts**
  item is present; assert clicking Accounts fires `onSelect('connections')`; the
  divider test stays.
- **`App.test.tsx`:** the two tests that click the "Manage connections" button
  now click the **Accounts** nav item; the Connections-screen heading assertion
  becomes "Accounts". No other assertions change.
- **`ConnectionsScreen.test.tsx`:** unaffected — it never asserts the screen
  title (only account names and form fields), so the `connections.title` value
  change needs no test update there.

## Out of scope

- No full code rename (`connections` id / `ConnectionsScreen` stay).
- No full wordmark logo or tagline in the sidebar.
- No second divider isolating Dashboard.
- The `<select>`s elsewhere, and any unrelated styling, are untouched.

## Open questions

None.
