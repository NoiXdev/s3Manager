import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiChevronDown, FiChevronUp, FiEdit3, FiMove, FiTrash2 } from 'react-icons/fi';
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
import { DEFAULT_SORT, nextSort, sortEntries, type SortKey, type SortState } from '../../lib/sortEntries';

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSort: (column: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === column;
  const Icon = sort.direction === 'asc' ? FiChevronUp : FiChevronDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`px-3 py-1.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 ${
          active ? 'text-slate-900 dark:text-slate-100' : ''
        }`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? '' : 'invisible'}`} aria-hidden />
      </button>
    </th>
  );
}

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
  const { t } = useTranslation();
  const objects = useObjects(accountId, bucket, prefix);
  const { query } = objects;
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const { folders, files } = useMemo(
    () => sortEntries(objects.folders, objects.files, sort),
    [objects.folders, objects.files, sort],
  );
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
    return <div className="flex h-full items-center justify-center text-slate-400 dark:text-slate-500">{t('files.selectBucket')}</div>;
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
            {t('files.uploadLinkButton')}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => setNewFolderOpen(true)}
          >
            {t('files.newFolder')}
          </button>
        </div>
      </div>

      {query.isLoading && <p className="p-3 text-slate-500 dark:text-slate-400">{t('common.loading')}</p>}
      {query.isError && <p className="p-3 text-red-600 dark:text-red-400">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500 dark:text-slate-400">{t('files.folderEmpty')}</p>}

      <DropZone onDropFiles={(droppedFiles) => void uploads.upload(droppedFiles, prefix)}>
        <div className="h-full overflow-auto">
          <table className="w-full border-collapse text-left">
            {(folders.length > 0 || files.length > 0) && (
              <thead className="sticky top-0 z-10 bg-white text-xs text-slate-500 shadow-[inset_0_-1px_0_var(--color-slate-200)] dark:bg-slate-900 dark:text-slate-400 dark:shadow-[inset_0_-1px_0_var(--color-slate-700)]">
                <tr>
                  <SortableHeader label={t('files.columnName')} column="name" sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))} />
                  <SortableHeader label={t('files.columnSize')} column="size" sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))} align="right" />
                  <SortableHeader label={t('files.columnLastModified')} column="lastModified" sort={sort} onSort={(c) => setSort((s) => nextSort(s, c))} />
                  <th scope="col" className="px-3 py-1.5">
                    <span className="sr-only">{t('files.columnActions')}</span>
                  </th>
                </tr>
              </thead>
            )}
            <tbody>
              {folders.map((folder) => (
                <tr
                  key={folder.prefix}
                  onClick={() => onNavigate(folder.prefix)}
                  className="cursor-pointer border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <td className="px-3 py-1.5">📁 <span>{folder.name}</span></td>
                  <td className="px-3 py-1.5 text-right text-slate-400 dark:text-slate-500">—</td>
                  <td className="px-3 py-1.5" />
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label={t('files.renameFolderAria', { name: folder.name })}
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
                      aria-label={t('files.moveFolderAria', { name: folder.name })}
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
                      aria-label={t('files.deleteFolderAria', { name: folder.name })}
                      className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400"
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
                  <td className="px-3 py-1.5" />
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
              {query.isFetchingNextPage ? t('common.loading') : t('files.loadMore')}
            </button>
          )}
        </div>
      </DropZone>

      <UploadsPanel items={uploads.items} onClear={uploads.clearFinished} />

      {folderToDelete && (
        <ConfirmDialog
          message={t('files.deleteFolderConfirm', { name: folderToDelete.name })}
          confirmLabel={t('files.delete')}
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
          title={t('files.newFolder')}
          initialValue=""
          confirmLabel={t('files.create')}
          onCancel={() => setNewFolderOpen(false)}
          onConfirm={async (name) => {
            setNewFolderOpen(false);
            try {
              await transfer.createFolder.mutateAsync({ prefix, name });
              show(t('files.folderCreated'));
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {folderToRename && (
        <NameDialog
          title={t('files.renameTitle', { name: folderToRename.name })}
          initialValue={folderToRename.name}
          confirmLabel={t('files.rename')}
          onCancel={() => setFolderToRename(null)}
          onConfirm={async (name) => {
            const target = folderToRename;
            setFolderToRename(null);
            try {
              await transfer.moveFolder.mutateAsync({ sourcePrefix: target.prefix, destPrefix: `${parentPrefix(target.prefix)}${name}/` });
              show(t('files.renamed'));
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
