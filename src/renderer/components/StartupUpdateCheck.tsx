import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../hooks/useSettings';
import { useUpdateCheck } from '../hooks/useUpdateCheck';
import { useToast } from './ui/ToastProvider';
import { shouldAutoCheck } from '../lib/updateThrottle';

/** Renders nothing; fires a daily-throttled update check on startup and toasts when one is available. */
export function StartupUpdateCheck() {
  const { settings } = useSettings();
  const check = useUpdateCheck();
  const { show } = useToast();
  const { t } = useTranslation();
  const fired = useRef(false);
  const toasted = useRef(false);

  useEffect(() => {
    if (fired.current || !settings.isSuccess) return;
    const due = shouldAutoCheck({
      autoCheckUpdates: settings.data.autoCheckUpdates,
      lastUpdateCheckAt: settings.data.lastUpdateCheckAt,
      now: Date.now(),
    });
    if (due) {
      fired.current = true;
      check.mutate();
    }
  }, [settings.isSuccess, settings.data, check]);

  useEffect(() => {
    if (toasted.current) return;
    if (check.data?.updateAvailable) {
      toasted.current = true;
      show(t('updates.available', { version: check.data.latestVersion }));
    }
  }, [check.data, show, t]);

  return null;
}
