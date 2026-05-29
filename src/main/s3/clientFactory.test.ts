import { describe, it, expect } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { buildClientConfig, createClient, type ConnectionProfile } from './clientFactory';

const base: ConnectionProfile = {
  provider: 'hetzner',
  region: 'fsn1',
  endpoint: 'https://fsn1.your-objectstorage.com',
  forcePathStyle: true,
  accessKeyId: 'AK',
  secretAccessKey: 'SK',
};

describe('buildClientConfig', () => {
  it('maps profile fields onto S3 client config', () => {
    const cfg = buildClientConfig(base);
    expect(cfg.region).toBe('fsn1');
    expect(cfg.endpoint).toBe('https://fsn1.your-objectstorage.com');
    expect(cfg.forcePathStyle).toBe(true);
    expect(cfg.credentials).toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' });
  });

  it('omits endpoint when not provided (Amazon S3 default)', () => {
    const cfg = buildClientConfig({ ...base, provider: 'amazon-s3', endpoint: undefined, forcePathStyle: false });
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.forcePathStyle).toBe(false);
  });
});

describe('createClient', () => {
  it('returns an S3Client instance', () => {
    expect(createClient(base)).toBeInstanceOf(S3Client);
  });
});
