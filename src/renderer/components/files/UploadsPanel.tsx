import { useTranslation } from 'react-i18next';
import type { UploadItem } from '../../hooks/useUploads';

function percent(item: UploadItem): number {
  if (item.status === 'done') return 100;
  if (!item.total || item.total === 0) return 0;
  return Math.min(100, Math.round((item.loaded / item.total) * 100));
}

export function UploadsPanel({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-2">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('files.uploads.heading')}</span>
        <button type="button" className="rounded px-2 text-xs hover:bg-slate-200 dark:hover:bg-slate-700" onClick={onClear}>
          {t('files.uploads.clearFinished')}
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate">{item.name}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
              <span
                className={`block h-full ${item.status === 'error' ? 'bg-red-500' : 'bg-slate-700 dark:bg-slate-300'}`}
                style={{ width: `${percent(item)}%` }}
              />
            </span>
            <span className="w-16 text-right text-slate-500 dark:text-slate-400">
              {item.status === 'error' ? t('files.uploads.error') : `${percent(item)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
