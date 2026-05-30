import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { EditableMetadata } from '../../main/s3/objectMetadata';

export function useObjectMetadataEditor(accountId: string | null, bucket: string | null, key: string | null) {
  const qc = useQueryClient();
  const enabled = accountId !== null && bucket !== null && key !== null;
  const editableKey = ['editableMetadata', accountId, bucket, key] as const;

  const editable = useQuery({
    queryKey: editableKey,
    enabled,
    queryFn: async (): Promise<EditableMetadata> =>
      unwrap(await window.s3.getEditableMetadata({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const update = useMutation({
    mutationFn: async (v: EditableMetadata) =>
      unwrap(await window.s3.updateObjectMetadata({ accountId: accountId!, bucket: bucket!, key: key!, ...v })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: editableKey });
      qc.invalidateQueries({ queryKey: ['objectMetadata', accountId, bucket, key] });
    },
  });

  return { editable, update };
}
