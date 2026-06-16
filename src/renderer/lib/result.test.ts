import { describe, it, expect } from 'vitest';
import { unwrap, humanErrorMessage } from './result';

describe('unwrap', () => {
  it('returns data for an ok Result', () => {
    expect(unwrap({ ok: true, data: 42 })).toBe(42);
  });

  it('throws an Error carrying the code + message for an err Result', () => {
    expect(() => unwrap({ ok: false, error: { code: 'AccessDenied', message: 'nope' } })).toThrowError(
      /AccessDenied: nope/,
    );
  });
});

describe('humanErrorMessage', () => {
  it('strips the leading "Code: " prefix that unwrap adds', () => {
    expect(humanErrorMessage(new Error('IncorrectPassword: Incorrect password.'))).toBe('Incorrect password.');
  });

  it('preserves colons within the message body', () => {
    expect(humanErrorMessage(new Error('Code: a: b: c'))).toBe('a: b: c');
  });

  it('returns a message without a prefix unchanged', () => {
    expect(humanErrorMessage(new Error('plain message'))).toBe('plain message');
  });

  it('handles non-Error values', () => {
    expect(humanErrorMessage('boom')).toBe('boom');
  });
});
