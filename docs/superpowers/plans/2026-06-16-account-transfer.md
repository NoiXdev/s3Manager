# Account Import / Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export one/several/all accounts (incl. their secret keys) to an optionally password-encrypted string with copy/download, and import accounts from a pasted string or a loaded file.

**Architecture:** A pure `node:crypto` module handles serialize/encrypt/decrypt (scrypt + AES-256-GCM). IPC handlers glue it to the accounts/secrets repos; two injected main helpers do file save/open. The renderer adds two dialogs and entry points in the Accounts screen.

**Tech Stack:** Electron Forge, TypeScript, `node:crypto` (no new dependency), TanStack Query, react-i18next (6 locales), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-16-account-transfer-design.md`

**Conventions:**
- `Result<T>` via `ok(data)`/`err(code, message)` (`src/main/shared/result.ts`); renderer `unwrap()` (`src/renderer/lib/result.ts`) throws on error.
- Handlers registered with `h(CH.x, fn)` (try/catch → `toErr`). Deps injected via `RegisterDeps`; `main.ts` wires real impls.
- Tests load real i18n in English. Single file: `npx vitest run <path>`. Full: `npm test`. Lint: `npm run lint`. Types: `npx tsc --noEmit`.
- Conventional Commits, footer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. No pushing. Branch: `feat/account-import-export`.

---

### Task 1: Pure `accountTransfer` module

**Files:**
- Create: `src/main/accounts/accountTransfer.ts`
- Test: `src/main/accounts/accountTransfer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/accounts/accountTransfer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { exportAccounts, importAccounts, TransferError, type ExportAccount } from './accountTransfer';

const acc: ExportAccount = {
  label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1',
  accessKeyId: 'AK', secretAccessKey: 'SECRET',
};
const custom: ExportAccount = {
  label: 'MinIO', provider: 'custom', region: 'us-east-1',
  accessKeyId: 'CK', secretAccessKey: 'CS', endpoint: 'https://minio.example.com', forcePathStyle: true,
};

describe('accountTransfer round-trip', () => {
  it('exports and imports without a password (unencrypted)', () => {
    const blob = exportAccounts([acc]);
    expect(importAccounts(blob)).toEqual([acc]);
  });

  it('exports and imports with a password', () => {
    const blob = exportAccounts([acc, custom], 'hunter2');
    expect(importAccounts(blob, 'hunter2')).toEqual([acc, custom]);
  });

  it('produces different ciphertext each time (random salt/iv)', () => {
    expect(exportAccounts([acc], 'pw')).not.toEqual(exportAccounts([acc], 'pw'));
  });
});

