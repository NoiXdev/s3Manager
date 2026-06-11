import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import type { ProviderId } from '../s3/providers';

export interface NewAccount {
  label: string;
  provider: ProviderId;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  forcePathStyle: boolean;
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
  force_path_style: number;
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
    forcePathStyle: Boolean(row.force_path_style),
    createdAt: row.created_at,
  };
}

export function createAccountsRepo(db: DB) {
  return {
    create(input: NewAccount): Account {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(
        `INSERT INTO accounts (id, label, provider, endpoint, region, access_key_id, force_path_style, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, input.label, input.provider, input.endpoint ?? null, input.region,
        input.accessKeyId, input.forcePathStyle ? 1 : 0, createdAt,
      );
      return { ...input, id, createdAt };
    },
    list(): Account[] {
      return (db.prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(toAccount);
    },
    get(id: string): Account | undefined {
      const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
      return row ? toAccount(row) : undefined;
    },
    update(id: string, input: NewAccount): Account {
      const existing = this.get(id);
      if (!existing) throw new Error(`Account not found: ${id}`);
      db.prepare(
        `UPDATE accounts
         SET label = ?, provider = ?, endpoint = ?, region = ?, access_key_id = ?, force_path_style = ?
         WHERE id = ?`,
      ).run(
        input.label, input.provider, input.endpoint ?? null, input.region,
        input.accessKeyId, input.forcePathStyle ? 1 : 0, id,
      );
      return { ...input, id, createdAt: existing.createdAt };
    },
    remove(id: string): void {
      db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    },
  };
}

export type AccountsRepo = ReturnType<typeof createAccountsRepo>;
