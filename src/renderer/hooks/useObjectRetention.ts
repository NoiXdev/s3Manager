import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { ObjectRetention, LegalHoldStatus } from '../../main/s3/objectRetention';

export function useObjectRetention(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const retentionKey = ['objectRetention', accountId, bucket, key] as const;
  const legalHoldKey = ['objectLegalHold', accountId, bucket, key] as const;

  const retention = useQuery({
    queryKey: retentionKey,
    enabled,
    queryFn: async (): Promise<ObjectRetention> =>
      unwrap(await window.s3.getObjectRetention({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const legalHold = useQuery({
    queryKey: legalHoldKey,
    enabled,
    queryFn: async (): Promise<LegalHoldStatus> =>
      unwrap(await window.s3.getObjectLegalHold({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const setRetention = useMutation({
    mutationFn: async (v: { retainUntil: string }) =>
      unwrap(await window.s3.putObjectRetention({ accountId: accountId!, bucket: bucket!, key: key!, retainUntil: v.retainUntil })),
    onSuccess: () => qc.invalidateQueries({ queryKey: retentionKey }),
  });

  const setLegalHold = useMutation({
    mutationFn: async (status: LegalHoldStatus) =>
      unwrap(await window.s3.putObjectLegalHold({ accountId: accountId!, bucket: bucket!, key: key!, status })),
    onSuccess: () => qc.invalidateQueries({ queryKey: legalHoldKey }),
  });

  return { retention, legalHold, setRetention, setLegalHold };
}
