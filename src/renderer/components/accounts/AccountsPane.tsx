import { useState } from 'react';
import { useAccounts, useCreateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from './ProviderBadge';
import { AddAccountForm } from './AddAccountForm';

export function AccountsPane({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const removeAccount = useRemoveAccount();
  const [adding, setAdding] = useState(false);

  if (adding) {
    return (
      <div className="p-3">
        <h2 className="pb-2 font-medium">Add account</h2>
        <AddAccountForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await createAccount.mutateAsync(input);
            setAdding(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accounts</span>
        <button type="button" className="rounded px-2 py-0.5 text-sm hover:bg-slate-100" onClick={() => setAdding(true)}>
          + Add account
        </button>
      </div>

      {accounts.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {accounts.isError && <p className="p-3 text-red-600">{(accounts.error as Error).message}</p>}

      {accounts.isSuccess && accounts.data.length === 0 && (
        <div className="p-3 text-slate-500">
          <p className="font-medium text-slate-700">No accounts yet</p>
          <p className="mt-1 text-sm">Add an Amazon S3 or Hetzner account to get started.</p>
        </div>
      )}

      <ul className="flex-1 overflow-auto">
        {accounts.data?.map((acc) => (
          <li key={acc.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(acc.id)}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(acc.id)}
              className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 ${
                acc.id === selectedId ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <span className="flex flex-col">
                <span className="font-medium">{acc.label}</span>
                <ProviderBadge provider={acc.provider} />
              </span>
              <button
                type="button"
                aria-label={`Remove ${acc.label}`}
                className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAccount.mutate(acc.id);
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
