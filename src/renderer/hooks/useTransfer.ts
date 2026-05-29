import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useTransfer(accountId: string, bucket: string) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });

  const createFolder = useMutation({
    mutationFn: async (a: { prefix: string; name: string }) =>
      unwrap(await window.s3.createFolder({ accountId, bucket, prefix: a.prefix, name: a.name })),
    onSuccess: invalidate,
  });

  const moveObject = useMutation({
    mutationFn: async (a: { sourceKey: string; destKey: string }) =>
      unwrap(await window.s3.moveObject({ accountId, bucket, sourceKey: a.sourceKey, destKey: a.destKey })),
    onSuccess: invalidate,
  });

  const moveFolder = useMutation({
    mutationFn: async (a: { sourcePrefix: string; destPrefix: string }) =>
      unwrap(await window.s3.moveFolder({ accountId, bucket, sourcePrefix: a.sourcePrefix, destPrefix: a.destPrefix })),
    onSuccess: invalidate,
  });

  return { createFolder, moveObject, moveFolder };
}
