import { basename } from 'node:path';
import { CH, UPLOAD_PROGRESS_CHANNEL, type CreateAccountInput } from './channels';
import { ok, err, type Result } from '../shared/result';
import { resolveEndpoint, getProvider, PROVIDERS } from '../s3/providers';
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
import type { DB } from '../storage/db';

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

  h(CH.accountsCreate, (input: CreateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
    const endpoint = resolveEndpoint(input.provider, input.region);
    const account = deps.db.transaction(() => {
      const created = deps.accounts.create({
        label: input.label,
        provider: input.provider,
        endpoint,
        region: input.region,
        accessKeyId: input.accessKeyId,
      });
      deps.secrets.set(created.id, input.secretAccessKey);
      return created;
    })();
    return ok(account);
  });

  h(CH.accountsRemove, (id: string) => {
    deps.secrets.remove(id);
    deps.accounts.remove(id);
    return ok(true as const);
  });

  h(CH.accountsTest, async (input: CreateAccountInput) => {
    if (!isKnownProvider(input.provider)) {
      return err('InvalidProvider', `Unknown provider: ${input.provider}`);
    }
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
}
