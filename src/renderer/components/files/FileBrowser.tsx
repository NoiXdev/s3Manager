import { useState } from 'react';
import { FiEdit3, FiMove, FiTrash2 } from 'react-icons/fi';
import { useObjects } from '../../hooks/useObjects';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { Breadcrumb } from './Breadcrumb';
import { DropZone } from './DropZone';
import { UploadsPanel } from './UploadsPanel';
import { useUploads } from '../../hooks/useUploads';
import { useObjectActions } from '../../hooks/useObjectActions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useTransfer } from '../../hooks/useTransfer';
import { parentPrefix } from '../../lib/keys';
import { NameDialog } from '../transfer/NameDialog';
import { MoveDialog, type MoveItem } from '../transfer/MoveDialog';
import { useToast } from '../ui/ToastProvider';
import { UploadLinkDialog } from './UploadLinkDialog';

export function FileBrowser({
  accountId,
  bucket,
  prefix,
  selectedKey,
  onNavigate,
  onSelectFile,
}: {
  accountId: string | null;
  bucket: string | null;
  prefix: string;
  selectedKey: string | null;
  onNavigate: (prefix: string) => void;
  onSelectFile: (key: string) => void;
}) {
  const { query, folders, files } = useObjects(accountId, bucket, prefix);
  const uploads = useUploads(accountId, bucket);
  const actions = useObjectActions(accountId ?? '', bucket ?? '');
  const [folderToDelete, setFolderToDelete] = useState<{ name: string; prefix: string } | null>(null);
  const transfer = useTransfer(accountId ?? '', bucket ?? '');
  const { show } = useToast();
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [uploadLinkOpen, setUploadLinkOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<{ name: string; prefix: string } | null>(null);
  const [itemToMove, setItemToMove] = useState<MoveItem | null>(null);

  if (bucket === null) {
    return <div className="flex h-full items-center justify-center text-slate-400 dark:text-slate-500">Select a bucket</div>;
  }

  const isEmpty = query.isSuccess && folders.length === 0 && files.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => setUploadLinkOpen(true)}
          >
            Upload link…
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => setNewFolderOpen(true)}
          >
            New folder
          </button>
        </div>
      </div>

      {query.isLoading && <p className="p-3 text-slate-500 dark:text-slate-400">Loading…</p>}
      {query.isError && <p className="p-3 text-red-600">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500 dark:text-slate-400">This folder is empty</p>}

      <DropZone onDropFiles={(droppedFiles) => void uploads.upload(droppedFiles, prefix)}>
        <div className="h-full overflow-auto">
          <table className="w-full border-collapse text-left">
            <tbody>
              {folders.map((folder) => (
                <tr
                  key={folder.prefix}
                  onClick={() => onNavigate(folder.prefix)}
                  className="cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <td className="px-3 py-1.5">📁 <span>{folder.name}</span></td>
                  <td className="px-3 py-1.5 text-right text-slate-400 dark:text-slate-500">—</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-label={`Rename folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToRename(folder);
                      }}
                    >
                      <FiEdit3 className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        setItemToMove({ kind: 'folder', name: folder.name, parent: parentPrefix(folder.prefix), prefix: folder.prefix });
                      }}
                    >
                      <FiMove className="h-4 w-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToDelete(folder);
                      }}
                    >
                      <FiTrash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
              {files.map((file) => (
                <tr
                  key={file.key}
                  onClick={() => onSelectFile(file.key)}
                  className={`cursor-pointer border-b border-slate-100 dark:border-slate-800 ${
                    file.key === selectedKey ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <td className="px-3 py-1.5">📄 <span>{file.name}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(file.size)}</td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">{formatTimestamp(file.lastModified)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              className="m-3 rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </DropZone>

      <UploadsPanel items={uploads.items} onClear={uploads.clearFinished} />

      {folderToDelete && (
        <ConfirmDialog
          message={`Delete folder ${folderToDelete.name} and all its contents?`}
          confirmLabel="Delete"
          onCancel={() => setFolderToDelete(null)}
          onConfirm={async () => {
            const target = folderToDelete;
            setFolderToDelete(null);
            await actions.deleteFolder(target.prefix);
          }}
        />
      )}

      {newFolderOpen && (
        <NameDialog
          title="New folder"
          initialValue=""
          confirmLabel="Create"
          onCancel={() => setNewFolderOpen(false)}
          onConfirm={async (name) => {
            setNewFolderOpen(false);
            try {
              await transfer.createFolder.mutateAsync({ prefix, name });
              show('Folder created');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {folderToRename && (
        <NameDialog
          title={`Rename ${folderToRename.name}`}
          initialValue={folderToRename.name}
          confirmLabel="Rename"
          onCancel={() => setFolderToRename(null)}
          onConfirm={async (name) => {
            const target = folderToRename;
            setFolderToRename(null);
            try {
              await transfer.moveFolder.mutateAsync({ sourcePrefix: target.prefix, destPrefix: `${parentPrefix(target.prefix)}${name}/` });
              show('Renamed');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {itemToMove && (
        <MoveDialog accountId={accountId ?? ''} bucket={bucket ?? ''} item={itemToMove} onClose={() => setItemToMove(null)} />
      )}

      {uploadLinkOpen && (
        <UploadLinkDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          prefix={prefix}
          onClose={() => setUploadLinkOpen(false)}
        />
      )}
    </div>
  );
}
