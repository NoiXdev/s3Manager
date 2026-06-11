import { describe, it, expect } from 'vitest';
import { openDatabase } from './db';
import { createAccountsRepo, type NewAccount } from './accountsRepo';

const sample: NewAccount = {
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AK',
  forcePathStyle: false,
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

  it('round-trips forcePathStyle', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create({ ...sample, forcePathStyle: true });
    expect(created.forcePathStyle).toBe(true);
    expect(repo.get(created.id)?.forcePathStyle).toBe(true);
    expect(repo.list()[0].forcePathStyle).toBe(true);
  });

  it('updates an account in place, preserving id and createdAt', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    const created = repo.create(sample);
    const updated = repo.update(created.id, {
      label: 'AWS staging',
      provider: 'custom',
      endpoint: 'https://minio.example.com:9000',
      region: 'us-east-1',
      accessKeyId: 'AK2',
      forcePathStyle: true,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.label).toBe('AWS staging');
    expect(updated.provider).toBe('custom');
    expect(updated.endpoint).toBe('https://minio.example.com:9000');
    expect(updated.forcePathStyle).toBe(true);
    // persisted, not just returned
    expect(repo.get(created.id)?.label).toBe('AWS staging');
    expect(repo.list()).toHaveLength(1);
  });

  it('throws when updating a missing account', () => {
    const repo = createAccountsRepo(openDatabase(':memory:'));
    expect(() => repo.update('missing', sample)).toThrow();
  });
});
