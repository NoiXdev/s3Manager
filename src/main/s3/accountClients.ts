import type { S3Client } from '@aws-sdk/client-s3';
import { createClient } from './clientFactory';
import { getProvider } from './providers';
import type { AccountsRepo } from '../storage/accountsRepo';
import type { SecretsStore } from '../storage/secrets';

export interface Deps {
  accounts: AccountsRepo;
  secrets: SecretsStore;
}

export function createClientForAccount(accountId: string, deps: Deps): S3Client {
  const account = deps.accounts.get(accountId);
  if (!account) throw new Error(`No account found for id ${accountId}`);

  const secretAccessKey = deps.secrets.get(accountId);
  if (!secretAccessKey) throw new Error(`No secret found for account ${accountId}`);

  return createClient({
    provider: account.provider,
    region: account.region,
    endpoint: account.endpoint,
    forcePathStyle: getProvider(account.provider).forcePathStyle,
    accessKeyId: account.accessKeyId,
    secretAccessKey,
  });
}
