# S3 Manager — Per-Grantee Object ACL Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** View and edit a single object's full S3 ACL (owner + per-grantee grants) in a "Permissions…" dialog opened from the metadata panel.

**Architecture:** A new `objectAcl.ts` (`getObjectAcl` → owner+grants; `putObjectAcl` → replaces the ACL, preserving owner and round-tripping non-editable grant types) behind two IPC channels, a `useObjectAcl` hook (save invalidates the ACL + visibility queries), and a `PermissionsDialog` (owner + editable grants table) launched from the panel.

**Tech Stack:** AWS SDK v3 (`GetObjectAclCommand`/`PutObjectAclCommand`), Electron IPC, React 19, TanStack Query, Tailwind 4, Vitest + RTL + `aws-sdk-client-mock`.

**Prerequisite facts (verified, do not re-derive):**
- `src/main/s3/visibility.ts` already imports `{ S3Client, GetObjectAclCommand, PutObjectAclCommand }` and defines `ACL_UNSUPPORTED = new Set(['AccessControlListNotSupported','NotImplemented'])`; `ok`/`err`/`Result` from `../shared/result`, `toErr` from `./objects`. `@aws-sdk/client-s3` exports `Grant` and `Grantee` types.
- S3 ACL: `GetObjectAcl` → `{ Owner: { ID, DisplayName }, Grants: [{ Grantee: { Type: 'CanonicalUser'|'Group'|'AmazonCustomerByEmail', ID?, DisplayName?, URI?, EmailAddress? }, Permission }] }`. `PutObjectAcl` takes `AccessControlPolicy: { Owner, Grants }` and REPLACES the ACL.
- `src/main/ipc/channels.ts`: `CH` + `ApiMap`; `Result` imported; per-object channels carry `{ accountId, bucket, key }`. `register.ts`: `h(channel, fn)` + `clientFor`. `register.test.ts`: `buildHarness()` → `{ handlers }`, `s3Mock = mockClient(S3Client)`, create account via `handlers.get(CH.accountsCreate)!({ label, provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' })`; every-channel test iterates `Object.values(CH)`.
- `src/preload.ts`: `(a) => invoke(CH.x, a)` methods.
- `src/renderer/hooks/useObjectDetails.ts` / `useObjectRetention.ts` show the query+mutation+`invalidateQueries` style; `unwrap` from `../lib/result`; the visibility query key is `['objectVisibility', accountId, bucket, key]`.
- `src/renderer/components/files/MetadataPanel.tsx`: the actions row (`<div className="flex gap-1 border-b border-slate-200 p-2">`) has Download / Copy URL / Rename / Move / Delete buttons; state hooks (`renaming`, `moving`, `confirmingPublic`, etc.) are declared after `const { show } = useToast();`; dialog blocks (`{moving && (<MoveDialog …/>)}`, `{confirmingPublic && (<ConfirmDialog …/>)}`) render before the details body. `accountId`/`bucket` props are `string | null`; existing code passes `accountId ?? ''`.
- Renderer dialogs use `useToast()`; tests render within `ToastProvider` (or rely on its default no-op `show`).

---

## File Structure

```
src/main/s3/objectAcl.ts                              # CREATE: types + getObjectAcl/putObjectAcl
src/main/ipc/channels.ts                              # MODIFY: 2 channels + ApiMap
src/main/ipc/register.ts                              # MODIFY: 2 handlers
src/preload.ts                                        # MODIFY: 2 methods
src/renderer/hooks/useObjectAcl.ts                    # CREATE
src/renderer/components/files/PermissionsDialog.tsx   # CREATE
src/renderer/components/files/MetadataPanel.tsx       # MODIFY: "Permissions…" button + dialog
```

---

## Task 1: objectAcl.ts — backend ops

