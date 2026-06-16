import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import { accountsKey } from './useAccounts';

export function useExportAccounts() {
  return useMutation({
    mutationFn: async (input: { accountIds: string[]; password?: string }) =>
      unwrap(await window.s3.accounts.export(input)),
  });
}

export function useImportAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { blob: string; password?: string; onDuplicate?: 'skip' | 'copy' | 'replace' }) =>
      unwrap(await window.s3.accounts.import(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: async (input: { blob: string; password?: string }) =>
      unwrap(await window.s3.accounts.importPreview(input)),
  });
}
