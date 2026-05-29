import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function bucketsKey(accountId: string | null) {
  return ['buckets', accountId] as const;
}

export function useBuckets(accountId: string | null) {
  return useQuery({
    queryKey: bucketsKey(accountId),
    queryFn: async () => unwrap(await window.s3.listBuckets(accountId!)),
    enabled: accountId !== null,
  });
}
