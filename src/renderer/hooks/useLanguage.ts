import { useEffect } from 'react';
import i18n, { SUPPORTED_LOCALES, type SupportedLocale } from '../i18n';
import type { LanguagePreference } from '../../main/settings/appSettings';

function resolveSystemLocale(): SupportedLocale {
  const primary = (navigator.language || 'en').split('-')[0].toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(primary)
    ? (primary as SupportedLocale)
    : 'en';
}

/**
 * Applies the language preference to i18next. When the preference is 'system'
 * (or undefined), it resolves the nearest supported locale from the OS via
 * navigator.language, falling back to English.
 */
export function useLanguage(preference: LanguagePreference | undefined): void {
  useEffect(() => {
    const pref = preference ?? 'system';
    const target = pref === 'system' ? resolveSystemLocale() : pref;
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [preference]);
}
