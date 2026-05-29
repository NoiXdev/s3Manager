import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { Endpoint, SyncPlan } from '../../main/s3/sync';

export interface SyncEndpoints {
  source: Endpoint;
  dest: Endpoint;
}

export function useSync() {
  const plan = useMutation({
    mutationFn: async (v: SyncEndpoints): Promise<SyncPlan> => unwrap(await window.s3.planSync(v)),
  });
  return { plan };
}
