import { describe, it, expect } from 'vitest';
import { PROVIDERS, getProvider, resolveEndpoint } from './providers';

describe('provider registry', () => {
  it('lists amazon-s3 and hetzner', () => {
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(['amazon-s3', 'hetzner']);
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

  it('throws on unknown provider', () => {
    expect(() => getProvider('gcs' as never)).toThrow();
  });
});
