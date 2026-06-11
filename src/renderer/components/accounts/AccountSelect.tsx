import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';
import { UI_PROVIDERS } from '../../lib/providers';
import type { ProviderId } from '../../../main/s3/providers';

function providerLabel(provider: ProviderId): string {
  return UI_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function AccountSelect({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccounts();
  const list = accounts.data ?? [];

  return (
    <select
      aria-label={t('accounts.ariaAccount')}
      className="w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
      value={selectedId ?? ''}
      onChange={(e) => {
        if (e.target.value) onSelect(e.target.value);
      }}
    >
      <option value="">{accounts.isLoading ? t('common.loading') : t('accounts.select')}</option>
      {list.map((a) => (
        <option key={a.id} value={a.id}>
          {t('accounts.optionLabel', { label: a.label, provider: providerLabel(a.provider) })}
        </option>
      ))}
    </select>
  );
}
