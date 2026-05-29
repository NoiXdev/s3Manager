import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface UploadItem {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  loaded: number;
  total: number | null;
  error?: string;
}

export function useUploads(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    const unsubscribe = window.s3.onUploadProgress((p) => {
      updateRef.current(p.uploadId, { loaded: p.loaded, total: p.total });
    });
    return () => { unsubscribe(); };
  }, []);

  const upload = useCallback(
    async (files: File[], prefix: string) => {
      if (accountId === null || bucket === null) return;
      await Promise.all(
        files.map(async (file) => {
          const id = crypto.randomUUID();
          setItems((prev) => [...prev, { id, name: file.name, status: 'uploading', loaded: 0, total: null }]);
          try {
            const filePath = window.s3.getDropPath(file);
            const r = await window.s3.uploadObject({
              accountId,
              bucket,
              key: `${prefix}${file.name}`,
              filePath,
              contentType: file.type || undefined,
              uploadId: id,
            });
            if (r.ok) {
              update(id, { status: 'done' });
              qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });
            } else {
              update(id, { status: 'error', error: `${r.error.code}: ${r.error.message}` });
            }
          } catch (e) {
            update(id, { status: 'error', error: (e as Error).message });
          }
        }),
      );
    },
    [accountId, bucket, qc, update],
  );

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'uploading'));
  }, []);

  return { items, upload, clearFinished };
}
