import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useExportAccounts } from '../../hooks/useAccountTransfer';
import { useToast } from '../ui/ToastProvider';

export function ExportAccountsDialog({ accountIds, onClose }: { accountIds: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const exportAccounts = useExportAccounts();
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const onGenerate = async () => {
    try {
      const blob = await exportAccounts.mutateAsync({ accountIds, password: password || undefined });
      setResult(blob);
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onCopy = async () => {
    if (result === null) return;
    await navigator.clipboard.writeText(result);
    show(t('transfer.copied'));
  };

  const onDownload = async () => {
    if (result === null) return;
    await window.s3.saveTextFile({ defaultName: 's3manager-accounts.txt', contents: result });
  };

  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('transfer.exportTitle')}</p>
          <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {result === null ? (
          <>
            <label className="block text-sm">
              {t('transfer.password')}
              <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {password.length === 0 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('transfer.noPasswordWarning')}</p>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={exportAccounts.isPending}
                className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
                onClick={onGenerate}
              >
                {t('transfer.generate')}
              </button>
            </div>
          </>
        ) : (
          <>
            <textarea
              aria-label={t('transfer.resultAria')}
              readOnly
              value={result}
              className="mt-3 h-28 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onCopy}>
                {t('transfer.copy')}
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onDownload}>
                {t('transfer.download')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
