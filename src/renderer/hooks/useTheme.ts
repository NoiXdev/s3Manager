import { useEffect } from 'react';
import type { ThemePreference } from '../../main/settings/appSettings';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the theme preference to the document by toggling the `dark` class on
 * <html>. When the preference is 'system' (or undefined), it resolves from the
 * OS via matchMedia and updates live as the OS appearance changes.
 */
export function useTheme(preference: ThemePreference | undefined): void {
  useEffect(() => {
    const pref = preference ?? 'system';
    const root = document.documentElement;

    const apply = (dark: boolean) => root.classList.toggle('dark', dark);

    if (pref !== 'system') {
      apply(pref === 'dark');
      return;
    }

    const mql = window.matchMedia(DARK_QUERY);
    apply(mql.matches);
    const onChange = (e: { matches: boolean }) => apply(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [preference]);
}
