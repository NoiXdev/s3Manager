import type { Account } from '../../../main/storage/accountsRepo';
import { ProviderBadge } from '../accounts/ProviderBadge';

export interface BreakdownItem {
  account: Account;
  buckets: string[];
  isLoading: boolean;
  isError: boolean;
}

export function AccountBreakdown({
  items,
  onOpenAccount,
  onOpenBucket,
}: {
  items: BreakdownItem[];
  onOpenAccount: (accountId: string) => void;
  onOpenBucket: (accountId: string, bucket: string) => void;
}) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {items.map(({ account, buckets, isLoading, isError }) => (
        <li key={account.id} className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
          <button
            type="button"
            aria-label={`Open account ${account.label}`}
            onClick={() => onOpenAccount(account.id)}
            className="flex items-center gap-2 text-left"
          >
            <span className="font-medium">{account.label}</span>
            <ProviderBadge provider={account.provider} />
            {!isLoading && !isError && (
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {buckets.length} bucket{buckets.length === 1 ? '' : 's'}
              </span>
            )}
          </button>

          {isLoading && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Loading buckets…</p>}
          {isError && <p className="mt-2 text-sm text-red-600">{"Couldn't load buckets"}</p>}

          {!isLoading && !isError && buckets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {buckets.map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  onClick={() => onOpenBucket(account.id, bucket)}
                  className="rounded bg-slate-100 dark:bg-slate-800 px-2 py-1 text-xs hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  {bucket}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
