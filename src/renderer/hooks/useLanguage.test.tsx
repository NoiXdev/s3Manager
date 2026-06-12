import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import i18n from '../i18n';
import { useLanguage } from './useLanguage';

function setNavigatorLanguage(lang: string) {
  Object.defineProperty(window.navigator, 'language', { value: lang, configurable: true });
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('useLanguage', () => {
  it('applies an explicit locale directly', () => {
    renderHook(() => useLanguage('de'));
    expect(i18n.language).toBe('de');
  });

  it('resolves "system" from navigator.language', () => {
    setNavigatorLanguage('fr-FR');
    renderHook(() => useLanguage('system'));
    expect(i18n.language).toBe('fr');
  });

  it('falls back to en for an unsupported system locale', () => {
    setNavigatorLanguage('ja-JP');
    renderHook(() => useLanguage('system'));
    expect(i18n.language).toBe('en');
  });

  it('treats undefined as "system"', () => {
    setNavigatorLanguage('pl');
    renderHook(() => useLanguage(undefined));
    expect(i18n.language).toBe('pl');
  });
});
