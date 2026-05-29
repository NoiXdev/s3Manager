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
