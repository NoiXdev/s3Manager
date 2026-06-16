# Duplicate Import & Dismissible Modals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn + offer skip/copy/replace when an imported account name already exists, and make all 10 modals dismissible via Esc and backdrop click through a shared `Modal` wrapper.

**Architecture:** `accountsImport` gains an `onDuplicate` mode applied per name-collision inside its transaction. A new `ui/Modal` owns the overlay + Esc/backdrop dismissal; the 10 dialogs adopt it. The import dialog detects collisions from its preview list and surfaces the chooser.

**Tech Stack:** Electron Forge, TypeScript, TanStack Query, react-i18next (6 locales), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-16-duplicate-and-modal-design.md`

**Conventions:** `Result<T>` via `ok`/`err`; renderer `unwrap()`; `Account = { id, label, provider, region, accessKeyId, endpoint?, forcePathStyle, createdAt }`; `deps.accounts.update(id, NewAccount)` updates in place. Tests load real i18n (English). `npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint`. Conventional Commits, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No pushing. Branch: `feat/account-import-export`.

---

### Task 1: `accountsImport` duplicate mode

**Files:**
- Modify: `src/main/ipc/channels.ts`, `src/main/ipc/register.ts`, `src/main/ipc/register.test.ts`, `src/renderer/hooks/useAccountTransfer.ts`

- [ ] **Step 1: Add the failing handler tests**

In `src/main/ipc/register.test.ts`, add inside `describe('registerIpc', …)`:

```ts
  it('accounts:import skips a same-named account when onDuplicate=skip', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const { handlers, deps } = buildHarness();
    await handlers.get(CH.accountsCreate)!({ label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'OLD', secretAccessKey: 'OLDS' });
    const blob = exportAccounts([
      { label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'NEW', secretAccessKey: 'NEWS' },
      { label: 'Fresh', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'FK', secretAccessKey: 'FS' },
    ]);
    const res = (await handlers.get(CH.accountsImport)!({ blob, onDuplicate: 'skip' })) as { ok: boolean; data: { label: string }[] };
    expect(res.ok).toBe(true);
    expect(res.data.map((a) => a.label)).toEqual(['Fresh']);
    expect(deps.accounts.list().filter((a) => a.label === 'AWS')).toHaveLength(1);
    expect(deps.accounts.list().find((a) => a.label === 'AWS')!.accessKeyId).toBe('OLD');
  });

  it('accounts:import creates a copy when onDuplicate=copy (default)', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const { handlers, deps } = buildHarness();
    await handlers.get(CH.accountsCreate)!({ label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'OLD', secretAccessKey: 'OLDS' });
    const blob = exportAccounts([{ label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'NEW', secretAccessKey: 'NEWS' }]);
    const res = (await handlers.get(CH.accountsImport)!({ blob })) as { ok: boolean };
    expect(res.ok).toBe(true);
    expect(deps.accounts.list().filter((a) => a.label === 'AWS')).toHaveLength(2);
  });

  it('accounts:import overwrites the existing account when onDuplicate=replace', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({ label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'OLD', secretAccessKey: 'OLDS' })) as { data: { id: string } };
    const blob = exportAccounts([{ label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'NEW', secretAccessKey: 'NEWS' }]);
    const res = (await handlers.get(CH.accountsImport)!({ blob, onDuplicate: 'replace' })) as { ok: boolean; data: { id: string }[] };
    expect(res.ok).toBe(true);
    const list = deps.accounts.list().filter((a) => a.label === 'AWS');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.data.id);
    expect(list[0].accessKeyId).toBe('NEW');
    expect(deps.secrets.get(created.data.id)).toBe('NEWS');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `onDuplicate` ignored (current handler always creates).

- [ ] **Step 3: Widen the channel arg (`channels.ts`)**

Replace the `[CH.accountsImport]` line with:

```ts
  [CH.accountsImport]: { args: [{ blob: string; password?: string; onDuplicate?: 'skip' | 'copy' | 'replace' }]; res: Result<Account[]> };
```

- [ ] **Step 4: Apply the mode in the handler (`register.ts`)**

