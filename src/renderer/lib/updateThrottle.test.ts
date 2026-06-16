import { describe, it, expect } from 'vitest';
import { shouldAutoCheck, UPDATE_CHECK_INTERVAL_MS } from './updateThrottle';

describe('shouldAutoCheck', () => {
  const now = 1_000_000_000_000;

  it('is true when auto-check is on and it was never checked', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: null, now })).toBe(true);
  });

  it('is true when the last check was at least the interval ago', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: now - UPDATE_CHECK_INTERVAL_MS, now })).toBe(true);
  });

  it('is false when the last check was within the interval', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: true, lastUpdateCheckAt: now - 1000, now })).toBe(false);
  });

  it('is false when auto-check is disabled', () => {
    expect(shouldAutoCheck({ autoCheckUpdates: false, lastUpdateCheckAt: null, now })).toBe(false);
  });
});
