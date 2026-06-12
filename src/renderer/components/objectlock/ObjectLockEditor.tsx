import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useObjectLock } from '../../hooks/useObjectLock';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';

type Unit = 'days' | 'years';

export function ObjectLockEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const { t } = useTranslation();
  const lock = useObjectLock(accountId, bucket);
  const { show } = useToast();

  const [mode, setMode] = useState<'GOVERNANCE' | 'COMPLIANCE'>('GOVERNANCE');
  const [period, setPeriod] = useState('');
  const [unit, setUnit] = useState<Unit>('days');
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const dr = lock.query.data?.defaultRetention;
    if (!lock.query.data) return;
    if (dr) {
      setMode(dr.mode);
      if (dr.days !== null) {
        setPeriod(String(dr.days));
        setUnit('days');
      } else if (dr.years !== null) {
        setPeriod(String(dr.years));
        setUnit('years');
      }
    } else {
      setMode('GOVERNANCE');
      setPeriod('');
      setUnit('days');
    }
  }, [lock.query.data]);

  const periodNum = Number(period);
  const periodValid = period.trim() !== '' && Number.isInteger(periodNum) && periodNum > 0;

  const fieldClass = 'rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm';

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">{t('objectLock.title')}</h2>

      {bucket === null && <p className="mt-4 text-slate-500 dark:text-slate-400">{t('objectLock.selectBucket')}</p>}

      {bucket !== null && lock.query.isLoading && <p className="mt-4 text-slate-500 dark:text-slate-400">{t('objectLock.loading')}</p>}
      {bucket !== null && lock.query.isError && <p className="mt-4 text-red-600 dark:text-red-400">{(lock.query.error as Error).message}</p>}

      {bucket !== null && lock.query.isSuccess && !lock.query.data.enabled && (
        <p className="mt-4 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-sm text-slate-600 dark:text-slate-400">
          {t('objectLock.notEnabled')}
        </p>
      )}

      {bucket !== null && lock.query.isSuccess && lock.query.data.enabled && (
        <div className="mt-4 flex max-w-md flex-col gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">{t('objectLock.defaultRetention')}</p>

          <label className="block text-sm">
            {t('objectLock.mode')}
            <select aria-label={t('objectLock.modeAria')} className={`${fieldClass} mt-1 block`} value={mode} onChange={(e) => setMode(e.target.value as 'GOVERNANCE' | 'COMPLIANCE')}>
              <option value="GOVERNANCE">{t('objectLock.modeGovernance')}</option>
              <option value="COMPLIANCE">{t('objectLock.modeCompliance')}</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="block text-sm">
              {t('objectLock.period')}
              <input aria-label={t('objectLock.periodAria')} type="number" min="1" className={`${fieldClass} mt-1 block w-28`} value={period} onChange={(e) => setPeriod(e.target.value)} />
            </label>
            <label className="block text-sm">
              {t('objectLock.unit')}
              <select aria-label={t('objectLock.unitAria')} className={`${fieldClass} mt-1 block`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="days">{t('objectLock.unitDays')}</option>
                <option value="years">{t('objectLock.unitYears')}</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={!periodValid}
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
              onClick={async () => {
                try {
                  await lock.save.mutateAsync({
                    mode,
                    days: unit === 'days' ? periodNum : null,
                    years: unit === 'years' ? periodNum : null,
                  });
                  show(t('objectLock.saved'));
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              {t('common.save')}
            </button>
            <button type="button" className="rounded border border-red-300 dark:border-red-800 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50" onClick={() => setConfirmRemove(true)}>
              {t('objectLock.removeDefault')}
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message={t('objectLock.removeConfirm')}
          confirmLabel={t('objectLock.removeConfirmLabel')}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            try {
              await lock.clear.mutateAsync();
              show(t('objectLock.removed'));
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
