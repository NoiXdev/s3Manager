import { describe, it, expect } from 'vitest';
import { runPool } from './pool';

describe('runPool', () => {
  it('processes every item when there are more than the limit', async () => {
    const processed: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => { processed.push(n); });
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    await runPool(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
