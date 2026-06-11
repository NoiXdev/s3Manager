import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectRetention } from '../../hooks/useObjectRetention';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { formatTimestamp } from '../../lib/format';

/** Tomorrow as a 'YYYY-MM-DD' string (UTC). */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function RetentionSection({
  accountId,
  bucket,
  objectKey,
}: {
  accountId: string;
  bucket: string;
  objectKey: string;
}) {
  const { t } = useTranslation();
  const { retention, legalHold, setRetention, setLegalHold } = useObjectRetention(accountId, bucket, objectKey);
  const { show } = useToast();
  const [date, setDate] = useState('');
  const [confirming, setConfirming] = useState(false);

  const ret = retention.data;
  const isCompliance = ret?.mode === 'COMPLIANCE';
  const currentUntilDay = ret?.retainUntil ? ret.retainUntil.slice(0, 10) : null;
  const minDate = currentUntilDay && currentUntilDay > tomorrow() ? currentUntilDay : tomorrow();
  const canApply = date !== '' && date >= minDate && !setRetention.isPending;

  const retentionLabel = retention.isSuccess
    ? ret && ret.mode
      ? t('files.retention.retentionUntil', { mode: ret.mode, date: formatTimestamp(ret.retainUntil) })
      : t('files.retention.none')
    : retention.isError
      ? t('files.retention.unavailable')
      : '…';
  const holdLabel = legalHold.isSuccess
    ? legalHold.data === 'ON'
      ? t('files.retention.holdOn')
      : t('files.retention.holdOff')
    : legalHold.isError
      ? t('files.retention.unavailable')
      : '…';

  const applyRetention = async () => {
    setConfirming(false);
    try {
      await setRetention.mutateAsync({ retainUntil: `${date}T00:00:00.000Z` });
      show(t('files.retention.retentionUpdated'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const toggleHold = async () => {
    const next = legalHold.data === 'ON' ? 'OFF' : 'ON';
    try {
      await setLegalHold.mutateAsync(next);
      show(next === 'ON' ? t('files.retention.holdOnToast') : t('files.retention.holdOffToast'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 dark:border-slate-800 py-2">
      <span className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{t('files.retention.heading')}</span>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500 dark:text-slate-400">{t('files.retention.retentionLabel')} <span className="text-slate-700 dark:text-slate-200">{retentionLabel}</span></span>
        {retention.isSuccess && !isCompliance && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label={t('files.retention.retainUntilAria')}
              min={minDate}
              className="rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-0.5 text-xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              disabled={!canApply}
              className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              onClick={() => setConfirming(true)}
            >
              {t('files.retention.apply')}
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-400">{t('files.retention.legalHoldLabel')} <span className="text-slate-700 dark:text-slate-200">{holdLabel}</span></span>
        {legalHold.isSuccess && (
          <button
            type="button"
            disabled={setLegalHold.isPending}
            className="rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
            onClick={toggleHold}
          >
            {legalHold.data === 'ON' ? t('files.retention.turnOffHold') : t('files.retention.turnOnHold')}
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={t('files.retention.lockConfirm', { date })}
          confirmLabel={t('files.retention.applyRetention')}
          onCancel={() => setConfirming(false)}
          onConfirm={applyRetention}
        />
      )}
    </div>
  );
}
