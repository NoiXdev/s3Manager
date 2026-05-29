import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { SyncPlan, SyncResult, SyncProgress } from '../../main/s3/sync';
import type { LocalSyncArgs } from '../../main/s3/localSync';

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

export function useLocalSync() {
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const plan = useMutation({
    mutationFn: async (v: LocalSyncArgs): Promise<SyncPlan> => unwrap(await window.s3.localSyncPlan(v)),
  });

  const run = useCallback(async (v: LocalSyncArgs): Promise<SyncResult> => {
    setProgress(LISTING);
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    try {
      return unwrap(await window.s3.localSyncRun(v));
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
