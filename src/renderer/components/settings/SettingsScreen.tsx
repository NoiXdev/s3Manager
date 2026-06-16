import { useSettings } from '../../hooks/useSettings';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useToast } from '../ui/ToastProvider';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LicensesList, type LicenseEntry } from './LicensesList';
import type { LanguagePreference } from '../../../main/settings/appSettings';
import licensesData from './licenses.generated.json';

const LICENSES = licensesData as unknown as LicenseEntry[];

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-1.5 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

export function SettingsScreen() {
  const { settings, info, save } = useSettings();
  const { show } = useToast();
  const { t } = useTranslation();

  const EXPIRY_OPTIONS = [
    { label: t('settings.expiry1h'), value: 3600 },
    { label: t('settings.expiry24h'), value: 86400 },
    { label: t('settings.expiry7d'), value: 604800 },
  ];

  const LANGUAGE_OPTIONS: { value: LanguagePreference; label: string }[] = [
    { value: 'system', label: t('settings.languageSystem') },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Français' },
    { value: 'pl', label: 'Polski' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'ro', label: 'Română' },
  ];

  const expiry = settings.data?.presignExpirySeconds ?? 3600;
  const theme = settings.data?.theme ?? 'system';
  const language = settings.data?.language ?? 'system';
  const [showLicenses, setShowLicenses] = useState(false);

  const autoCheck = settings.data?.autoCheckUpdates ?? true;
  const check = useUpdateCheck();

  const onToggleAutoCheck = async (value: boolean) => {
    try {
      await save.mutateAsync({ autoCheckUpdates: value });
      show(t('common.settingsSaved'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onChangeExpiry = async (value: number) => {
    try {
      await save.mutateAsync({ presignExpirySeconds: value });
      show(t('common.settingsSaved'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onChangeTheme = async (value: 'system' | 'light' | 'dark') => {
    try {
      await save.mutateAsync({ theme: value });
      show(t('common.settingsSaved'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onChangeLanguage = async (value: LanguagePreference) => {
    try {
      await save.mutateAsync({ language: value });
      show(t('common.settingsSaved'));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">{t('settings.title')}</h2>

      <div className="max-w-md">
        <label className="block text-sm">
          {t('settings.appearance')}
          <select
            aria-label={t('settings.appearance')}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            value={theme}
            disabled={save.isPending}
            onChange={(e) => void onChangeTheme(e.target.value as 'system' | 'light' | 'dark')}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </label>
        <p className="pb-4 pt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.appearanceHelp')}</p>
        <label className="block text-sm">
          {t('settings.language')}
          <select
            aria-label={t('settings.language')}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            value={language}
            disabled={save.isPending}
            onChange={(e) => void onChangeLanguage(e.target.value as LanguagePreference)}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="pb-4 pt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.languageHelp')}</p>
        <label className="block text-sm">
          {t('settings.defaultLinkExpiry')}
          <select
            aria-label={t('settings.defaultLinkExpiry')}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            value={expiry}
            disabled={save.isPending}
            onChange={(e) => void onChangeExpiry(Number(e.target.value))}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.linkExpiryHelp')}</p>
      </div>

      <h3 className="pb-1 pt-6 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('settings.about')}</h3>
      <div className="max-w-md text-sm">
        {info.isSuccess ? (
          <>
            <InfoRow label={t('settings.version')} value={info.data.version} />
            <InfoRow label={t('settings.secretsEncryption')} value={info.data.encryptionAvailable ? t('settings.encryptionEnabled') : t('settings.encryptionUnavailable')} />
            <InfoRow label={t('settings.accounts')} value={String(info.data.accountCount)} />
          </>
        ) : (
          <p className="py-2 text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        )}
      </div>

      <div className="max-w-md pt-4">
        <button
          type="button"
          onClick={() => check.mutate()}
          disabled={check.isPending}
          className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {t('settings.checkUpdates')}
        </button>
        <div className="pt-2 text-sm" aria-live="polite">
          {check.isPending && <span className="text-slate-500 dark:text-slate-400">{t('settings.checkingUpdates')}</span>}
          {check.isError && <span className="text-red-600 dark:text-red-400">{t('settings.updateCheckFailed')}</span>}
          {check.isSuccess && !check.data.updateAvailable && (
            <span className="text-slate-600 dark:text-slate-300">{t('settings.upToDate')}</span>
          )}
          {check.isSuccess && check.data.updateAvailable && (
            <span className="text-slate-800 dark:text-slate-100">
              {t('settings.updateAvailable', { version: check.data.latestVersion })}{' '}
              <button
                type="button"
                onClick={() => void window.s3.openExternal(check.data.releaseUrl)}
                className="text-sky-700 hover:underline dark:text-sky-400"
              >
                {t('settings.updateDownload')}
              </button>
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 pt-3 text-sm">
          <input
            type="checkbox"
            checked={autoCheck}
            disabled={save.isPending}
            onChange={(e) => void onToggleAutoCheck(e.target.checked)}
          />
          {t('settings.autoCheck')}
        </label>
        <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">{t('settings.autoCheckHelp')}</p>
      </div>

      <div className="max-w-md pt-4">
        <button
          type="button"
          onClick={() => setShowLicenses((v) => !v)}
          aria-expanded={showLicenses}
          className="text-sm text-sky-700 dark:text-sky-400 hover:underline"
        >
          {t(showLicenses ? 'settings.hideLicenses' : 'settings.showLicenses', { count: LICENSES.length })}
        </button>
        {showLicenses && <LicensesList licenses={LICENSES} />}
      </div>
    </div>
  );
}
