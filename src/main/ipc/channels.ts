import type { ProviderId } from '../s3/providers';
import type { Result } from '../shared/result';
import type { ListObjectsResult, ObjectMetadata } from '../s3/objects';
import type { Visibility } from '../s3/visibility';
import type { Account } from '../storage/accountsRepo';
import type { CorsRule } from '../s3/cors';
import type { ObjectLockStatus, DefaultRetention } from '../s3/objectLock';
import type { Endpoint, SyncPlan, SyncResult } from '../s3/sync';
import type { LocalSyncArgs } from '../s3/localSync';

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
  setObjectVisibility: 's3:setObjectVisibility',
  presignGet: 's3:presignGet',
  presignPut: 's3:presignPut',
  deleteObject: 's3:deleteObject',
  deleteFolder: 's3:deleteFolder',
  uploadObject: 's3:uploadObject',
  downloadObject: 's3:downloadObject',
  getBucketCors: 's3:getBucketCors',
  putBucketCors: 's3:putBucketCors',
  deleteBucketCors: 's3:deleteBucketCors',
  getObjectLockConfig: 's3:getObjectLockConfig',
  putObjectLockConfig: 's3:putObjectLockConfig',
  createFolder: 's3:createFolder',
  moveObject: 's3:moveObject',
  moveFolder: 's3:moveFolder',
  syncPlan: 'sync:plan',
  syncRun: 'sync:run',
  syncCancel: 'sync:cancel',
  localSyncPlan: 'sync:localPlan',
  localSyncRun: 'sync:localRun',
  selectDirectory: 'sync:selectDirectory',
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
  [CH.setObjectVisibility]: { args: [{ accountId: string; bucket: string; key: string; visibility: 'public' | 'private' }]; res: Result<Visibility> };
  [CH.presignGet]: { args: [{ accountId: string; bucket: string; key: string; expiresIn: number }]; res: Result<string> };
  [CH.presignPut]: { args: [{ accountId: string; bucket: string; key: string; expiresIn: number }]; res: Result<string> };
  [CH.deleteObject]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<number> };
  [CH.deleteFolder]: { args: [{ accountId: string; bucket: string; prefix: string }]; res: Result<number> };
  [CH.uploadObject]: { args: [{ accountId: string; bucket: string; key: string; filePath: string; contentType?: string; uploadId: string }]; res: Result<{ key: string }> };
  [CH.downloadObject]: { args: [{ accountId: string; bucket: string; key: string }]; res: Result<{ path: string | null }> };
  [CH.getBucketCors]: { args: [{ accountId: string; bucket: string }]; res: Result<CorsRule[]> };
  [CH.putBucketCors]: { args: [{ accountId: string; bucket: string; rules: CorsRule[] }]; res: Result<true> };
  [CH.deleteBucketCors]: { args: [{ accountId: string; bucket: string }]; res: Result<true> };
  [CH.getObjectLockConfig]: { args: [{ accountId: string; bucket: string }]; res: Result<ObjectLockStatus> };
  [CH.putObjectLockConfig]: { args: [{ accountId: string; bucket: string; retention: DefaultRetention | null }]; res: Result<true> };
  [CH.createFolder]: { args: [{ accountId: string; bucket: string; prefix: string; name: string }]; res: Result<{ key: string }> };
  [CH.moveObject]: { args: [{ accountId: string; bucket: string; sourceKey: string; destKey: string }]; res: Result<{ key: string }> };
  [CH.moveFolder]: { args: [{ accountId: string; bucket: string; sourcePrefix: string; destPrefix: string }]; res: Result<{ count: number }> };
  [CH.syncPlan]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncPlan> };
  [CH.syncRun]: { args: [{ source: Endpoint; dest: Endpoint }]; res: Result<SyncResult> };
  [CH.syncCancel]: { args: []; res: Result<true> };
  [CH.localSyncPlan]: { args: [LocalSyncArgs]; res: Result<SyncPlan> };
  [CH.localSyncRun]: { args: [LocalSyncArgs]; res: Result<SyncResult> };
  [CH.selectDirectory]: { args: []; res: Result<string | null> };
}

/** One-way main→renderer channel for upload progress (not an invoke channel,
 *  so intentionally not part of CH/ApiMap). */
export const UPLOAD_PROGRESS_CHANNEL = 's3:uploadProgress';

export interface UploadProgress {
  uploadId: string;
  loaded: number;
  total: number | null;
}

/** One-way main→renderer channel for sync progress (mirrors UPLOAD_PROGRESS_CHANNEL). */
export const SYNC_PROGRESS_CHANNEL = 's3:syncProgress';
export type { SyncProgress } from '../s3/sync';
