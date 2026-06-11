import type { SettingsRepo } from '../storage/settingsRepo';

export type ThemePreference = 'system' | 'light' | 'dark';
export type LanguagePreference = 'system' | 'en' | 'de' | 'fr' | 'pl' | 'nl' | 'ro';

export interface AppSettings {
  presignExpirySeconds: number;
  theme: ThemePreference;
  language: LanguagePreference;
}
export interface AppInfo {
  version: string;
  encryptionAvailable: boolean;
  accountCount: number;
}

const DEFAULT_EXPIRY = 3600;
const MAX_EXPIRY = 604800; // S3's 7-day presign cap
const THEMES: ThemePreference[] = ['system', 'light', 'dark'];
const LANGUAGES: LanguagePreference[] = ['system', 'en', 'de', 'fr', 'pl', 'nl', 'ro'];

function isTheme(v: unknown): v is ThemePreference {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}

function isLanguage(v: unknown): v is LanguagePreference {
  return typeof v === 'string' && (LANGUAGES as string[]).includes(v);
}

export function readSettings(repo: SettingsRepo): AppSettings {
  const raw = repo.get('presignExpirySeconds');
  const n = raw !== undefined ? Number(raw) : NaN;
  const presignExpirySeconds = Number.isFinite(n) && n >= 1 && n <= MAX_EXPIRY ? n : DEFAULT_EXPIRY;
  const storedTheme = repo.get('theme');
  const theme: ThemePreference = isTheme(storedTheme) ? storedTheme : 'system';
  const storedLanguage = repo.get('language');
  const language: LanguagePreference = isLanguage(storedLanguage) ? storedLanguage : 'system';
  return { presignExpirySeconds, theme, language };
}

export function writeSettings(repo: SettingsRepo, patch: Partial<AppSettings>): AppSettings {
  if (patch.presignExpirySeconds !== undefined) {
    const clamped = Math.min(MAX_EXPIRY, Math.max(1, Math.round(patch.presignExpirySeconds)));
    repo.set('presignExpirySeconds', String(clamped));
  }
  if (patch.theme !== undefined && isTheme(patch.theme)) {
    repo.set('theme', patch.theme);
  }
  if (patch.language !== undefined && isLanguage(patch.language)) {
    repo.set('language', patch.language);
  }
  return readSettings(repo);
}
