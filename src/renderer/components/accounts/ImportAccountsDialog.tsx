import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { useImportAccounts, useImportPreview } from '../../hooks/useAccountTransfer';
import { useToast } from '../ui/ToastProvider';
import { humanErrorMessage, errorCode } from '../../lib/result';
import { UI_PROVIDERS } from '../../lib/providers';
import type { ImportPreview } from '../../../main/accounts/accountTransfer';

// TransferError codes → their localized message keys.
const CODE_KEYS: Record<string, string> = {
  IncorrectPassword: 'transfer.incorrectPassword',
  InvalidData: 'transfer.invalidData',
};

function providerLabel(provider: string): string {
  return UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function ImportAccountsDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const importAccounts = useImportAccounts();
  const importPreview = useImportPreview();
  const [blob, setBlob] = useState('');
  const [password, setPassword] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // Background, debounced preview whenever the blob or password changes.
  useEffect(() => {
    if (blob.trim().length === 0) {
      setPreview(null);
      setPreviewError(null);
      setEncrypted(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    const id = ++reqId.current;
    const handle = setTimeout(() => {
      importPreview
        .mutateAsync({ blob, password: password || undefined })
        .then((data) => {
          if (id !== reqId.current) return;
          setEncrypted(data.encrypted);
          setPreview(data);
          setPreviewError(null);
        })
        .catch((e) => {
          if (id !== reqId.current) return;
          const code = errorCode(e);
          if (code === 'IncorrectPassword') setEncrypted(true);
          else if (code === 'InvalidData') setEncrypted(false);
          setPreview(null);
          const key = CODE_KEYS[code ?? ''];
          setPreviewError(key ? t(key) : humanErrorMessage(e));
        })
        .finally(() => {
          if (id === reqId.current) setChecking(false);
        });
    }, 350);
    return () => clearTimeout(handle);
    // importPreview.mutateAsync and t are stable; intentionally keyed on blob+password.
  }, [blob, password]);

  const onLoadFile = async () => {
    const text = await window.s3.openTextFile();
    if (text.ok && text.data !== null) setBlob(text.data);
  };

  const onImport = async () => {
    setError(null);
    try {
      const created = await importAccounts.mutateAsync({ blob, password: password || undefined });
      show(t('transfer.imported', { count: created.length }));
      onImported();
      onClose();
    } catch (e) {
      const key = CODE_KEYS[errorCode(e) ?? ''];
      setError(key ? t(key) : humanErrorMessage(e));
    }
  };

  const accounts = preview?.accounts ?? null;
  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] max-w-[90vw] rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('transfer.importTitle')}</p>
          <button type="button" aria-label={t('common.close')} className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <textarea
          aria-label={t('transfer.pasteAria')}
          placeholder={t('transfer.pastePlaceholder')}
          value={blob}
          onChange={(e) => setBlob(e.target.value)}
          className="h-24 w-full resize-none rounded border border-slate-300 p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="mt-2">
          <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={onLoadFile}>
            {t('transfer.loadFile')}
          </button>
        </div>

        {encrypted && (
          <label className="mt-3 block text-sm">
            {t('transfer.importPassword')}
            <input type="password" className={field} value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}

        <div className="mt-3 text-sm" aria-live="polite">
          {checking && <span className="text-slate-500 dark:text-slate-400">{t('transfer.checking')}</span>}
          {!checking && previewError !== null && <span className="text-red-600 dark:text-red-400">{previewError}</span>}
          {!checking && previewError === null && encrypted && accounts === null && (
            <span className="text-slate-500 dark:text-slate-400">{t('transfer.encryptedHint')}</span>
          )}
          {!checking && accounts !== null && (
            <div>
              <p className="text-slate-700 dark:text-slate-200">{t('transfer.previewCount', { count: accounts.length })}</p>
              <ul className="mt-1 max-h-32 overflow-auto text-slate-600 dark:text-slate-300">
                {accounts.map((a, i) => (
                  <li key={i}>{a.label} ({providerLabel(a.provider)})</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {error !== null && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={accounts === null || importAccounts.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900"
            onClick={onImport}
          >
            {t('transfer.import')}
          </button>
        </div>
      </div>
    </div>
  );
}