Replace the whole `h(CH.accountsImport, …)` handler with:

```ts
  h(CH.accountsImport, (a: { blob: string; password?: string; onDuplicate?: 'skip' | 'copy' | 'replace' }) => {
    let parsed: ExportAccount[];
    try {
      parsed = importAccounts(a.blob, a.password);
    } catch (e) {
      if (e instanceof TransferError) return err(e.code, e.message);
      throw e;
    }
    const resolved: { acc: ExportAccount; params: ConnParams }[] = [];
    for (const acc of parsed) {
      if (!isKnownProvider(acc.provider)) {
        return err('InvalidProvider', `Unknown provider: ${acc.provider}`);
      }
      const params = resolveConnParams(acc);
      if (!params.ok) return params;
      resolved.push({ acc, params: params.data });
    }
    const mode = a.onDuplicate ?? 'copy';
    const existing = deps.accounts.list();
    const result = deps.db.transaction(() => {
      const out = [];
      for (const { acc, params } of resolved) {
        const dup = existing.find((e) => e.label === acc.label);
        const fields = {
          label: acc.label,
          provider: acc.provider,
          endpoint: params.endpoint,
          region: acc.region,
          accessKeyId: acc.accessKeyId,
          forcePathStyle: params.forcePathStyle,
        };
        if (dup && mode === 'skip') {
          continue;
        }
        if (dup && mode === 'replace') {
          const updated = deps.accounts.update(dup.id, fields);
          deps.secrets.set(dup.id, acc.secretAccessKey);
          out.push(updated);
        } else {
          const a2 = deps.accounts.create(fields);
          deps.secrets.set(a2.id, acc.secretAccessKey);
          out.push(a2);
        }
      }
      return out;
    })();
    return ok(result);
  });
```

- [ ] **Step 5: Widen the hook input type (`useAccountTransfer.ts`)**

In `useImportAccounts`, change the mutationFn input type:

```ts
    mutationFn: async (input: { blob: string; password?: string; onDuplicate?: 'skip' | 'copy' | 'replace' }) =>
      unwrap(await window.s3.accounts.import(input)),
```

- [ ] **Step 6: Run to verify pass + types + lint**

Run: `npx vitest run src/main/ipc/register.test.ts` (pass). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main/ipc/register.test.ts src/renderer/hooks/useAccountTransfer.ts
git commit -m "feat(accounts): import duplicate mode (skip/copy/replace)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: shared `Modal` wrapper

**Files:**
- Create: `src/renderer/components/ui/Modal.tsx`
- Test: `src/renderer/components/ui/Modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/ui/Modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders a dialog with the panel content', () => {
    render(<Modal onDismiss={() => {}} className="w-96">hi</Modal>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}>hi</Modal>);
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a backdrop click', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}>hi</Modal>);
    await userEvent.click(screen.getByRole('dialog'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss when clicking inside the panel', async () => {
    const onDismiss = vi.fn();
    render(<Modal onDismiss={onDismiss}><button type="button">inside</button></Modal>);
    await userEvent.click(screen.getByText('inside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/ui/Modal.test.tsx`
Expected: FAIL — cannot resolve `./Modal`.

- [ ] **Step 3: Implement**

Create `src/renderer/components/ui/Modal.tsx`:

```tsx
import { useEffect, type ReactNode } from 'react';

export function Modal({
  onDismiss,
  className,
  children,
}: {
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div className={className ?? 'rounded bg-white p-4 shadow-lg dark:bg-slate-900'}>{children}</div>
    </div>
  );
}
```

