import { useState } from 'react';
import { useLocalSync } from '../../hooks/useLocalSync';
import { useSyncRun } from './SyncRunProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import { LocalFolderPicker } from './LocalFolderPicker';
import type { SyncPlan } from '../../../main/s3/sync';
import type { LocalSyncArgs } from '../../../main/s3/localSync';

export function LocalSyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [direction, setDirection] = useState<'upload' | 'download'>('upload');
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [remote, setRemote] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const { plan: planMutation } = useLocalSync();
  const run = useSyncRun();
  const [plan, setPlan] = useState<SyncPlan | null>(null);

  const ready = !!(localPath && remote.accountId && remote.bucket);
  const canPreview = ready && !run.running && !planMutation.isPending;
  const clearOutputs = () => { setPlan(null); run.clearResult(); };

  const toArgs = (): LocalSyncArgs => ({
    direction,
    localPath: localPath!,
    remote: { accountId: remote.accountId!, bucket: remote.bucket!, prefix: remote.prefix },
  });

  const onPreview = async () => {
    run.clearResult();
    try {
      setPlan(await planMutation.mutateAsync(toArgs()));
    } catch {
      // planMutation surfaces its own error
    }
  };

  const onRun = async () => {
    try {
      await run.runLocal(toArgs());
      setPlan(null);
    } catch {
      // error toasted by the provider
    }
  };

  const dirBtn = (d: 'upload' | 'download', label: string) => (
    <button
      type="button"
      aria-pressed={direction === d}
      onClick={() => { setDirection(d); clearOutputs(); }}
      className={`rounded border px-3 py-1 text-sm ${direction === d ? 'border-slate-800 bg-slate-800 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (local ↔ bucket)</h2>

      <div className="flex gap-2 pb-4">
        {dirBtn('upload', 'Upload (local → bucket)')}
        {dirBtn('download', 'Download (bucket → local)')}
      </div>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Local folder</h3>
          <LocalFolderPicker path={localPath} onPick={(p) => { setLocalPath(p); clearOutputs(); }} />
        </div>
        <EndpointPicker label="Bucket" value={remote} onChange={(v) => { setRemote(v); clearOutputs(); }} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canPreview}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
          onClick={onPreview}
        >
          Preview
        </button>
        {run.running && (
          <button type="button" className="rounded border border-red-300 dark:border-red-800 px-3 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50" onClick={run.cancel}>
            Cancel
          </button>
        )}
      </div>

      {planMutation.isPending && <p className="mt-4 text-slate-500 dark:text-slate-400">Computing plan…</p>}

      {plan && !run.running && (
        <div className="mt-4 rounded border border-slate-200 dark:border-slate-700 p-3">
          {plan.toCopy === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">Already in sync — nothing to copy ({plan.upToDate} up-to-date).</p>
          ) : (
            <p className="text-slate-700 dark:text-slate-200">{plan.toCopy} to copy · {plan.upToDate} up-to-date · {formatBytes(plan.bytesToCopy)} to transfer</p>
          )}
          {plan.sample.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-slate-500 dark:text-slate-400">
              {plan.sample.map((op) => (
                <li key={op.relKey}>{op.relKey} <span className="text-slate-400 dark:text-slate-500">({op.reason})</span></li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={plan.toCopy === 0}
            className="mt-3 rounded bg-emerald-700 px-3 py-1 text-sm text-white hover:bg-emerald-600 disabled:opacity-40"
            onClick={onRun}
          >
            Run sync
          </button>
        </div>
      )}

      {run.running && run.progress && (
        <div className="mt-4 rounded border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-200">
          {run.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{run.progress.copied} / {run.progress.total} objects · {formatBytes(run.progress.bytesCopied)} / {formatBytes(run.progress.bytesTotal)}</p>
              {run.progress.currentKey && <p className="truncate text-xs text-slate-400 dark:text-slate-500">{run.progress.currentKey}</p>}
            </>
          )}
        </div>
      )}

      {run.result && (
        <div className="mt-4 rounded border border-slate-200 dark:border-slate-700 p-3 text-sm">
          <p className="text-slate-700 dark:text-slate-200">
            {run.result.canceled ? 'Canceled — ' : ''}Copied {run.result.copied} object(s), {formatBytes(run.result.bytesCopied)}
            {run.result.failed.length > 0 ? ` · ${run.result.failed.length} failed` : ''}
          </p>
          {run.result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600 dark:text-red-400">
              {run.result.failed.map((f) => (
                <li key={f.key}>{f.key} — {f.code}: {f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
