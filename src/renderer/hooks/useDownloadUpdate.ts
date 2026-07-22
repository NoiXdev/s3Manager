import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

/**
 * Downloads a release installer and asks the OS to open it. The main process
 * validates the URL host and, on success, has already launched the installer;
 * the user finishes the install steps themselves.
 */
export function useDownloadUpdate() {
  return useMutation({
    mutationFn: async (asset: { url: string; fileName: string }) =>
      unwrap(await window.s3.downloadUpdate(asset)),
  });
}
