import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useObjectDetails(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;

  const metadata = useQuery({
    queryKey: ['objectMetadata', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.headObject({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const visibility = useQuery({
    queryKey: ['objectVisibility', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.objectVisibility({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const setVisibility = useMutation({
    mutationFn: async (v: 'public' | 'private') =>
      unwrap(await window.s3.setObjectVisibility({ accountId: accountId!, bucket: bucket!, key: key!, visibility: v })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectVisibility', accountId, bucket, key] }),
  });

  return { metadata, visibility, setVisibility };
}
