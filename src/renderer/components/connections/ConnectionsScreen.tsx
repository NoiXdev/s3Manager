import { useState } from 'react';
import { FiTrash2, FiEdit2 } from 'react-icons/fi';
import { useAccounts, useCreateAccount, useUpdateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from '../accounts/ProviderBadge';
import { AccountForm } from '../accounts/AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';

// null = list view; 'new' = add form; Account = edit form for that account
type Editing = null | 'new' | Account;

export function ConnectionsScreen({ onAccountRemoved }: { onAccountRemoved?: (id: string) => void } = {}) {
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">Connections</h2>
        {editing === null && (
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            onClick={() => setEditing('new')}
          >
            + Add account
          </button>
        )}
      </div>

      {editing !== null ? (
        <div className="max-w-md">
          <AccountForm
            key={editing === 'new' ? 'new' : editing.id}
            account={editing === 'new' ? undefined : editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => {
              if ('id' in input) {
                await updateAccount.mutateAsync(input);
              } else {
                await createAccount.mutateAsync(input);
              }
              setEditing(null);
            }}
          />
        </div>
      ) : (
        <>
          {accounts.isLoading && <p className="text-slate-500">Loading…</p>}
          {accounts.isError && <p className="text-red-600">{(accounts.error as Error).message}</p>}

          {accounts.isSuccess && accounts.data.length === 0 && (
            <div className="text-slate-500">
              <p className="font-medium text-slate-700">No accounts yet</p>
              <p className="mt-1 text-sm">Add an Amazon S3 or Hetzner account to get started.</p>
            </div>
          )}

          <ul className="max-w-md divide-y divide-slate-100">
            {accounts.data?.map((acc) => (
              <li key={acc.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{acc.label}</span>
                  <ProviderBadge provider={acc.provider} />
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Edit ${acc.label}`}
                    className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setEditing(acc)}
                  >
                    <FiEdit2 className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${acc.label}`}
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() =>
                      removeAccount.mutate(acc.id, {
                        onSuccess: () => onAccountRemoved?.(acc.id),
                      })
                    }
                  >
                    <FiTrash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
