import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { unwrap } from '../../lib/result';
import { useToast } from '../ui/ToastProvider';
import type { SyncProgress, SyncResult } from '../../../main/s3/sync';
import type { SyncEndpoints } from '../../hooks/useSync';
import type { LocalSyncArgs } from '../../../main/s3/localSync';

const LISTING: SyncProgress = { phase: 'listing', copied: 0, total: 0, bytesCopied: 0, bytesTotal: 0, failed: 0 };

interface SyncRunContextValue {
  running: boolean;
  progress: SyncProgress | null;
  result: SyncResult | null;
  runBucket: (args: SyncEndpoints) => Promise<SyncResult>;
  runLocal: (args: LocalSyncArgs) => Promise<SyncResult>;
  cancel: () => void;
  clearResult: () => void;
}

const SyncRunContext = createContext<SyncRunContextValue | null>(null);

export function SyncRunProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { show } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    const unsubscribe = window.s3.onSyncProgress((p) => setProgress(p));
    return () => { unsubscribe(); };
  }, []);

  const execute = useCallback(
    async (runFn: () => Promise<SyncResult>): Promise<SyncResult> => {
      setRunning(true);
      setResult(null);
      setProgress(LISTING);
      try {
        const r = await runFn();
        setResult(r);
        show(r.canceled ? t('sync.toast.canceled') : t('sync.toast.synced', { count: r.copied }));
        return r;
      } catch (e) {
        show((e as Error).message, 'error');
        throw e;
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [show, t],
  );

  const runBucket = useCallback(
    (args: SyncEndpoints) => execute(async () => unwrap(await window.s3.runSync(args))),
    [execute],
  );
  const runLocal = useCallback(
    (args: LocalSyncArgs) => execute(async () => unwrap(await window.s3.localSyncRun(args))),
    [execute],
  );
  const cancel = useCallback(() => { void window.s3.cancelSync(); }, []);
  const clearResult = useCallback(() => setResult(null), []);

  return (
    <SyncRunContext.Provider value={{ running, progress, result, runBucket, runLocal, cancel, clearResult }}>
      {children}
    </SyncRunContext.Provider>
  );
}

export function useSyncRun(): SyncRunContextValue {
  const ctx = useContext(SyncRunContext);
  if (!ctx) throw new Error('useSyncRun must be used within a SyncRunProvider');
  return ctx;
}
