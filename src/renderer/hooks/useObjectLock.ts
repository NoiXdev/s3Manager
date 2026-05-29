import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { DefaultRetention } from '../../main/s3/objectLock';

export function objectLockKey(accountId: string | null, bucket: string | null) {
  return ['objectLock', accountId, bucket] as const;
}

export function useObjectLock(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null;
  const invalidate = () => qc.invalidateQueries({ queryKey: objectLockKey(accountId, bucket) });

  const query = useQuery({
    queryKey: objectLockKey(accountId, bucket),
    enabled,
    queryFn: async () => unwrap(await window.s3.getObjectLockConfig({ accountId: accountId!, bucket: bucket! })),
  });

  const save = useMutation({
    mutationFn: async (retention: DefaultRetention) =>
      unwrap(await window.s3.putObjectLockConfig({ accountId: accountId!, bucket: bucket!, retention })),
    onSuccess: invalidate,
  });

  const clear = useMutation({
    mutationFn: async () =>
      unwrap(await window.s3.putObjectLockConfig({ accountId: accountId!, bucket: bucket!, retention: null })),
    onSuccess: invalidate,
  });

  return { query, save, clear };
}
