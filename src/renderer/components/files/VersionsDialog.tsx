import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiDownload, FiX } from 'react-icons/fi';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/ToastProvider';
import { useObjectVersions } from '../../hooks/useObjectVersions';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { baseName } from '../../lib/keys';

export function VersionsDialog({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string | null;
  bucket: string | null;
  objectKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { show } = useToast();
  const { query, restore, remove, removeMarker } = useObjectVersions(accountId, bucket, objectKey);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingMarkerId, setRemovingMarkerId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const run = async (p: Promise<unknown>, okMsg: string) => {
    try {
      await p;
      show(okMsg);
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const download = async (versionId: string) => {
    if (!accountId || !bucket) return;
    setDownloadingId(versionId);
    try {
      const r = await window.s3.downloadObject({ accountId, bucket, key: objectKey, versionId });
      if (!r.ok) show(`${r.error.code}: ${r.error.message}`, 'error');
      else if (r.data.path) show(t('versioning.downloaded'));
    } catch (e) {
      show((e as Error).message, 'error');
    } finally {
      setDownloadingId(null);
    }
  };

  const btn = 'rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40';

  return (
    <Modal onDismiss={onClose} className="max-h-[80vh] w-[34rem] overflow-auto rounded bg-white p-4 shadow-lg dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">{t('versioning.versionsTitle', { name: baseName(objectKey) })}</h3>
        <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
          <FiX className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {query.isLoading && <p className="text-slate-500 dark:text-slate-400">{t('versioning.loadingVersions')}</p>}
      {query.isError && <p className="text-red-600 dark:text-red-400">{(query.error as Error).message}</p>}
      {query.isSuccess && query.data.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">{t('versioning.noVersions')}</p>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {query.data.map((v) => (
            <li key={v.versionId} className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 py-2 text-sm">
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-xs" title={v.versionId}>{v.versionId}</span>
                  {v.isLatest && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-400">{t('versioning.latest')}</span>}
                  {v.isDeleteMarker && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-400">{t('versioning.deleteMarker')}</span>}
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-500">
                  {formatTimestamp(v.lastModified)}{v.size !== null ? ` · ${formatBytes(v.size)}` : ''}
                </div>
              </div>
              {v.isDeleteMarker ? (
                <button type="button" disabled={removeMarker.isPending} className={btn} onClick={() => setRemovingMarkerId(v.versionId)}>{t('versioning.removeMarker')}</button>
              ) : (
                <>
                  <button type="button" aria-label={t('versioning.download')} title={t('versioning.download')} disabled={downloadingId !== null} className={btn} onClick={() => void download(v.versionId)}>
                    <FiDownload className="h-4 w-4" aria-hidden />
                  </button>
                  {!v.isLatest && (
                    <button type="button" disabled={restore.isPending} className={btn} onClick={() => void run(restore.mutateAsync(v.versionId), t('versioning.restored'))}>{t('versioning.restore')}</button>
                  )}
                  <button type="button" disabled={remove.isPending} className="rounded border border-red-300 dark:border-red-800 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-40" onClick={() => setDeletingId(v.versionId)}>{t('versioning.deleteVersion')}</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {deletingId !== null && (
        <ConfirmDialog
          message={t('versioning.deleteConfirm')}
          confirmLabel={t('versioning.deleteConfirmLabel')}
          onCancel={() => setDeletingId(null)}
          onConfirm={async () => {
            const id = deletingId;
            setDeletingId(null);
            await run(remove.mutateAsync(id), t('versioning.deletedVersion'));
          }}
        />
      )}

      {removingMarkerId !== null && (
        <ConfirmDialog
          message={t('versioning.removeMarkerConfirm')}
          confirmLabel={t('versioning.removeMarkerConfirmLabel')}
          onCancel={() => setRemovingMarkerId(null)}
          onConfirm={async () => {
            const id = removingMarkerId;
            setRemovingMarkerId(null);
            await run(removeMarker.mutateAsync(id), t('versioning.markerRemoved'));
          }}
        />
      )}
    </Modal>
  );
}