Note: backdrop dismissal uses `onMouseDown` with `e.target === e.currentTarget` so a click that starts inside the panel (e.g. a drag-select) never dismisses. The panel needs no `stopPropagation`. (The test's `userEvent.click` on the overlay triggers the mousedown on `currentTarget`.)

- [ ] **Step 4: Run to verify pass + lint**

Run: `npx vitest run src/renderer/components/ui/Modal.test.tsx` (pass, 4 tests). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ui/Modal.tsx src/renderer/components/ui/Modal.test.tsx
git commit -m "feat(ui): add dismissible Modal wrapper (Esc + backdrop)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: adopt `Modal` in 5 dialogs (accounts/buckets/confirm)

**Files:**
- Modify: `src/renderer/components/accounts/ExportAccountsDialog.tsx`, `src/renderer/components/accounts/ImportAccountsDialog.tsx`, `src/renderer/components/accounts/QuickAddAccountDialog.tsx`, `src/renderer/components/buckets/CreateBucketDialog.tsx`, `src/renderer/components/ui/ConfirmDialog.tsx`

The transformation for each dialog: add `import { Modal } from '<relative>/ui/Modal';` and replace the outer overlay + panel:

```tsx
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="<PANEL CLASSES>">
        … content …
      </div>
    </div>
```

with:

```tsx
    <Modal onDismiss={<HANDLER>} className="<PANEL CLASSES>">
      … content …
    </Modal>
```

Per-dialog values (read each file to copy its exact `<PANEL CLASSES>`):

| Dialog | import path | HANDLER | panel classes |
| --- | --- | --- | --- |
| `ExportAccountsDialog` | `../ui/Modal` | `onClose` | `w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900` |
| `ImportAccountsDialog` | `../ui/Modal` | `onClose` | `w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900` |
| `QuickAddAccountDialog` | `../ui/Modal` | `onClose` | (read it — it includes `max-h-[90vh] … overflow-auto … w-96 …`) |
| `CreateBucketDialog` | `../ui/Modal` | `onClose` | `w-96 rounded bg-white p-4 shadow-lg dark:bg-slate-900` |
| `ConfirmDialog` | `./Modal` | `onCancel` | `w-80 rounded bg-white p-4 shadow-lg dark:bg-slate-900` |

- [ ] **Step 1: Refactor all 5 dialogs**

For each dialog: read it, apply the transformation above using its HANDLER and its exact panel classes, keep all inner content unchanged. Remove only the two wrapper `<div>`s (overlay + panel) — `Modal` provides `role="dialog"`/`aria-modal` and the panel `<div className=…>`.

- [ ] **Step 2: Run the affected dialog tests**

Run: `npx vitest run src/renderer/components/accounts/ src/renderer/components/buckets/CreateBucketDialog.test.tsx src/renderer/components/ui/ConfirmDialog.test.tsx`
Expected: PASS — the existing tests query content/role/buttons, all preserved.

- [ ] **Step 3: Add an Esc test to ConfirmDialog**

Append to `src/renderer/components/ui/ConfirmDialog.test.tsx` (inside its describe; it already imports render/screen/userEvent/vi):

```tsx
  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Sure?" confirmLabel="Yes" onConfirm={() => {}} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
```

(If `ConfirmDialog.test.tsx` lacks `userEvent`, add `import userEvent from '@testing-library/user-event';`.)

- [ ] **Step 4: Types + lint + commit**

Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors), then:

