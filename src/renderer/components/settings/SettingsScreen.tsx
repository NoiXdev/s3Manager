import { useSettings } from '../../hooks/useSettings';
import { useToast } from '../ui/ToastProvider';
import { useState } from 'react';
import { LicensesList, type LicenseEntry } from './LicensesList';
import licensesData from './licenses.generated.json';

const LICENSES = licensesData as unknown as LicenseEntry[];

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

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

  const expiry = settings.data?.presignExpirySeconds ?? 3600;
  const theme = settings.data?.theme ?? 'system';
  const [showLicenses, setShowLicenses] = useState(false);

  const onChangeExpiry = async (value: number) => {
    try {
      await save.mutateAsync({ presignExpirySeconds: value });
      show('Settings saved');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onChangeTheme = async (value: 'system' | 'light' | 'dark') => {
    try {
      await save.mutateAsync({ theme: value });
      show('Settings saved');
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Settings</h2>

      <div className="max-w-md">
        <label className="block text-sm">
          Appearance
          <select
            aria-label="Appearance"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
            value={theme}
            disabled={save.isPending}
            onChange={(e) => void onChangeTheme(e.target.value as 'system' | 'light' | 'dark')}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <p className="pb-4 pt-1 text-xs text-slate-500 dark:text-slate-400">Choose how s3manager looks. "System" follows your OS appearance.</p>
        <label className="block text-sm">
          Default link expiry
          <select
            aria-label="Default link expiry"
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
        <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">Applies to "Copy URL" links generated from the metadata panel.</p>
      </div>

      <h3 className="pb-1 pt-6 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">About</h3>
      <div className="max-w-md text-sm">
        {info.isSuccess ? (
          <>
            <InfoRow label="Version" value={info.data.version} />
            <InfoRow label="Secrets encryption" value={info.data.encryptionAvailable ? 'Enabled' : 'Unavailable'} />
            <InfoRow label="Accounts" value={String(info.data.accountCount)} />
          </>
        ) : (
          <p className="py-2 text-slate-500 dark:text-slate-400">Loading…</p>
        )}
      </div>

      <div className="max-w-md pt-4">
        <button
          type="button"
          onClick={() => setShowLicenses((v) => !v)}
          aria-expanded={showLicenses}
          className="text-sm text-sky-700 dark:text-sky-400 hover:underline"
        >
          {showLicenses ? 'Hide' : 'Show'} open source licenses ({LICENSES.length})
        </button>
        {showLicenses && <LicensesList licenses={LICENSES} />}
      </div>
    </div>
  );
}
