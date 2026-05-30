import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { AppSettings } from '../../main/settings/appSettings';

export function useSettings() {
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: async () => unwrap(await window.s3.getSettings()),
  });

  const info = useQuery({
    queryKey: ['appInfo'],
    queryFn: async () => unwrap(await window.s3.getAppInfo()),
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => unwrap(await window.s3.setSettings(patch)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  return { settings, info, save };
}