```bash
git add src/renderer/components/accounts/ src/renderer/components/buckets/CreateBucketDialog.tsx src/renderer/components/ui/ConfirmDialog.tsx src/renderer/components/ui/ConfirmDialog.test.tsx
git commit -m "refactor(ui): adopt Modal in account/bucket/confirm dialogs" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: adopt `Modal` in 5 dialogs (files/transfer)

**Files:**
- Modify: `src/renderer/components/files/MetadataDialog.tsx`, `src/renderer/components/files/PermissionsDialog.tsx`, `src/renderer/components/files/UploadLinkDialog.tsx`, `src/renderer/components/transfer/MoveDialog.tsx`, `src/renderer/components/transfer/NameDialog.tsx`

Same transformation as Task 3. Per-dialog values:

| Dialog | import path | HANDLER | panel classes |
| --- | --- | --- | --- |
| `MetadataDialog` | `../ui/Modal` | `onClose` | (read it — copy the panel `<div>`'s className verbatim) |
| `PermissionsDialog` | `../ui/Modal` | `onClose` | (read it — copy verbatim) |
| `UploadLinkDialog` | `../ui/Modal` | `onClose` | `w-[28rem] rounded bg-white p-4 shadow-lg dark:bg-slate-900` |
| `MoveDialog` | `../ui/Modal` | `onClose` | `w-96 rounded bg-white p-4 shadow-lg dark:bg-slate-900` |
| `NameDialog` | `../ui/Modal` | `onCancel` | `w-80 rounded bg-white p-4 shadow-lg dark:bg-slate-900` |

- [ ] **Step 1: Refactor all 5 dialogs**

For each: read it, replace the outer overlay + panel `<div>`s with `<Modal onDismiss={HANDLER} className="<exact panel classes>">…</Modal>`, add the Modal import, keep inner content unchanged. NameDialog's panel `<div>` spans multiple lines (its className is on its own line) — move that className to the `Modal`'s `className`.

- [ ] **Step 2: Run the affected dialog tests**

Run: `npx vitest run src/renderer/components/files/ src/renderer/components/transfer/`
Expected: PASS (content/role/buttons preserved).

- [ ] **Step 3: Types + lint + commit**

Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors), then:

```bash
git add src/renderer/components/files/MetadataDialog.tsx src/renderer/components/files/PermissionsDialog.tsx src/renderer/components/files/UploadLinkDialog.tsx src/renderer/components/transfer/MoveDialog.tsx src/renderer/components/transfer/NameDialog.tsx
git commit -m "refactor(ui): adopt Modal in files/transfer dialogs" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: duplicate warning + chooser in the import dialog

**Files:**
- Modify: `src/renderer/i18n/locales/{en,de,fr,pl,nl,ro}.json`
- Modify: `src/renderer/components/accounts/ImportAccountsDialog.tsx`
- Modify: `src/renderer/components/accounts/ImportAccountsDialog.test.tsx`

- [ ] **Step 1: Add i18n keys (6 locales, in the `transfer` object)**

| Key | en | de |
| --- | --- | --- |
| duplicateWarning | {{count}} names already exist | {{count}} Namen existieren bereits |
| duplicateMode | Existing names | Vorhandene Namen |
| duplicateSkip | Skip | Überspringen |
| duplicateCopy | Import as copies | Als Kopie importieren |
| duplicateReplace | Replace existing | Vorhandene ersetzen |
| nameExists | name exists | Name existiert |

| Key | fr | pl |
| --- | --- | --- |
| duplicateWarning | {{count}} noms existent déjà | {{count}} nazw już istnieje |
| duplicateMode | Noms existants | Istniejące nazwy |
| duplicateSkip | Ignorer | Pomiń |
| duplicateCopy | Importer comme copies | Importuj jako kopie |
| duplicateReplace | Remplacer l'existant | Zastąp istniejące |
| nameExists | nom existant | nazwa istnieje |

| Key | nl | ro |
| --- | --- | --- |
| duplicateWarning | {{count}} namen bestaan al | {{count}} nume există deja |
| duplicateMode | Bestaande namen | Nume existente |
| duplicateSkip | Overslaan | Omite |
| duplicateCopy | Als kopie importeren | Importă drept copii |
| duplicateReplace | Bestaande vervangen | Înlocuiește existentele |
| nameExists | naam bestaat | numele există |

Validate: `node -e "['en','de','fr','pl','nl','ro'].forEach(l=>JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/'+l+'.json','utf8')))"`.

- [ ] **Step 2: Add the failing tests**

Append to the `describe('ImportAccountsDialog', …)` block in `ImportAccountsDialog.test.tsx`. Extend the `setS3` helper to allow an `accounts.list` mock (existing accounts) — add `list` to the default accounts mock:

In the `setS3` function, add `list: vi.fn().mockResolvedValue({ ok: true, data: [] }),` to the default `accounts` object (so `useAccounts` resolves). Then add:

```tsx
  it('warns about a name collision and imports with the chosen mode', async () => {
    setS3({
      list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'x', label: 'AWS prod', provider: 'amazon-s3', region: 'r', accessKeyId: 'K', createdAt: 1 }] }),
    });
    const onImported = vi.fn();
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={onImported} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    expect(await screen.findByText('1 names already exist')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Existing names'), 'replace');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined, onDuplicate: 'replace' }));
    expect(onImported).toHaveBeenCalled();
  });

  it('imports with copy mode when there is no collision', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await screen.findByText('AWS prod (Amazon S3)');
    expect(screen.queryByLabelText('Existing names')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined, onDuplicate: 'copy' }));
  });
```

