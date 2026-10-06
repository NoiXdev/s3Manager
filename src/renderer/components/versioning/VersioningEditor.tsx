import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBucketVersioning } from '../../hooks/useBucketVersioning';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export function VersioningEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const { t } = useTranslation();
  const { query, setVersioning } = useBucketVersioning(accountId, bucket);
  const { show } = useToast();
  const [confirmSuspend, setConfirmSuspend] = useState(false);

  const status = query.data?.status;
  const isEnabled = status === 'Enabled';

  const statusText =
    status === 'Enabled' ? t('versioning.statusEnabled')
    : status === 'Suspended' ? t('versioning.statusSuspended')
    : t('versioning.statusUnversioned');

  const apply = async (enabled: boolean) => {
    try {
      await setVersioning.mutateAsync(enabled);
      show(enabled ? t('versioning.enabled') : t('versioning.suspended'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">{t('versioning.title')}</h2>

      {bucket === null && <p className="mt-4 text-slate-500 dark:text-slate-400">{t('versioning.selectBucket')}</p>}

      {bucket !== null && query.isLoading && <p className="mt-4 text-slate-500 dark:text-slate-400">{t('versioning.loading')}</p>}
      {bucket !== null && query.isError && <p className="mt-4 text-red-600 dark:text-red-400">{(query.error as Error).message}</p>}

      {bucket !== null && query.isSuccess && (
        <div className="mt-4 flex max-w-md flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{t('versioning.statusLabel')}</span>
            <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${
              isEnabled ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
              : status === 'Suspended' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
            }`}>{statusText}</span>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-400">{t('versioning.note')}</p>

          {isEnabled ? (
            <button
              type="button"
              disabled={setVersioning.isPending}
              className="self-start rounded border border-amber-300 dark:border-amber-800 px-3 py-1 text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 disabled:opacity-40"
              onClick={() => setConfirmSuspend(true)}
            >
              {t('versioning.suspend')}
            </button>
          ) : (
            <button
              type="button"
              disabled={setVersioning.isPending}
              className="self-start rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              onClick={() => void apply(true)}
            >
              {t('versioning.enable')}
            </button>
          )}
        </div>
      )}

      {confirmSuspend && (
        <ConfirmDialog
          message={t('versioning.suspendConfirm')}
          confirmLabel={t('versioning.suspendConfirmLabel')}
          onCancel={() => setConfirmSuspend(false)}
          onConfirm={async () => {
            setConfirmSuspend(false);
            await apply(false);
          }}
        />
      )}
    </div>
  );
}
