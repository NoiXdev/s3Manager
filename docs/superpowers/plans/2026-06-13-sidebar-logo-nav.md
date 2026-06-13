# Sidebar Logo, Menu Icons & Nav Reordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the brand icon to the sidebar header, give every nav item a Feather icon, and reorder the menu to Dashboard → S3 tools → Settings → Accounts (promoting the former "Manage connections" button to an "Accounts" nav item, label-only rename).

**Architecture:** A new dependency-free `AppLogo` inlines the existing square icon SVG. `SectionNav` gains an `icon` per entry and a new ordered grouping that includes the `connections` section (rendered as "Accounts"). `App.tsx` adds the logo to the header and drops the standalone connections button. New i18n key `nav.accounts`, `connections.title` revalued, `app.manageConnections` removed.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS 4 (dark via `dark:`), react-icons/fi (`IconType` from `react-icons`), react-i18next (6 locales), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-13-sidebar-logo-nav-design.md`

**Conventions:**
- Tests load real i18n in English (`vitest.setup.ts`), so queries assert English strings.
- Single file: `npx vitest run <path>`. Full suite: `npm test`. Lint: `npm run lint`.
- Conventional Commits, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No pushing. Branch: `feat/improvements`.
- Icons are `aria-hidden`, so button accessible names stay the label text — role+name queries keep working.

---

### Task 1: `AppLogo` component

**Files:**
- Create: `src/renderer/components/AppLogo.tsx`
- Test: `src/renderer/components/AppLogo.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/components/AppLogo.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AppLogo } from './AppLogo';

