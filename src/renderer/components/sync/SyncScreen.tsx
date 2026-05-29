import { useState } from 'react';
import { useSync } from '../../hooks/useSync';
import { useToast } from '../ui/ToastProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import type { Endpoint, SyncPlan, SyncResult } from '../../../main/s3/sync';

export function SyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [source, setSource] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const [dest, setDest] = useState<EndpointValue>({ accountId: null, bucket: null, prefix: '' });
  const sync = useSync();
  const { show } = useToast();
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [running, setRunning] = useState(false);

  const bothChosen = !!(source.accountId && source.bucket && dest.accountId && dest.bucket);
  const sameBucket = source.accountId === dest.accountId && source.bucket === dest.bucket;
  const identical = sameBucket && source.prefix === dest.prefix;
  const overlap = sameBucket && (dest.prefix.startsWith(source.prefix) || source.prefix.startsWith(dest.prefix));
  const canPreview = bothChosen && !identical && !overlap && !running && !sync.plan.isPending;

  const toEndpoint = (v: EndpointValue): Endpoint => ({ accountId: v.accountId!, bucket: v.bucket!, prefix: v.prefix });

  const onPreview = async () => {
    setResult(null);
    try {
      const p = await sync.plan.mutateAsync({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setPlan(p);
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const onRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const r = await sync.run({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setResult(r);
      setPlan(null);
      show(r.canceled ? 'Sync canceled' : `Synced ${r.copied} object(s)`);
    } catch (e) {
      show((e as Error).message, 'error');
    } finally {
      setRunning(false);
      sync.resetProgress();
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (bucket → bucket)</h2>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <EndpointPicker label="Source" value={source} onChange={(v) => { setSource(v); setPlan(null); }} />
        <EndpointPicker label="Destination" value={dest} onChange={(v) => { setDest(v); setPlan(null); }} />
      </div>

      {identical && <p className="mt-3 text-sm text-red-600">Source and destination are the same.</p>}
      {!identical && overlap && <p className="mt-3 text-sm text-red-600">Destination overlaps the source prefix in the same bucket.</p>}

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
          <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={sync.cancel}>
            Cancel
          </button>
        )}
      </div>

      {sync.plan.isPending && <p className="mt-4 text-slate-500">Computing plan…</p>}

      {plan && !running && (
        <div className="mt-4 rounded border border-slate-200 p-3">
          {plan.toCopy === 0 ? (
            <p className="text-slate-600">Already in sync — nothing to copy ({plan.upToDate} up-to-date).</p>
          ) : (
            <p className="text-slate-700">
              {plan.toCopy} to copy · {plan.upToDate} up-to-date · {formatBytes(plan.bytesToCopy)} to transfer
            </p>
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

      {running && sync.progress && (
        <div className="mt-4 rounded border border-slate-200 p-3 text-sm text-slate-700">
          {sync.progress.phase === 'listing' ? (
            <p>Listing both sides…</p>
          ) : (
            <>
              <p>{sync.progress.copied} / {sync.progress.total} objects · {formatBytes(sync.progress.bytesCopied)} / {formatBytes(sync.progress.bytesTotal)}</p>
              {sync.progress.currentKey && <p className="truncate text-xs text-slate-400">{sync.progress.currentKey}</p>}
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
