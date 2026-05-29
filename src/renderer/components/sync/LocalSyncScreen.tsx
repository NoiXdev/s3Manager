import { useState } from 'react';
import { useLocalSync } from '../../hooks/useLocalSync';
import { useToast } from '../ui/ToastProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import { LocalFolderPicker } from './LocalFolderPicker';
import type { SyncPlan, SyncResult } from '../../../main/s3/sync';
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
  const lsync = useLocalSync();
  const { show } = useToast();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [running, setRunning] = useState(false);

  const ready = !!(localPath && remote.accountId && remote.bucket);
  const canPreview = ready && !running && !lsync.plan.isPending;
  const clearOutputs = () => { setPlan(null); setResult(null); };

  const toArgs = (): LocalSyncArgs => ({
    direction,
    localPath: localPath!,
    remote: { accountId: remote.accountId!, bucket: remote.bucket!, prefix: remote.prefix },
  });

  const onPreview = async () => {
    setResult(null);
    try {
      setPlan(await lsync.plan.mutateAsync(toArgs()));
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await lsync.run(toArgs());
      setResult(r);
      setPlan(null);
      show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`);
    } catch (e) {
      show((e as Error).message, 'error');
    } finally {
      setRunning(false);
      lsync.resetProgress();
    }
  };

  const dirBtn = (d: 'upload' | 'download', label: string) => (
    <button
      type="button"
      aria-pressed={direction === d}
      onClick={() => { setDirection(d); clearOutputs(); }}
      className={`rounded border px-3 py-1 text-sm ${direction === d ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 hover:bg-slate-50'}`}
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
          <h3 className="text-sm font-medium text-slate-700">Local folder</h3>
          <LocalFolderPicker path={localPath} onPick={(p) => { setLocalPath(p); clearOutputs(); }} />
        </div>
        <EndpointPicker label="Bucket" value={remote} onChange={(v) => { setRemote(v); clearOutputs(); }} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={!canPreview}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
          onClick={onPreview}
        >
          Preview
        </button>
        {running && (
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={lsync.cancel}>
            Cancel
          </button>
        )}
      </div>

      {lsync.plan.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !running && (
        <div className="mt-4 rounded border border-slate-200 p-3">
          {plan.toCopy === 0 ? (
            <p className="text-slate-600">Already in sync — nothing to copy ({plan.upToDate} up-to-date).</p>
          ) : (
            <p className="text-slate-700">{plan.toCopy} to copy · {plan.upToDate} up-to-date · {formatBytes(plan.bytesToCopy)} to transfer</p>
          )}
          {plan.sample.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-slate-500">
              {plan.sample.map((op) => (
                <li key={op.relKey}>{op.relKey} <span className="text-slate-400">({op.reason})</span></li>
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

      {running && lsync.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {lsync.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{lsync.progress.copied} / {lsync.progress.total} objects · {formatBytes(lsync.progress.bytesCopied)} / {formatBytes(lsync.progress.bytesTotal)}</p>
              {lsync.progress.currentKey && <p className="truncate text-xs text-slate-400">{lsync.progress.currentKey}</p>}
            </>
          )}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm">
          <p className="text-slate-700">
            {result.canceled ? 'Canceled — ' : ''}Copied {result.copied} object(s), {formatBytes(result.bytesCopied)}
            {result.failed.length > 0 ? ` · ${result.failed.length} failed` : ''}
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600">
              {result.failed.map((f) => (
                <li key={f.key}>{f.key} — {f.code}: {f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
