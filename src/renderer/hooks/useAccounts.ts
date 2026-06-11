import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { CreateAccountInput, UpdateAccountInput, TestAccountInput } from '../../main/ipc/channels';

export const accountsKey = ['accounts'] as const;

export function useAccounts() {
  return useQuery({
    queryKey: accountsKey,
    queryFn: async () => unwrap(await window.s3.accounts.list()),
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAccountInput) => unwrap(await window.s3.accounts.create(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAccountInput) => unwrap(await window.s3.accounts.update(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useRemoveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await window.s3.accounts.remove(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (input: TestAccountInput) => unwrap(await window.s3.accounts.test(input)),
  });
}
