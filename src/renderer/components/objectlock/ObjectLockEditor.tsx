import { useEffect, useState } from 'react';
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
      <h2 className="pb-3 text-lg font-semibold">Object Lock</h2>

      {bucket === null && <p className="mt-4 text-slate-500 dark:text-slate-400">Select a bucket to view its Object Lock settings.</p>}

      {bucket !== null && lock.query.isLoading && <p className="mt-4 text-slate-500 dark:text-slate-400">Loading Object Lock…</p>}
      {bucket !== null && lock.query.isError && <p className="mt-4 text-red-600">{(lock.query.error as Error).message}</p>}

      {bucket !== null && lock.query.isSuccess && !lock.query.data.enabled && (
        <p className="mt-4 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-sm text-slate-600 dark:text-slate-400">
          Object Lock is not enabled on this bucket. It can only be enabled when a bucket is created.
        </p>
      )}

      {bucket !== null && lock.query.isSuccess && lock.query.data.enabled && (
        <div className="mt-4 flex max-w-md flex-col gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">Default retention applied to new objects:</p>

          <label className="block text-sm">
            Mode
            <select aria-label="Retention mode" className={`${fieldClass} mt-1 block`} value={mode} onChange={(e) => setMode(e.target.value as 'GOVERNANCE' | 'COMPLIANCE')}>
              <option value="GOVERNANCE">Governance</option>
              <option value="COMPLIANCE">Compliance</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="block text-sm">
              Period
              <input aria-label="Retention period" type="number" min="1" className={`${fieldClass} mt-1 block w-28`} value={period} onChange={(e) => setPeriod(e.target.value)} />
            </label>
            <label className="block text-sm">
              Unit
              <select aria-label="Period unit" className={`${fieldClass} mt-1 block`} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                <option value="days">Days</option>
                <option value="years">Years</option>
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
                  show('Object Lock saved');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              Save
            </button>
            <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmRemove(true)}>
              Remove default
            </button>
          </div>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          message="Remove the default retention from this bucket? Object Lock stays enabled."
          confirmLabel="Remove default retention"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={async () => {
            setConfirmRemove(false);
            try {
              await lock.clear.mutateAsync();
              show('Default retention removed');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
