import { describe, it, expect } from 'vitest';
import { UI_PROVIDERS } from './providers';

describe('UI_PROVIDERS', () => {
  it('exposes id + label for amazon-s3, hetzner, and custom', () => {
    expect(UI_PROVIDERS).toEqual([
      { id: 'amazon-s3', label: 'Amazon S3' },
      { id: 'hetzner', label: 'Hetzner Object Storage' },
      { id: 'custom', label: 'Custom (S3-compatible)' },
    ]);
  });
});
