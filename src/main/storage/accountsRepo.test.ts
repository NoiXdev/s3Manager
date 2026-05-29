import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createAccountsRepo, type NewAccount } from './accountsRepo';

const sample: NewAccount = {
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AK',
};

describe('accountsRepo', () => {
  it('creates and lists accounts with a generated id', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].label).toBe('AWS prod');
  });

  it('gets an account by id', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    expect(repo.get(created.id)?.region).toBe('eu-central-1');
    expect(repo.get('missing')).toBeUndefined();
  });

  it('deletes an account', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    repo.remove(created.id);
    expect(repo.list()).toHaveLength(0);
  });
});
