import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { ObjectAcl } from '../../main/s3/objectAcl';

export function useObjectAcl(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const aclKey = ['objectAcl', accountId, bucket, key] as const;

  const acl = useQuery({
    queryKey: aclKey,
    enabled,
    queryFn: async (): Promise<ObjectAcl> =>
      unwrap(await window.s3.getObjectAcl({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const save = useMutation({
    mutationFn: async (next: ObjectAcl) =>
      unwrap(await window.s3.putObjectAcl({ accountId: accountId!, bucket: bucket!, key: key!, acl: next })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aclKey });
      qc.invalidateQueries({ queryKey: ['objectVisibility', accountId, bucket, key] });
    },
  });

  return { acl, save };
}
