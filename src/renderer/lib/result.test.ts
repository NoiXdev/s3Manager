import { describe, it, expect } from 'vitest';
import { unwrap } from './result';

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