describe('accountTransfer errors', () => {
  it('throws IncorrectPassword for a wrong password', () => {
    const blob = exportAccounts([acc], 'right');
    expect(() => importAccounts(blob, 'wrong')).toThrow(expect.objectContaining({ code: 'IncorrectPassword' }));
  });

  it('throws PasswordRequired when an encrypted blob is imported without a password', () => {
    const blob = exportAccounts([acc], 'pw');
    expect(() => importAccounts(blob)).toThrow(expect.objectContaining({ code: 'PasswordRequired' }));
  });

  it('throws InvalidData for non-base64 / non-JSON garbage', () => {
    expect(() => importAccounts('!!!not-base64!!!')).toThrow(expect.objectContaining({ code: 'InvalidData' }));
  });

  it('throws InvalidData for a JSON blob that is not our format', () => {
    const notOurs = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64');
    expect(() => importAccounts(notOurs)).toThrow(expect.objectContaining({ code: 'InvalidData' }));
  });

  it('throws IncorrectPassword when the ciphertext is tampered', () => {
    const blob = exportAccounts([acc], 'pw');
    const env = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
    env.data = Buffer.from('tampered-ciphertext').toString('base64');
    const tampered = Buffer.from(JSON.stringify(env), 'utf8').toString('base64');
    expect(() => importAccounts(tampered, 'pw')).toThrow(expect.objectContaining({ code: 'IncorrectPassword' }));
  });

  it('exposes TransferError with a code', () => {
    expect(new TransferError('InvalidData', 'x').code).toBe('InvalidData');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/accounts/accountTransfer.test.ts`
Expected: FAIL — cannot resolve `./accountTransfer`.

- [ ] **Step 3: Implement the module**

Create `src/main/accounts/accountTransfer.ts`:

```ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import type { ProviderId } from '../s3/providers';

export interface ExportAccount {
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

export type TransferErrorCode = 'PasswordRequired' | 'IncorrectPassword' | 'InvalidData';

export class TransferError extends Error {
  constructor(public readonly code: TransferErrorCode, message: string) {
    super(message);
    this.name = 'TransferError';
  }
}

const FORMAT = 's3manager-accounts';
const VERSION = 1;
const SCRYPT = { N: 32768, r: 8, p: 1 };
const KEYLEN = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEYLEN, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
}

export function exportAccounts(accounts: ExportAccount[], password?: string): string {
  const payload = JSON.stringify({ accounts });
  let envelope: Record<string, unknown>;
  if (password && password.length > 0) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    const ciphertext = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    envelope = {
      format: FORMAT,
      version: VERSION,
      encrypted: true,
      kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64') },
      cipher: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: ciphertext.toString('base64'),
    };
  } else {
    envelope = { format: FORMAT, version: VERSION, encrypted: false, data: payload };
  }
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
}

export function importAccounts(blob: string, password?: string): ExportAccount[] {
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

  let payload: string;
  if (env.encrypted === true) {
    if (!password || password.length === 0) {
      throw new TransferError('PasswordRequired', 'This export is password-protected.');
    }
    try {
      const kdf = env.kdf as { salt: string };
      const salt = Buffer.from(kdf.salt, 'base64');
      const iv = Buffer.from(env.iv as string, 'base64');
      const tag = Buffer.from(env.tag as string, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
      decipher.setAuthTag(tag);
      payload = Buffer.concat([
        decipher.update(Buffer.from(env.data as string, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new TransferError('IncorrectPassword', 'Incorrect password or corrupted data.');
    }
  } else {
    payload = env.data;
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    throw new TransferError('InvalidData', 'The import payload is malformed.');
  }
  const accounts = (parsedPayload as { accounts?: unknown }).accounts;
  if (!Array.isArray(accounts)) {
    throw new TransferError('InvalidData', 'The import payload has no accounts.');
  }
  return accounts as ExportAccount[];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/accounts/accountTransfer.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` (0 errors), then:

```bash
git add src/main/accounts/accountTransfer.ts src/main/accounts/accountTransfer.test.ts
git commit -m "feat(accounts): add encrypted account export/import module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Main file helpers — `saveTextFile` / `openTextFile`

**Files:**
- Modify: `src/main/ipc/channels.ts`, `src/main/ipc/register.ts`, `src/main.ts`, `src/preload.ts`, `src/main/ipc/register.test.ts`

- [ ] **Step 1: Add the failing handler tests**

In `src/main/ipc/register.test.ts`, add inside `describe('registerIpc', …)`:

```ts
  it('util:saveTextFile delegates to the injected saveTextFile helper', async () => {
    const saveTextFile = vi.fn().mockResolvedValue(true);
    const { handlers } = buildHarness({ saveTextFile });
    const res = (await handlers.get(CH.saveTextFile)!({ defaultName: 'x.txt', contents: 'hi' })) as { ok: boolean; data: { saved: boolean } };
    expect(saveTextFile).toHaveBeenCalledWith('x.txt', 'hi');
    expect(res).toEqual({ ok: true, data: { saved: true } });
  });

  it('util:openTextFile delegates to the injected openTextFile helper', async () => {
    const openTextFile = vi.fn().mockResolvedValue('file-contents');
    const { handlers } = buildHarness({ openTextFile });
    const res = (await handlers.get(CH.openTextFile)!()) as { ok: boolean; data: string | null };
    expect(res).toEqual({ ok: true, data: 'file-contents' });
  });
```

(`buildHarness({ overrides })` already spreads overrides into deps — added in the update-check work. If this branch lacks it, change `function buildHarness()` to `function buildHarness(overrides: Record<string, unknown> = {})` and spread `...overrides` into the deps object.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `CH.saveTextFile`/`CH.openTextFile` undefined.

- [ ] **Step 3: Add channels (`channels.ts`)**

In the `CH` object, after `openExternal: 'shell:openExternal',`:

```ts
  saveTextFile: 'util:saveTextFile',
  openTextFile: 'util:openTextFile',
```

In `ApiMap`, after the `[CH.openExternal]` line:

```ts
  [CH.saveTextFile]: { args: [{ defaultName: string; contents: string }]; res: Result<{ saved: boolean }> };
  [CH.openTextFile]: { args: []; res: Result<string | null> };
```

- [ ] **Step 4: Add deps + handlers (`register.ts`)**

In `RegisterDeps`, after the `selectDirectory` field:

```ts
  /** Saves text to a user-chosen file; resolves true if saved, false if cancelled. Injected by main.ts. */
  saveTextFile: (defaultName: string, contents: string) => Promise<boolean>;
  /** Opens a user-chosen text file and resolves its contents, or null if cancelled. Injected by main.ts. */
  openTextFile: () => Promise<string | null>;
```

After the `h(CH.getAppInfo, …)` block (before the closing `}` of `registerIpc`):

```ts
  h(CH.saveTextFile, async (a: { defaultName: string; contents: string }) => {
    const saved = await deps.saveTextFile(a.defaultName, a.contents);
    return ok({ saved });
  });

  h(CH.openTextFile, async () => ok(await deps.openTextFile()));
```

- [ ] **Step 5: Wire real impls (`main.ts`)**

Add to the imports at the top: change `import path from 'node:path';` group by adding below it:

```ts
import { readFile, writeFile } from 'node:fs/promises';
```

In `initBackend`, after the `selectDirectory` const block, add:

```ts
  const saveTextFile = async (defaultName: string, contents: string): Promise<boolean> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultName })
      : await dialog.showSaveDialog({ defaultPath: defaultName });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, contents, 'utf8');
    return true;
  };
  const openTextFile = async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile'] })
      : await dialog.showOpenDialog({ properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    return readFile(result.filePaths[0], 'utf8');
  };
```

In the `registerIpc(ipcMain, { … })` call, add `saveTextFile, openTextFile,` to the deps object.

- [ ] **Step 6: Expose in preload (`preload.ts`)**

After the `openExternal` line:

```ts
  saveTextFile: (a: ApiMap[typeof CH.saveTextFile]['args'][0]) => invoke(CH.saveTextFile, a),
  openTextFile: () => invoke(CH.openTextFile),
```

- [ ] **Step 7: Run to verify pass + types + lint**

Run: `npx vitest run src/main/ipc/register.test.ts` (pass, incl. the every-channel loop).
Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat(ipc): add saveTextFile/openTextFile helpers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: IPC — `accountsExport` / `accountsImport`

**Files:**
- Modify: `src/main/ipc/channels.ts`, `src/main/ipc/register.ts`, `src/preload.ts`, `src/main/ipc/register.test.ts`

- [ ] **Step 1: Add the failing handler tests**

In `src/main/ipc/register.test.ts`, add inside `describe('registerIpc', …)`:

```ts
  it('accounts:export returns a string that imports back to the account incl. secret', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SECRET',
    })) as { ok: true; data: { id: string } };
    const res = (await handlers.get(CH.accountsExport)!({ accountIds: [created.data.id] })) as { ok: boolean; data: string };
    expect(res.ok).toBe(true);
    // round-trip the produced blob with the pure importer
    const { importAccounts } = await import('../accounts/accountTransfer');
    const accounts = importAccounts(res.data);
    expect(accounts).toEqual([
      { label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SECRET', endpoint: undefined, forcePathStyle: false },
    ]);
    void deps;
  });

  it('accounts:import creates the accounts and their secrets', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'Imported', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'IK', secretAccessKey: 'IS' },
    ]);
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsImport)!({ blob })) as { ok: boolean; data: { id: string }[] };
    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    const list = deps.accounts.list();
    expect(list.map((a) => a.label)).toContain('Imported');
    expect(deps.secrets.get(res.data[0].id)).toBe('IS');
  });

  it('accounts:import rejects an unknown provider without creating anything', async () => {
    const { exportAccounts } = await import('../accounts/accountTransfer');
    const blob = exportAccounts([
      { label: 'Bad', provider: 'not-a-provider' as never, region: 'x', accessKeyId: 'K', secretAccessKey: 'S' },
    ]);
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsImport)!({ blob })) as { ok: boolean };
    expect(res.ok).toBe(false);
    expect(deps.accounts.list()).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — `CH.accountsExport`/`CH.accountsImport` undefined.

- [ ] **Step 3: Add channels (`channels.ts`)**

In `CH`, after `accountsTest: 'accounts:test',`:

```ts
  accountsExport: 'accounts:export',
  accountsImport: 'accounts:import',
```

In `ApiMap`, after the `[CH.accountsTest]` line:

```ts
  [CH.accountsExport]: { args: [{ accountIds: string[]; password?: string }]; res: Result<string> };
  [CH.accountsImport]: { args: [{ blob: string; password?: string }]; res: Result<Account[]> };
```

- [ ] **Step 4: Add handlers (`register.ts`)**

Add imports near the top (after the `createBucket` import):

```ts
import { exportAccounts, importAccounts, TransferError } from '../accounts/accountTransfer';
import type { ExportAccount } from '../accounts/accountTransfer';
```

After the `h(CH.accountsTest, …)` handler block, add:

```ts
  h(CH.accountsExport, (a: { accountIds: string[]; password?: string }) => {
    const accounts: ExportAccount[] = [];
    for (const id of a.accountIds) {
      const acc = deps.accounts.get(id);
      if (!acc) continue;
      const secret = deps.secrets.get(id);
      if (secret === undefined) {
        return err('SecretUnavailable', `Cannot read the secret for account "${acc.label}".`);
      }
      accounts.push({
        label: acc.label,
        provider: acc.provider,
        region: acc.region,
        accessKeyId: acc.accessKeyId,
        secretAccessKey: secret,
        endpoint: acc.endpoint,
        forcePathStyle: acc.forcePathStyle,
      });
    }
    if (accounts.length === 0) return err('NothingToExport', 'No accounts to export.');
    return ok(exportAccounts(accounts, a.password));
  });

  h(CH.accountsImport, (a: { blob: string; password?: string }) => {
    let parsed: ExportAccount[];
    try {
      parsed = importAccounts(a.blob, a.password);
    } catch (e) {
      if (e instanceof TransferError) return err(e.code, e.message);
      throw e;
    }
    // Validate everything before creating anything (all-or-nothing).
    const resolved: { acc: ExportAccount; params: ConnParams }[] = [];
    for (const acc of parsed) {
      if (!isKnownProvider(acc.provider)) {
        return err('InvalidProvider', `Unknown provider: ${acc.provider}`);
      }
      const params = resolveConnParams(acc);
      if (!params.ok) return params;
      resolved.push({ acc, params: params.data });
    }
    const created = deps.db.transaction(() => {
      return resolved.map(({ acc, params }) => {
        const a2 = deps.accounts.create({
          label: acc.label,
          provider: acc.provider,
          endpoint: params.endpoint,
          region: acc.region,
          accessKeyId: acc.accessKeyId,
          forcePathStyle: params.forcePathStyle,
        });
        deps.secrets.set(a2.id, acc.secretAccessKey);
        return a2;
      });
    })();
    return ok(created);
  });
```

- [ ] **Step 5: Expose in preload (`preload.ts`)**

After the `test` line in the `accounts` object (`test: (input) => invoke(CH.accountsTest, input),`), add inside the same `accounts: { … }` object:

```ts
    export: (a: ApiMap[typeof CH.accountsExport]['args'][0]) => invoke(CH.accountsExport, a),
    import: (a: ApiMap[typeof CH.accountsImport]['args'][0]) => invoke(CH.accountsImport, a),
```

- [ ] **Step 6: Run to verify pass + types + lint**

Run: `npx vitest run src/main/ipc/register.test.ts` (pass).
Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat(ipc): add accounts export/import channels" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Renderer hooks + i18n keys

**Files:**
- Create: `src/renderer/hooks/useAccountTransfer.ts`
- Test: `src/renderer/hooks/useAccountTransfer.test.tsx`
- Modify: `src/renderer/i18n/locales/{en,de,fr,pl,nl,ro}.json`

- [ ] **Step 1: Add all `transfer.*` i18n keys to the six locales**

Add a new top-level `transfer` object to each locale. Values:

| Key | en | de |
| --- | --- | --- |
| exportTitle | Export accounts | Konten exportieren |
| importTitle | Import accounts | Konten importieren |
| password | Password (optional) | Passwort (optional) |
| importPassword | Password | Passwort |
| noPasswordWarning | Without a password the secret keys are not encrypted — keep this export private. | Ohne Passwort sind die Secret Keys nicht verschlüsselt — halte diesen Export geheim. |
| generate | Generate export | Export erzeugen |
| copy | Copy | Kopieren |
| copied | Copied | Kopiert |
| download | Download | Herunterladen |
| resultAria | Export string | Export-String |
| pastePlaceholder | Paste the export string here | Export-String hier einfügen |
| pasteAria | Import data | Importdaten |
| loadFile | Load file | Datei laden |
| import | Import | Importieren |
| passwordRequired | This export is password-protected. Enter the password. | Dieser Export ist passwortgeschützt. Bitte Passwort eingeben. |
| incorrectPassword | Incorrect password. | Falsches Passwort. |
| invalidData | This doesn't look like a valid account export. | Das sieht nicht nach einem gültigen Konten-Export aus. |
| imported | Imported {{count}} accounts | {{count}} Konten importiert |
| importAccounts | Import | Importieren |
| exportAll | Export all | Alle exportieren |
| exportAria | Export {{label}} | {{label}} exportieren |

| Key | fr | pl |
| --- | --- | --- |
| exportTitle | Exporter les comptes | Eksportuj konta |
| importTitle | Importer des comptes | Importuj konta |
| password | Mot de passe (optionnel) | Hasło (opcjonalne) |
| importPassword | Mot de passe | Hasło |
| noPasswordWarning | Sans mot de passe, les clés secrètes ne sont pas chiffrées — gardez cet export privé. | Bez hasła klucze tajne nie są szyfrowane — zachowaj ten eksport prywatnie. |
| generate | Générer l'export | Wygeneruj eksport |
| copy | Copier | Kopiuj |
| copied | Copié | Skopiowano |
| download | Télécharger | Pobierz |
| resultAria | Chaîne d'export | Ciąg eksportu |
| pastePlaceholder | Collez la chaîne d'export ici | Wklej tutaj ciąg eksportu |
| pasteAria | Données d'import | Dane importu |
| loadFile | Charger un fichier | Wczytaj plik |
| import | Importer | Importuj |
| passwordRequired | Cet export est protégé par mot de passe. Saisissez le mot de passe. | Ten eksport jest chroniony hasłem. Wprowadź hasło. |
| incorrectPassword | Mot de passe incorrect. | Nieprawidłowe hasło. |
| invalidData | Cela ne ressemble pas à un export de comptes valide. | To nie wygląda na prawidłowy eksport kont. |
| imported | {{count}} comptes importés | Zaimportowano {{count}} kont |
| importAccounts | Importer | Importuj |
| exportAll | Tout exporter | Eksportuj wszystkie |
| exportAria | Exporter {{label}} | Eksportuj {{label}} |

| Key | nl | ro |
| --- | --- | --- |
| exportTitle | Accounts exporteren | Exportă conturile |
| importTitle | Accounts importeren | Importă conturi |
| password | Wachtwoord (optioneel) | Parolă (opțional) |
| importPassword | Wachtwoord | Parolă |
| noPasswordWarning | Zonder wachtwoord zijn de secret keys niet versleuteld — houd deze export privé. | Fără parolă, cheile secrete nu sunt criptate — păstrează acest export privat. |
| generate | Export genereren | Generează exportul |
| copy | Kopiëren | Copiază |
| copied | Gekopieerd | Copiat |
| download | Downloaden | Descarcă |
| resultAria | Exportreeks | Șir de export |
| pastePlaceholder | Plak hier de exportreeks | Lipește aici șirul de export |
| pasteAria | Importgegevens | Date de import |
| loadFile | Bestand laden | Încarcă fișier |
| import | Importeren | Importă |
| passwordRequired | Deze export is met een wachtwoord beveiligd. Voer het wachtwoord in. | Acest export este protejat cu parolă. Introdu parola. |
| incorrectPassword | Onjuist wachtwoord. | Parolă incorectă. |
| invalidData | Dit lijkt geen geldige accountexport. | Acesta nu pare un export de conturi valid. |
| imported | {{count}} accounts geïmporteerd | {{count}} conturi importate |
| importAccounts | Importeren | Importă |
| exportAll | Alles exporteren | Exportă tot |
| exportAria | {{label}} exporteren | Exportă {{label}} |

After editing, validate JSON: `node -e "['en','de','fr','pl','nl','ro'].forEach(l=>JSON.parse(require('fs').readFileSync('src/renderer/i18n/locales/'+l+'.json','utf8')))"` (exit 0).

- [ ] **Step 2: Write the failing hook test**

Create `src/renderer/hooks/useAccountTransfer.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useExportAccounts, useImportAccounts } from './useAccountTransfer';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      export: vi.fn().mockResolvedValue({ ok: true, data: 'BLOB' }),
      import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }] }),
    },
  };
});

describe('useExportAccounts', () => {
  it('returns the export string', async () => {
    const { result } = renderHook(() => useExportAccounts(), { wrapper: wrapper() });
    result.current.mutate({ accountIds: ['a'], password: 'pw' });
    await waitFor(() => expect(result.current.data).toBe('BLOB'));
    expect((window.s3 as unknown as { accounts: { export: ReturnType<typeof vi.fn> } }).accounts.export)
      .toHaveBeenCalledWith({ accountIds: ['a'], password: 'pw' });
  });
});

describe('useImportAccounts', () => {
  it('returns the imported accounts', async () => {
    const { result } = renderHook(() => useImportAccounts(), { wrapper: wrapper() });
    result.current.mutate({ blob: 'BLOB' });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'n1' }]));
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/renderer/hooks/useAccountTransfer.test.tsx`
Expected: FAIL — cannot resolve `./useAccountTransfer`.

- [ ] **Step 4: Implement the hooks**

Create `src/renderer/hooks/useAccountTransfer.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { accountsKey } from './useAccounts';

export function useExportAccounts() {
  return useMutation({
    mutationFn: async (input: { accountIds: string[]; password?: string }) =>
      unwrap(await window.s3.accounts.export(input)),
  });
}

export function useImportAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { blob: string; password?: string }) =>
      unwrap(await window.s3.accounts.import(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}
```

(`accountsKey` is exported from `src/renderer/hooks/useAccounts.ts`.)

- [ ] **Step 5: Run to verify pass + types + lint**

Run: `npx vitest run src/renderer/hooks/useAccountTransfer.test.tsx` (pass).
Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/hooks/useAccountTransfer.ts src/renderer/hooks/useAccountTransfer.test.tsx src/renderer/i18n/locales/*.json
git commit -m "feat(accounts): add transfer hooks and i18n keys" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `ExportAccountsDialog`

**Files:**
- Create: `src/renderer/components/accounts/ExportAccountsDialog.tsx`
- Test: `src/renderer/components/accounts/ExportAccountsDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/accounts/ExportAccountsDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ExportAccountsDialog } from './ExportAccountsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { export: vi.fn().mockResolvedValue({ ok: true, data: 'EXPORT-BLOB' }) },
    saveTextFile: vi.fn().mockResolvedValue({ ok: true, data: { saved: true } }),
  };
});

