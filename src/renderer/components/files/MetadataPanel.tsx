import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX, FiDownload, FiLink, FiEdit3, FiMove, FiLock, FiTag, FiTrash2 } from 'react-icons/fi';
import { useObjectDetails } from '../../hooks/useObjectDetails';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { useObjectActions } from '../../hooks/useObjectActions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useTransfer } from '../../hooks/useTransfer';
import { useToast } from '../ui/ToastProvider';
import { parentPrefix, baseName } from '../../lib/keys';
import { NameDialog } from '../transfer/NameDialog';
import { MoveDialog } from '../transfer/MoveDialog';
import { useObjectLock } from '../../hooks/useObjectLock';
import { RetentionSection } from './RetentionSection';
import { PermissionsDialog } from './PermissionsDialog';
import { MetadataDialog } from './MetadataDialog';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col border-b border-slate-100 dark:border-slate-800 py-1.5">
      <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

export function MetadataPanel({
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
  const { metadata, visibility, setVisibility } = useObjectDetails(accountId, bucket, objectKey);
  const lock = useObjectLock(accountId, bucket);
  const actions = useObjectActions(accountId ?? '', bucket ?? '');
  const [confirming, setConfirming] = useState(false);
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const transfer = useTransfer(accountId ?? '', bucket ?? '');
  const { show } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  return (
    <div className="flex h-full w-80 flex-col border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('files.metadata.details')}</span>
        <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
          <FiX className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 p-2">
        <button type="button" aria-label={t('files.metadata.download')} title={t('files.metadata.download')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => void actions.download(objectKey)}>
          <FiDownload className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label={t('files.metadata.copyUrl')} title={t('files.metadata.copyUrl')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => void actions.copyPresignedUrl(objectKey)}>
          <FiLink className="h-4 w-4" aria-hidden />
        </button>
        {!renaming && (
          <button type="button" aria-label={t('files.metadata.rename')} title={t('files.metadata.rename')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setRenaming(true)}>
            <FiEdit3 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <button type="button" aria-label={t('files.metadata.move')} title={t('files.metadata.move')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setMoving(true)}>
          <FiMove className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label={t('files.metadata.permissions')} title={t('files.metadata.permissions')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setPermissionsOpen(true)}>
          <FiLock className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" aria-label={t('files.metadata.editMetadata')} title={t('files.metadata.editMetadata')} className="rounded border border-slate-300 dark:border-slate-700 p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800" onClick={() => setMetadataOpen(true)}>
          <FiTag className="h-4 w-4" aria-hidden />
        </button>
        {!confirming && (
          <button type="button" aria-label={t('files.metadata.delete')} title={t('files.metadata.delete')} className="rounded border border-red-300 dark:border-red-800 p-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50" onClick={() => setConfirming(true)}>
            <FiTrash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={t('files.metadata.deleteConfirm', { key: objectKey })}
          confirmLabel={t('files.metadata.delete')}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await actions.deleteObject(objectKey);
            onClose();
          }}
        />
      )}

      {renaming && (
        <NameDialog
          title={t('files.renameTitle', { name: baseName(objectKey) })}
          initialValue={baseName(objectKey)}
          confirmLabel={t('files.rename')}
          onCancel={() => setRenaming(false)}
          onConfirm={async (name) => {
            setRenaming(false);
            try {
              await transfer.moveObject.mutateAsync({ sourceKey: objectKey, destKey: `${parentPrefix(objectKey)}${name}` });
              show(t('files.renamed'));
              onClose();
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {moving && (
        <MoveDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          item={{ kind: 'file', name: baseName(objectKey), parent: parentPrefix(objectKey), key: objectKey }}
          onClose={() => setMoving(false)}
          onMoved={onClose}
        />
      )}

      {permissionsOpen && (
        <PermissionsDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          objectKey={objectKey}
          onClose={() => setPermissionsOpen(false)}
        />
      )}

      {metadataOpen && (
        <MetadataDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          objectKey={objectKey}
          onClose={() => setMetadataOpen(false)}
        />
      )}

      {confirmingPublic && (
        <ConfirmDialog
          message={t('files.metadata.makePublicConfirm')}
          confirmLabel={t('files.metadata.makePublic')}
          onCancel={() => setConfirmingPublic(false)}
          onConfirm={async () => {
            setConfirmingPublic(false);
            try {
              await setVisibility.mutateAsync('public');
              show(t('files.metadata.madePublic'));
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      <div className="flex-1 overflow-auto p-3 text-sm">
        <Row label={t('files.metadata.key')} value={objectKey} />

        <div className="flex flex-col border-b border-slate-100 dark:border-slate-800 py-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{t('files.metadata.visibility')}</span>
          <span>
            {visibility.isSuccess ? (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                  visibility.data === 'public' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {visibility.data}
              </span>
            ) : visibility.isError ? (
              <span className="text-xs text-slate-400 dark:text-slate-500">{t('files.metadata.unavailable')}</span>
            ) : (
              '…'
            )}
          </span>
          {visibility.isSuccess && (visibility.data === 'public' || visibility.data === 'private') && !confirmingPublic && (
            <button
              type="button"
              disabled={setVisibility.isPending}
              className="mt-1 self-start rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              onClick={async () => {
                if (visibility.data === 'private') {
                  setConfirmingPublic(true);
                  return;
                }
                try {
                  await setVisibility.mutateAsync('private');
                  show(t('files.metadata.madePrivate'));
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              {visibility.data === 'public' ? t('files.metadata.makePrivate') : t('files.metadata.makePublic')}
            </button>
          )}
        </div>

        {lock.query.data?.enabled && (
          <RetentionSection accountId={accountId ?? ''} bucket={bucket ?? ''} objectKey={objectKey} />
        )}

        {metadata.isLoading && <p className="py-2 text-slate-500 dark:text-slate-400">{t('common.loading')}</p>}
        {metadata.isError && <p className="py-2 text-red-600 dark:text-red-400">{(metadata.error as Error).message}</p>}

        {metadata.isSuccess && (
          <>
            <Row label={t('files.metadata.size')} value={formatBytes(metadata.data.size)} />
            <Row label={t('files.metadata.contentType')} value={metadata.data.contentType ?? '—'} />
            <Row label={t('files.metadata.lastModified')} value={formatTimestamp(metadata.data.lastModified)} />
            <Row label={t('files.metadata.storageClass')} value={metadata.data.storageClass ?? '—'} />
            <Row label={t('files.metadata.etag')} value={metadata.data.etag ?? '—'} />
            {Object.entries(metadata.data.metadata).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
