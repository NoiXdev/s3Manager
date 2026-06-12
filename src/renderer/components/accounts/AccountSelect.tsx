import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';
import { UI_PROVIDERS } from '../../lib/providers';
import { Combobox } from '../ui/Combobox';
import { QuickAddAccountDialog } from './QuickAddAccountDialog';
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
  const [adding, setAdding] = useState(false);

  const items = (accounts.data ?? []).map((a) => ({
    value: a.id,
    label: t('accounts.optionLabel', { label: a.label, provider: providerLabel(a.provider) }),
  }));

  return (
    <>
      <Combobox
        items={items}
        value={selectedId}
        onSelect={onSelect}
        placeholder={accounts.isLoading ? t('common.loading') : t('accounts.select')}
        ariaLabel={t('accounts.ariaAccount')}
        loading={accounts.isLoading}
        footerAction={{ label: t('accounts.quickAdd'), onClick: () => setAdding(true) }}
      />
      {adding && (
        <QuickAddAccountDialog
          onClose={() => setAdding(false)}
          onCreated={(account) => onSelect(account.id)}
        />
      )}
    </>
  );
}
