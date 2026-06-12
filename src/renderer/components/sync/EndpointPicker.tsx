import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';
import { Combobox } from '../ui/Combobox';

export interface EndpointValue {
  accountId: string | null;
  bucket: string | null;
  prefix: string;
}

export function EndpointPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: EndpointValue;
  onChange: (v: EndpointValue) => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const buckets = useBuckets(value.accountId);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</h3>
      <Combobox
        items={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.label }))}
        value={value.accountId}
        onSelect={(accountId) => {
          if (accountId !== value.accountId) onChange({ accountId, bucket: null, prefix: '' });
        }}
        placeholder={t('sync.endpoint.selectAccount')}
        ariaLabel={t('sync.endpoint.accountAria', { label })}
        loading={accounts.isLoading}
      />
      <Combobox
        items={(buckets.data ?? []).map((b) => ({ value: b, label: b }))}
        value={value.bucket}
        onSelect={(bucket) => {
          if (bucket !== value.bucket) onChange({ ...value, bucket, prefix: '' });
        }}
        placeholder={t('sync.endpoint.selectBucket')}
        ariaLabel={t('sync.endpoint.bucketAria', { label })}
        disabled={value.accountId === null}
        loading={buckets.isLoading && value.accountId !== null}
      />
      <input
        aria-label={t('sync.endpoint.prefixAria', { label })}
        className="rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm"
        placeholder={t('sync.endpoint.prefixPlaceholder')}
        value={value.prefix}
        onChange={(e) => onChange({ ...value, prefix: e.target.value })}
      />
    </div>
  );
}