describe('ExportAccountsDialog', () => {
  it('warns when no password is set and generates the export string', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    expect(screen.getByText(/secret keys are not encrypted/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    const out = await screen.findByLabelText('Export string');
    expect(out).toHaveValue('EXPORT-BLOB');
  });

  it('downloads the generated string via saveTextFile', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    await screen.findByLabelText('Export string');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(window.s3.saveTextFile).toHaveBeenCalledWith({ defaultName: 's3manager-accounts.txt', contents: 'EXPORT-BLOB' }),
    );
  });

  it('hides the warning once a password is entered', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Password (optional)'), 'pw');
    expect(screen.queryByText(/secret keys are not encrypted/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/accounts/ExportAccountsDialog.test.tsx`
Expected: FAIL — cannot resolve `./ExportAccountsDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/renderer/components/accounts/ExportAccountsDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useExportAccounts } from '../../hooks/useAccountTransfer';
import { useToast } from '../ui/ToastProvider';

export function ExportAccountsDialog({ accountIds, onClose }: { accountIds: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const exportAccounts = useExportAccounts();
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const onGenerate = async () => {
    try {
      const blob = await exportAccounts.mutateAsync({ accountIds, password: password || undefined });
      setResult(blob);
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onCopy = async () => {
    if (result === null) return;
    await navigator.clipboard.writeText(result);
    show(t('transfer.copied'));
  };

  const onDownload = async () => {
    if (result === null) return;
    await window.s3.saveTextFile({ defaultName: 's3manager-accounts.txt', contents: result });
  };

  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('transfer.exportTitle')}</p>
          <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

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
          <>
            <textarea
              aria-label={t('transfer.resultAria')}
              readOnly
              value={result}
              className="mt-3 h-28 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onCopy}>
                {t('transfer.copy')}
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onDownload}>
                {t('transfer.download')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass + types + lint**

Run: `npx vitest run src/renderer/components/accounts/ExportAccountsDialog.test.tsx` (pass).
Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/ExportAccountsDialog.tsx src/renderer/components/accounts/ExportAccountsDialog.test.tsx
git commit -m "feat(accounts): add export dialog" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `ImportAccountsDialog`

**Files:**
- Create: `src/renderer/components/accounts/ImportAccountsDialog.tsx`
- Test: `src/renderer/components/accounts/ImportAccountsDialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/components/accounts/ImportAccountsDialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }, { id: 'n2' }] }) },
    openTextFile: vi.fn().mockResolvedValue({ ok: true, data: 'FILE-BLOB' }),
  };
});

describe('ImportAccountsDialog', () => {
  it('imports a pasted blob and reports the count', async () => {
    const onImported = vi.fn();
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={onImported} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it('loads a file into the textarea', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load file' }));
    await waitFor(() => expect(screen.getByLabelText('Import data')).toHaveValue('FILE-BLOB'));
  });

  it('shows an inline error and stays open on an incorrect password', async () => {
    (window.s3 as unknown as { accounts: { import: ReturnType<typeof vi.fn> } }).accounts.import = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'IncorrectPassword', message: 'Incorrect password.' } });
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx`
Expected: FAIL — cannot resolve `./ImportAccountsDialog`.

- [ ] **Step 3: Implement the dialog**

Create `src/renderer/components/accounts/ImportAccountsDialog.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useImportAccounts } from '../../hooks/useAccountTransfer';
import { useToast } from '../ui/ToastProvider';

export function ImportAccountsDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const importAccounts = useImportAccounts();
  const [blob, setBlob] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      setError((e as Error).message);
    }
  };

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
          className="h-28 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="mt-2">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onLoadFile}>
            {t('transfer.loadFile')}
          </button>
        </div>

        <label className="mt-3 block text-sm">
          {t('transfer.importPassword')}
          <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>

        {error !== null && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={blob.trim().length === 0 || importAccounts.isPending}
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

- [ ] **Step 4: Run to verify pass + types + lint**

Run: `npx vitest run src/renderer/components/accounts/ImportAccountsDialog.test.tsx` (pass).
Run: `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/ImportAccountsDialog.tsx src/renderer/components/accounts/ImportAccountsDialog.test.tsx
git commit -m "feat(accounts): add import dialog" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `ConnectionsScreen` entry points

**Files:**
- Modify: `src/renderer/components/connections/ConnectionsScreen.tsx`
- Modify: `src/renderer/components/connections/ConnectionsScreen.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append to the `describe('ConnectionsScreen', …)` block in `src/renderer/components/connections/ConnectionsScreen.test.tsx`. The shared `beforeEach` mock has only `accounts.list`/`accounts.remove`; these tests just open dialogs (no export/import call needed to open):

```tsx
  it('opens the export dialog from a row export button', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export AWS prod' }));
    expect(screen.getByText('Export accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('opens the import dialog from the header', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(screen.getByText('Import accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('opens the export-all dialog from the header', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export all' }));
    expect(screen.getByText('Export accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('disables export-all when there are no accounts', async () => {
    (window.s3 as unknown as { accounts: { list: ReturnType<typeof vi.fn> } }).accounts.list = vi
      .fn()
      .mockResolvedValue({ ok: true, data: [] });
    wrap(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled());
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer/components/connections/ConnectionsScreen.test.tsx`
Expected: FAIL — no Import / Export all / row Export buttons yet.

- [ ] **Step 3: Implement the entry points**

In `src/renderer/components/connections/ConnectionsScreen.tsx`:

Change the icon import line to add `FiDownload`/`FiUpload`:

```tsx
import { FiTrash2, FiEdit2, FiUpload } from 'react-icons/fi';
```

Add the dialog imports:

```tsx
import { ExportAccountsDialog } from '../accounts/ExportAccountsDialog';
import { ImportAccountsDialog } from '../accounts/ImportAccountsDialog';
```

Add dialog state inside the component (after `const [editing, setEditing] = useState<Editing>(null);`):

```tsx
  // null = closed; string[] = export those ids; 'import' = import dialog
  const [transfer, setTransfer] = useState<null | { kind: 'export'; ids: string[] } | { kind: 'import' }>(null);
```

Replace the header block (the `<div className="flex items-center justify-between pb-3">…</div>`) with one that adds Import + Export all next to Add account:

```tsx
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">{t('connections.title')}</h2>
        {editing === null && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => setTransfer({ kind: 'import' })}
            >
              {t('transfer.importAccounts')}
            </button>
            <button
              type="button"
              disabled={!accounts.data || accounts.data.length === 0}
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              onClick={() => setTransfer({ kind: 'export', ids: (accounts.data ?? []).map((a) => a.id) })}
            >
              {t('transfer.exportAll')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => setEditing('new')}
            >
              {t('connections.addAccount')}
            </button>
          </div>
        )}
      </div>
```

Add a row export button — inside the per-row `<div className="flex items-center gap-1">`, before the edit button:

```tsx
                  <button
                    type="button"
                    aria-label={t('transfer.exportAria', { label: acc.label })}
                    className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => setTransfer({ kind: 'export', ids: [acc.id] })}
                  >
                    <FiUpload className="h-4 w-4" aria-hidden />
                  </button>
```

Render the dialogs — add just before the final closing `</div>` of the component's outer wrapper:

```tsx
      {transfer?.kind === 'export' && (
        <ExportAccountsDialog accountIds={transfer.ids} onClose={() => setTransfer(null)} />
      )}
      {transfer?.kind === 'import' && (
        <ImportAccountsDialog onClose={() => setTransfer(null)} onImported={() => undefined} />
      )}
```

(The import dialog already invalidates the accounts query via `useImportAccounts`; `onImported` can be a no-op here.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer/components/connections/ConnectionsScreen.test.tsx`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Full suite + types + lint**

Run: `npm test` (all green), `npx tsc --noEmit` (clean), `npm run lint` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/connections/ConnectionsScreen.tsx src/renderer/components/connections/ConnectionsScreen.test.tsx
git commit -m "feat(accounts): export/import entry points in the Accounts screen" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes

- **Spec coverage:** transfer module + crypto (Task 1); file helpers (Task 2); export/import IPC incl. all-or-nothing + new ids (Task 3); hooks + i18n (Task 4); export dialog w/ password warning + copy + download (Task 5); import dialog w/ paste + load-file + inline password errors (Task 6); per-account + export-all + import entry points (Task 7). All spec sections covered.
- **Type consistency:** `ExportAccount` defined in Task 1, imported in Task 3; `accountsExport`/`accountsImport` arg shapes match across channels (Task 3), preload (Task 3), hooks (Task 4), and dialogs (Tasks 5/6); `TransferError.code` ∈ {PasswordRequired, IncorrectPassword, InvalidData} mapped to `err(code, …)` in Task 3 and surfaced inline in Task 6; `ConnParams`/`resolveConnParams` reused from existing register.ts code in Task 3.
- **Existing-test impact:** Task 2 relies on `buildHarness(overrides)` (present from the update-check branch; fallback noted). Task 7's new tests open dialogs only; the dialogs call `accounts.export`/`import` only on user action, which these tests don't trigger except where mocked.
- **Security:** secrets never logged; password optional with a visible plaintext warning; AES-256-GCM + scrypt; import all-or-nothing; new ids only.
