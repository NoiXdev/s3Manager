import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { bucketsKey } from './useBuckets';

export interface CreateBucketArgs {
  bucket: string;
  objectLock: boolean;
  versioning: boolean;
}

export function useCreateBucket(accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: CreateBucketArgs) =>
      unwrap(await window.s3.createBucket({ accountId, ...args })),
    onSuccess: () => qc.invalidateQueries({ queryKey: bucketsKey(accountId) }),
  });
}
