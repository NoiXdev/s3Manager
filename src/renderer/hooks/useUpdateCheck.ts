import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useUpdateCheck() {
  return useMutation({
    mutationFn: async () => unwrap(await window.s3.checkForUpdate()),
    onSuccess: () => {
      void window.s3.setSettings({ lastUpdateCheckAt: Date.now() });
    },
  });
}