**Files:**
- Create: `src/main/s3/objectAcl.ts`
- Test: `src/main/s3/objectAcl.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/s3/objectAcl.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectAclCommand, PutObjectAclCommand } from '@aws-sdk/client-s3';
import { getObjectAcl, putObjectAcl } from './objectAcl';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';

describe('getObjectAcl', () => {
  it('maps owner and canonical/group/email grants', async () => {
    s3Mock.on(GetObjectAclCommand).resolves({
      Owner: { ID: 'owner-1', DisplayName: 'me' },
      Grants: [
        { Grantee: { Type: 'CanonicalUser', ID: 'owner-1', DisplayName: 'me' }, Permission: 'FULL_CONTROL' },
        { Grantee: { Type: 'Group', URI: ALL_USERS }, Permission: 'READ' },
        { Grantee: { Type: 'AmazonCustomerByEmail', EmailAddress: 'x@y.com' }, Permission: 'READ' },
      ],
    });
    const r = await getObjectAcl(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.owner).toEqual({ id: 'owner-1', displayName: 'me' });
      expect(r.data.grants).toEqual([
        { granteeType: 'CanonicalUser', id: 'owner-1', displayName: 'me', permission: 'FULL_CONTROL' },
        { granteeType: 'Group', uri: ALL_USERS, permission: 'READ' },
        { granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' },
      ]);
    }
  });

  it('maps an ACL-unsupported error to AclUnsupported', async () => {
    s3Mock.on(GetObjectAclCommand).rejects(Object.assign(new Error('no'), { name: 'AccessControlListNotSupported' }));
    const r = await getObjectAcl(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AclUnsupported');
  });
});

describe('putObjectAcl', () => {
  it('sends the owner and grants mapped back to AWS shapes', async () => {
    s3Mock.on(PutObjectAclCommand).resolves({});
    const r = await putObjectAcl(new S3Client({}), {
      bucket: 'b',
      key: 'k',
      acl: {
        owner: { id: 'owner-1', displayName: 'me' },
        grants: [
          { granteeType: 'CanonicalUser', id: 'owner-1', displayName: 'me', permission: 'FULL_CONTROL' },
          { granteeType: 'Group', uri: ALL_USERS, permission: 'READ' },
          { granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' },
        ],
      },
    });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(PutObjectAclCommand)[0].args[0].input;
    expect(input.AccessControlPolicy?.Owner?.ID).toBe('owner-1');
    const grants = input.AccessControlPolicy?.Grants ?? [];
    expect(grants[1].Grantee).toEqual({ Type: 'Group', URI: ALL_USERS });
    expect(grants[2].Grantee).toEqual({ Type: 'AmazonCustomerByEmail', EmailAddress: 'x@y.com' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/s3/objectAcl.test.ts`
Expected: FAIL — cannot find module `./objectAcl`.

- [ ] **Step 3: Implement** — `src/main/s3/objectAcl.ts`:

