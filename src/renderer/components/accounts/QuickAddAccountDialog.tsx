import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useCreateAccount } from '../../hooks/useAccounts';
import { useToast } from '../ui/ToastProvider';
import { AccountForm } from './AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';
import type { CreateAccountInput } from '../../../main/ipc/channels';

export function QuickAddAccountDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (account: Account) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateAccount();
  const { show } = useToast();

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-96 overflow-auto rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('accounts.quickAddTitle')}</p>
          <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <AccountForm
          onCancel={onClose}
          onSubmit={async (input) => {
            try {
              const account = await create.mutateAsync(input as CreateAccountInput);
              onCreated(account);
              onClose();
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      </div>
    </div>
  );
}
