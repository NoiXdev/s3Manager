import { basename } from 'node:path';
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL, type CreateAccountInput, type UpdateAccountInput, type TestAccountInput } from './channels';
import { ok, err, type Result } from '../shared/result';
import { resolveEndpoint, getProvider, PROVIDERS, bucketLocationConstraint, type ProviderId } from '../s3/providers';
import { createClient } from '../s3/clientFactory';
import { createClientForAccount } from '../s3/accountClients';
import {
  listBuckets,
  listObjects,
  headObject,
  presignGetUrl,
  presignPutUrl,
  deleteObject,
  deleteFolder,
  uploadObject,
  downloadObject,
  toErr,
} from '../s3/objects';
import { getObjectVisibility, setObjectVisibility } from '../s3/visibility';
import { getBucketCors, putBucketCors, deleteBucketCors } from '../s3/cors';
import type { CorsRule } from '../s3/cors';
import { getObjectLockConfig, putObjectLockConfig } from '../s3/objectLock';
import { getObjectRetention, putObjectRetention, getObjectLegalHold, putObjectLegalHold } from '../s3/objectRetention';
import type { LegalHoldStatus } from '../s3/objectRetention';
import { getObjectAcl, putObjectAcl } from '../s3/objectAcl';
import type { ObjectAcl } from '../s3/objectAcl';
import { getEditableMetadata, updateObjectMetadata } from '../s3/objectMetadata';
import { createFolder, moveObject, moveFolder } from '../s3/transfer';
import { createBucket } from '../s3/buckets';
import { planSync, runSync, type Endpoint } from '../s3/sync';
import { planLocalSync, runLocalSync } from '../s3/localSync';
import type { LocalSyncArgs } from '../s3/localSync';
import type { DefaultRetention } from '../s3/objectLock';
import type { AccountsRepo } from '../storage/accountsRepo';
import type { SecretsStore, Crypto } from '../storage/secrets';
import type { SettingsRepo } from '../storage/settingsRepo';
import type { DB } from '../storage/db';
import { readSettings, writeSettings } from '../settings/appSettings';
import type { AppSettings } from '../settings/appSettings';

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface RegisterDeps {
  accounts: AccountsRepo;
  secrets: SecretsStore;
  settings: SettingsRepo;
  crypto: Crypto;
  db: DB;
  /** Shows a native save dialog; resolves the chosen path, or null if cancelled. */
  saveDialog: (defaultFileName: string) => Promise<string | null>;
  /** Shows a native folder picker; resolves the chosen directory, or null if cancelled. */
  selectDirectory: () => Promise<string | null>;
  /** The app version string (Electron app.getVersion()), injected by main.ts. */
  appVersion: string;
  /** Opens a URL in the user's default browser (Electron shell.openExternal), injected by main.ts. */
  openExternal: (url: string) => Promise<void>;
  /** Applies the chosen theme to native chrome (nativeTheme.themeSource), injected by main.ts. Optional so tests/headless can omit it. */
  applyTheme?: (theme: AppSettings['theme']) => void;
}

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
type ConnInput = Pick<CreateAccountInput, 'provider' | 'region' | 'endpoint' | 'forcePathStyle'>;

