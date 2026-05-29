import { describe, it, expect } from 'vitest';
import { ok, err, isOk } from './result';

describe('Result helpers', () => {
  it('ok wraps data', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, data: 42 });
    expect(isOk(r)).toBe(true);
  });

  it('err wraps code + message', () => {
    const r = err('AccessDenied', 'nope');
    expect(r).toEqual({ ok: false, error: { code: 'AccessDenied', message: 'nope' } });
    expect(isOk(r)).toBe(false);
  });
});
