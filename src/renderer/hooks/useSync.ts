import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { Endpoint, SyncPlan, SyncResult, SyncProgress } from '../../main/s3/sync';

export interface SyncEndpoints {
  source: Endpoint;
  dest: Endpoint;
}

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

export function useSync() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const plan = useMutation({
    mutationFn: async (v: SyncEndpoints): Promise<SyncPlan> => unwrap(await window.s3.planSync(v)),
  });

  const run = useCallback(async (v: SyncEndpoints): Promise<SyncResult> => {
    setProgress(LISTING);
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    try {
      return unwrap(await window.s3.runSync(v));
    } finally {
      unsubscribe();
    }
  }, []);

  const cancel = useCallback(() => {
    void window.s3.cancelSync();
  }, []);

  const resetProgress = useCallback(() => setProgress(null), []);

  return { plan, run, cancel, progress, resetProgress };
}