function resolveConnParams(input: ConnInput): Result<ConnParams> {
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

export function registerIpc(ipcMain: IpcMainLike, deps: RegisterDeps): void {
  const isKnownProvider = (p: string) => PROVIDERS.some((x) => x.id === p);
  const clientFor = (accountId: string) => createClientForAccount(accountId, deps);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = <T>(channel: string, fn: (...args: any[]) => Promise<Result<T>> | Result<T>) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (e) {
        return toErr(e);
      }
    });

  h(CH.accountsList, () => ok(deps.accounts.list()));

  h(CH.encryptionAvailable, () => ok(deps.crypto.isEncryptionAvailable()));

  h(CH.openExternal, async (url: string) => {
    if (!isHttpUrl(url)) return err('InvalidUrl', 'Only http(s) URLs can be opened externally');
    await deps.openExternal(url);
    return ok(true as const);
  });

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

  h(CH.accountsUpdate, (input: UpdateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    if (!deps.accounts.get(input.id)) {
      return err('AccountNotFound', `Unknown account: ${input.id}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const account = deps.db.transaction(() => {
      const updated = deps.accounts.update(input.id, {
        label: input.label,
        provider: input.provider,
        endpoint: params.data.endpoint,
        region: input.region,
        accessKeyId: input.accessKeyId,
        forcePathStyle: params.data.forcePathStyle,
      });
      if (input.secretAccessKey) {
        deps.secrets.set(input.id, input.secretAccessKey);
      }
      return updated;
    })();
    return ok(account);
  });

  h(CH.accountsRemove, (id: string) => {
    deps.secrets.remove(id);
    deps.accounts.remove(id);
    return ok(true as const);
  });

  h(CH.accountsTest, async (input: TestAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const params = resolveConnParams(input);
    if (!params.ok) return params;
    const secretAccessKey =
      input.secretAccessKey || (input.id ? deps.secrets.get(input.id) : undefined);
    if (!secretAccessKey) {
      return err('MissingSecret', 'A secret access key is required to test the connection');
    }
    const client = createClient({
      provider: input.provider,
      region: input.region,
      endpoint: params.data.endpoint,
      forcePathStyle: params.data.forcePathStyle,
      accessKeyId: input.accessKeyId,
      secretAccessKey,
    });
    const r = await listBuckets(client);
    return r.ok ? ok(true as const) : err(r.error.code, r.error.message);
  });

  h(CH.listBuckets, (accountId: string) => listBuckets(clientFor(accountId)));

  h(CH.createBucket, (a: { accountId: string; bucket: string; objectLock: boolean; versioning: boolean }) => {
    const account = deps.accounts.get(a.accountId);
    if (!account) return err('AccountNotFound', `Unknown account: ${a.accountId}`);
    const locationConstraint = bucketLocationConstraint(account.provider as ProviderId, account.region);
    return createBucket(clientFor(a.accountId), {
      bucket: a.bucket, objectLock: a.objectLock, versioning: a.versioning, locationConstraint,
    });
  });

  h(CH.listObjects, (a: { accountId: string; bucket: string; prefix: string; continuationToken?: string }) =>
    listObjects(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix, continuationToken: a.continuationToken }),
  );

  h(CH.headObject, (a: { accountId: string; bucket: string; key: string }) =>
    headObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.objectVisibility, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.getObjectAcl, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectAcl, (a: { accountId: string; bucket: string; key: string; acl: ObjectAcl }) =>
    putObjectAcl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, acl: a.acl }),
  );

  h(CH.setObjectVisibility, (a: { accountId: string; bucket: string; key: string; visibility: 'public' | 'private' }) =>
    setObjectVisibility(clientFor(a.accountId), { bucket: a.bucket, key: a.key, visibility: a.visibility }),
  );

  h(CH.getEditableMetadata, (a: { accountId: string; bucket: string; key: string }) =>
    getEditableMetadata(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.updateObjectMetadata, (a: { accountId: string; bucket: string; key: string; contentType: string | null; cacheControl: string | null; contentDisposition: string | null; metadata: Record<string, string> }) =>
    updateObjectMetadata(clientFor(a.accountId), { bucket: a.bucket, key: a.key, contentType: a.contentType, cacheControl: a.cacheControl, contentDisposition: a.contentDisposition, metadata: a.metadata }),
  );

  h(CH.presignGet, (a: { accountId: string; bucket: string; key: string; expiresIn: number }) =>
    presignGetUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }),
  );

  h(CH.presignPut, (a: { accountId: string; bucket: string; key: string; expiresIn: number }) =>
    presignPutUrl(clientFor(a.accountId), { bucket: a.bucket, key: a.key, expiresIn: a.expiresIn }),
  );

  h(CH.deleteObject, (a: { accountId: string; bucket: string; key: string }) =>
    deleteObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );

  h(CH.deleteFolder, (a: { accountId: string; bucket: string; prefix: string }) =>
    deleteFolder(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix }),
  );

  ipcMain.handle(CH.uploadObject, async (event, ...args) => {
    const a = args[0] as {
      accountId: string; bucket: string; key: string; filePath: string; contentType?: string; uploadId: string;
    };
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    try {
      return await uploadObject(clientFor(a.accountId), {
        bucket: a.bucket,
        key: a.key,
        filePath: a.filePath,
        contentType: a.contentType,
        onProgress: (loaded, total) =>
          sender.send(UPLOAD_PROGRESS_CHANNEL, { uploadId: a.uploadId, loaded, total: total ?? null }),
      });
    } catch (e) {
      return toErr(e);
    }
  });

  h(CH.downloadObject, async (a: { accountId: string; bucket: string; key: string }) => {
    const dest = await deps.saveDialog(basename(a.key));
    if (!dest) return ok({ path: null });
    const r = await downloadObject(clientFor(a.accountId), { bucket: a.bucket, key: a.key, destPath: dest });
    return r.ok ? ok({ path: dest as string | null }) : r;
  });

  h(CH.getBucketCors, (a: { accountId: string; bucket: string }) =>
    getBucketCors(clientFor(a.accountId), a.bucket),
  );

  h(CH.putBucketCors, (a: { accountId: string; bucket: string; rules: CorsRule[] }) =>
    putBucketCors(clientFor(a.accountId), a.bucket, a.rules),
  );

  h(CH.deleteBucketCors, (a: { accountId: string; bucket: string }) =>
    deleteBucketCors(clientFor(a.accountId), a.bucket),
  );

  h(CH.getObjectLockConfig, (a: { accountId: string; bucket: string }) =>
    getObjectLockConfig(clientFor(a.accountId), a.bucket),
  );

  h(CH.putObjectLockConfig, (a: { accountId: string; bucket: string; retention: DefaultRetention | null }) =>
    putObjectLockConfig(clientFor(a.accountId), a.bucket, a.retention),
  );

  h(CH.getObjectRetention, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectRetention(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectRetention, (a: { accountId: string; bucket: string; key: string; retainUntil: string }) =>
    putObjectRetention(clientFor(a.accountId), { bucket: a.bucket, key: a.key, retainUntil: a.retainUntil }),
  );
  h(CH.getObjectLegalHold, (a: { accountId: string; bucket: string; key: string }) =>
    getObjectLegalHold(clientFor(a.accountId), { bucket: a.bucket, key: a.key }),
  );
  h(CH.putObjectLegalHold, (a: { accountId: string; bucket: string; key: string; status: LegalHoldStatus }) =>
    putObjectLegalHold(clientFor(a.accountId), { bucket: a.bucket, key: a.key, status: a.status }),
  );

  h(CH.createFolder, (a: { accountId: string; bucket: string; prefix: string; name: string }) =>
    createFolder(clientFor(a.accountId), { bucket: a.bucket, prefix: a.prefix, name: a.name }),
  );

  h(CH.moveObject, (a: { accountId: string; bucket: string; sourceKey: string; destKey: string }) =>
    moveObject(clientFor(a.accountId), { bucket: a.bucket, sourceKey: a.sourceKey, destKey: a.destKey }),
  );

  h(CH.moveFolder, (a: { accountId: string; bucket: string; sourcePrefix: string; destPrefix: string }) =>
    moveFolder(clientFor(a.accountId), { bucket: a.bucket, sourcePrefix: a.sourcePrefix, destPrefix: a.destPrefix }),
  );

  let activeSync: AbortController | null = null;

  h(CH.syncPlan, (a: { source: Endpoint; dest: Endpoint }) =>
    planSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest),
  );

  ipcMain.handle(CH.syncRun, async (event, ...args) => {
    const a = args[0] as { source: Endpoint; dest: Endpoint };
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    const controller = new AbortController();
    activeSync?.abort(); // a new run supersedes any still-running one (one run at a time)
    activeSync = controller;
    try {
      return await runSync(clientFor(a.source.accountId), clientFor(a.dest.accountId), a.source, a.dest, {
        sameAccount: a.source.accountId === a.dest.accountId,
        signal: controller.signal,
        onProgress: (p) => sender.send(SYNC_PROGRESS_CHANNEL, p),
      });
    } catch (e) {
      return toErr(e);
    } finally {
      if (activeSync === controller) activeSync = null;
    }
  });

  h(CH.syncCancel, () => {
    activeSync?.abort();
    return ok(true as const);
  });

  h(CH.localSyncPlan, (a: LocalSyncArgs) => planLocalSync(clientFor(a.remote.accountId), a));

  ipcMain.handle(CH.localSyncRun, async (event, ...args) => {
    const a = args[0] as LocalSyncArgs;
    const sender = (event as { sender: { send(channel: string, payload: unknown): void } }).sender;
    const controller = new AbortController();
    activeSync?.abort();
    activeSync = controller;
    try {
      return await runLocalSync(clientFor(a.remote.accountId), a, {
        signal: controller.signal,
        onProgress: (p) => sender.send(SYNC_PROGRESS_CHANNEL, p),
      });
    } catch (e) {
      return toErr(e);
    } finally {
      if (activeSync === controller) activeSync = null;
    }
  });

  h(CH.selectDirectory, async () => ok(await deps.selectDirectory()));

  h(CH.getSettings, () => ok(readSettings(deps.settings)));
  h(CH.setSettings, (patch: Partial<AppSettings>) => {
    const next = writeSettings(deps.settings, patch);
    deps.applyTheme?.(next.theme);
    return ok(next);
  });
  h(CH.getAppInfo, () =>
    ok({
      version: deps.appVersion,
      encryptionAvailable: deps.crypto.isEncryptionAvailable(),
      accountCount: deps.accounts.list().length,
    }),
  );
}
