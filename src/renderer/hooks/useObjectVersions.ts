import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function objectVersionsKey(accountId: string | null, bucket: string | null, objectKey: string | null) {
  return ['objectVersions', accountId, bucket, objectKey] as const;
}

export function useObjectVersions(accountId: string | null, bucket: string | null, objectKey: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && objectKey !== null;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: objectVersionsKey(accountId, bucket, objectKey) });
    void qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });
  };

  const query = useQuery({
    queryKey: objectVersionsKey(accountId, bucket, objectKey),
    enabled,
    queryFn: async () => unwrap(await window.s3.listObjectVersions({ accountId: accountId!, bucket: bucket!, key: objectKey! })),
  });

  const restore = useMutation({
    mutationFn: async (versionId: string) =>
      unwrap(await window.s3.restoreObjectVersion({ accountId: accountId!, bucket: bucket!, key: objectKey!, versionId })),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (versionId: string) =>
      unwrap(await window.s3.deleteObjectVersion({ accountId: accountId!, bucket: bucket!, key: objectKey!, versionId })),
    onSuccess: invalidate,
  });
  const removeMarker = useMutation({
    mutationFn: async (versionId: string) =>
      unwrap(await window.s3.removeDeleteMarker({ accountId: accountId!, bucket: bucket!, key: objectKey!, versionId })),
    onSuccess: invalidate,
  });

  return { query, restore, remove, removeMarker };
}
