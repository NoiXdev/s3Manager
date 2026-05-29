import { useState } from 'react';
import type { CreateAccountInput } from '../../../main/ipc/channels';
import { UI_PROVIDERS } from '../../lib/providers';
import { useTestConnection } from '../../hooks/useAccounts';

const fieldClass = 'mt-1 w-full rounded border border-slate-300 px-2 py-1';

export function AddAccountForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: CreateAccountInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState<CreateAccountInput['provider']>(UI_PROVIDERS[0].id);
  const [region, setRegion] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const test = useTestConnection();

  const input: CreateAccountInput = { label, provider, region, accessKeyId, secretAccessKey };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(input);
      }}
    >
      <label className="block">
        Label
        <input className={fieldClass} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <label className="block">
        Provider
        <select className={fieldClass} value={provider} onChange={(e) => setProvider(e.target.value as CreateAccountInput['provider'])}>
          {UI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
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
        <input type="password" className={fieldClass} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          disabled={test.isPending}
          onClick={() => test.mutate(input)}
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
          Add account
        </button>
      </div>
    </form>
  );
}
