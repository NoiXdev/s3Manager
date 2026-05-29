import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { presignGetUrl } from './objects';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/x'),
}));

beforeEach(() => vi.clearAllMocks());

describe('presignGetUrl', () => {
  it('returns a signed url with the requested expiry', async () => {
    const r = await presignGetUrl(new S3Client({}), { bucket: 'b', key: 'k', expiresIn: 3600 });
    expect(r).toEqual({ ok: true, data: 'https://signed.example/x' });
    expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 });
  });
});
