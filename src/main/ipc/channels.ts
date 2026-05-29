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
