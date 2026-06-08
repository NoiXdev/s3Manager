# Custom S3-compatible Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users connect to any S3-compatible host by selecting a "Custom" provider and entering their own endpoint URL and path-style preference.

**Architecture:** Register `custom` as a third built-in provider. Persist `forcePathStyle` per account (new DB column, backfilled from the provider) so a custom host can control addressing. The create/test IPC handlers resolve the effective endpoint + path-style from a single helper: built-in providers derive them as before; custom uses the user-supplied values. The Add Account form conditionally reveals endpoint + path-style inputs when Custom is selected.

**Tech Stack:** Electron + TypeScript, React 19, `@aws-sdk/client-s3`, `node-sqlite3-wasm`, Vitest + Testing Library, `aws-sdk-client-mock`.

**Spec:** `docs/superpowers/specs/2026-06-08-custom-provider-design.md`

**Test commands:** `npm test` runs the full Vitest suite. Run a single file with `npx vitest run <path>`.

---

## File Structure

- `src/main/s3/providers.ts` — add `custom` to `ProviderId` and `PROVIDERS`.
- `src/main/storage/db.ts` — migrate: add + backfill `force_path_style` column.
- `src/main/storage/accountsRepo.ts` — persist/read `forcePathStyle`.
- `src/main/s3/accountClients.ts` — use the stored `forcePathStyle`.
- `src/main/ipc/channels.ts` — extend `CreateAccountInput`.
- `src/main/ipc/register.ts` — resolve connection params (built-in vs custom) for create + test.
- `src/renderer/components/accounts/AddAccountForm.tsx` — conditional custom fields.
- (No change needed in `src/renderer/lib/providers.ts`: `UI_PROVIDERS` is derived from `PROVIDERS`, so `custom` appears automatically.)

---

## Task 1: Register the `custom` provider

**Files:**
- Modify: `src/main/s3/providers.ts`
- Test: `src/main/s3/providers.test.ts`

- [ ] **Step 1: Update the failing tests**

Replace the first test and add custom coverage in `src/main/s3/providers.test.ts`. Change the `lists` assertion (lines 5-7) and add a `custom` case:

```ts
  it('lists amazon-s3, hetzner, and custom', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['amazon-s3', 'custom', 'hetzner']);
  });
```

Add inside the `describe('provider registry', …)` block, after the hetzner test:

```ts
  it('custom has inert defaults — no derived endpoint, path style on', () => {
    const p = getProvider('custom');
    expect(p.forcePathStyle).toBe(true);
    expect(resolveEndpoint('custom', 'us-east-1')).toBeUndefined();
  });
```

Add inside the `describe('bucketLocationConstraint', …)` block:

```ts
  it('returns undefined for custom', () => {
    expect(bucketLocationConstraint('custom', 'us-east-1')).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: FAIL — `getProvider('custom')` throws "Unknown provider: custom", and the `lists` assertion does not include `custom`.

- [ ] **Step 3: Implement the provider entry**

In `src/main/s3/providers.ts`, change the type on line 1:

```ts
export type ProviderId = 'amazon-s3' | 'hetzner' | 'custom';
```

Add this object as the last entry of the `PROVIDERS` array (after the `hetzner` entry, before the closing `]`):

```ts
  {
    id: 'custom',
    label: 'Custom (S3-compatible)',
    forcePathStyle: true,
    resolveEndpoint: () => undefined,
  },
```

`bucketLocationConstraint` already returns `undefined` for any provider other than `amazon-s3`, so it needs no change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/providers.ts src/main/s3/providers.test.ts
git commit -m "feat: register custom S3-compatible provider"
```

---

## Task 2: Migrate the `force_path_style` column

**Files:**
- Modify: `src/main/storage/db.ts`
- Test: `src/main/storage/db.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/main/storage/db.test.ts`, inside the `describe('openDatabase', …)` block:

```ts
  it('adds the force_path_style column to accounts', () => {
    const db = openDatabase(':memory:');
    const cols = (db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('force_path_style');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/db.test.ts`
