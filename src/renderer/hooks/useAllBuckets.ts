import { useQueries } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { bucketsKey } from './useBuckets';
import type { Account } from '../../main/storage/accountsRepo';

export interface AccountBuckets {
  accountId: string;
  buckets: string[];
  isLoading: boolean;
  isError: boolean;
}

export function useAllBuckets(accounts: Account[]): AccountBuckets[] {
  const results = useQueries({
    queries: accounts.map((account) => ({
      queryKey: bucketsKey(account.id),
      queryFn: async () => unwrap(await window.s3.listBuckets(account.id)),
    })),
  });

  return accounts.map((account, i) => ({
    accountId: account.id,
    buckets: results[i]?.data ?? [],
    isLoading: results[i]?.isLoading ?? false,
    isError: results[i]?.isError ?? false,
  }));
}
