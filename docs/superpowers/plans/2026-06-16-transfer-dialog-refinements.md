# Transfer Dialog Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide the export password field once the string is generated; in import, show the password field only when the blob is encrypted (detected in the background) and add a preview of the accounts to be imported.

**Architecture:** A pure `peekEnvelope` reports `encrypted` without decrypting. A new `accountsImportPreview` IPC dry-runs the import and returns `{ encrypted, accounts: {label,provider}[] | null }` (never secrets). The import dialog debounce-calls it on blob/password change to drive a conditional password field + preview list, gating the Import button.

**Tech Stack:** Electron Forge, TypeScript, `node:crypto`, TanStack Query, react-i18next (6 locales), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-16-transfer-dialog-refinements-design.md`

**Conventions:** `Result<T>` via `ok`/`err`; renderer `unwrap()` throws `"Code: message"`; `errorCode()`/`humanErrorMessage()` in `src/renderer/lib/result.ts`. Tests load real i18n (English). `npx vitest run <path>`, `npx tsc --noEmit`, `npm run lint`. Conventional Commits, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No pushing. Branch: `feat/account-import-export`.

---

### Task 1: `peekEnvelope` + `ImportPreview` (accountTransfer)

**Files:**
- Modify: `src/main/accounts/accountTransfer.ts`
- Modify: `src/main/accounts/accountTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/main/accounts/accountTransfer.test.ts`:

```ts
import { peekEnvelope } from './accountTransfer';

describe('peekEnvelope', () => {
  it('reports encrypted=false for a plain export', () => {
    const blob = exportAccounts([acc]);
    expect(peekEnvelope(blob)).toEqual({ encrypted: false });
  });

  it('reports encrypted=true for a password export', () => {
    const blob = exportAccounts([acc], 'pw');
    expect(peekEnvelope(blob)).toEqual({ encrypted: true });
  });

  it('throws InvalidData on garbage', () => {
    expect(() => peekEnvelope('!!!nope!!!')).toThrow(expect.objectContaining({ code: 'InvalidData' }));
  });
});
```

(`acc` and `exportAccounts` are already imported/defined at the top of this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/accounts/accountTransfer.test.ts`
Expected: FAIL — `peekEnvelope` is not exported.

- [ ] **Step 3: Refactor envelope parsing + add `peekEnvelope` and `ImportPreview`**

In `src/main/accounts/accountTransfer.ts`:

Add this interface after the `ExportAccount` interface:

```ts
export interface ImportPreview {
  encrypted: boolean;
  accounts: { label: string; provider: ProviderId }[] | null;
}
```

Add this private helper just above `export function importAccounts` (it extracts the existing base64+JSON+format/version validation):

```ts
function parseEnvelope(blob: string): Record<string, unknown> {
  let env: Record<string, unknown>;
  try {
    const json = Buffer.from(blob.trim(), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    env = parsed as Record<string, unknown>;
  } catch {
    throw new TransferError('InvalidData', 'The import data is not valid.');
  }
  if (env.format !== FORMAT || env.version !== VERSION || typeof env.data !== 'string') {
    throw new TransferError('InvalidData', 'The import data is not a recognized account export.');
  }
  return env;
}

/** Report whether an export is password-encrypted, without decrypting it. */
export function peekEnvelope(blob: string): { encrypted: boolean } {
  return { encrypted: parseEnvelope(blob).encrypted === true };
}
```

In `importAccounts`, replace its inline parse block:

```ts
  let env: Record<string, unknown>;
  try {
    const json = Buffer.from(blob.trim(), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    env = parsed as Record<string, unknown>;
  } catch {
    throw new TransferError('InvalidData', 'The import data is not valid.');
  }
  if (env.format !== FORMAT || env.version !== VERSION || typeof env.data !== 'string') {
    throw new TransferError('InvalidData', 'The import data is not a recognized account export.');
  }
```

with:

```ts
  const env = parseEnvelope(blob);
```

