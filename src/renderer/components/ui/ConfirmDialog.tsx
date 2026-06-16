import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';

export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal onDismiss={onCancel} className="w-80 rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <p className="text-sm text-slate-800 dark:text-slate-100">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
    </Modal>
  );
}
