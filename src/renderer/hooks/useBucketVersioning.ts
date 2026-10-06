import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function bucketVersioningKey(accountId: string | null, bucket: string | null) {
  return ['bucketVersioning', accountId, bucket] as const;
}

export function useBucketVersioning(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null;
  const invalidate = () => qc.invalidateQueries({ queryKey: bucketVersioningKey(accountId, bucket) });

  const query = useQuery({
    queryKey: bucketVersioningKey(accountId, bucket),
    enabled,
    queryFn: async () => unwrap(await window.s3.getBucketVersioning({ accountId: accountId!, bucket: bucket! })),
  });

  const setVersioning = useMutation({
    mutationFn: async (nextEnabled: boolean) =>
      unwrap(await window.s3.putBucketVersioning({ accountId: accountId!, bucket: bucket!, enabled: nextEnabled })),
    onSuccess: invalidate,
  });

  return { query, setVersioning };
}