(Everything after this line in `importAccounts` is unchanged.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/accounts/accountTransfer.test.ts`
Expected: PASS (existing 13 + 3 new). The existing importAccounts tests still pass — `parseEnvelope` does exactly what the inline block did.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` (0 errors), then:

```bash
git add src/main/accounts/accountTransfer.ts src/main/accounts/accountTransfer.test.ts
git commit -m "feat(accounts): add peekEnvelope and ImportPreview type" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `accountsImportPreview` IPC

**Files:**
- Modify: `src/main/ipc/channels.ts`, `src/main/ipc/register.ts`, `src/preload.ts`, `src/main/ipc/register.test.ts`

- [ ] **Step 1: Add the failing handler tests**

In `src/main/ipc/register.test.ts`, add inside `describe('registerIpc', …)`:

```ts
  it('accounts:importPreview returns label+provider (no secret) for a plain export', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SECRET' },
    ]);
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsImportPreview)!({ blob })) as {
      ok: boolean;
      data: { encrypted: boolean; accounts: { label: string; provider: string; secretAccessKey?: string }[] | null };
    };
    expect(res.ok).toBe(true);
    expect(res.data.encrypted).toBe(false);
    expect(res.data.accounts).toEqual([{ label: 'AWS', provider: 'amazon-s3' }]);
    expect(res.data.accounts![0]).not.toHaveProperty('secretAccessKey');
  });

  it('accounts:importPreview reports encrypted without a password and previews with one', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'Enc', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'K', secretAccessKey: 'S' },
    ], 'pw');
    const { handlers } = buildHarness();
    const locked = (await handlers.get(CH.accountsImportPreview)!({ blob })) as { ok: boolean; data: { encrypted: boolean; accounts: unknown } };
    expect(locked).toEqual({ ok: true, data: { encrypted: true, accounts: null } });
    const opened = (await handlers.get(CH.accountsImportPreview)!({ blob, password: 'pw' })) as { ok: boolean; data: { encrypted: boolean; accounts: { label: string }[] } };
    expect(opened.ok).toBe(true);
    expect(opened.data.accounts).toEqual([{ label: 'Enc', provider: 'amazon-s3' }]);
  });

  it('accounts:importPreview errors on a wrong password', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([{ label: 'Enc', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'K', secretAccessKey: 'S' }], 'pw');
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsImportPreview)!({ blob, password: 'WRONG' })) as { ok: boolean; error: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('IncorrectPassword');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `CH.accountsImportPreview` undefined.

- [ ] **Step 3: Add the channel (`channels.ts`)**

Add to the existing `import type { ... } from '../accounts/accountTransfer'` line (or add a new import) so `ImportPreview` is imported. If accountTransfer is not yet imported in channels.ts, add:

```ts
import type { ImportPreview } from '../accounts/accountTransfer';
```

In `CH`, after `accountsImport: 'accounts:import',`:

```ts
  accountsImportPreview: 'accounts:importPreview',
```

In `ApiMap`, after the `[CH.accountsImport]: ...;` line:

```ts
  [CH.accountsImportPreview]: { args: [{ blob: string; password?: string }]; res: Result<ImportPreview> };
```

- [ ] **Step 4: Add the handler (`register.ts`)**

The imports `exportAccounts, importAccounts, TransferError` and `type { ExportAccount }` already exist from the account-transfer work. Add `peekEnvelope` to the value import and `ImportPreview` to the type import:

```ts
import { exportAccounts, importAccounts, TransferError, peekEnvelope } from '../accounts/accountTransfer';
import type { ExportAccount, ImportPreview } from '../accounts/accountTransfer';
```

After the `h(CH.accountsImport, …)` handler block, add:

```ts
  h(CH.accountsImportPreview, (a: { blob: string; password?: string }): Result<ImportPreview> => {
    let encrypted: boolean;
    try {
      encrypted = peekEnvelope(a.blob).encrypted;
    } catch (e) {
      if (e instanceof TransferError) return err(e.code, e.message);
      throw e;
    }
    if (encrypted && !a.password) {
      return ok({ encrypted: true, accounts: null });
    }
    let parsed: ExportAccount[];
    try {
      parsed = importAccounts(a.blob, a.password);
    } catch (e) {
      if (e instanceof TransferError) return err(e.code, e.message);
      throw e;
    }
    return ok({ encrypted, accounts: parsed.map((acc) => ({ label: acc.label, provider: acc.provider })) });
  });
```

(`Result` is already imported in register.ts.)

- [ ] **Step 5: Expose in preload (`preload.ts`)**

Inside the `accounts: { … }` object, after the `import:` line:

```ts
    importPreview: (a: ApiMap[typeof CH.accountsImportPreview]['args'][0]) => invoke(CH.accountsImportPreview, a),
```

- [ ] **Step 6: Run to verify pass + types + lint**

Run: `npx vitest run src/main/ipc/register.test.ts` (pass). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat(ipc): add accounts import preview channel" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `useImportPreview` hook

**Files:**
- Modify: `src/renderer/hooks/useAccountTransfer.ts`
- Modify: `src/renderer/hooks/useAccountTransfer.test.tsx`

- [ ] **Step 1: Add the failing test**

In `src/renderer/hooks/useAccountTransfer.test.tsx`, add the import and a describe block:

Change the import line to include the new hook:

```tsx
import { useExportAccounts, useImportAccounts, useImportPreview } from './useAccountTransfer';
```

Add inside the `beforeEach` `accounts` mock object a new method:

```tsx
      importPreview: vi.fn().mockResolvedValue({ ok: true, data: { encrypted: false, accounts: [{ label: 'AWS', provider: 'amazon-s3' }] } }),
```

Add a describe block:

```tsx
describe('useImportPreview', () => {
  it('returns the preview payload', async () => {
    const { result } = renderHook(() => useImportPreview(), { wrapper: wrapper() });
    result.current.mutate({ blob: 'BLOB' });
    await waitFor(() => expect(result.current.data).toEqual({ encrypted: false, accounts: [{ label: 'AWS', provider: 'amazon-s3' }] }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/hooks/useAccountTransfer.test.tsx`
Expected: FAIL — `useImportPreview` is not exported.

- [ ] **Step 3: Implement the hook**

In `src/renderer/hooks/useAccountTransfer.ts`, add:

```ts
export function useImportPreview() {
  return useMutation({
    mutationFn: async (input: { blob: string; password?: string }) =>
      unwrap(await window.s3.accounts.importPreview(input)),
  });
}
```

- [ ] **Step 4: Run to verify pass + lint**

Run: `npx vitest run src/renderer/hooks/useAccountTransfer.test.tsx` (pass). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useAccountTransfer.ts src/renderer/hooks/useAccountTransfer.test.tsx
git commit -m "feat(accounts): add useImportPreview hook" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Export dialog — hide password on the result page

**Files:**
- Modify: `src/renderer/components/accounts/ExportAccountsDialog.tsx`
- Modify: `src/renderer/components/accounts/ExportAccountsDialog.test.tsx`

- [ ] **Step 1: Add the failing test**

Append to the `describe('ExportAccountsDialog', …)` block in `src/renderer/components/accounts/ExportAccountsDialog.test.tsx`:

```tsx
  it('hides the password field once the export string is shown', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    expect(screen.getByLabelText('Password (optional)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    await screen.findByLabelText('Export string');
    expect(screen.queryByLabelText('Password (optional)')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/accounts/ExportAccountsDialog.test.tsx`
Expected: FAIL — the password field is still present after generating.

- [ ] **Step 3: Move the password field into the input phase**

In `src/renderer/components/accounts/ExportAccountsDialog.tsx`, replace this block:

```tsx
        <label className="block text-sm">
          {t('transfer.password')}
          <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {password.length === 0 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('transfer.noPasswordWarning')}</p>
        )}

        {result === null ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={exportAccounts.isPending}
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
              onClick={onGenerate}
            >
              {t('transfer.generate')}
            </button>
          </div>
        ) : (
```

with:

```tsx
        {result === null ? (
          <>
            <label className="block text-sm">
              {t('transfer.password')}
              <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {password.length === 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('transfer.noPasswordWarning')}</p>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={exportAccounts.isPending}
                className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
                onClick={onGenerate}
              >
                {t('transfer.generate')}
              </button>
            </div>
          </>
        ) : (
```

(The `: ( … )` result branch with the textarea + Copy/Download stays unchanged.)

- [ ] **Step 4: Run to verify pass + lint**

Run: `npx vitest run src/renderer/components/accounts/ExportAccountsDialog.test.tsx` (pass, 5 tests). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/ExportAccountsDialog.tsx src/renderer/components/accounts/ExportAccountsDialog.test.tsx
git commit -m "feat(accounts): hide export password field after generating" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Import dialog — conditional password + preview

**Files:**
- Modify: `src/renderer/i18n/locales/{en,de,fr,pl,nl,ro}.json`
- Modify: `src/renderer/components/accounts/ImportAccountsDialog.tsx`
- Modify: `src/renderer/components/accounts/ImportAccountsDialog.test.tsx`

- [ ] **Step 1: Add three i18n keys to the `transfer` object in all six locales**

| Key | en | de |
| --- | --- | --- |
| previewCount | {{count}} accounts will be imported | {{count}} Konten werden importiert |
| encryptedHint | Encrypted — enter the password to preview | Verschlüsselt — Passwort zur Vorschau eingeben |
| checking | Checking… | Wird geprüft… |

| Key | fr | pl |
| --- | --- | --- |
| previewCount | {{count}} comptes seront importés | Zostanie zaimportowanych {{count}} kont |
| encryptedHint | Chiffré — saisissez le mot de passe pour prévisualiser | Zaszyfrowane — wprowadź hasło, aby wyświetlić podgląd |
| checking | Vérification… | Sprawdzanie… |

| Key | nl | ro |
| --- | --- | --- |
| previewCount | {{count}} accounts worden geïmporteerd | {{count}} conturi vor fi importate |
| encryptedHint | Versleuteld — voer het wachtwoord in voor een voorbeeld | Criptat — introdu parola pentru previzualizare |
| checking | Controleren… | Se verifică… |

Validate JSON: `node -e "['en','de','fr','pl','nl','ro'].forEach(l=>JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/'+l+'.json','utf8')))"`.

- [ ] **Step 2: Rewrite the test file (failing first)**

Replace the FULL contents of `src/renderer/components/accounts/ImportAccountsDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ImportAccountsDialog } from './ImportAccountsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function setS3(over: Record<string, unknown> = {}) {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }] }),
      importPreview: vi.fn().mockResolvedValue({ ok: true, data: { encrypted: false, accounts: [{ label: 'AWS prod', provider: 'amazon-s3' }] } }),
      ...over,
    },
    openTextFile: vi.fn().mockResolvedValue({ ok: true, data: 'FILE-BLOB' }),
  };
}

beforeEach(() => setS3());

describe('ImportAccountsDialog', () => {
  it('previews an unencrypted blob: shows the list, no password field, import enabled', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    expect(await screen.findByText('AWS prod (Amazon S3)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('imports after previewing and reports the count', async () => {
    const onImported = vi.fn();
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={onImported} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await screen.findByText('AWS prod (Amazon S3)');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('AWS prod (Amazon S3)'); // settle
    expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined });
    expect(onImported).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the password field for an encrypted blob and previews after the password', async () => {
    setS3({
      importPreview: vi.fn().mockImplementation(async (input: { password?: string }) =>
        input.password
          ? { ok: true, data: { encrypted: true, accounts: [{ label: 'Hetzner', provider: 'hetzner' }] } }
          : { ok: true, data: { encrypted: true, accounts: null } },
      ),
    });
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'ENC');
    const pw = await screen.findByLabelText('Password');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    await userEvent.type(pw, 'secret');
    expect(await screen.findByText('Hetzner (Hetzner Object Storage)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('shows an inline error on an incorrect password and keeps Import disabled', async () => {
    setS3({
      importPreview: vi.fn().mockImplementation(async (input: { password?: string }) =>
        input.password
          ? { ok: false, error: { code: 'IncorrectPassword', message: 'Incorrect password.' } }
          : { ok: true, data: { encrypted: true, accounts: null } },
      ),
    });
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'ENC');
    const pw = await screen.findByLabelText('Password');
    await userEvent.type(pw, 'wrong');
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('loads a file into the textarea', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load file' }));
    expect(await screen.findByDisplayValue('FILE-BLOB')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx`
Expected: FAIL — no preview list / password field is always shown.

- [ ] **Step 4: Rewrite the dialog**

Replace the FULL contents of `src/renderer/components/accounts/ImportAccountsDialog.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useImportAccounts, useImportPreview } from '../../hooks/useAccountTransfer';
import { useToast } from '../ui/ToastProvider';
import { humanErrorMessage, errorCode } from '../../lib/result';
import { UI_PROVIDERS } from '../../lib/providers';
import type { ImportPreview } from '../../../main/accounts/accountTransfer';

// TransferError codes → their localized message keys.
const CODE_KEYS: Record<string, string> = {
  IncorrectPassword: 'transfer.incorrectPassword',
  InvalidData: 'transfer.invalidData',
};

function providerLabel(provider: string): string {
  return UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function ImportAccountsDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const importAccounts = useImportAccounts();
  const importPreview = useImportPreview();
  const [blob, setBlob] = useState('');
  const [password, setPassword] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Background, debounced preview whenever the blob or password changes.
  useEffect(() => {
    if (blob.trim().length === 0) {
      setPreview(null);
      setPreviewError(null);
      setEncrypted(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    const id = ++reqId.current;
    const handle = setTimeout(() => {
      importPreview
        .mutateAsync({ blob, password: password || undefined })
        .then((data) => {
          if (id !== reqId.current) return;
          setEncrypted(data.encrypted);
          setPreview(data);
          setPreviewError(null);
        })
        .catch((e) => {
          if (id !== reqId.current) return;
          const code = errorCode(e);
          // A wrong password still means the blob is encrypted — keep the field.
          if (code === 'IncorrectPassword') setEncrypted(true);
          else if (code === 'InvalidData') setEncrypted(false);
          setPreview(null);
          const key = CODE_KEYS[code ?? ''];
          setPreviewError(key ? t(key) : humanErrorMessage(e));
        })
        .finally(() => {
          if (id === reqId.current) setChecking(false);
        });
    }, 350);
    return () => clearTimeout(handle);
    // importPreview.mutateAsync and t are stable; intentionally keyed on blob+password.
  }, [blob, password]);

  const onLoadFile = async () => {
    const text = await window.s3.openTextFile();
    if (text.ok && text.data !== null) setBlob(text.data);
  };

  const onImport = async () => {
    setError(null);
    try {
      const created = await importAccounts.mutateAsync({ blob, password: password || undefined });
      show(t('transfer.imported', { count: created.length }));
      onImported();
      onClose();
    } catch (e) {
      const key = CODE_KEYS[errorCode(e) ?? ''];
      setError(key ? t(key) : humanErrorMessage(e));
    }
  };

  const accounts = preview?.accounts ?? null;
  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('transfer.importTitle')}</p>
          <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <textarea
          aria-label={t('transfer.pasteAria')}
          placeholder={t('transfer.pastePlaceholder')}
          value={blob}
          onChange={(e) => setBlob(e.target.value)}
          className="h-24 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="mt-2">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onLoadFile}>
            {t('transfer.loadFile')}
          </button>
        </div>

        {encrypted && (
          <label className="mt-3 block text-sm">
            {t('transfer.importPassword')}
            <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}

        <div className="mt-3 text-sm" aria-live="polite">
          {checking && <span className="text-slate-500 dark:text-slate-400">{t('transfer.checking')}</span>}
          {!checking && previewError !== null && <span className="text-red-600 dark:text-red-400">{previewError}</span>}
          {!checking && previewError === null && encrypted && accounts === null && (
            <span className="text-slate-500 dark:text-slate-400">{t('transfer.encryptedHint')}</span>
          )}
          {!checking && accounts !== null && (
            <div>
              <p className="text-slate-700 dark:text-slate-200">{t('transfer.previewCount', { count: accounts.length })}</p>
              <ul className="mt-1 max-h-32 overflow-auto text-slate-600 dark:text-slate-300">
                {accounts.map((a, i) => (
                  <li key={i}>{a.label} ({providerLabel(a.provider)})</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error !== null && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={accounts === null || importAccounts.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
            onClick={onImport}
          >
            {t('transfer.import')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass + types + lint**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx` (pass, 5 tests). `npx tsc --noEmit` (clean). `npm run lint` (0 errors).

- [ ] **Step 6: Full suite**

Run: `npm test` (all green), `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/i18n/locales/*.json src/renderer/components/accounts/ImportAccountsDialog.tsx src/renderer/components/accounts/ImportAccountsDialog.test.tsx
git commit -m "feat(accounts): import preview with conditional password field" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** export password hidden on result (Task 4); `peekEnvelope` (Task 1); `accountsImportPreview` returning label+provider with no secrets (Task 2); `useImportPreview` (Task 3); debounced background preview + conditional password + preview list + gated import + i18n (Task 5). All covered.
- **Type consistency:** `ImportPreview { encrypted: boolean; accounts: {label,provider}[] | null }` defined in Task 1, used in channels (Task 2), hook (Task 3), dialog (Task 5). `accountsImportPreview` arg `{ blob, password? }` consistent across channel/handler/preload/hook/dialog. `errorCode`/`humanErrorMessage`/`CODE_KEYS` reused from existing code.
- **No-secret guarantee:** the preview handler maps to `{ label, provider }` only; a Task-2 test asserts the result has no `secretAccessKey`.
- **Debounce staleness:** guarded by the `reqId` token so a stale resolve can't overwrite a newer one.
- **Existing tests:** Task 1 keeps `importAccounts` behavior (extraction only). Task 5 fully replaces the import-dialog test file (the old tests assumed an always-visible password field + immediate import).
