import { useTranslation } from 'react-i18next';
import { useAccounts } from '../../hooks/useAccounts';
import { useAllBuckets } from '../../hooks/useAllBuckets';
import { UI_PROVIDERS } from '../../lib/providers';
import { SummaryCards } from './SummaryCards';
import { AccountBreakdown, type BreakdownItem } from './AccountBreakdown';

export function Dashboard({
  onOpenAccount,
  onOpenBucket,
}: {
  onOpenAccount: (accountId: string) => void;
  onOpenBucket: (accountId: string, bucket: string) => void;
}) {
  const { t } = useTranslation();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];
  const perAccount = useAllBuckets(accounts);

  if (accountsQuery.isLoading) {
    return <div className="p-6 text-slate-500 dark:text-slate-400">{t('common.loading')}</div>;
  }
  if (accountsQuery.isError) {
    return <div className="p-6 text-red-600 dark:text-red-400">{(accountsQuery.error as Error).message}</div>;
  }
  if (accounts.length === 0) {
    return (
      <div className="p-6 text-slate-500 dark:text-slate-400">
        <p className="font-medium text-slate-700 dark:text-slate-200">{t('dashboard.emptyTitle')}</p>
        <p className="mt-1 text-sm">{t('dashboard.emptyHelp')}</p>
      </div>
    );
  }

  const items: BreakdownItem[] = accounts.map((account, i) => ({
    account,
    buckets: perAccount[i]?.buckets ?? [],
    isLoading: perAccount[i]?.isLoading ?? false,
    isError: perAccount[i]?.isError ?? false,
  }));

  const bucketCount = items.reduce((sum, it) => sum + it.buckets.length, 0);
  const providerAccountCounts = UI_PROVIDERS.map((p) => ({
    provider: p.id,
    count: accounts.filter((a) => a.provider === p.id).length,
  })).filter((pc) => pc.count > 0);

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">{t('dashboard.title')}</h2>
      <SummaryCards accountCount={accounts.length} bucketCount={bucketCount} providerAccountCounts={providerAccountCounts} />
      <AccountBreakdown items={items} onOpenAccount={onOpenAccount} onOpenBucket={onOpenBucket} />
    </div>
  );
}
