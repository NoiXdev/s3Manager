# S3 Manager — Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully-tested main-process backend for the S3 Manager — storage, provider abstraction, S3 operations, and the typed IPC/preload contract — with no UI yet.

**Architecture:** All sensitive logic runs in the Electron main process behind a typed `contextBridge` API. S3 access uses AWS SDK v3 (one client, two providers via endpoint/path-style config). Non-secret config lives in SQLite (`better-sqlite3`); secret keys are encrypted with Electron `safeStorage` and the ciphertext is persisted in SQLite. Modules are dependency-injected so logic is unit-testable under Vitest without Electron or a real bucket.

**Tech Stack:** Electron 42, TypeScript 5, Vite, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`, `better-sqlite3`, Vitest, `aws-sdk-client-mock`.

---

## Status: COMPLETE (2026-05-29)

All 20 tasks implemented on branch `feat/backend-foundation`. Final state: `npx tsc --noEmit` clean, **45 tests passing** across 15 files.

**Deviations from the plan as written (all intentional, verified):**
- `uuid` dependency dropped in favor of Node's built-in `crypto.randomUUID()`.
- `db.ts` sets `PRAGMA foreign_keys = ON` (the `account_secrets → accounts` `ON DELETE CASCADE` now functions); the secrets test seeds a parent account row.
- The upload test constructs its `S3Client` with a `region` because `@aws-sdk/lib-storage`'s `Upload` resolves region before dispatch (otherwise "Region is missing").
- `vitest.config.ts` sets `passWithNoTests: true`.
- `IpcMainLike.handle` uses `unknown[]` (not `never[]`); the internal `h` helper bridges with a locally-scoped `any[]`. `tsconfig` includes `forge.env.d.ts` so the Vite globals type-check.

**Post-implementation hardening (from final review, commit `harden: …`):**
- `deleteFolder` rejects an empty/root prefix (`InvalidPrefix`) — prevents accidental whole-bucket deletion.
- `accountsCreate` wraps account-row insert + secret-set in a `better-sqlite3` transaction (atomic; rolls back if the secret fails).
- `accountsCreate`/`accountsTest` validate `provider` against the registry (`InvalidProvider`).

**Deferred to Plan 2 (File Manager UI) or later — NOT implemented here:**
- Live Electron GUI boot smoke test (replaced by `tsc` + full test suite verification; the GUI boot remains a manual step — note that `npm start` runs `electron-rebuild` for `better-sqlite3`, which then requires `npm rebuild better-sqlite3` before `npm test` works again under Node).
- Per-file **upload progress transport** over IPC (`onProgress` exists on the op but no `webContents.send` channel yet).
- **Content-Security-Policy** on the renderer.
- **Versioned** schema migrations (current `migrate()` is `CREATE TABLE IF NOT EXISTS` only).
- `settingsRepo` has no IPC channel yet (wired into main, unused at the boundary).
- `deleteFolder` ignores the `DeleteObjects` per-key `Errors[]` (reports attempted count).

---

## File Structure

```
src/main/
  shared/result.ts            # Result<T> discriminated union + helpers
  s3/providers.ts             # provider registry (endpoint/path-style defaults)
  s3/clientFactory.ts         # connection profile -> S3Client config + client
  s3/listTransform.ts         # pure prefix/breadcrumb + List output transforms
  s3/objects.ts               # list/head/presign/delete/upload/download ops
  s3/visibility.ts            # public/private detection
  s3/accountClients.ts        # accountId -> configured S3Client (orchestration)
  storage/db.ts               # better-sqlite3 connection + migrations
  storage/accountsRepo.ts     # CRUD for accounts (non-secret)
  storage/settingsRepo.ts     # key/value app settings
  storage/secrets.ts          # safeStorage encrypt + SQLite ciphertext persistence
  ipc/channels.ts             # channel name constants + payload/response types
  ipc/register.ts             # wires channels -> service handlers
src/preload.ts                # typed window.s3 bridge (rewritten)
src/main.ts                   # init db + register IPC on ready (modified)
vite.main.config.ts           # externalize native module (modified)
vitest.config.ts              # test runner config (created)
tsconfig.json                 # TS5 + strict (modified)
```

Each `src/main` module has one responsibility and is imported by `ipc/register.ts`, which is the only place services are composed.

---

## Task 1: Project setup — dependencies, tsconfig, Vitest

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vite.main.config.ts`
- Create: `vitest.config.ts`
- Create: `src/main/shared/smoke.test.ts` (temporary, deleted in Step 7)

- [ ] **Step 1: Install runtime + dev dependencies**

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage better-sqlite3
npm install -D typescript@^5.4.0 vitest@^2.1.0 aws-sdk-client-mock@^4.1.0 @types/better-sqlite3 @types/node
```

- [ ] **Step 2: Replace `tsconfig.json` with a TS5 strict config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "baseUrl": ".",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "forge.config.ts", "*.config.ts"]
}
```

- [ ] **Step 3: Externalize the native module in `vite.main.config.ts`**

```ts
import { defineConfig } from 'vite';

// better-sqlite3 is a native module; it must be resolved at runtime from
// node_modules (unpacked by @electron-forge/plugin-auto-unpack-natives), not
// bundled by Vite/Rollup.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3'],
    },
  },
});
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Add the test script to `package.json`**

Add to the `"scripts"` object:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 6: Add a temporary smoke test to prove the runner works**

Create `src/main/shared/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('vitest', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the test, confirm it passes, then delete it**

Run: `npm test`
Expected: 1 passing test.

```bash
rm src/main/shared/smoke.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add backend deps, TS5 strict config, and Vitest"
```

---

## Task 2: Result<T> helpers

**Files:**
- Create: `src/main/shared/result.ts`
- Test: `src/main/shared/result.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/shared/result.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ok, err, isOk } from './result';

describe('Result helpers', () => {
  it('ok wraps data', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, data: 42 });
    expect(isOk(r)).toBe(true);
  });

  it('err wraps code + message', () => {
    const r = err('AccessDenied', 'nope');
    expect(r).toEqual({ ok: false, error: { code: 'AccessDenied', message: 'nope' } });
    expect(isOk(r)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/shared/result.test.ts`
Expected: FAIL — cannot find module `./result`.

- [ ] **Step 3: Write the implementation**

`src/main/shared/result.ts`:

```ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/shared/result.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/shared/result.ts src/main/shared/result.test.ts
git commit -m "feat: add Result<T> helpers for IPC boundary"
```

---

## Task 3: Provider registry

**Files:**
- Create: `src/main/s3/providers.ts`
- Test: `src/main/s3/providers.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/s3/providers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, resolveEndpoint } from './providers';

describe('provider registry', () => {
  it('lists amazon-s3 and hetzner', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['amazon-s3', 'hetzner']);
  });

  it('amazon-s3 lets the SDK derive the endpoint and uses virtual-host style', () => {
    const p = getProvider('amazon-s3');
    expect(p.forcePathStyle).toBe(false);
    expect(resolveEndpoint('amazon-s3', 'eu-central-1')).toBeUndefined();
  });

  it('hetzner builds a region endpoint and uses path style', () => {
    const p = getProvider('hetzner');
    expect(p.forcePathStyle).toBe(true);
    expect(resolveEndpoint('hetzner', 'fsn1')).toBe('https://fsn1.your-objectstorage.com');
  });

  it('throws on unknown provider', () => {
    expect(() => getProvider('gcs' as never)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: FAIL — cannot find module `./providers`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/providers.ts`:

```ts
export type ProviderId = 'amazon-s3' | 'hetzner';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  forcePathStyle: boolean;
  /** Returns the endpoint URL, or undefined to let the AWS SDK derive it. */
  resolveEndpoint(region: string): string | undefined;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'amazon-s3',
    label: 'Amazon S3',
    forcePathStyle: false,
    resolveEndpoint: () => undefined,
  },
  {
    id: 'hetzner',
    label: 'Hetzner Object Storage',
    forcePathStyle: true,
    resolveEndpoint: (region) => `https://${region}.your-objectstorage.com`,
  },
];

