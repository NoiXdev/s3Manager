import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';

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
  const field = 'rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-2 py-1 text-sm';

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</h3>
      <select
        aria-label={t('sync.endpoint.accountAria', { label })}
        className={field}
        value={value.accountId ?? ''}
        onChange={(e) => onChange({ accountId: e.target.value || null, bucket: null, prefix: '' })}
      >
        <option value="">{t('sync.endpoint.selectAccount')}</option>
        {accounts.data?.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      <select
        aria-label={t('sync.endpoint.bucketAria', { label })}
        className={field}
        value={value.bucket ?? ''}
        disabled={value.accountId === null}
        onChange={(e) => onChange({ ...value, bucket: e.target.value || null, prefix: '' })}
      >
        <option value="">{t('sync.endpoint.selectBucket')}</option>
        {buckets.data?.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <input
        aria-label={t('sync.endpoint.prefixAria', { label })}
        className={field}
        placeholder={t('sync.endpoint.prefixPlaceholder')}
        value={value.prefix}
        onChange={(e) => onChange({ ...value, prefix: e.target.value })}
      />
    </div>
  );
}
