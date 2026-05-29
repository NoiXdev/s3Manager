import { describe, it, expect } from 'vitest';
import { diffListings } from './syncDiff';

describe('diffListings', () => {
  it('flags keys missing on the destination', () => {
    const ops = diffListings([{ relKey: 'a.txt', size: 10 }], []);
    expect(ops).toEqual([{ relKey: 'a.txt', size: 10, reason: 'missing' }]);
  });

  it('flags keys whose size differs', () => {
    const ops = diffListings([{ relKey: 'a.txt', size: 10 }], [{ relKey: 'a.txt', size: 9 }]);
    expect(ops).toEqual([{ relKey: 'a.txt', size: 10, reason: 'size' }]);
  });

  it('skips keys present with matching size, and ignores destination-only keys', () => {
    const ops = diffListings(
      [{ relKey: 'same.txt', size: 5 }],
      [{ relKey: 'same.txt', size: 5 }, { relKey: 'destonly.txt', size: 7 }],
    );
    expect(ops).toEqual([]);
  });

  it('returns ops in source order', () => {
    const ops = diffListings(
      [{ relKey: 'a', size: 1 }, { relKey: 'b', size: 2 }],
      [{ relKey: 'b', size: 2 }],
    );
    expect(ops.map((o) => o.relKey)).toEqual(['a']);
  });
});
