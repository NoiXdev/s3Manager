import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { SyncPlan } from '../../main/s3/sync';
import type { LocalSyncArgs } from '../../main/s3/localSync';

export function useLocalSync() {
  const plan = useMutation({
    mutationFn: async (v: LocalSyncArgs): Promise<SyncPlan> => unwrap(await window.s3.localSyncPlan(v)),
  });
  return { plan };
}