```ts
import { S3Client, GetObjectAclCommand, PutObjectAclCommand, type Grant, type Grantee } from '@aws-sdk/client-s3';
import { ok, err, type Result } from '../shared/result';
import { toErr } from './objects';

export type AclPermission = 'FULL_CONTROL' | 'WRITE' | 'WRITE_ACP' | 'READ' | 'READ_ACP';
export type GranteeType = 'CanonicalUser' | 'Group' | 'AmazonCustomerByEmail';

export interface AclGrant {
  granteeType: GranteeType;
  permission: AclPermission;
  id?: string;
  displayName?: string;
  uri?: string;
  email?: string;
}

export interface ObjectAcl {
  owner: { id: string; displayName: string | null };
  grants: AclGrant[];
}

const ACL_UNSUPPORTED = new Set(['AccessControlListNotSupported', 'NotImplemented']);

function fromAwsGrant(g: Grant): AclGrant {
  const grantee = g.Grantee;
  const permission = g.Permission as AclPermission;
  if (grantee?.Type === 'Group') return { granteeType: 'Group', uri: grantee.URI, permission };
  if (grantee?.Type === 'AmazonCustomerByEmail') return { granteeType: 'AmazonCustomerByEmail', email: grantee.EmailAddress, permission };
  return { granteeType: 'CanonicalUser', id: grantee?.ID, displayName: grantee?.DisplayName, permission };
}

function toAwsGrant(grant: AclGrant): Grant {
  let grantee: Grantee;
  if (grant.granteeType === 'Group') grantee = { Type: 'Group', URI: grant.uri };
  else if (grant.granteeType === 'AmazonCustomerByEmail') grantee = { Type: 'AmazonCustomerByEmail', EmailAddress: grant.email };
  else grantee = { Type: 'CanonicalUser', ID: grant.id, DisplayName: grant.displayName };
  return { Grantee: grantee, Permission: grant.permission };
}

export async function getObjectAcl(
  client: S3Client,
  args: { bucket: string; key: string },
): Promise<Result<ObjectAcl>> {
  try {
    const out = await client.send(new GetObjectAclCommand({ Bucket: args.bucket, Key: args.key }));
    return ok({
      owner: { id: out.Owner?.ID ?? '', displayName: out.Owner?.DisplayName ?? null },
      grants: (out.Grants ?? []).map(fromAwsGrant),
    });
  } catch (e) {
    if (ACL_UNSUPPORTED.has((e as { name?: string })?.name ?? '')) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}

export async function putObjectAcl(
  client: S3Client,
  args: { bucket: string; key: string; acl: ObjectAcl },
): Promise<Result<true>> {
  try {
    await client.send(
      new PutObjectAclCommand({
        Bucket: args.bucket,
        Key: args.key,
        AccessControlPolicy: {
          Owner: { ID: args.acl.owner.id, DisplayName: args.acl.owner.displayName ?? undefined },
          Grants: args.acl.grants.map(toAwsGrant),
        },
      }),
    );
    return ok(true);
  } catch (e) {
    if (ACL_UNSUPPORTED.has((e as { name?: string })?.name ?? '')) {
      return err('AclUnsupported', 'This bucket does not support per-object ACLs');
    }
    return toErr(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/main/s3/objectAcl.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/s3/objectAcl.ts src/main/s3/objectAcl.test.ts
git commit -m "feat: add object ACL get/put ops (owner + per-grantee grants)"
```

---

## Task 2: IPC wiring (channels + register + preload)

**Files:**
- Modify: `src/main/ipc/channels.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload.ts`
- Modify: `src/main/ipc/register.test.ts`

- [ ] **Step 1: Extend the contract** — in `src/main/ipc/channels.ts`:

Add a type import near the other `../s3` imports:
```ts
import type { ObjectAcl } from '../s3/objectAcl';
```
Add to `CH`:
```ts
  getObjectAcl: 's3:getObjectAcl',
  putObjectAcl: 's3:putObjectAcl',
```
Add to `ApiMap`:
```ts
  [CH.getObjectAcl]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<ObjectAcl> };
  [CH.putObjectAcl]: { args: [{ accountId: string; bucket: string; key: string; acl: ObjectAcl }]; res: Result<true> };
```

- [ ] **Step 2: Add the failing test** — append to `src/main/ipc/register.test.ts` (add `GetObjectAclCommand`, `PutObjectAclCommand` to the `@aws-sdk/client-s3` import):