`waitFor` is already imported in that file (it uses it elsewhere); if not, add it to the `@testing-library/react` import. The default `importPreview` mock returns `accounts: [{ label: 'AWS prod', provider: 'amazon-s3' }]`, so the first test (existing label 'AWS prod') collides.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx`
Expected: FAIL — no collision warning/chooser; import omits `onDuplicate`.

- [ ] **Step 4: Implement the collision UI**

In `src/renderer/components/accounts/ImportAccountsDialog.tsx`:

Add imports:

```tsx
import { useAccounts } from '../../hooks/useAccounts';
```

Inside the component, after the existing state declarations, add:

```tsx
  const existingAccounts = useAccounts();
  const [duplicateMode, setDuplicateMode] = useState<'skip' | 'copy' | 'replace'>('skip');
```

After `const accounts = preview?.accounts ?? null;`, add:

```tsx
  const existingLabels = new Set((existingAccounts.data ?? []).map((a) => a.label));
  const collisions = accounts?.filter((a) => existingLabels.has(a.label)) ?? [];
```

In `onImport`, change the mutate call to pass the mode:

```tsx
      const created = await importAccounts.mutateAsync({
        blob,
        password: password || undefined,
        onDuplicate: collisions.length > 0 ? duplicateMode : 'copy',
      });
```

In the preview list rendering, mark colliding rows — replace the `<li>` map with:

```tsx
                {accounts.map((a, i) => (
                  <li key={i}>
                    {a.label} ({providerLabel(a.provider)})
                    {existingLabels.has(a.label) && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">— {t('transfer.nameExists')}</span>
                    )}
                  </li>
                ))}
```

Add the warning + chooser just AFTER the preview `<div … aria-live="polite">…</div>` block and BEFORE the `{error !== null && …}` line:

```tsx
        {collisions.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('transfer.duplicateWarning', { count: collisions.length })}</p>
            <label className="mt-1 block text-sm">
              {t('transfer.duplicateMode')}
              <select
                aria-label={t('transfer.duplicateMode')}
                className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={duplicateMode}
                onChange={(e) => setDuplicateMode(e.target.value as 'skip' | 'copy' | 'replace')}
              >
                <option value="skip">{t('transfer.duplicateSkip')}</option>
                <option value="copy">{t('transfer.duplicateCopy')}</option>
                <option value="replace">{t('transfer.duplicateReplace')}</option>
              </select>
            </label>
          </div>
        )}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx`
Expected: PASS (existing 5 + 2 new).

- [ ] **Step 6: Full suite + types + lint**

Run: `npm test` (all green), `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/i18n/locales/*.json src/renderer/components/accounts/ImportAccountsDialog.tsx src/renderer/components/accounts/ImportAccountsDialog.test.tsx
git commit -m "feat(accounts): warn and choose skip/copy/replace on name collisions" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** backend onDuplicate skip/copy/replace + snapshot (Task 1); shared Modal with Esc+backdrop (Task 2); 10 dialogs adopt Modal (Tasks 3+4); import-dialog collision detection from preview + warning + chooser + row marker + onDuplicate wiring + i18n (Task 5). All covered.
- **Type consistency:** `onDuplicate: 'skip' | 'copy' | 'replace'` identical across channel (Task 1), handler (Task 1), hook (Task 1), and dialog (Task 5). `Modal` props `{ onDismiss, className?, children }` consistent across Tasks 2–4. `deps.accounts.update(id, fields)` matches the `NewAccount` shape.
- **Backward compatibility:** `onDuplicate` defaults to `'copy'`; existing `accountsImport` tests (call `{ blob }`) and the import-dialog no-collision path are unaffected.
- **Existing-test impact:** Tasks 3–4 keep dialog content/role/panel classes, so existing dialog tests pass; Task 5 adds `accounts.list` to the import-dialog mock so `useAccounts` resolves.
