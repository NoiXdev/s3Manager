import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectRetentionCommand,
  PutObjectRetentionCommand,
  GetObjectLegalHoldCommand,
  PutObjectLegalHoldCommand,
} from '@aws-sdk/client-s3';
import { getObjectRetention, putObjectRetention, getObjectLegalHold, putObjectLegalHold } from './objectRetention';

const s3Mock = mockClient(S3Client);
beforeEach(() => s3Mock.reset());

describe('getObjectRetention', () => {
  it('maps a retention payload to mode + ISO date', async () => {
    s3Mock.on(GetObjectRetentionCommand).resolves({
      Retention: { Mode: 'GOVERNANCE', RetainUntilDate: new Date('2026-07-01T00:00:00.000Z') },
    });
    const r = await getObjectRetention(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { mode: 'GOVERNANCE', retainUntil: '2026-07-01T00:00:00.000Z' } });
  });

  it('treats NoSuchObjectLockConfiguration as no retention', async () => {
    s3Mock.on(GetObjectRetentionCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));
    const r = await getObjectRetention(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: { mode: null, retainUntil: null } });
  });
});

describe('getObjectLegalHold', () => {
  it('returns ON when held', async () => {
    s3Mock.on(GetObjectLegalHoldCommand).resolves({ LegalHold: { Status: 'ON' } });
    const r = await getObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'ON' });
  });

  it('returns OFF when not set', async () => {
    s3Mock.on(GetObjectLegalHoldCommand).rejects(Object.assign(new Error('none'), { name: 'NoSuchObjectLockConfiguration' }));
    const r = await getObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k' });
    expect(r).toEqual({ ok: true, data: 'OFF' });
  });
});

describe('putObjectRetention', () => {
  it('sends a GOVERNANCE retention with the retain-until date', async () => {
    s3Mock.on(PutObjectRetentionCommand).resolves({});
    const r = await putObjectRetention(new S3Client({}), { bucket: 'b', key: 'k', retainUntil: '2026-07-01T00:00:00.000Z' });
    expect(r).toEqual({ ok: true, data: true });
    const input = s3Mock.commandCalls(PutObjectRetentionCommand)[0].args[0].input;
    expect(input.Retention?.Mode).toBe('GOVERNANCE');
    expect(input.Retention?.RetainUntilDate).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });
});

describe('putObjectLegalHold', () => {
  it('sends the legal hold status', async () => {
    s3Mock.on(PutObjectLegalHoldCommand).resolves({});
    const r = await putObjectLegalHold(new S3Client({}), { bucket: 'b', key: 'k', status: 'ON' });
    expect(r).toEqual({ ok: true, data: true });
    expect(s3Mock.commandCalls(PutObjectLegalHoldCommand)[0].args[0].input.LegalHold?.Status).toBe('ON');
  });
});