```ts
describe('object ACL handlers', () => {
  it('s3:getObjectAcl returns the mapped ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(GetObjectAclCommand).resolves({
      Owner: { ID: 'o', DisplayName: 'me' },
      Grants: [{ Grantee: { Type: 'CanonicalUser', ID: 'o', DisplayName: 'me' }, Permission: 'FULL_CONTROL' }],
    });

    const res = (await handlers.get(CH.getObjectAcl)!({ accountId: created.data.id, bucket: 'b', key: 'k' })) as {
      ok: boolean; data: { owner: { id: string }; grants: unknown[] };
    };
    expect(res.ok).toBe(true);
    expect(res.data.owner.id).toBe('o');
    expect(res.data.grants).toHaveLength(1);
  });

  it('s3:putObjectAcl writes the ACL via the account client', async () => {
    const { handlers } = buildHarness();
    const created = (await handlers.get(CH.accountsCreate)!({
      label: 'AWS', provider: 'amazon-s3', region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK',
    })) as { data: { id: string } };
    s3Mock.on(PutObjectAclCommand).resolves({});

    const res = (await handlers.get(CH.putObjectAcl)!({
      accountId: created.data.id, bucket: 'b', key: 'k',
      acl: { owner: { id: 'o', displayName: 'me' }, grants: [] },
    })) as { ok: boolean; data: boolean };
    expect(res).toEqual({ ok: true, data: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: FAIL — no handlers (and the every-channel test fails for the 2 new channels).

- [ ] **Step 4: Implement.**

In `src/main/ipc/register.ts`: add the import:
```ts
import { getObjectAcl, putObjectAcl } from '../s3/objectAcl';
import type { ObjectAcl } from '../s3/objectAcl';
```
Register the handlers (near the visibility handlers):
```ts
  h(CH.getObjectAcl, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectAcl, (a: { accountId: string; bucket: string; key: string; acl: ObjectAcl }) =>
    putObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, acl: a.acl }),
  );
```

In `src/preload.ts`, add:
```ts
  getObjectAcl: (a: ApiMap[typeof CH.getObjectAcl]['args'][0]) => invoke(CH.getObjectAcl, a),
  putObjectAcl: (a: ApiMap[typeof CH.putObjectAcl]['args'][0]) => invoke(CH.putObjectAcl, a),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/ipc/register.test.ts`
Expected: PASS (incl. the every-channel test). Then `npm test` and `npx tsc --noEmit` (0 errors).

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/channels.ts src/main/ipc/register.ts src/preload.ts src/main/ipc/register.test.ts
git commit -m "feat: wire object ACL IPC channels"
```

---

## Task 3: useObjectAcl hook

**Files:**
- Create: `src/renderer/hooks/useObjectAcl.ts`
- Test: `src/renderer/hooks/useObjectAcl.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectAcl.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectAcl } from './useObjectAcl';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ACL = { owner: { id: 'o', displayName: 'me' }, grants: [] };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: ACL }),
    putObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('useObjectAcl', () => {
  it('loads the ACL', async () => {
    const { result } = renderHook(() => useObjectAcl('a', 'b', 'k'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.acl.isSuccess).toBe(true));
    expect(result.current.acl.data).toEqual(ACL);
  });

  it('save calls putObjectAcl and invalidates the acl + visibility queries', async () => {
    const { result } = renderHook(() => useObjectAcl('a', 'b', 'k'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.save.mutateAsync({ owner: { id: 'o', displayName: 'me' }, grants: [] });
    expect(window.s3.putObjectAcl).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', acl: { owner: { id: 'o', displayName: 'me' }, grants: [] } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectAcl', 'a', 'b', 'k'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objectVisibility', 'a', 'b', 'k'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectAcl.test.tsx`
Expected: FAIL — cannot find module `./useObjectAcl`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectAcl.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { ObjectAcl } from '../../main/s3/objectAcl';

