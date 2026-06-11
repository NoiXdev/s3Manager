import { useState } from 'react';
import type { CreateAccountInput, UpdateAccountInput, TestAccountInput } from '../../../main/ipc/channels';
import type { Account } from '../../../main/storage/accountsRepo';
import { UI_PROVIDERS } from '../../lib/providers';
import { useTestConnection } from '../../hooks/useAccounts';

const fieldClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1';

export function AccountForm({
  account,
  onSubmit,
  onCancel,
}: {
  account?: Account;
  onSubmit: (input: CreateAccountInput | UpdateAccountInput) => Promise<void>;
  onCancel: () => void;
}) {
  const isEdit = account !== undefined;
  const [label, setLabel] = useState(account?.label ?? '');
  const [provider, setProvider] = useState<CreateAccountInput['provider']>(
    account?.provider ?? UI_PROVIDERS[0].id,
  );
  const [region, setRegion] = useState(account?.region ?? '');
  const [accessKeyId, setAccessKeyId] = useState(account?.accessKeyId ?? '');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [endpoint, setEndpoint] = useState(account?.endpoint ?? '');
  const [forcePathStyle, setForcePathStyle] = useState(account?.forcePathStyle ?? true);
  const test = useTestConnection();

  const custom = provider === 'custom';
  const customFields = custom ? { endpoint, forcePathStyle } : {};
  const hasSecret = secretAccessKey.trim() !== '';

  const submitInput: CreateAccountInput | UpdateAccountInput = isEdit
    ? {
        id: account!.id,
        label,
        provider,
        region,
        accessKeyId,
        ...(hasSecret ? { secretAccessKey } : {}),
        ...customFields,
      }
    : {
        label,
        provider,
        region,
        accessKeyId,
        secretAccessKey,
        ...customFields,
      };

  const testInput: TestAccountInput = {
    ...(isEdit ? { id: account!.id } : {}),
    label,
    provider,
    region,
    accessKeyId,
    ...(hasSecret ? { secretAccessKey } : {}),
    ...customFields,
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(submitInput);
      }}
    >
      <label className="block">
        Label
        <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="block">
        Provider
        <select
          className={fieldClass}
          value={provider}
          onChange={(e) => {
            const next = e.target.value as CreateAccountInput['provider'];
            setProvider(next);
            if (next === 'custom' && region.trim() === '') setRegion('us-east-1');
          }}
        >
          {UI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {custom && (
        <>
          <label className="block">
            Endpoint URL
            <input
              className={fieldClass}
              placeholder="https://minio.example.com:9000"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={forcePathStyle}
              onChange={(e) => setForcePathStyle(e.target.checked)}
            />
            Path-style addressing
          </label>
        </>
      )}
      <label className="block">
        Region
        <input className={fieldClass} value={region} onChange={(e) => setRegion(e.target.value)} />
      </label>
      <label className="block">
        Access key ID
        <input className={fieldClass} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
      </label>
      <label className="block">
        Secret access key
        <input
          type="password"
          className={fieldClass}
          placeholder={isEdit ? '••••• (unchanged)' : ''}
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          disabled={test.isPending}
          onClick={() => test.mutate(testInput)}
        >
          Test connection
        </button>
        {test.isSuccess && <span className="text-sm text-green-600">Connection OK</span>}
        {test.isError && <span className="text-sm text-red-600">{(test.error as Error).message}</span>}
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="rounded px-3 py-1 hover:bg-slate-100" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="rounded bg-slate-800 px-3 py-1 text-white hover:bg-slate-700">
          {isEdit ? 'Save changes' : 'Add account'}
        </button>
      </div>
    </form>
  );
}
