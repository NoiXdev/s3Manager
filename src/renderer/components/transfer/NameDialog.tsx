import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';

export function NameDialog({
  title,
  initialValue,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const valid = trimmed !== '' && !trimmed.includes('/');

  return (
    <Modal onDismiss={onCancel} className="w-80 rounded bg-white p-4 shadow-lg dark:bg-slate-900">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(trimmed);
        }}
      >
        <p className="pb-2 text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
        <label className="block text-sm">
          {t('transfer.name')}
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
