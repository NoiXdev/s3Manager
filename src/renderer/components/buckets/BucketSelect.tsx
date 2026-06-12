import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBuckets } from '../../hooks/useBuckets';
import { CreateBucketDialog } from './CreateBucketDialog';

export function BucketSelect({
  accountId,
  selectedBucket,
  onSelect,
}: {
  accountId: string | null;
  selectedBucket: string | null;
  onSelect: (bucket: string) => void;
}) {
  const { t } = useTranslation();
  const buckets = useBuckets(accountId);
  const [creating, setCreating] = useState(false);

  const placeholder =
    accountId === null
      ? t('buckets.selectAccountFirst')
      : buckets.isLoading
        ? t('common.loading')
        : t('buckets.selectBucket');

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={t('buckets.ariaBucket')}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
        value={selectedBucket ?? ''}
        disabled={accountId === null}
        onChange={(e) => {
          if (e.target.value) onSelect(e.target.value);
        }}
      >
        <option value="">{placeholder}</option>
        {(buckets.data ?? []).map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      {accountId !== null && (
        <button
          type="button"
          aria-label={t('buckets.createAria')}
          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          onClick={() => setCreating(true)}
        >
          +
        </button>
      )}
      {creating && accountId !== null && (
        <CreateBucketDialog
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            onSelect(name);
          }}
        />
      )}
    </div>
  );
}
