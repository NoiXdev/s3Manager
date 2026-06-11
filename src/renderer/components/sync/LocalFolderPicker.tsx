import { useTranslation } from 'react-i18next';
import { unwrap } from '../../lib/result';

export function LocalFolderPicker({
  path,
  onPick,
}: {
  path: string | null;
  onPick: (p: string) => void;
}) {
  const { t } = useTranslation();
  const choose = async () => {
    const picked = unwrap(await window.s3.selectSyncDirectory());
    if (picked) onPick(picked);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="rounded border border-slate-300 dark:border-slate-700 px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
        onClick={choose}
      >
        {t('sync.folder.choose')}
      </button>
      <span className="truncate text-sm text-slate-600 dark:text-slate-400">{path ?? t('sync.folder.none')}</span>
    </div>
  );
}