describe('AppLogo', () => {
  it('renders an svg element', () => {
    const { container } = render(<AppLogo />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('forwards the className to the svg', () => {
    const { container } = render(<AppLogo className="h-7 w-7" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('h-7 w-7');
  });

  it('is hidden from assistive tech', () => {
    const { container } = render(<AppLogo />);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/AppLogo.test.tsx`
Expected: FAIL — cannot resolve `./AppLogo`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/AppLogo.tsx` (SVG content mirrors `build/icon.svg`; `id`s are suffixed to avoid collisions if the icon is ever rendered twice):

```tsx
export function AppLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="appLogoGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="108" height="108" rx="28" fill="url(#appLogoGrad)" />
      <rect x="30" y="38" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.96" />
      <rect x="30" y="60" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.80" />
      <rect x="30" y="82" width="60" height="14" rx="7" fill="#FFFFFF" fillOpacity="0.64" />
      <circle cx="82" cy="45" r="4.5" fill="#F59E0B" />
    </svg>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/AppLogo.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/AppLogo.tsx src/renderer/components/AppLogo.test.tsx
git commit -m "feat(ui): add inline AppLogo brand icon" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: i18n — add `nav.accounts`, revalue `connections.title`, remove `app.manageConnections`

**Files:**
- Modify: `src/renderer/i18n/locales/en.json`, `de.json`, `fr.json`, `pl.json`, `nl.json`, `ro.json`

Per-locale values:

| Locale | `nav.accounts` (new, in `nav` section) | `connections.title` (change existing) |
| --- | --- | --- |
| en | `Accounts` | `Accounts` |
| de | `Konten` | `Konten` |
| fr | `Comptes` | `Comptes` |
| nl | `Accounts` | `Accounts` |
| pl | `Konta` | `Konta` |
| ro | `Conturi` | `Conturi` |

- [ ] **Step 1: Edit all six locale files**

In each locale file:
1. Add `"accounts": "<value>"` to the `nav` object (e.g. after `nav.dashboard` / `nav.settings`).
2. Change the existing `connections.title` value to the per-locale value above.
3. Delete the `app.manageConnections` line from the `app` object.

Example diff for `en.json` (`nav` and `connections` sections):

```json
"nav": {
  "files": "Files",
  "objectLock": "Object Lock",
  "cors": "CORS",
  "sync": "Sync",
  "dashboard": "Dashboard",
  "settings": "Settings",
  "accounts": "Accounts"
},
```
and `"title": "Connections"` → `"title": "Accounts"` inside `connections`, and remove `"manageConnections": "Manage connections"` from `app`.

- [ ] **Step 2: Verify `app.manageConnections` is now unused**

Run: `grep -rn "manageConnections" src/`
Expected: no matches (the App.tsx usage is removed in Task 4; if this runs before Task 4, the only match is `App.tsx` — that is fine, it disappears in Task 4). Note: this i18n task commits together with nothing else; the dangling reference is resolved in Task 4, so DO NOT run the full suite as a gate here.

- [ ] **Step 3: Sanity-check JSON validity**

Run: `node -e "['en','de','fr','pl','nl','ro'].forEach(l=>JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/'+l+'.json','utf8')))"`
Expected: no output, exit 0 (all files are valid JSON).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/i18n/locales/*.json
git commit -m "i18n: rename Connections label to Accounts, drop manageConnections" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `SectionNav` — icons + reorder + Accounts item

**Files:**
- Modify: `src/renderer/components/SectionNav.tsx`
- Modify: `src/renderer/components/SectionNav.test.tsx`

- [ ] **Step 1: Rewrite the test file (failing first)**

Replace the FULL contents of `src/renderer/components/SectionNav.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionNav, type Section } from './SectionNav';

describe('SectionNav', () => {
  it('renders all sections including Accounts and marks the active one', () => {
    render(<SectionNav active="dashboard" onSelect={() => {}} />);
    for (const label of ['Dashboard', 'Files', 'Object Lock', 'CORS', 'Sync', 'Settings', 'Accounts']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('orders items Dashboard first, then S3 tools, then Settings and Accounts', () => {
    render(<SectionNav active="dashboard" onSelect={() => {}} />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['Dashboard', 'Files', 'Object Lock', 'CORS', 'Sync', 'Settings', 'Accounts']);
  });

  it('renders a divider between the primary and secondary groups', () => {
    render(<SectionNav active="files" onSelect={() => {}} />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('routes the Accounts item to the connections section', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="dashboard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(onSelect).toHaveBeenCalledWith('connections' satisfies Section);
  });

  it('calls onSelect with the section id when clicked', async () => {
    const onSelect = vi.fn();
    render(<SectionNav active="dashboard" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onSelect).toHaveBeenCalledWith('settings' satisfies Section);
  });
});
```

Note: `button.textContent` equals the label because the icon is `aria-hidden` and renders no text. The `getAllByRole('button')` order reflects DOM order, which is PRIMARY then SECONDARY.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: FAIL — "Accounts" button not found / order mismatch (old order + no Accounts item).

- [ ] **Step 3: Rewrite the component**

Replace the FULL contents of `src/renderer/components/SectionNav.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { IconType } from 'react-icons';
import { FiGrid, FiFolder, FiLock, FiGlobe, FiRefreshCw, FiSettings, FiUsers } from 'react-icons/fi';

export type Section =
  | 'files'
  | 'dashboard'
  | 'objectLock'
  | 'cors'
  | 'sync'
  | 'settings'
  | 'connections';

type NavItem = { id: Section; key: string; icon: IconType };

const PRIMARY: NavItem[] = [
  { id: 'dashboard', key: 'nav.dashboard', icon: FiGrid },
  { id: 'files', key: 'nav.files', icon: FiFolder },
  { id: 'objectLock', key: 'nav.objectLock', icon: FiLock },
  { id: 'cors', key: 'nav.cors', icon: FiGlobe },
  { id: 'sync', key: 'nav.sync', icon: FiRefreshCw },
];

const SECONDARY: NavItem[] = [
  { id: 'settings', key: 'nav.settings', icon: FiSettings },
  { id: 'connections', key: 'nav.accounts', icon: FiUsers },
];

export function SectionNav({
  active,
  onSelect,
}: {
  active: Section;
  onSelect: (section: Section) => void;
}) {
  const { t } = useTranslation();
  const renderItem = (s: NavItem) => {
    const isActive = s.id === active;
    const Icon = s.icon;
    return (
      <button
        key={s.id}
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onSelect(s.id)}
        className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
          isActive ? 'bg-slate-200 font-medium dark:bg-slate-700' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        {t(s.key)}
      </button>
    );
  };

  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY.map(renderItem)}
      <div role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
      {SECONDARY.map(renderItem)}
    </nav>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/components/SectionNav.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/SectionNav.tsx src/renderer/components/SectionNav.test.tsx
git commit -m "feat(nav): add menu icons and reorder with Accounts item" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `App.tsx` — logo header, drop the Manage-connections button, adapt App tests

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: Add the logo import and header in `App.tsx`**

Add the import near the other component imports (after the `SectionNav` import):

```tsx
import { AppLogo } from './components/AppLogo';
```

Replace the current header line (`App.tsx:74`):

```tsx
          <h1 className="px-2 pb-3 text-base font-semibold">{t('app.title')}</h1>
```

with:

```tsx
          <div className="flex items-center gap-2 px-2 pb-3">
            <AppLogo className="h-7 w-7 shrink-0" />
            <h1 className="text-base font-semibold">{t('app.title')}</h1>
          </div>
```

- [ ] **Step 2: Remove the standalone "Manage connections" button**

Delete the entire button block (`App.tsx:83-94`):

```tsx
          <button
            type="button"
            onClick={() => setSection('connections')}
            aria-current={section === 'connections' ? 'page' : undefined}
            className={`mb-3 rounded px-2 py-1.5 text-left ${
              section === 'connections'
                ? 'bg-slate-200 font-medium dark:bg-slate-700'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {t('app.manageConnections')}
          </button>
```

Leave the selectors block above it and the `<SectionNav .../>` below it intact. (Accounts is now reached via `SectionNav`, which already emits `'connections'`.)

- [ ] **Step 3: Run lint to confirm no unused symbols**

Run: `npm run lint`
Expected: no errors (no dangling `app.manageConnections` usage, no unused imports).

- [ ] **Step 4: Adapt `App.test.tsx`**

Two tests reference the removed button. Apply these edits:

(a) Test "opens the Connections screen from the Manage connections button" (around `App.test.tsx:63-64`). Replace its body:

```tsx
  it('opens the Accounts screen from the Accounts nav item', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(await screen.findByRole('heading', { name: 'Accounts' })).toBeInTheDocument();
  });
```

(b) Test "clears the selected account when it is removed in Connections" (around `App.test.tsx:106`). It currently clicks `{ name: 'Manage connections' }`; change that single line to:

```tsx
    await userEvent.click(screen.getByRole('button', { name: 'Accounts' }));
```

Everything else in that test (the `pick('Account', …)` before it, the Remove click, the final `toHaveTextContent('Select account')` assertion) stays unchanged.

- [ ] **Step 5: Run the App tests**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 6: Full suite + lint**

Run: `npm test`
Expected: all green (94 files / 449+ tests — AppLogo adds a file, SectionNav adds a test, net counts grow).

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(app): logo in sidebar header, Accounts nav replaces button" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** Logo (Task 1 + Task 4 header), menu icons (Task 3), reorder + Accounts item (Task 3), button removal (Task 4), label-only rename via `nav.accounts` + `connections.title` (Task 2), `app.manageConnections` removal (Task 2 + Task 4 usage), AppLogo test (Task 1), SectionNav test (Task 3), App test (Task 4). ConnectionsScreen.test.tsx intentionally untouched (no title assertion). All covered.
- **Ordering caveat:** Task 2 removes the `app.manageConnections` string while `App.tsx` still references it until Task 4. Running these tasks in order (2 → 3 → 4) means the full suite is only gated at the end of Task 4. Within Task 2, only JSON validity + a scoped grep are gated — not `npm test`.
- **Type consistency:** `Section` union unchanged (still includes `connections`); `NavItem` type used consistently; `IconType` imported from `react-icons`; all seven `Fi*` icons verified to exist.
