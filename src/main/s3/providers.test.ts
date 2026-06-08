import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, resolveEndpoint, bucketLocationConstraint } from './providers';

describe('provider registry', () => {
  it('lists amazon-s3, hetzner, and custom', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['amazon-s3', 'custom', 'hetzner']);
  });

  it('amazon-s3 lets the SDK derive the endpoint and uses virtual-host style', () => {
    const p = getProvider('amazon-s3');
    expect(p.forcePathStyle).toBe(false);
    expect(resolveEndpoint('amazon-s3', 'eu-central-1')).toBeUndefined();
  });

  it('hetzner builds a region endpoint and uses path style', () => {
    const p = getProvider('hetzner');
    expect(p.forcePathStyle).toBe(true);
    expect(resolveEndpoint('hetzner', 'fsn1')).toBe('https://fsn1.your-objectstorage.com');
  });

  it('custom has inert defaults — no derived endpoint, path style on', () => {
    const p = getProvider('custom');
    expect(p.forcePathStyle).toBe(true);
    expect(resolveEndpoint('custom', 'us-east-1')).toBeUndefined();
  });

  it('throws on unknown provider', () => {
    expect(() => getProvider('gcs' as never)).toThrow();
  });
});

describe('bucketLocationConstraint', () => {
  it('returns the region for amazon-s3 outside us-east-1', () => {
    expect(bucketLocationConstraint('amazon-s3', 'eu-central-1')).toBe('eu-central-1');
  });
  it('returns undefined for amazon-s3 us-east-1', () => {
    expect(bucketLocationConstraint('amazon-s3', 'us-east-1')).toBeUndefined();
  });
  it('returns undefined for hetzner', () => {
    expect(bucketLocationConstraint('hetzner', 'fsn1')).toBeUndefined();
  });
  it('returns undefined for custom', () => {
    expect(bucketLocationConstraint('custom', 'us-east-1')).toBeUndefined();
  });
});
