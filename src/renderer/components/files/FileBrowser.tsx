import { useState } from 'react';
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
  const [folderToRename, setFolderToRename] = useState<{ name: string; prefix: string } | null>(null);
  const [itemToMove, setItemToMove] = useState<MoveItem | null>(null);

  if (bucket === null) {
    return <div className="flex h-full items-center justify-center text-slate-400">Select a bucket</div>;
  }

  const isEmpty = query.isSuccess && folders.length === 0 && files.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
          onClick={() => setNewFolderOpen(true)}
        >
          New folder
        </button>
      </div>

      {query.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {query.isError && <p className="p-3 text-red-600">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500">This folder is empty</p>}

      <DropZone onDropFiles={(droppedFiles) => void uploads.upload(droppedFiles, prefix)}>
        <div className="h-full overflow-auto">
          <table className="w-full border-collapse text-left">
            <tbody>
              {folders.map((folder) => (
                <tr
                  key={folder.prefix}
                  onClick={() => onNavigate(folder.prefix)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-1.5">📁 <span>{folder.name}</span></td>
                  <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-label={`Rename folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToRename(folder);
                      }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label={`Move folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        setItemToMove({ kind: 'folder', name: folder.name, parent: parentPrefix(folder.prefix), prefix: folder.prefix });
                      }}
                    >
                      ➜
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
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {files.map((file) => (
                <tr
                  key={file.key}
                  onClick={() => onSelectFile(file.key)}
                  className={`cursor-pointer border-b border-slate-100 ${
                    file.key === selectedKey ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-3 py-1.5">📄 <span>{file.name}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(file.size)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{formatTimestamp(file.lastModified)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              className="m-3 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
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
    </div>
  );
}
