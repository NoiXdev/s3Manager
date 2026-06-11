import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';

type Listener = (e: { matches: boolean }) => void;

function mockMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<Listener>();
  const mql = {
    get matches() { return matches; },
    addEventListener: (_: string, l: Listener) => void listeners.add(l),
    removeEventListener: (_: string, l: Listener) => void listeners.delete(l),
  };
  (window as unknown as { matchMedia: unknown }).matchMedia = vi.fn().mockReturnValue(mql);
  return {
    setSystemDark(v: boolean) { matches = v; listeners.forEach((l) => l({ matches: v })); },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTheme', () => {
  it('forces dark when preference is "dark"', () => {
    mockMatchMedia(false);
    renderHook(() => useTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('forces light when preference is "light" even if OS is dark', () => {
    mockMatchMedia(true);
    renderHook(() => useTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves "system" from matchMedia', () => {
    mockMatchMedia(true);
    renderHook(() => useTheme('system'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('tracks live OS changes while on "system"', () => {
    const mm = mockMatchMedia(false);
    renderHook(() => useTheme('system'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    mm.setSystemDark(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not subscribe to OS changes when preference is forced', () => {
    const mm = mockMatchMedia(false);
    renderHook(() => useTheme('dark'));
    expect(mm.listenerCount()).toBe(0);
  });

  it('treats an undefined preference as "system"', () => {
    mockMatchMedia(true);
    renderHook(() => useTheme(undefined));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
