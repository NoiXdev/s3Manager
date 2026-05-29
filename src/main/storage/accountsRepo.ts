import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import type { ProviderId } from '../s3/providers';

export interface NewAccount {
  label: string;
  provider: ProviderId;
  endpoint?: string;
  region: string;
  accessKeyId: string;
}

export interface Account extends NewAccount {
  id: string;
  createdAt: number;
}

interface Row {
  id: string;
  label: string;
  provider: string;
  endpoint: string | null;
  region: string;
  access_key_id: string;
  created_at: number;
}

function toAccount(row: Row): Account {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider as ProviderId,
    endpoint: row.endpoint ?? undefined,
    region: row.region,
    accessKeyId: row.access_key_id,
    createdAt: row.created_at,
  };
}

export function createAccountsRepo(db: DB) {
  return {
    create(input: NewAccount): Account {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO accounts (id, label, provider, endpoint, region, access_key_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.label, input.provider, input.endpoint ?? null, input.region, input.accessKeyId, createdAt);
      return { ...input, id, createdAt };
    },
    list(): Account[] {
      return (db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(toAccount);
    },
    get(id: string): Account | undefined {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
      return row ? toAccount(row) : undefined;
    },
    remove(id: string): void {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },
  };
}

export type AccountsRepo = ReturnType<typeof createAccountsRepo>;
