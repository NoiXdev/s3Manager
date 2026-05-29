import { useState } from 'react';
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
      ? `${ret.mode} until ${formatTimestamp(ret.retainUntil)}`
      : 'None'
    : retention.isError
      ? 'unavailable'
      : '…';
  const holdLabel = legalHold.isSuccess
    ? legalHold.data === 'ON'
      ? 'On'
      : 'Off'
    : legalHold.isError
      ? 'unavailable'
      : '…';

  const applyRetention = async () => {
    setConfirming(false);
    try {
      await setRetention.mutateAsync({ retainUntil: `${date}T00:00:00.000Z` });
      show('Retention updated');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const toggleHold = async () => {
    const next = legalHold.data === 'ON' ? 'OFF' : 'ON';
    try {
      await setLegalHold.mutateAsync(next);
      show(next === 'ON' ? 'Legal hold on' : 'Legal hold off');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 py-2">
      <span className="text-xs uppercase tracking-wide text-slate-400">Retention &amp; legal hold</span>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-500">Retention: <span className="text-slate-700">{retentionLabel}</span></span>
        {retention.isSuccess && !isCompliance && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Retain until"
              min={minDate}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button
              type="button"
              disabled={!canApply}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
              onClick={() => setConfirming(true)}
            >
              Apply
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">Legal hold: <span className="text-slate-700">{holdLabel}</span></span>
        {legalHold.isSuccess && (
          <button
            type="button"
            disabled={setLegalHold.isPending}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
            onClick={toggleHold}
          >
            {legalHold.data === 'ON' ? 'Turn off legal hold' : 'Turn on legal hold'}
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={`Lock this object from deletion until ${date}? You won't be able to shorten this here.`}
          confirmLabel="Apply retention"
          onCancel={() => setConfirming(false)}
          onConfirm={applyRetention}
        />
      )}
    </div>
  );
}
