import { useTranslation } from 'react-i18next';
import { useSyncRun } from './SyncRunProvider';

export function SyncStatus({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const { running, progress } = useSyncRun();
  if (!running) return null;

  const label =
    progress?.phase === 'copying'
      ? t('sync.status.syncing', { copied: progress.copied, total: progress.total })
      : t('sync.status.listing');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
      {label}
    </button>
  );
}
