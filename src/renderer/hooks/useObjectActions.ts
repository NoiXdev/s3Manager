import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/ui/ToastProvider';

export function useObjectActions(accountId: string, bucket: string) {
  const qc = useQueryClient();
  const { show } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });

  return {
    async download(key: string) {
      const r = await window.s3.downloadObject({ accountId, bucket, key });
      if (!r.ok) show(`${r.error.code}: ${r.error.message}`, 'error');
      else if (r.data.path) show('Download complete');
    },
    async copyPresignedUrl(key: string) {
      const r = await window.s3.presignGet({ accountId, bucket, key, expiresIn: 3600 });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      await navigator.clipboard.writeText(r.data);
      show('Signed URL copied');
    },
    async deleteObject(key: string) {
      const r = await window.s3.deleteObject({ accountId, bucket, key });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      invalidate();
      show('Deleted');
    },
    async deleteFolder(prefix: string) {
      const r = await window.s3.deleteFolder({ accountId, bucket, prefix });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      invalidate();
      show('Folder deleted');
    },
  };
}
