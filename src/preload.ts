import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CH, UPLOAD_PROGRESS_CHANNEL, SYNC_PROGRESS_CHANNEL } from './main/ipc/channels';
import type { ApiMap, UploadProgress, SyncProgress } from './main/ipc/channels';

type Channel = keyof ApiMap;

function invoke<C extends Channel>(channel: C, ...args: ApiMap[C]['args']): Promise<ApiMap[C]['res']> {
  return ipcRenderer.invoke(channel, ...args);
}

const api = {
  accounts: {
    list: () => invoke(CH.accountsList),
    create: (input: ApiMap[typeof CH.accountsCreate]['args'][0]) => invoke(CH.accountsCreate, input),
    update: (input: ApiMap[typeof CH.accountsUpdate]['args'][0]) => invoke(CH.accountsUpdate, input),
    remove: (id: string) => invoke(CH.accountsRemove, id),
    test: (input: ApiMap[typeof CH.accountsTest]['args'][0]) => invoke(CH.accountsTest, input),
  },
  encryptionAvailable: () => invoke(CH.encryptionAvailable),
  listBuckets: (accountId: string) => invoke(CH.listBuckets, accountId),
  createBucket: (a: ApiMap[typeof CH.createBucket]['args'][0]) => invoke(CH.createBucket, a),
  listObjects: (a: ApiMap[typeof CH.listObjects]['args'][0]) => invoke(CH.listObjects, a),
  headObject: (a: ApiMap[typeof CH.headObject]['args'][0]) => invoke(CH.headObject, a),
  objectVisibility: (a: ApiMap[typeof CH.objectVisibility]['args'][0]) => invoke(CH.objectVisibility, a),
  setObjectVisibility: (a: ApiMap[typeof CH.setObjectVisibility]['args'][0]) => invoke(CH.setObjectVisibility, a),
  presignGet: (a: ApiMap[typeof CH.presignGet]['args'][0]) => invoke(CH.presignGet, a),
  presignPut: (a: ApiMap[typeof CH.presignPut]['args'][0]) => invoke(CH.presignPut, a),
  deleteObject: (a: ApiMap[typeof CH.deleteObject]['args'][0]) => invoke(CH.deleteObject, a),
  deleteFolder: (a: ApiMap[typeof CH.deleteFolder]['args'][0]) => invoke(CH.deleteFolder, a),
  uploadObject: (a: ApiMap[typeof CH.uploadObject]['args'][0]) => invoke(CH.uploadObject, a),
  downloadObject: (a: ApiMap[typeof CH.downloadObject]['args'][0]) => invoke(CH.downloadObject, a),
  getBucketCors: (a: ApiMap[typeof CH.getBucketCors]['args'][0]) => invoke(CH.getBucketCors, a),
  putBucketCors: (a: ApiMap[typeof CH.putBucketCors]['args'][0]) => invoke(CH.putBucketCors, a),
  deleteBucketCors: (a: ApiMap[typeof CH.deleteBucketCors]['args'][0]) => invoke(CH.deleteBucketCors, a),
  getObjectLockConfig: (a: ApiMap[typeof CH.getObjectLockConfig]['args'][0]) => invoke(CH.getObjectLockConfig, a),
  putObjectLockConfig: (a: ApiMap[typeof CH.putObjectLockConfig]['args'][0]) => invoke(CH.putObjectLockConfig, a),
  getObjectRetention: (a: ApiMap[typeof CH.getObjectRetention]['args'][0]) => invoke(CH.getObjectRetention, a),
  putObjectRetention: (a: ApiMap[typeof CH.putObjectRetention]['args'][0]) => invoke(CH.putObjectRetention, a),
  getObjectLegalHold: (a: ApiMap[typeof CH.getObjectLegalHold]['args'][0]) => invoke(CH.getObjectLegalHold, a),
  putObjectLegalHold: (a: ApiMap[typeof CH.putObjectLegalHold]['args'][0]) => invoke(CH.putObjectLegalHold, a),
  createFolder: (a: ApiMap[typeof CH.createFolder]['args'][0]) => invoke(CH.createFolder, a),
  moveObject: (a: ApiMap[typeof CH.moveObject]['args'][0]) => invoke(CH.moveObject, a),
  moveFolder: (a: ApiMap[typeof CH.moveFolder]['args'][0]) => invoke(CH.moveFolder, a),
  planSync: (a: ApiMap[typeof CH.syncPlan]['args'][0]) => invoke(CH.syncPlan, a),
  runSync: (a: ApiMap[typeof CH.syncRun]['args'][0]) => invoke(CH.syncRun, a),
  cancelSync: () => invoke(CH.syncCancel),
  localSyncPlan: (a: ApiMap[typeof CH.localSyncPlan]['args'][0]) => invoke(CH.localSyncPlan, a),
  localSyncRun: (a: ApiMap[typeof CH.localSyncRun]['args'][0]) => invoke(CH.localSyncRun, a),
  selectSyncDirectory: () => invoke(CH.selectDirectory),
  getSettings: () => invoke(CH.getSettings),
  setSettings: (a: ApiMap[typeof CH.setSettings]['args'][0]) => invoke(CH.setSettings, a),
  getAppInfo: () => invoke(CH.getAppInfo),
  getObjectAcl: (a: ApiMap[typeof CH.getObjectAcl]['args'][0]) => invoke(CH.getObjectAcl, a),
  putObjectAcl: (a: ApiMap[typeof CH.putObjectAcl]['args'][0]) => invoke(CH.putObjectAcl, a),
  getEditableMetadata: (a: ApiMap[typeof CH.getEditableMetadata]['args'][0]) => invoke(CH.getEditableMetadata, a),
  updateObjectMetadata: (a: ApiMap[typeof CH.updateObjectMetadata]['args'][0]) => invoke(CH.updateObjectMetadata, a),
  onSyncProgress: (cb: (p: SyncProgress) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload as SyncProgress);
    ipcRenderer.on(SYNC_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(SYNC_PROGRESS_CHANNEL, listener);
  },
  onUploadProgress: (cb: (progress: UploadProgress) => void) => {
    const listener = (_event: unknown, payload: unknown) => cb(payload as UploadProgress);
    ipcRenderer.on(UPLOAD_PROGRESS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPLOAD_PROGRESS_CHANNEL, listener);
  },
  /** Resolve the absolute filesystem path of a dropped/selected File (sandbox-safe). */
  getDropPath: (file: File) => webUtils.getPathForFile(file),
};

export type S3Api = typeof api;
contextBridge.exposeInMainWorld('s3', api);
