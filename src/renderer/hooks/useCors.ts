import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { CorsRule } from '../../main/s3/cors';

export function corsKey(accountId: string | null, bucket: string | null) {
  return ['cors', accountId, bucket] as const;
}

export function useCors(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null;
  const invalidate = () => qc.invalidateQueries({ queryKey: corsKey(accountId, bucket) });

  const query = useQuery({
    queryKey: corsKey(accountId, bucket),
    enabled,
    queryFn: async () => unwrap(await window.s3.getBucketCors({ accountId: accountId!, bucket: bucket! })),
  });

  const save = useMutation({
    mutationFn: async (rules: CorsRule[]) =>
      unwrap(await window.s3.putBucketCors({ accountId: accountId!, bucket: bucket!, rules })),
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: async () => unwrap(await window.s3.deleteBucketCors({ accountId: accountId!, bucket: bucket! })),
    onSuccess: invalidate,
  });

  return { query, save, clear };
}
