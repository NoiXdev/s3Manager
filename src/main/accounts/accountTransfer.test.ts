import { describe, it, expect } from 'vitest';
import { exportAccounts, importAccounts, TransferError, type ExportAccount } from './accountTransfer';

const acc: ExportAccount = {
  label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1',
  accessKeyId: 'AK', secretAccessKey: 'SECRET',
};
const custom: ExportAccount = {
  label: 'MinIO', provider: 'custom', region: 'us-east-1',
  accessKeyId: 'CK', secretAccessKey: 'CS', endpoint: 'https://minio.example.com', forcePathStyle: true,
};

describe('accountTransfer round-trip', () => {
  it('exports and imports without a password (unencrypted)', () => {
    const blob = exportAccounts([acc]);
    expect(importAccounts(blob)).toEqual([acc]);
  });

  it('exports and imports with a password', () => {
    const blob = exportAccounts([acc, custom], 'hunter2');
    expect(importAccounts(blob, 'hunter2')).toEqual([acc, custom]);
  });

  it('produces different ciphertext each time (random salt/iv)', () => {
    expect(exportAccounts([acc], 'pw')).not.toEqual(exportAccounts([acc], 'pw'));
  });
});

describe('accountTransfer errors', () => {
  it('throws IncorrectPassword for a wrong password', () => {
    const blob = exportAccounts([acc], 'right');
    expect(() => importAccounts(blob, 'wrong')).toThrow(expect.objectContaining({ code: 'IncorrectPassword' }));
  });

  it('throws PasswordRequired when an encrypted blob is imported without a password', () => {
    const blob = exportAccounts([acc], 'pw');
    expect(() => importAccounts(blob)).toThrow(expect.objectContaining({ code: 'PasswordRequired' }));
  });

  it('throws InvalidData for non-base64 / non-JSON garbage', () => {
    expect(() => importAccounts('!!!not-base64!!!')).toThrow(expect.objectContaining({ code: 'InvalidData' }));
  });

  it('throws InvalidData for a JSON blob that is not our format', () => {
    const notOurs = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64');
    expect(() => importAccounts(notOurs)).toThrow(expect.objectContaining({ code: 'InvalidData' }));
  });

  it('throws IncorrectPassword when the ciphertext is tampered', () => {
    const blob = exportAccounts([acc], 'pw');
    const env = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'));
    env.data = Buffer.from('tampered-ciphertext').toString('base64');
    const tampered = Buffer.from(JSON.stringify(env), 'utf8').toString('base64');
    expect(() => importAccounts(tampered, 'pw')).toThrow(expect.objectContaining({ code: 'IncorrectPassword' }));
  });

  it('exposes TransferError with a code', () => {
    expect(new TransferError('InvalidData', 'x').code).toBe('InvalidData');
  });
});