export function useObjectAcl(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const aclKey = ['objectAcl', accountId, bucket, key] as const;

  const acl = useQuery({
    queryKey: aclKey,
    enabled,
    queryFn: async (): Promise<ObjectAcl> =>
      unwrap(await window.s3.getObjectAcl({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const save = useMutation({
    mutationFn: async (next: ObjectAcl) =>
      unwrap(await window.s3.putObjectAcl({ accountId: accountId!, bucket: bucket!, key: key!, acl: next })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aclKey });
      qc.invalidateQueries({ queryKey: ['objectVisibility', accountId, bucket, key] });
    },
  });

  return { acl, save };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectAcl.test.tsx`
Expected: PASS (2 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectAcl.ts src/renderer/hooks/useObjectAcl.test.tsx
git commit -m "feat(ui): add useObjectAcl hook"
```

---

## Task 4: PermissionsDialog component

**Files:**
- Create: `src/renderer/components/files/PermissionsDialog.tsx`
- Test: `src/renderer/components/files/PermissionsDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/PermissionsDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { PermissionsDialog } from './PermissionsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';

function baseS3(over: Record<string, unknown> = {}) {
  return {
    getObjectAcl: vi.fn().mockResolvedValue({
      ok: true,
      data: { owner: { id: 'o', displayName: 'me' }, grants: [{ granteeType: 'CanonicalUser', id: 'o', displayName: 'me', permission: 'FULL_CONTROL' }] },
    }),
    putObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('PermissionsDialog', () => {
  it('shows the owner and existing grants', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('me')).toBeInTheDocument();
    expect(screen.getByLabelText('Permission for me')).toHaveValue('FULL_CONTROL');
  });

  it('adds a group grant and saves the edited ACL', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    await screen.findByText('me');
    // grantee type defaults to Group, group defaults to Everyone; choose READ permission for the add form
    await userEvent.selectOptions(screen.getByLabelText('New grant permission'), 'READ');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(window.s3.putObjectAcl).toHaveBeenCalled());
    const arg = (window.s3.putObjectAcl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.acl.grants).toContainEqual({ granteeType: 'Group', uri: ALL_USERS, permission: 'READ' });
  });

  it('removes a grant', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove me' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(window.s3.putObjectAcl).toHaveBeenCalled());
    const arg = (window.s3.putObjectAcl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.acl.grants).toHaveLength(0);
  });

  it('shows a message when ACLs are unsupported', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectAcl: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AclUnsupported', message: 'This bucket does not support per-object ACLs' } }),
    });
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText(/does not support per-object ACLs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/PermissionsDialog.test.tsx`
Expected: FAIL — cannot find module `./PermissionsDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/PermissionsDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useObjectAcl } from '../../hooks/useObjectAcl';
import { useToast } from '../ui/ToastProvider';
import type { AclGrant, AclPermission } from '../../../main/s3/objectAcl';

const PERMISSIONS: AclPermission[] = ['FULL_CONTROL', 'WRITE', 'WRITE_ACP', 'READ', 'READ_ACP'];
const GROUPS = [
  { label: 'Everyone (public)', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
  { label: 'Authenticated users', uri: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers' },
  { label: 'Log delivery', uri: 'http://acs.amazonaws.com/groups/s3/LogDelivery' },
];

function granteeLabel(g: AclGrant): string {
  if (g.granteeType === 'Group') return GROUPS.find((x) => x.uri === g.uri)?.label ?? g.uri ?? 'Group';
  if (g.granteeType === 'AmazonCustomerByEmail') return g.email ?? 'Email';
  return g.displayName || g.id || 'Canonical user';
}

export function PermissionsDialog({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string;
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const { acl, save } = useObjectAcl(accountId, bucket, objectKey);
  const { show } = useToast();
  const [grants, setGrants] = useState<AclGrant[]>([]);
  const [addType, setAddType] = useState<'Group' | 'CanonicalUser'>('Group');
  const [addUri, setAddUri] = useState(GROUPS[0].uri);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addPerm, setAddPerm] = useState<AclPermission>('READ');

  useEffect(() => {
    if (acl.data) setGrants(acl.data.grants);
  }, [acl.data]);

  const canAdd = addType === 'Group' || addId.trim() !== '';

  const addGrant = () => {
    const grant: AclGrant =
      addType === 'Group'
        ? { granteeType: 'Group', uri: addUri, permission: addPerm }
        : { granteeType: 'CanonicalUser', id: addId.trim(), displayName: addName.trim() || undefined, permission: addPerm };
    setGrants((prev) => [...prev, grant]);
  };

  const onSave = async () => {
    if (!acl.data) return;
    try {
      await save.mutateAsync({ owner: acl.data.owner, grants });
      show('Permissions saved');
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-[34rem] overflow-auto rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Permissions</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>✕</button>
        </div>

        {acl.isLoading && <p className="py-4 text-sm text-slate-500">Loading permissions…</p>}
        {acl.isError && <p className="py-4 text-sm text-red-600">{(acl.error as Error).message}</p>}

        {acl.isSuccess && (
          <>
            <p className="pb-2 text-xs text-slate-500">
              Owner: <span className="text-slate-700">{acl.data.owner.displayName || acl.data.owner.id || '—'}</span>
            </p>

            <table className="w-full text-left text-sm">
              <tbody>
                {grants.map((g, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-2 break-all">{granteeLabel(g)}</td>
                    <td className="py-1.5 pr-2">
                      <select
                        aria-label={`Permission for ${granteeLabel(g)}`}
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                        value={g.permission}
                        onChange={(e) =>
                          setGrants((prev) => prev.map((x, j) => (j === i ? { ...x, permission: e.target.value as AclPermission } : x)))
                        }
                      >
                        {PERMISSIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${granteeLabel(g)}`}
                        className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setGrants((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {grants.length === 0 && (
                  <tr>
                    <td className="py-2 text-xs text-slate-400" colSpan={3}>No grants</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <select
                aria-label="Grantee type"
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                value={addType}
                onChange={(e) => setAddType(e.target.value as 'Group' | 'CanonicalUser')}
              >
                <option value="Group">Group</option>
                <option value="CanonicalUser">Canonical User</option>
              </select>
              {addType === 'Group' ? (
                <select aria-label="Group" className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={addUri} onChange={(e) => setAddUri(e.target.value)}>
                  {GROUPS.map((g) => (
                    <option key={g.uri} value={g.uri}>{g.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input aria-label="Canonical user ID" className="rounded border border-slate-300 px-1 py-0.5 text-xs" placeholder="Canonical user ID" value={addId} onChange={(e) => setAddId(e.target.value)} />
                  <input aria-label="Display name" className="rounded border border-slate-300 px-1 py-0.5 text-xs" placeholder="Display name (optional)" value={addName} onChange={(e) => setAddName(e.target.value)} />
                </>
              )}
              <select aria-label="New grant permission" className="rounded border border-slate-300 px-1 py-0.5 text-xs" value={addPerm} onChange={(e) => setAddPerm(e.target.value as AclPermission)}>
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button type="button" disabled={!canAdd} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40" onClick={addGrant}>
                Add
              </button>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onClose}>Cancel</button>
              <button type="button" disabled={save.isPending} className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40" onClick={onSave}>
                Save permissions
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/PermissionsDialog.test.tsx`
Expected: PASS (4 tests). Then `npx tsc --noEmit` — 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/PermissionsDialog.tsx src/renderer/components/files/PermissionsDialog.test.tsx
git commit -m "feat(ui): add PermissionsDialog (per-grantee ACL editor)"
```

---

## Task 5: MetadataPanel — "Permissions…" button

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

- [ ] **Step 1: Add the failing test** — append to `src/renderer/components/files/MetadataPanel.test.tsx`:

```tsx
describe('MetadataPanel permissions', () => {
  it('opens the Permissions dialog from the actions row', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
      getObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: { owner: { id: 'o', displayName: 'me' }, grants: [] } }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Permissions…' }));
    expect(await screen.findByText('Permissions')).toBeInTheDocument();
    expect(await screen.findByText('me')).toBeInTheDocument(); // owner row, after the ACL query resolves
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — no "Permissions…" button.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`:

(a) Add the import (near the other dialog imports):
```tsx
import { PermissionsDialog } from './PermissionsDialog';
```
(b) Add state next to the other dialog states (e.g. after `const [moving, setMoving] = useState(false);`):
```tsx
  const [permissionsOpen, setPermissionsOpen] = useState(false);
```
(c) In the actions row, add a "Permissions…" button after the "Move" button (before the Delete block):
```tsx
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setPermissionsOpen(true)}>
          Permissions…
        </button>
```
(d) Add the dialog render near the other dialog blocks (e.g. after the `{moving && (<MoveDialog …/>)}` block):
```tsx
      {permissionsOpen && (
        <PermissionsDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          objectKey={objectKey}
          onClose={() => setPermissionsOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing + new). Then run the FULL suite `npm test` (all green) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): add Permissions… button opening the ACL editor"
```

---

## Manual smoke checklist (after Task 5)

`npm start` (full restart — main-process IPC handlers added), with an account + a bucket that allows ACLs and an object:
1. Select an object → **Permissions…** → the dialog shows the owner + current grants (e.g. owner FULL_CONTROL).
2. Add a grant: Group = Everyone (public), permission READ → **Add** → **Save permissions** → toast; the visibility badge in the panel flips to `public`.
3. Reopen → the READ-for-Everyone grant is present. Change its permission, or **✕** to remove it → **Save** → verify the change took effect.
4. **Cancel** after edits → nothing changes.
5. Select an object in a bucket with ACLs disabled (Object Ownership = bucket-owner-enforced / Hetzner) → **Permissions…** → "This bucket does not support per-object ACLs", no editor.

---

## Self-Review

**Spec coverage (against `2026-05-30-s3-manager-object-acl-editor-design.md`):**
- `objectAcl.ts` (`getObjectAcl` maps owner + canonical/group/email; `putObjectAcl` replaces ACL preserving owner + mapping grants back; `AclUnsupported`) → Task 1. ✅
- IPC `s3:getObjectAcl`/`s3:putObjectAcl` + register + preload → Task 2. ✅
- `useObjectAcl` (acl query; save invalidates acl + visibility) → Task 3. ✅
- `PermissionsDialog` (owner read-only; grants table add/remove/change-permission on a local copy; add Group/Canonical; Save replaces; Cancel discards; `AclUnsupported` message; round-trips email grants since the working copy carries all grant types) → Task 4. ✅
- MetadataPanel "Permissions…" button opens the dialog → Task 5. ✅
- States/errors (loading/error; no optimistic update; replace-with-round-trip; visibility badge refresh) → Tasks 3/4. ✅
- Out of scope (bucket ACLs, creating email grants, bulk/folder, canned shortcuts, lockout guards) → none added. ✅

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `AclPermission`/`GranteeType`/`AclGrant`/`ObjectAcl` are defined once in `objectAcl.ts` (Task 1) and imported by `channels.ts` (Task 2), `useObjectAcl` (Task 3), and `PermissionsDialog` (Task 4). `getObjectAcl(args:{bucket,key})`/`putObjectAcl(args:{bucket,key,acl})` shapes match the `ApiMap`/register/preload `{accountId,bucket,key}`/`{…,acl}` (Task 2) and the hook's `window.s3.getObjectAcl/putObjectAcl` calls (Task 3). The hook's `save` takes a full `ObjectAcl`; the dialog calls `save.mutateAsync({ owner: acl.data.owner, grants })` (Task 4) — matches. The ACL query key `['objectAcl', …]` matches between query and invalidate; the visibility key `['objectVisibility', …]` matches the existing `useObjectDetails` query so the badge invalidation lands. Grantee labels/`granteeLabel` drive the `aria-label`s the tests target ("Permission for me", "Remove me"). `ok(true)` returns `Result<true>` (consistent with existing put-ops).

**Notes for implementers:** Task 2 adds main-process handlers, so the manual smoke needs a full `npm start` restart. The PermissionsDialog test asserts on `putObjectAcl` mock call args (not a fixed object) so it's robust to ordering. The MetadataPanel new test stubs `getObjectAcl` (and `getObjectLockConfig`, since the panel mounts `useObjectLock`); existing MetadataPanel tests don't click "Permissions…", so they never call `getObjectAcl` and remain unaffected.