export function getProvider(id: ProviderId): ProviderDef {
  const provider = PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown provider: ${id}`);
  return provider;
}

export function resolveEndpoint(id: ProviderId, region: string): string | undefined {
  return getProvider(id).resolveEndpoint(region);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/providers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/providers.ts src/main/s3/providers.test.ts
git commit -m "feat: add provider registry for Amazon S3 and Hetzner"
```

---

## Task 4: S3 client factory

**Files:**
- Create: `src/main/s3/clientFactory.ts`
- Test: `src/main/s3/clientFactory.test.ts`

A `ConnectionProfile` holds everything needed to build a client. `buildClientConfig` is the pure, testable part; `createClient` wraps it.

- [ ] **Step 1: Write the failing test**

`src/main/s3/clientFactory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { buildClientConfig, createClient, type ConnectionProfile } from './clientFactory';

const base: ConnectionProfile = {
  provider: 'hetzner',
  region: 'fsn1',
  endpoint: 'https://fsn1.your-objectstorage.com',
  forcePathStyle: true,
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
};

describe('buildClientConfig', () => {
  it('maps profile fields onto S3 client config', () => {
    const cfg = buildClientConfig(base);
    expect(cfg.region).toBe('fsn1');
    expect(cfg.endpoint).toBe('https://fsn1.your-objectstorage.com');
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.credentials).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' });
  });

  it('omits endpoint when not provided (Amazon S3 default)', () => {
    const cfg = buildClientConfig({ ...base, provider: 'amazon-s3', endpoint: undefined, forcePathStyle: false });
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.forcePathStyle).toBe(false);
  });
});

describe('createClient', () => {
  it('returns an S3Client instance', () => {
    expect(createClient(base)).toBeInstanceOf(S3Client);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/clientFactory.test.ts`
Expected: FAIL — cannot find module `./clientFactory`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/clientFactory.ts`:

```ts
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import type { ProviderId } from './providers';

export interface ConnectionProfile {
  provider: ProviderId;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

export function buildClientConfig(profile: ConnectionProfile): S3ClientConfig {
  const config: S3ClientConfig = {
    region: profile.region,
    forcePathStyle: profile.forcePathStyle,
    credentials: {
      accessKeyId: profile.accessKeyId,
      secretAccessKey: profile.secretAccessKey,
    },
  };
  if (profile.endpoint) config.endpoint = profile.endpoint;
  return config;
}

export function createClient(profile: ConnectionProfile): S3Client {
  return new S3Client(buildClientConfig(profile));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/clientFactory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/clientFactory.ts src/main/s3/clientFactory.test.ts
git commit -m "feat: add S3 client factory"
```

---

## Task 5: List transform + prefix/breadcrumb helpers

**Files:**
- Create: `src/main/s3/listTransform.ts`
- Test: `src/main/s3/listTransform.test.ts`

Pure functions: turn `ListObjectsV2` output into folders/files, and map prefixes to breadcrumbs.

- [ ] **Step 1: Write the failing test**

`src/main/s3/listTransform.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transformListing, prefixToBreadcrumb, parentPrefix } from './listTransform';

describe('transformListing', () => {
  it('maps CommonPrefixes to folders and Contents to files, skipping the prefix placeholder', () => {
    const out = transformListing(
      {
        CommonPrefixes: [{ Prefix: 'images/thumbs/' }],
        Contents: [
          { Key: 'images/', Size: 0 }, // the folder placeholder key — must be skipped
          { Key: 'images/logo.png', Size: 1234, LastModified: new Date('2024-01-01'), StorageClass: 'STANDARD', ETag: '"abc"' },
        ],
      },
      'images/',
    );
    expect(out.folders).toEqual([{ name: 'thumbs', prefix: 'images/thumbs/' }]);
    expect(out.files).toEqual([
      {
        name: 'logo.png',
        key: 'images/logo.png',
        size: 1234,
        lastModified: '2024-01-01T00:00:00.000Z',
        storageClass: 'STANDARD',
        etag: '"abc"',
      },
    ]);
  });
});

describe('prefixToBreadcrumb', () => {
  it('returns root for empty prefix', () => {
    expect(prefixToBreadcrumb('')).toEqual([{ label: 'root', prefix: '' }]);
  });
  it('builds cumulative segments', () => {
    expect(prefixToBreadcrumb('a/b/')).toEqual([
      { label: 'root', prefix: '' },
      { label: 'a', prefix: 'a/' },
      { label: 'b', prefix: 'a/b/' },
    ]);
  });
});

describe('parentPrefix', () => {
  it('drops the last segment', () => {
    expect(parentPrefix('a/b/')).toBe('a/');
    expect(parentPrefix('a/')).toBe('');
    expect(parentPrefix('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/listTransform.test.ts`
Expected: FAIL — cannot find module `./listTransform`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/listTransform.ts`:

```ts
export interface FolderEntry {
  name: string;
  prefix: string;
}

export interface FileEntry {
  name: string;
  key: string;
  size: number;
  lastModified: string | null;
  storageClass: string | null;
  etag: string | null;
}

export interface Listing {
  folders: FolderEntry[];
  files: FileEntry[];
}

interface RawListOutput {
  CommonPrefixes?: { Prefix?: string }[];
  Contents?: {
    Key?: string;
    Size?: number;
    LastModified?: Date;
    StorageClass?: string;
    ETag?: string;
  }[];
}

export function transformListing(out: RawListOutput, prefix: string): Listing {
  const folders: FolderEntry[] = (out.CommonPrefixes ?? [])
    .map((cp) => cp.Prefix ?? '')
    .filter(Boolean)
    .map((p) => ({ name: stripPrefix(p, prefix).replace(/\/$/, ''), prefix: p }));

  const files: FileEntry[] = (out.Contents ?? [])
    .filter((c) => c.Key && c.Key !== prefix) // skip the folder placeholder key
    .map((c) => ({
      name: stripPrefix(c.Key!, prefix),
      key: c.Key!,
      size: c.Size ?? 0,
      lastModified: c.LastModified ? c.LastModified.toISOString() : null,
      storageClass: c.StorageClass ?? null,
      etag: c.ETag ?? null,
    }));

  return { folders, files };
}

function stripPrefix(key: string, prefix: string): string {
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export interface Crumb {
  label: string;
  prefix: string;
}

export function prefixToBreadcrumb(prefix: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'root', prefix: '' }];
  const segments = prefix.split('/').filter(Boolean);
  let acc = '';
  for (const seg of segments) {
    acc += `${seg}/`;
    crumbs.push({ label: seg, prefix: acc });
  }
  return crumbs;
}

export function parentPrefix(prefix: string): string {
  const segments = prefix.split('/').filter(Boolean);
  segments.pop();
  return segments.length ? `${segments.join('/')}/` : '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/listTransform.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/listTransform.ts src/main/s3/listTransform.test.ts
git commit -m "feat: add list transform and breadcrumb helpers"
```

---

## Task 6: S3 ops — listBuckets and listObjects

**Files:**
- Create: `src/main/s3/objects.ts`
- Test: `src/main/s3/objects.test.ts`

All ops take an `S3Client` and return `Result<T>`. Tests use `aws-sdk-client-mock`.

- [ ] **Step 1: Write the failing test**

`src/main/s3/objects.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { listBuckets, listObjects } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('listBuckets', () => {
  it('returns bucket names', async () => {
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'a' }, { Name: 'b' }] });
    const r = await listBuckets(new S3Client({}));
    expect(r).toEqual({ ok: true, data: ['a', 'b'] });
  });

  it('maps SDK errors to err Result', async () => {
    s3Mock.on(ListBucketsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    const r = await listBuckets(new S3Client({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AccessDenied');
  });
});

describe('listObjects', () => {
  it('returns folders, files, and nextToken', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      CommonPrefixes: [{ Prefix: 'docs/' }],
      Contents: [{ Key: 'readme.txt', Size: 10 }],
      NextContinuationToken: 'TOK',
    });
    const r = await listObjects(new S3Client({}), { bucket: 'b', prefix: '' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.folders).toEqual([{ name: 'docs', prefix: 'docs/' }]);
      expect(r.data.files.map((f) => f.name)).toEqual(['readme.txt']);
      expect(r.data.nextToken).toBe('TOK');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: FAIL — cannot find module `./objects`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/objects.ts`:

```ts
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { transformListing, type Listing } from './listTransform';

export function toErr(e: unknown): Result<never> {
  const code = (e as { name?: string })?.name ?? 'UnknownError';
  const message = (e as { message?: string })?.message ?? 'Unexpected error';
  return err(code, message);
}

export async function listBuckets(client: S3Client): Promise<Result<string[]>> {
  try {
    const out = await client.send(new ListBucketsCommand({}));
    return ok((out.Buckets ?? []).map((b) => b.Name!).filter(Boolean));
  } catch (e) {
    return toErr(e);
  }
}

export interface ListObjectsArgs {
  bucket: string;
  prefix: string;
  continuationToken?: string;
}

export interface ListObjectsResult extends Listing {
  nextToken: string | null;
}

export async function listObjects(
  client: S3Client,
  args: ListObjectsArgs,
): Promise<Result<ListObjectsResult>> {
  try {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: args.bucket,
        Prefix: args.prefix || undefined,
        Delimiter: '/',
        ContinuationToken: args.continuationToken,
      }),
    );
    const listing = transformListing(out, args.prefix);
    return ok({ ...listing, nextToken: out.NextContinuationToken ?? null });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/objects.test.ts
git commit -m "feat: add listBuckets and listObjects S3 operations"
```

---

## Task 7: S3 ops — headObject (metadata)

**Files:**
- Modify: `src/main/s3/objects.ts`
- Modify: `src/main/s3/objects.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/main/s3/objects.test.ts` (and add `HeadObjectCommand` to the existing `@aws-sdk/client-s3` import, and `headObject` to the `./objects` import):

```ts
describe('headObject', () => {
  it('returns metadata fields', async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1234,
      ContentType: 'image/png',
      LastModified: new Date('2024-01-01'),
      StorageClass: 'STANDARD',
      ETag: '"abc"',
      Metadata: { owner: 'me' },
    });
    const r = await headObject(new S3Client({}), { bucket: 'b', key: 'x.png' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        size: 1234,
        contentType: 'image/png',
        lastModified: '2024-01-01T00:00:00.000Z',
        storageClass: 'STANDARD',
        etag: '"abc"',
        metadata: { owner: 'me' },
      });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: FAIL — `headObject` is not exported.

- [ ] **Step 3: Add the implementation**

Add `HeadObjectCommand` to the `@aws-sdk/client-s3` import in `objects.ts`, then append:

```ts
export interface ObjectMetadata {
  size: number;
  contentType: string | null;
  lastModified: string | null;
  storageClass: string | null;
  etag: string | null;
  metadata: Record<string, string>;
}

export async function headObject(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectMetadata>> {
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: args.bucket, Key: args.key }),
    );
    return ok({
      size: out.ContentLength ?? 0,
      contentType: out.ContentType ?? null,
      lastModified: out.LastModified ? out.LastModified.toISOString() : null,
      storageClass: out.StorageClass ?? null,
      etag: out.ETag ?? null,
      metadata: out.Metadata ?? {},
    });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/objects.test.ts
git commit -m "feat: add headObject metadata operation"
```

---

## Task 8: S3 ops — presigned GET URL

**Files:**
- Modify: `src/main/s3/objects.ts`
- Create: `src/main/s3/presign.test.ts`

The presigner module is mocked so the test doesn't depend on real signing.

- [ ] **Step 1: Write the failing test**

`src/main/s3/presign.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { presignGetUrl } from './objects';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/x'),
}));

beforeEach(() => vi.clearAllMocks());

describe('presignGetUrl', () => {
  it('returns a signed url with the requested expiry', async () => {
    const r = await presignGetUrl(new S3Client({}), { bucket: 'b', key: 'k', expiresIn: 3600 });
    expect(r).toEqual({ ok: true, data: 'https://signed.example/x' });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/presign.test.ts`
Expected: FAIL — `presignGetUrl` is not exported.

- [ ] **Step 3: Add the implementation**

Add `GetObjectCommand` to the `@aws-sdk/client-s3` import in `objects.ts`, add a new import, then append:

```ts
// add near the top of objects.ts:
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// append:
export async function presignGetUrl(
  client: S3Client,
  args: { bucket: string; key: string; expiresIn: number },
): Promise<Result<string>> {
  try {
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: args.bucket, Key: args.key }),
      { expiresIn: args.expiresIn },
    );
    return ok(url);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/presign.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/presign.test.ts
git commit -m "feat: add presigned GET URL operation"
```

---

## Task 9: S3 ops — delete object and delete folder (batched)

**Files:**
- Modify: `src/main/s3/objects.ts`
- Modify: `src/main/s3/objects.test.ts`

`deleteFolder` paginates all keys under a prefix and deletes them in batches of 1000.

- [ ] **Step 1: Add the failing test**

Append to `src/main/s3/objects.test.ts` (add `DeleteObjectCommand`, `DeleteObjectsCommand` to the SDK import; `deleteObject`, `deleteFolder` to the `./objects` import):

```ts
describe('deleteObject', () => {
  it('deletes a single key', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    const r = await deleteObject(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 1 });
  });
});

describe('deleteFolder', () => {
  it('lists all keys under the prefix and deletes them, returning the count', async () => {
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({ Contents: [{ Key: 'p/a' }, { Key: 'p/b' }], NextContinuationToken: 'T' })
      .resolves({ Contents: [{ Key: 'p/c' }] });
    s3Mock.on(DeleteObjectsCommand).resolves({ Deleted: [] });
    const r = await deleteFolder(new S3Client({}), { bucket: 'b', prefix: 'p/' });
    expect(r).toEqual({ ok: true, data: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: FAIL — `deleteObject`/`deleteFolder` not exported.

- [ ] **Step 3: Add the implementation**

Add `DeleteObjectCommand`, `DeleteObjectsCommand` to the SDK import in `objects.ts`, then append:

```ts
export async function deleteObject(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<number>> {
  try {
    await client.send(new DeleteObjectCommand({ Bucket: args.bucket, Key: args.key }));
    return ok(1);
  } catch (e) {
    return toErr(e);
  }
}

export async function deleteFolder(
  client: S3Client,
  args: { bucket: string; prefix: string },
): Promise<Result<number>> {
  try {
    let token: string | undefined;
    let deleted = 0;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: args.bucket,
          Prefix: args.prefix,
          ContinuationToken: token,
        }),
      );
      const keys = (listed.Contents ?? []).map((c) => c.Key!).filter(Boolean);
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: args.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })) },
          }),
        );
        deleted += batch.length;
      }
      token = listed.NextContinuationToken;
    } while (token);
    return ok(deleted);
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/objects.test.ts
git commit -m "feat: add delete object and batched delete folder"
```

---

## Task 10: S3 ops — upload (multipart via lib-storage)

**Files:**
- Modify: `src/main/s3/objects.ts`
- Create: `src/main/s3/upload.test.ts`

`uploadObject` reads a local file path and uploads it, reporting progress via a callback.

- [ ] **Step 1: Write the failing test**

`src/main/s3/upload.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uploadObject } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('uploadObject', () => {
  it('uploads a local file and resolves ok', async () => {
    s3Mock.on(PutObjectCommand).resolves({});
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const file = join(dir, 'hello.txt');
    writeFileSync(file, 'hello world');

    const r = await uploadObject(new S3Client({}), {
      bucket: 'b',
      key: 'hello.txt',
      filePath: file,
      contentType: 'text/plain',
    });
    expect(r).toEqual({ ok: true, data: { key: 'hello.txt' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/upload.test.ts`
Expected: FAIL — `uploadObject` not exported.

- [ ] **Step 3: Add the implementation**

Add imports to `objects.ts`, then append:

```ts
// add near the top of objects.ts:
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';

// append:
export interface UploadArgs {
  bucket: string;
  key: string;
  filePath: string;
  contentType?: string;
  onProgress?: (loaded: number, total: number | undefined) => void;
}

export async function uploadObject(
  client: S3Client,
  args: UploadArgs,
): Promise<Result<{ key: string }>> {
  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: args.bucket,
        Key: args.key,
        Body: createReadStream(args.filePath),
        ContentType: args.contentType,
      },
    });
    if (args.onProgress) {
      upload.on('httpUploadProgress', (p) => args.onProgress!(p.loaded ?? 0, p.total));
    }
    await upload.done();
    return ok({ key: args.key });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/upload.test.ts
git commit -m "feat: add multipart file upload operation"
```

---

## Task 11: S3 ops — download (stream to disk)

**Files:**
- Modify: `src/main/s3/objects.ts`
- Create: `src/main/s3/download.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/s3/download.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadObject } from './objects';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('downloadObject', () => {
  it('streams the object body to a local file', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: Readable.from([Buffer.from('file bytes')]) as never });
    const dir = mkdtempSync(join(tmpdir(), 's3m-'));
    const dest = join(dir, 'out.bin');

    const r = await downloadObject(new S3Client({}), { bucket: 'b', key: 'k', destPath: dest });
    expect(r).toEqual({ ok: true, data: { path: dest } });
    expect(readFileSync(dest, 'utf8')).toBe('file bytes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/download.test.ts`
Expected: FAIL — `downloadObject` not exported.

- [ ] **Step 3: Add the implementation**

Add imports to `objects.ts`, then append:

```ts
// add near the top of objects.ts:
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

// append:
export async function downloadObject(
  client: S3Client,
  args: { bucket: string; key: string; destPath: string },
): Promise<Result<{ path: string }>> {
  try {
    const out = await client.send(
      new GetObjectCommand({ Bucket: args.bucket, Key: args.key }),
    );
    if (!out.Body) return err('EmptyBody', 'Object has no body');
    await pipeline(out.Body as Readable, createWriteStream(args.destPath));
    return ok({ path: args.destPath });
  } catch (e) {
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/download.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objects.ts src/main/s3/download.test.ts
git commit -m "feat: add streaming download operation"
```

---

## Task 12: S3 ops — object visibility

**Files:**
- Create: `src/main/s3/visibility.ts`
- Test: `src/main/s3/visibility.test.ts`

Reads an object ACL and reports `public` if it grants READ to AllUsers, else `private`. ACL-not-supported errors map to `unknown` rather than failing the listing.

- [ ] **Step 1: Write the failing test**

`src/main/s3/visibility.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectVisibility } from './visibility';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const PUBLIC_GROUP = 'http://acs.amazonaws.com/groups/global/AllUsers';

describe('getObjectVisibility', () => {
  it('is public when AllUsers has READ', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({
      Grants: [{ Grantee: { Type: 'Group', URI: PUBLIC_GROUP }, Permission: 'READ' }],
    });
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'public' });
  });

  it('is private with no public grant', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({ Grants: [] });
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'private' });
  });

  it('is unknown when ACLs are not supported', async () => {
    s3Mock.on(GetObjectAclCommand).rejects(Object.assign(new Error('x'), { name: 'AccessControlListNotSupported' }));
    const r = await getObjectVisibility(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'unknown' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/visibility.test.ts`
Expected: FAIL — cannot find module `./visibility`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/visibility.ts`:

```ts
import { S3Client, GetObjectAclCommand } from '@aws-sdk/client-s3';
import { ok, type Result } from '../shared/result';
import { toErr } from './objects';

export type Visibility = 'public' | 'private' | 'unknown';

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';
const ACL_UNSUPPORTED = new Set([
  'AccessControlListNotSupported',
  'NotImplemented',
]);

export async function getObjectVisibility(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<Visibility>> {
  try {
    const out = await client.send(
      new GetObjectAclCommand({ Bucket: args.bucket, Key: args.key }),
    );
    const isPublic = (out.Grants ?? []).some(
      (g) =>
        g.Grantee?.URI === ALL_USERS &&
        (g.Permission === 'READ' || g.Permission === 'FULL_CONTROL'),
    );
    return ok(isPublic ? 'public' : 'private');
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    if (ACL_UNSUPPORTED.has(name)) return ok('unknown');
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/visibility.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/visibility.ts src/main/s3/visibility.test.ts
git commit -m "feat: add object visibility detection"
```

---

## Task 13: Storage — database connection + migrations

**Files:**
- Create: `src/main/storage/db.ts`
- Test: `src/main/storage/db.test.ts`

`openDatabase(filename)` opens a `better-sqlite3` DB and runs idempotent migrations. Tests use `:memory:`.

> **Native module note:** `better-sqlite3` is compiled against a specific ABI. Electron Forge rebuilds it for Electron on `npm start`/`package`. Vitest runs under system Node, so if a test ever fails to load the native binding after a Forge run, rebuild for Node with `npm rebuild better-sqlite3` before running tests. (This only matters if you alternate between `npm start` and `npm test`.)

- [ ] **Step 1: Write the failing test**

`src/main/storage/db.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';

describe('openDatabase', () => {
  it('creates the accounts, app_settings, and account_secrets tables', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: { name: string }) => r.name);
    expect(tables).toContain('accounts');
    expect(tables).toContain('app_settings');
    expect(tables).toContain('account_secrets');
  });

  it('is idempotent — opening twice does not throw', () => {
    expect(() => {
      openDatabase(':memory:');
      openDatabase(':memory:');
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/db.test.ts`
Expected: FAIL — cannot find module `./db`.

- [ ] **Step 3: Write the implementation**

`src/main/storage/db.ts`:

```ts
import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/db.ts src/main/storage/db.test.ts
git commit -m "feat: add SQLite connection and migrations"
```

---

## Task 14: Storage — accounts repository

**Files:**
- Create: `src/main/storage/accountsRepo.ts`
- Test: `src/main/storage/accountsRepo.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/storage/accountsRepo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createAccountsRepo, type NewAccount } from './accountsRepo';

const sample: NewAccount = {
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AK',
};

describe('accountsRepo', () => {
  it('creates and lists accounts with a generated id', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].label).toBe('AWS prod');
  });

  it('gets an account by id', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    expect(repo.get(created.id)?.region).toBe('eu-central-1');
    expect(repo.get('missing')).toBeUndefined();
  });

  it('deletes an account', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    repo.remove(created.id);
    expect(repo.list()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: FAIL — cannot find module `./accountsRepo`.

- [ ] **Step 3: Write the implementation**

`src/main/storage/accountsRepo.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import type { ProviderId } from '../s3/providers';

export interface NewAccount {
  label: string;
  provider: ProviderId;
  endpoint?: string;
  region: string;
  accessKeyId: string;
}

export interface Account extends NewAccount {
  id: string;
  createdAt: number;
}

interface Row {
  id: string;
  label: string;
  provider: string;
  endpoint: string | null;
  region: string;
  access_key_id: string;
  created_at: number;
}

function toAccount(row: Row): Account {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider as ProviderId,
    endpoint: row.endpoint ?? undefined,
    region: row.region,
    accessKeyId: row.access_key_id,
    createdAt: row.created_at,
  };
}

export function createAccountsRepo(db: DB) {
  return {
    create(input: NewAccount): Account {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO accounts (id, label, provider, endpoint, region, access_key_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.label, input.provider, input.endpoint ?? null, input.region, input.accessKeyId, createdAt);
      return { ...input, id, createdAt };
    },
    list(): Account[] {
      return (db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(toAccount);
    },
    get(id: string): Account | undefined {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
      return row ? toAccount(row) : undefined;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },
  };
}

export type AccountsRepo = ReturnType<typeof createAccountsRepo>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/accountsRepo.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/accountsRepo.ts src/main/storage/accountsRepo.test.ts
git commit -m "feat: add accounts repository"
```

---

## Task 15: Storage — settings repository

**Files:**
- Create: `src/main/storage/settingsRepo.ts`
- Test: `src/main/storage/settingsRepo.test.ts`

- [ ] **Step 1: Write the failing test**

`src/main/storage/settingsRepo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createSettingsRepo } from './settingsRepo';

describe('settingsRepo', () => {
  it('returns undefined for missing keys', () => {
    const repo = createSettingsRepo(openDatabase(':memory:'));
    expect(repo.get('theme')).toBeUndefined();
  });

  it('sets and gets a value, and upserts on repeat', () => {
    const repo = createSettingsRepo(openDatabase(':memory:'));
    repo.set('theme', 'dark');
    expect(repo.get('theme')).toBe('dark');
    repo.set('theme', 'light');
    expect(repo.get('theme')).toBe('light');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/settingsRepo.test.ts`
Expected: FAIL — cannot find module `./settingsRepo`.

- [ ] **Step 3: Write the implementation**

`src/main/storage/settingsRepo.ts`:

```ts
import type { DB } from './db';

export function createSettingsRepo(db: DB) {
  return {
    get(key: string): string | undefined {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value;
    },
    set(key: string, value: string): void {
      db.prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(key, value);
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/settingsRepo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/settingsRepo.ts src/main/storage/settingsRepo.test.ts
git commit -m "feat: add settings repository"
```

---

## Task 16: Storage — secrets (safeStorage + SQLite ciphertext)

**Files:**
- Create: `src/main/storage/secrets.ts`
- Test: `src/main/storage/secrets.test.ts`

`createSecretsStore` is injected with a `safeStorage`-like crypto object so it can be tested with a fake. It persists ciphertext in `account_secrets`.

- [ ] **Step 1: Write the failing test**

`src/main/storage/secrets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createSecretsStore, type Crypto } from './secrets';

// Fake safeStorage: reversible "encryption" for tests.
const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`, 'utf8'),
  decryptString: (b) => b.toString('utf8').replace(/^enc:/, ''),
};

describe('secretsStore', () => {
  it('stores and retrieves a secret via ciphertext, never plaintext in the row', () => {
    const db = openDatabase(':memory:');
    const store = createSecretsStore(db, fakeCrypto);
    store.set('acc-1', 'super-secret');

    const row = db.prepare('SELECT ciphertext FROM account_secrets WHERE account_id = ?').get('acc-1') as {
      ciphertext: Buffer;
    };
    expect(row.ciphertext.toString('utf8')).toBe('enc:super-secret'); // encrypted, not raw
    expect(store.get('acc-1')).toBe('super-secret');
  });

  it('returns undefined for unknown account', () => {
    const store = createSecretsStore(openDatabase(':memory:'), fakeCrypto);
    expect(store.get('nope')).toBeUndefined();
  });

  it('removes a secret', () => {
    const store = createSecretsStore(openDatabase(':memory:'), fakeCrypto);
    store.set('acc-1', 'x');
    store.remove('acc-1');
    expect(store.get('acc-1')).toBeUndefined();
  });

  it('throws on set when encryption is unavailable', () => {
    const store = createSecretsStore(openDatabase(':memory:'), { ...fakeCrypto, isEncryptionAvailable: () => false });
    expect(() => store.set('acc-1', 'x')).toThrow(/encryption/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/storage/secrets.test.ts`
Expected: FAIL — cannot find module `./secrets`.

- [ ] **Step 3: Write the implementation**

`src/main/storage/secrets.ts`:

```ts
import type { DB } from './db';

/** Subset of Electron's safeStorage we depend on (injectable for tests). */
export interface Crypto {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function createSecretsStore(db: DB, crypto: Crypto) {
  return {
    set(accountId: string, secret: string): void {
      if (!crypto.isEncryptionAvailable()) {
        throw new Error('Secret encryption is not available on this system');
      }
      const ciphertext = crypto.encryptString(secret);
      db.prepare(
        `INSERT INTO account_secrets (account_id, ciphertext) VALUES (?, ?)
         ON CONFLICT(account_id) DO UPDATE SET ciphertext = excluded.ciphertext`,
      ).run(accountId, ciphertext);
    },
    get(accountId: string): string | undefined {
      const row = db
        .prepare('SELECT ciphertext FROM account_secrets WHERE account_id = ?')
        .get(accountId) as { ciphertext: Buffer } | undefined;
      if (!row) return undefined;
      return crypto.decryptString(row.ciphertext);
    },
    remove(accountId: string): void {
      db.prepare('DELETE FROM account_secrets WHERE account_id = ?').run(accountId);
    },
  };
}

export type SecretsStore = ReturnType<typeof createSecretsStore>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/storage/secrets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/storage/secrets.ts src/main/storage/secrets.test.ts
git commit -m "feat: add encrypted secrets store"
```

---

## Task 17: Orchestration — build a client for an account

**Files:**
- Create: `src/main/s3/accountClients.ts`
- Test: `src/main/s3/accountClients.test.ts`

Composes `accountsRepo` + `secretsStore` + `providers` + `clientFactory` into "give me a client for this account id". Tested with fakes.

- [ ] **Step 1: Write the failing test**

`src/main/s3/accountClients.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { createClientForAccount } from './accountClients';
import { openDatabase } from '../storage/db';
import { createAccountsRepo } from '../storage/accountsRepo';
import { createSecretsStore, type Crypto } from '../storage/secrets';

const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString('utf8'),
};

function setup() {
  const db = openDatabase(':memory:');
  const accounts = createAccountsRepo(db);
  const secrets = createSecretsStore(db, fakeCrypto);
  return { accounts, secrets };
}

describe('createClientForAccount', () => {
  it('builds an S3Client from stored account + secret', () => {
    const { accounts, secrets } = setup();
    const acc = accounts.create({ label: 'h', provider: 'hetzner', endpoint: 'https://fsn1.your-objectstorage.com', region: 'fsn1', accessKeyId: 'AK' });
    secrets.set(acc.id, 'SK');

    const client = createClientForAccount(acc.id, { accounts, secrets });
    expect(client).toBeInstanceOf(S3Client);
  });

  it('throws when the account is missing', () => {
    const { accounts, secrets } = setup();
    expect(() => createClientForAccount('nope', { accounts, secrets })).toThrow(/account/i);
  });

  it('throws when the secret is missing', () => {
    const { accounts, secrets } = setup();
    const acc = accounts.create({ label: 'h', provider: 'hetzner', endpoint: 'e', region: 'fsn1', accessKeyId: 'AK' });
    expect(() => createClientForAccount(acc.id, { accounts, secrets })).toThrow(/secret/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/accountClients.test.ts`
Expected: FAIL — cannot find module `./accountClients`.

- [ ] **Step 3: Write the implementation**

`src/main/s3/accountClients.ts`:

```ts
import type { S3Client } from '@aws-sdk/client-s3';
import { createClient } from './clientFactory';
import { getProvider } from './providers';
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
    forcePathStyle: getProvider(account.provider).forcePathStyle,
    accessKeyId: account.accessKeyId,
    secretAccessKey,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/accountClients.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/accountClients.ts src/main/s3/accountClients.test.ts
git commit -m "feat: add per-account client orchestration"
```

---

## Task 18: IPC channel constants and payload types

**Files:**
- Create: `src/main/ipc/channels.ts`

This module has no logic to test — it's the shared contract. It is exercised indirectly by Task 19/20. (No test file.)

- [ ] **Step 1: Write the contract**

`src/main/ipc/channels.ts`:

```ts
import type { ProviderId } from '../s3/providers';
import type { Result } from '../shared/result';
import type { ListObjectsResult, ObjectMetadata } from '../s3/objects';
import type { Visibility } from '../s3/visibility';
import type { Account } from '../storage/accountsRepo';

export const CH = {
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsRemove: 'accounts:remove',
  accountsTest: 'accounts:test',
  encryptionAvailable: 'secrets:available',
  listBuckets: 's3:listBuckets',
  listObjects: 's3:listObjects',
  headObject: 's3:headObject',
  objectVisibility: 's3:objectVisibility',
  presignGet: 's3:presignGet',
  deleteObject: 's3:deleteObject',
  deleteFolder: 's3:deleteFolder',
  uploadObject: 's3:uploadObject',
  downloadObject: 's3:downloadObject',
} as const;

export interface CreateAccountInput {
  label: string;
  provider: ProviderId;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// Map of channel -> { args, response } shapes. Used by preload + register.
export interface ApiMap {
  [CH.accountsList]: { args: []; res: Result<Account[]> };
  [CH.accountsCreate]: { args: [CreateAccountInput]; res: Result<Account> };
  [CH.accountsRemove]: { args: [string]; res: Result<true> };
  [CH.accountsTest]: { args: [CreateAccountInput]; res: Result<true> };
  [CH.encryptionAvailable]: { args: []; res: Result<boolean> };
  [CH.listBuckets]: { args: [string]; res: Result<string[]> };
  [CH.listObjects]: { args: [{ accountId: string; bucket: string; prefix: string; continuationToken?: string }]; res: Result<ListObjectsResult> };
  [CH.headObject]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<ObjectMetadata> };
  [CH.objectVisibility]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<Visibility> };
  [CH.presignGet]: { args: [{ accountId: string; bucket: string; key: string; expiresIn: number }]; res: Result<string> };
  [CH.deleteObject]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<number> };
  [CH.deleteFolder]: { args: [{ accountId: string; bucket: string; prefix: string }]; res: Result<number> };
  [CH.uploadObject]: { args: [{ accountId: string; bucket: string; key: string; filePath: string; contentType?: string }]; res: Result<{ key: string }> };
  [CH.downloadObject]: { args: [{ accountId: string; bucket: string; key: string; destPath: string }]; res: Result<{ path: string }> };
}
```

- [ ] **Step 2: Type-check it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/channels.ts
git commit -m "feat: define IPC channel contract"
```

---

## Task 19: IPC register — wire channels to services

**Files:**
- Create: `src/main/ipc/register.ts`
- Test: `src/main/ipc/register.test.ts`

`registerIpc` takes injected dependencies and an `ipcMain`-like object, and registers one handler per channel. The handler bodies are tested by invoking them directly through a fake `ipcMain` that captures handlers. S3 calls go through `aws-sdk-client-mock`.

- [ ] **Step 1: Write the failing test**

`src/main/ipc/register.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { registerIpc, type IpcMainLike } from './register';
import { CH } from './channels';
import { openDatabase } from '../storage/db';
import { createAccountsRepo } from '../storage/accountsRepo';
import { createSecretsStore, type Crypto } from '../storage/secrets';
import { createSettingsRepo } from '../storage/settingsRepo';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const fakeCrypto: Crypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => b.toString('utf8'),
};

function buildHarness() {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => handlers.set(channel, (...a) => listener({}, ...a)),
  };
  const db = openDatabase(':memory:');
  const deps = {
    accounts: createAccountsRepo(db),
    secrets: createSecretsStore(db, fakeCrypto),
    settings: createSettingsRepo(db),
    crypto: fakeCrypto,
  };
  registerIpc(ipcMain, deps);
  return { handlers, deps };
}

describe('registerIpc', () => {
  it('registers a handler for every channel', () => {
    const { handlers } = buildHarness();
    for (const channel of Object.values(CH)) {
      expect(handlers.has(channel)).toBe(true);
    }
  });

  it('accounts:create stores account + secret and returns the account', async () => {
    const { handlers, deps } = buildHarness();
    const res = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { ok: boolean; data: { id: string } };
    expect(res.ok).toBe(true);
    expect(deps.accounts.list()).toHaveLength(1);
    expect(deps.secrets.get(res.data.id)).toBe('SK');
  });

  it('s3:listBuckets uses the account client', async () => {
    const { handlers, deps } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'b1' }] });

    const res = (await handlers.get(CH.listBuckets)!(created.data.id)) as { ok: boolean; data: string[] };
    expect(res).toEqual({ ok: true, data: ['b1'] });
    void deps;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — cannot find module `./register`.

- [ ] **Step 3: Write the implementation**

`src/main/ipc/register.ts`:

```ts
import { CH, type CreateAccountInput } from './channels';
import { ok, err, type Result } from '../shared/result';
import { resolveEndpoint, getProvider } from '../s3/providers';
import { createClient } from '../s3/clientFactory';
import { createClientForAccount } from '../s3/accountClients';
import {
  listBuckets,
  listObjects,
  headObject,
  presignGetUrl,
  deleteObject,
  deleteFolder,
  uploadObject,
  downloadObject,
  toErr,
} from '../s3/objects';
import { getObjectVisibility } from '../s3/visibility';
import type { AccountsRepo } from '../storage/accountsRepo';
import type { SecretsStore, Crypto } from '../storage/secrets';
import type { SettingsRepo } from '../storage/settingsRepo';

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: never[]) => unknown): void;
}

export interface RegisterDeps {
  accounts: AccountsRepo;
  secrets: SecretsStore;
  settings: SettingsRepo;
  crypto: Crypto;
}

export function registerIpc(ipcMain: IpcMainLike, deps: RegisterDeps): void {
  const clientFor = (accountId: string) => createClientForAccount(accountId, deps);

  const h = <T>(channel: string, fn: (...args: never[]) => Promise<Result<T>> | Result<T>) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        return toErr(e);
      }
    });

  h(CH.accountsList, () => ok(deps.accounts.list()));

  h(CH.encryptionAvailable, () => ok(deps.crypto.isEncryptionAvailable()));

  h(CH.accountsCreate, (input: CreateAccountInput) => {
    const endpoint = resolveEndpoint(input.provider, input.region);
    const account = deps.accounts.create({
      label: input.label,
      provider: input.provider,
      endpoint,
      region: input.region,
      accessKeyId: input.accessKeyId,
    });
    deps.secrets.set(account.id, input.secretAccessKey);
    return ok(account);
  });

  h(CH.accountsRemove, (id: string) => {
    deps.secrets.remove(id);
    deps.accounts.remove(id);
    return ok(true as const);
  });

  h(CH.accountsTest, async (input: CreateAccountInput) => {
    const client = createClient({
      provider: input.provider,
      region: input.region,
      endpoint: resolveEndpoint(input.provider, input.region),
      forcePathStyle: getProvider(input.provider).forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    });
    const r = await listBuckets(client);
    return r.ok ? ok(true as const) : err(r.error.code, r.error.message);
  });

  h(CH.listBuckets, (accountId: string) => listBuckets(clientFor(accountId)));

  h(CH.listObjects, (a: { accountId: string; bucket: string; prefix: string; continuationToken?: string }) =>
    listObjects(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix, continuationToken: a.continuationToken }),
  );

  h(CH.headObject, (a: { accountId: string; bucket: string; key: string }) =>
    headObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.objectVisibility, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.presignGet, (a: { accountId: string; bucket: string; key: string; expiresIn: number }) =>
    presignGetUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }),
  );

  h(CH.deleteObject, (a: { accountId: string; bucket: string; key: string }) =>
    deleteObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.deleteFolder, (a: { accountId: string; bucket: string; prefix: string }) =>
    deleteFolder(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix }),
  );

  h(CH.uploadObject, (a: { accountId: string; bucket: string; key: string; filePath: string; contentType?: string }) =>
    uploadObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key, filePath: a.filePath, contentType: a.contentType }),
  );

  h(CH.downloadObject, (a: { accountId: string; bucket: string; key: string; destPath: string }) =>
    downloadObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key, destPath: a.destPath }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/register.ts src/main/ipc/register.test.ts
git commit -m "feat: add IPC registration wiring services to channels"
```

---

## Task 20: Preload bridge + main process wiring

**Files:**
- Modify: `src/preload.ts`
- Modify: `src/main.ts`

Exposes a typed `window.s3` API and initializes the DB + registers IPC on app ready. This task is verified by a full app boot smoke check (no automated test — it requires the Electron runtime).

- [ ] **Step 1: Write the preload bridge**

Replace `src/preload.ts` with:

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { CH } from './main/ipc/channels';
import type { ApiMap } from './main/ipc/channels';

type Channel = keyof ApiMap;

function invoke<C extends Channel>(channel: C, ...args: ApiMap[C]['args']): Promise<ApiMap[C]['res']> {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  accounts: {
    list: () => invoke(CH.accountsList),
    create: (input: ApiMap[typeof CH.accountsCreate]['args'][0]) => invoke(CH.accountsCreate, input),
    remove: (id: string) => invoke(CH.accountsRemove, id),
    test: (input: ApiMap[typeof CH.accountsTest]['args'][0]) => invoke(CH.accountsTest, input),
  },
  encryptionAvailable: () => invoke(CH.encryptionAvailable),
  listBuckets: (accountId: string) => invoke(CH.listBuckets, accountId),
  listObjects: (a: ApiMap[typeof CH.listObjects]['args'][0]) => invoke(CH.listObjects, a),
  headObject: (a: ApiMap[typeof CH.headObject]['args'][0]) => invoke(CH.headObject, a),
  objectVisibility: (a: ApiMap[typeof CH.objectVisibility]['args'][0]) => invoke(CH.objectVisibility, a),
  presignGet: (a: ApiMap[typeof CH.presignGet]['args'][0]) => invoke(CH.presignGet, a),
  deleteObject: (a: ApiMap[typeof CH.deleteObject]['args'][0]) => invoke(CH.deleteObject, a),
  deleteFolder: (a: ApiMap[typeof CH.deleteFolder]['args'][0]) => invoke(CH.deleteFolder, a),
  uploadObject: (a: ApiMap[typeof CH.uploadObject]['args'][0]) => invoke(CH.uploadObject, a),
  downloadObject: (a: ApiMap[typeof CH.downloadObject]['args'][0]) => invoke(CH.downloadObject, a),
};

export type S3Api = typeof api;
contextBridge.exposeInMainWorld('s3', api);
```

- [ ] **Step 2: Wire the main process**

Replace `src/main.ts` with the following (keeps the starter's window logic, adds DB init + IPC registration + hardened webPreferences):

```ts
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { openDatabase } from './main/storage/db';
import { createAccountsRepo } from './main/storage/accountsRepo';
import { createSettingsRepo } from './main/storage/settingsRepo';
import { createSecretsStore } from './main/storage/secrets';
import { registerIpc } from './main/ipc/register';

if (started) {
  app.quit();
}

function initBackend() {
  const db = openDatabase(path.join(app.getPath('userData'), 's3manager.db'));
  const accounts = createAccountsRepo(db);
  const settings = createSettingsRepo(db);
  const secrets = createSecretsStore(db, safeStorage);
  registerIpc(ipcMain, { accounts, settings, secrets, crypto: safeStorage });
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
};

app.on('ready', () => {
  initBackend();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. (If `safeStorage` is flagged as not matching `Crypto`, confirm the `Crypto` interface in `secrets.ts` exactly matches the three methods used: `isEncryptionAvailable`, `encryptString`, `decryptString`.)

- [ ] **Step 4: Boot the app to smoke-test the wiring**

Run: `npm start`
Expected: the Electron window opens with no errors in the main-process terminal. (The renderer still shows the starter HTML — that's Plan 2. The point here is that the app boots, the DB file is created under userData, and IPC is registered without throwing.)

Verify the DB was created:

Run: `ls "$HOME/Library/Application Support/s3manager/s3manager.db"`
Expected: the file exists.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/preload.ts src/main.ts
git commit -m "feat: wire preload bridge and backend init into main process"
```

---

## Self-Review

**Spec coverage check (against `2026-05-29-s3-manager-foundation-mvp-design.md`):**

- Process model / security boundary → Tasks 18–20 (preload contract, hardened `webPreferences`). ✅
- AWS SDK v3, one client / two providers → Tasks 3, 4. ✅
- SQLite non-secret model (accounts, app_settings) → Tasks 13–15. ✅
- Secrets via safeStorage, SQLite never sees plaintext → Task 16 (ciphertext-only persistence, verified by test). ✅
- Provider abstraction + capability isolation (visibility) → Tasks 3, 12. ✅
- Prefix/folder semantics, paginated listing → Tasks 5, 6. ✅
- Folder delete in batches → Task 9. ✅
- Operations: listBuckets, listObjects, head, presign GET, delete, upload (multipart), download → Tasks 6–11. ✅
- Visibility detection → Task 12. ✅
- `Result<T>` error mapping, no secrets in errors → Tasks 2, 6 (`toErr`), used everywhere. ✅
- Test strategy: unit + `aws-sdk-client-mock`, in-memory SQLite → every task is TDD. ✅
- TypeScript/tsconfig bump (spec "open notes") → Task 1. ✅

**Deferred to Plan 2 (renderer UI), intentionally not covered here:** the three-pane Files UI, drag-drop, breadcrumb navigation UI, metadata panel, visibility badges, Tailwind 4 setup, React entry, and the real-account manual smoke checklist (which exercises the UI end-to-end). The `accountsTest` channel (Task 19) gives the UI its "Test connection" capability.

**Placeholder scan:** none — every code step contains complete, runnable code.

**Type consistency:** `Result<T>`/`ok`/`err`/`toErr`, `ConnectionProfile`, `ListObjectsResult`, `ObjectMetadata`, `Visibility`, `Account`/`NewAccount`, `Crypto`, `AccountsRepo`/`SecretsStore`/`SettingsRepo`, and the `CH`/`ApiMap` contract are defined once and referenced consistently across tasks.
