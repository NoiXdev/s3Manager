import type { SettingsRepo } from '../storage/settingsRepo';

export interface AppSettings {
  presignExpirySeconds: number;
}
export interface AppInfo {
  version: string;
  encryptionAvailable: boolean;
  accountCount: number;
}

const DEFAULT_EXPIRY = 3600;
const MAX_EXPIRY = 604800; // S3's 7-day presign cap

export function readSettings(repo: SettingsRepo): AppSettings {
  const raw = repo.get('presignExpirySeconds');
  const n = raw !== undefined ? Number(raw) : NaN;
  const presignExpirySeconds = Number.isFinite(n) && n >= 1 && n <= MAX_EXPIRY ? n : DEFAULT_EXPIRY;
  return { presignExpirySeconds };
}

export function writeSettings(repo: SettingsRepo, patch: Partial<AppSettings>): AppSettings {
  if (patch.presignExpirySeconds !== undefined) {
    const clamped = Math.min(MAX_EXPIRY, Math.max(1, Math.round(patch.presignExpirySeconds)));
    repo.set('presignExpirySeconds', String(clamped));
  }
  return readSettings(repo);
}
