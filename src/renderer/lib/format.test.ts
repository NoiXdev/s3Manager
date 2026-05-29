import { describe, it, expect } from 'vitest';
import { formatBytes, formatTimestamp } from './format';

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
});

describe('formatTimestamp', () => {
  it('renders an ISO string as a locale date-time', () => {
    const out = formatTimestamp('2024-01-02T03:04:05.000Z');
    expect(out).not.toBe('');
    expect(out).not.toBe('—');
  });
  it('renders an em dash for null', () => {
    expect(formatTimestamp(null)).toBe('—');
  });
});