Expected: FAIL — `cols` does not contain `force_path_style`.

- [ ] **Step 3: Implement the migration**

In `src/main/storage/db.ts`, replace the entire `migrate` function (currently lines 50-73) with:

```ts
function migrate(db: WasmDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      label         TEXT NOT NULL,
      provider      TEXT NOT NULL,
      endpoint      TEXT,
      region        TEXT NOT NULL,
      access_key_id TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_secrets (
      account_id TEXT PRIMARY KEY,
      ciphertext BLOB NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
  `);

  // node-sqlite3-wasm has no `ADD COLUMN IF NOT EXISTS`; guard with table_info.
  addColumnIfMissing(db, 'accounts', 'force_path_style', 'INTEGER');
  // Backfill rows created before this column existed: Hetzner used path style,
  // Amazon S3 (and anything else then) used virtual-host style.
  db.exec(
    `UPDATE accounts SET force_path_style = CASE provider WHEN 'hetzner' THEN 1 ELSE 0 END
     WHERE force_path_style IS NULL`,
  );
}

function addColumnIfMissing(db: WasmDatabase, table: string, column: string, type: string): void {
  const cols = db.all(`PRAGMA table_info(${table})`) as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/main/storage/db.test.ts`
Expected: PASS (including the existing idempotency test — `addColumnIfMissing` is a no-op on the second open).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/db.ts src/main/storage/db.test.ts
git commit -m "feat: add and backfill force_path_style account column"
```

---

## Task 3: Persist forcePathStyle through the storage + create path

**Files:**
- Modify: `src/main/storage/accountsRepo.ts`
- Modify: `src/main/s3/accountClients.ts`
- Modify: `src/main/ipc/register.ts:77-94` (the `accountsCreate` handler)
- Test: `src/main/storage/accountsRepo.test.ts`
- Test: `src/main/ipc/register.test.ts`

This task keeps `forcePathStyle` derived from the provider definition (the
permanent behavior for built-in providers); Task 4 generalizes the same code
path to honor a custom toggle.

- [ ] **Step 1: Update accountsRepo tests**

In `src/main/storage/accountsRepo.test.ts`, add `forcePathStyle: false` to the `sample` object (so it satisfies the new required field):

```ts
const sample: NewAccount = {
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AK',
  forcePathStyle: false,
};
```

Add a round-trip test inside the `describe('accountsRepo', …)` block:

```ts
  it('round-trips forcePathStyle', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create({ ...sample, forcePathStyle: true });
    expect(created.forcePathStyle).toBe(true);
    expect(repo.get(created.id)?.forcePathStyle).toBe(true);
    expect(repo.list()[0].forcePathStyle).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: FAIL — `forcePathStyle` is not a known property / `created.forcePathStyle` is `undefined`.

- [ ] **Step 3: Implement forcePathStyle in accountsRepo**

In `src/main/storage/accountsRepo.ts`:

Add `forcePathStyle: boolean;` to the `NewAccount` interface (after `accessKeyId`):

```ts
export interface NewAccount {
  label: string;
  provider: ProviderId;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  forcePathStyle: boolean;
}
```

Add `force_path_style: number;` to the `Row` interface (after `access_key_id`):

```ts
interface Row {
  id: string;
  label: string;
  provider: string;
  endpoint: string | null;
  region: string;
  access_key_id: string;
  force_path_style: number;
  created_at: number;
}
```

Add the field to `toAccount` (after `accessKeyId`):

```ts
    accessKeyId: row.access_key_id,
    forcePathStyle: Boolean(row.force_path_style),
```

Update the `create` INSERT to write the column:

```ts
    create(input: NewAccount): Account {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO accounts (id, label, provider, endpoint, region, access_key_id, force_path_style, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.label, input.provider, input.endpoint ?? null, input.region,
        input.accessKeyId, input.forcePathStyle ? 1 : 0, createdAt,
      );
      return { ...input, id, createdAt };
    },
```

- [ ] **Step 4: Run accountsRepo tests to verify they pass**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: PASS

- [ ] **Step 5: Use the stored forcePathStyle when building clients**

In `src/main/s3/accountClients.ts`, remove the now-unused `getProvider` import (line 3) and read the stored value. The full file becomes:

```ts
import type { S3Client } from '@aws-sdk/client-s3';
import { createClient } from './clientFactory';
import type { AccountsRepo } from '../storage/accountsRepo';
import type { SecretsStore } from '../storage/secrets';

export interface Deps {
  accounts: AccountsRepo;
  secrets: SecretsStore;
}

export function createClientForAccount(accountId: string, deps: Deps): S3Client {
  const account = deps.accounts.get(accountId);
  if (!account) throw new Error(`No account found for id ${accountId}`);

  const secretAccessKey = deps.secrets.get(accountId);
  if (!secretAccessKey) throw new Error(`No secret found for account ${accountId}`);

  return createClient({
    provider: account.provider,
    region: account.region,
    endpoint: account.endpoint,
    forcePathStyle: account.forcePathStyle,
    accessKeyId: account.accessKeyId,
    secretAccessKey,
  });
}
```

- [ ] **Step 6: Pass forcePathStyle from the create handler**

In `src/main/ipc/register.ts`, update the `accountsCreate` handler (lines 77-94) so the `deps.accounts.create({…})` call includes `forcePathStyle`. The `create` call becomes:

```ts
      const created = deps.accounts.create({
        label: input.label,
        provider: input.provider,
        endpoint,
        region: input.region,
        accessKeyId: input.accessKeyId,
        forcePathStyle: getProvider(input.provider).forcePathStyle,
      });
```

(`getProvider` is already imported on line 4. `endpoint` is still the existing `resolveEndpoint(input.provider, input.region)` from line 81 — unchanged in this task.)

- [ ] **Step 7: Add a register test for persisted forcePathStyle**

In `src/main/ipc/register.test.ts`, add inside `describe('registerIpc', …)` (after the existing `accounts:create stores…` test):

```ts
  it('accounts:create persists forcePathStyle derived from the provider', async () => {
    const { handlers } = buildHarness();
    const aws = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { forcePathStyle: boolean } };
    expect(aws.data.forcePathStyle).toBe(false);

    const hz = (await handlers.get(CH.accountsCreate)!({
      label: 'HZ', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { forcePathStyle: boolean } };
    expect(hz.data.forcePathStyle).toBe(true);
  });
```

- [ ] **Step 8: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS (all files — this confirms `accountClients` and every existing caller still typecheck and pass).

- [ ] **Step 9: Commit**

```bash
git add src/main/storage/accountsRepo.ts src/main/storage/accountsRepo.test.ts src/main/s3/accountClients.ts src/main/ipc/register.ts src/main/ipc/register.test.ts
git commit -m "feat: persist per-account forcePathStyle"
```

---

## Task 4: Resolve custom endpoint + path-style in the IPC handlers

**Files:**
- Modify: `src/main/ipc/channels.ts:60-66` (`CreateAccountInput`)
- Modify: `src/main/ipc/register.ts` (add helpers; update `accountsCreate` + `accountsTest`)
- Test: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/ipc/register.test.ts`, add a new describe block at the end of the file:

```ts
describe('custom provider', () => {
  it('accounts:create stores the typed endpoint and path-style toggle', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://minio.example.com:9000', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; data: { endpoint?: string; forcePathStyle: boolean } };
    expect(res.ok).toBe(true);
    expect(res.data.endpoint).toBe('https://minio.example.com:9000');
    expect(res.data.forcePathStyle).toBe(true);
    expect(deps.accounts.list()).toHaveLength(1);
  });

  it('accounts:create honors forcePathStyle=false for a custom host', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'Custom', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://s3.example.com', forcePathStyle: false,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { forcePathStyle: boolean } };
    expect(res.data.forcePathStyle).toBe(false);
  });

  it('accounts:create rejects a custom provider with a missing/invalid endpoint and persists nothing', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'Bad', provider: 'custom', region: 'us-east-1',
      endpoint: 'not-a-url', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidEndpoint');
    expect(deps.accounts.list()).toHaveLength(0);
  });

  it('accounts:test succeeds against a custom endpoint', async () => {
    const { handlers } = buildHarness();
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'b1' }] });
    const res = (await handlers.get(CH.accountsTest)!({
      label: 'MinIO', provider: 'custom', region: 'us-east-1',
      endpoint: 'https://minio.example.com:9000', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean };
    expect(res.ok).toBe(true);
  });

  it('accounts:test rejects a custom provider with an invalid endpoint', async () => {
    const { handlers } = buildHarness();
    const res = (await handlers.get(CH.accountsTest)!({
      label: 'Bad', provider: 'custom', region: 'us-east-1',
      endpoint: '', forcePathStyle: true,
      accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('InvalidEndpoint');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — custom create currently derives `endpoint` via `resolveEndpoint('custom', …)` which returns `undefined` (so `res.data.endpoint` is `undefined`), and there is no `InvalidEndpoint` validation.

- [ ] **Step 3: Extend CreateAccountInput**

In `src/main/ipc/channels.ts`, add two optional fields to `CreateAccountInput` (lines 60-66):

```ts
export interface CreateAccountInput {
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom providers only: the full endpoint URL the client should target. */
  endpoint?: string;
  /** Custom providers only: whether to use path-style addressing. */
  forcePathStyle?: boolean;
}
```

- [ ] **Step 4: Add the connection-param helper to register.ts**

In `src/main/ipc/register.ts`, add these two module-scope functions immediately before `export function registerIpc` (after the `RegisterDeps` interface):

```ts
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

interface ConnParams {
  endpoint: string | undefined;
  forcePathStyle: boolean;
}

/**
 * The effective endpoint + addressing style for a connection: custom providers
 * use the user-supplied values; built-in providers derive them as before.
 */
function resolveConnParams(input: CreateAccountInput): Result<ConnParams> {
  if (input.provider === 'custom') {
    const endpoint = input.endpoint?.trim();
    if (!endpoint || !isHttpUrl(endpoint)) {
      return err('InvalidEndpoint', 'A custom provider requires a valid http(s) endpoint URL');
    }
    return ok({ endpoint, forcePathStyle: input.forcePathStyle ?? true });
  }
  return ok({
    endpoint: resolveEndpoint(input.provider, input.region),
    forcePathStyle: getProvider(input.provider).forcePathStyle,
  });
}
```

(`Result`, `ok`, `err`, `resolveEndpoint`, `getProvider`, and `CreateAccountInput` are all already imported at the top of the file.)

- [ ] **Step 5: Use the helper in accountsCreate**

In `src/main/ipc/register.ts`, replace the body of the `accountsCreate` handler so it resolves params via the helper. The handler becomes:

```ts
  h(CH.accountsCreate, (input: CreateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const account = deps.db.transaction(() => {
      const created = deps.accounts.create({
        label: input.label,
        provider: input.provider,
        endpoint: params.data.endpoint,
        region: input.region,
        accessKeyId: input.accessKeyId,
        forcePathStyle: params.data.forcePathStyle,
      });
      deps.secrets.set(created.id, input.secretAccessKey);
      return created;
    })();
    return ok(account);
  });
```

- [ ] **Step 6: Use the helper in accountsTest**

In `src/main/ipc/register.ts`, replace the body of the `accountsTest` handler so it resolves params via the helper. The handler becomes:

```ts
  h(CH.accountsTest, async (input: CreateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const client = createClient({
      provider: input.provider,
      region: input.region,
      endpoint: params.data.endpoint,
      forcePathStyle: params.data.forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    });
    const r = await listBuckets(client);
    return r.ok ? ok(true as const) : err(r.error.code, r.error.message);
  });
```

- [ ] **Step 7: Run the full suite to verify everything passes**

Run: `npm test`
Expected: PASS — the new custom tests pass, and the Task 3 `forcePathStyle` test still passes (built-in path unchanged in behavior).

- [ ] **Step 8: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/main/ipc/register.test.ts
git commit -m "feat: resolve custom endpoint and path-style in account handlers"
```

---

## Task 5: Add custom fields to the Add Account form

**Files:**
- Modify: `src/renderer/components/accounts/AddAccountForm.tsx`
- Test: `src/renderer/components/accounts/AddAccountForm.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/components/accounts/AddAccountForm.test.tsx`, add inside the `describe('AddAccountForm', …)` block:

```ts
  it('hides custom fields unless the custom provider is selected', () => {
    wrap(<AddAccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
    expect(screen.queryByLabelText('Path-style addressing')).toBeNull();
  });

  it('reveals custom fields and prefills the region when custom is selected', async () => {
    wrap(<AddAccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Path-style addressing')).toBeInTheDocument();
    expect(screen.getByLabelText('Region')).toHaveValue('us-east-1');
  });

  it('submits the endpoint and path-style toggle for a custom provider', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AddAccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Label'), 'MinIO');
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await userEvent.type(screen.getByLabelText('Endpoint URL'), 'https://minio.example.com:9000');
    await userEvent.click(screen.getByLabelText('Path-style addressing')); // default ON -> toggle OFF
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIA');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(onSubmit).toHaveBeenCalledWith({
      label: 'MinIO',
      provider: 'custom',
      region: 'us-east-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      endpoint: 'https://minio.example.com:9000',
      forcePathStyle: false,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/accounts/AddAccountForm.test.tsx`
Expected: FAIL — there is no "Endpoint URL" / "Path-style addressing" field, and selecting custom does not prefill the region.

- [ ] **Step 3: Implement the form changes**

In `src/renderer/components/accounts/AddAccountForm.tsx`:

Add two state hooks after the existing `secretAccessKey` state (line 19):

```ts
  const [endpoint, setEndpoint] = useState('');
  const [forcePathStyle, setForcePathStyle] = useState(true);
```

Replace the `input` declaration (line 22) so custom-only fields are included only for the custom provider:

```ts
  const input: CreateAccountInput = {
    label,
    provider,
    region,
    accessKeyId,
    secretAccessKey,
    ...(provider === 'custom' ? { endpoint, forcePathStyle } : {}),
  };
```

Replace the Provider `<select>`'s `onChange` (line 38) so selecting custom prefills an empty region:

```tsx
        <select
          className={fieldClass}
          value={provider}
          onChange={(e) => {
            const next = e.target.value as CreateAccountInput['provider'];
            setProvider(next);
            if (next === 'custom' && region.trim() === '') setRegion('us-east-1');
          }}
        >
```

Add the conditional custom fields immediately after the Provider `<label>` block (after line 45, before the Region label):

```tsx
      {provider === 'custom' && (
        <>
          <label className="block">
            Endpoint URL
            <input
              className={fieldClass}
              placeholder="https://minio.example.com:9000"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(e) => setForcePathStyle(e.target.checked)}
            />
            Path-style addressing
          </label>
        </>
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/accounts/AddAccountForm.test.tsx`
Expected: PASS — including the existing "submits the entered values" test (the amazon-s3 input is unchanged because the custom fields are spread in only when `provider === 'custom'`).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/accounts/AddAccountForm.tsx src/renderer/components/accounts/AddAccountForm.test.tsx
git commit -m "feat: add custom endpoint and path-style fields to add-account form"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (confirms the removed `getProvider` import in `accountClients.ts` left no unused imports and the new code is clean).

- [ ] **Step 3: Manual smoke test (main-process change — full restart required)**

Run: `npm start`

> Note: changing main-process IPC handlers requires a full restart of `npm start`, not just a renderer HMR.

In the running app: add an account, choose **Custom (S3-compatible)**, confirm the Endpoint URL field and Path-style checkbox appear and Region prefills to `us-east-1`, enter a reachable S3-compatible endpoint + keys, click **Test connection**, and confirm "Connection OK". Save and confirm the account lists its buckets.
