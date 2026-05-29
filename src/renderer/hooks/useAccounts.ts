import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export const accountsKey = ['accounts'] as const;

export function useAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: async () => unwrap(await window.s3.accounts.list()),
  });
}
