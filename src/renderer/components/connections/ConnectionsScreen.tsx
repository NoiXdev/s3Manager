import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiTrash2, FiEdit2, FiUpload, FiDownload } from 'react-icons/fi';
import { useAccounts, useCreateAccount, useUpdateAccount, useRemoveAccount } from '../../hooks/useAccounts';
import { ProviderBadge } from '../accounts/ProviderBadge';
import { AccountForm } from '../accounts/AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';
import { ExportAccountsDialog } from '../accounts/ExportAccountsDialog';
import { ImportAccountsDialog } from '../accounts/ImportAccountsDialog';

// null = list view; 'new' = add form; Account = edit form for that account
type Editing = null | 'new' | Account;

export function ConnectionsScreen({ onAccountRemoved }: { onAccountRemoved?: (id: string) => void } = {}) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const removeAccount = useRemoveAccount();
  const [editing, setEditing] = useState<Editing>(null);

  // null = closed; export those ids; or the import dialog
  const [transfer, setTransfer] = useState<null | { kind: 'export'; ids: string[] } | { kind: 'import' }>(null);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="flex items-center justify-between pb-3">
        <h2 className="text-lg font-semibold">{t('connections.title')}</h2>
        {editing === null && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => setTransfer({ kind: 'import' })}
            >
              <FiDownload className="h-4 w-4" aria-hidden />
              {t('transfer.importAccounts')}
            </button>
            <button
              type="button"
              disabled={!accounts.data || accounts.data.length === 0}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              onClick={() => setTransfer({ kind: 'export', ids: (accounts.data ?? []).map((a) => a.id) })}
            >
              <FiUpload className="h-4 w-4" aria-hidden />
              {t('transfer.exportAll')}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              onClick={() => setEditing('new')}
            >
              {t('connections.addAccount')}
            </button>
          </div>
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
          {accounts.isLoading && <p className="text-slate-500 dark:text-slate-400">{t('common.loading')}</p>}
          {accounts.isError && <p className="text-red-600 dark:text-red-400">{(accounts.error as Error).message}</p>}

          {accounts.isSuccess && accounts.data.length === 0 && (
            <div className="text-slate-500 dark:text-slate-400">
              <p className="font-medium text-slate-700 dark:text-slate-200">{t('connections.emptyTitle')}</p>
              <p className="mt-1 text-sm">{t('connections.emptyHelp')}</p>
            </div>
          )}

          <ul className="max-w-md divide-y divide-slate-100 dark:divide-slate-800">
            {accounts.data?.map((acc) => (
              <li key={acc.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-col">
                  <span className="font-medium">{acc.label}</span>
                  <ProviderBadge provider={acc.provider} />
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={t('transfer.exportAria', { label: acc.label })}
                    className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => setTransfer({ kind: 'export', ids: [acc.id] })}
                  >
                    <FiUpload className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('connections.editAria', { label: acc.label })}
                    className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200"
                    onClick={() => setEditing(acc)}
                  >
                    <FiEdit2 className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('connections.removeAria', { label: acc.label })}
                    className="rounded px-1 text-slate-400 dark:text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/50 hover:text-red-600 dark:hover:text-red-400"
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

      {transfer?.kind === 'export' && (
        <ExportAccountsDialog accountIds={transfer.ids} onClose={() => setTransfer(null)} />
      )}
      {transfer?.kind === 'import' && (
        <ImportAccountsDialog onClose={() => setTransfer(null)} onImported={() => undefined} />
      )}
    </div>
  );
}
