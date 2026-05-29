import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CH, UPLOAD_PROGRESS_CHANNEL } from './main/ipc/channels';
import type { ApiMap, UploadProgress } from './main/ipc/channels';

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
  getBucketCors: (a: ApiMap[typeof CH.getBucketCors]['args'][0]) => invoke(CH.getBucketCors, a),
  putBucketCors: (a: ApiMap[typeof CH.putBucketCors]['args'][0]) => invoke(CH.putBucketCors, a),
  deleteBucketCors: (a: ApiMap[typeof CH.deleteBucketCors]['args'][0]) => invoke(CH.deleteBucketCors, a),
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
