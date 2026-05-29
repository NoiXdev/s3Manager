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
  const accounts = useAccounts();
  const buckets = useBuckets(value.accountId);
  const field = 'rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-slate-700">{label}</h3>
      <select
        aria-label={`${label} account`}
        className={field}
        value={value.accountId ?? ''}
        onChange={(e) => onChange({ accountId: e.target.value || null, bucket: null, prefix: '' })}
      >
        <option value="">Select account…</option>
        {accounts.data?.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      <select
        aria-label={`${label} bucket`}
        className={field}
        value={value.bucket ?? ''}
        disabled={value.accountId === null}
        onChange={(e) => onChange({ ...value, bucket: e.target.value || null, prefix: '' })}
      >
        <option value="">Select bucket…</option>
        {buckets.data?.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
      </select>
      <input
        aria-label={`${label} prefix`}
        className={field}
        placeholder="prefix/ (optional)"
        value={value.prefix}
        onChange={(e) => onChange({ ...value, prefix: e.target.value })}
      />
    </div>
  );
}
