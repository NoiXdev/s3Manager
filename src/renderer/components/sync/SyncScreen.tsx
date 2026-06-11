import { useState } from 'react';
import { useSync } from '../../hooks/useSync';
import { useSyncRun } from './SyncRunProvider';
import { formatBytes } from '../../lib/format';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';
import type { Endpoint, SyncPlan } from '../../../main/s3/sync';

export function SyncScreen({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [source, setSource] = useState<EndpointValue>({ accountId: initialAccountId, bucket: initialBucket, prefix: '' });
  const [dest, setDest] = useState<EndpointValue>({ accountId: null, bucket: null, prefix: '' });
  const { plan: planMutation } = useSync();
  const run = useSyncRun();
  const [plan, setPlan] = useState<SyncPlan | null>(null);

  const bothChosen = !!(source.accountId && source.bucket && dest.accountId && dest.bucket);
  const sameBucket = source.accountId === dest.accountId && source.bucket === dest.bucket;
  const identical = sameBucket && source.prefix === dest.prefix;
  const overlap = sameBucket && (dest.prefix.startsWith(source.prefix) || source.prefix.startsWith(dest.prefix));
  const canPreview = bothChosen && !identical && !overlap && !run.running && !planMutation.isPending;

  const toEndpoint = (v: EndpointValue): Endpoint => ({ accountId: v.accountId!, bucket: v.bucket!, prefix: v.prefix });
  const clearOutputs = () => { setPlan(null); run.clearResult(); };

  const onPreview = async () => {
    run.clearResult();
    try {
      setPlan(await planMutation.mutateAsync({ source: toEndpoint(source), dest: toEndpoint(dest) }));
    } catch {
      // planMutation surfaces its own error; nothing extra to show here
    }
  };

  const onRun = async () => {
    try {
      await run.runBucket({ source: toEndpoint(source), dest: toEndpoint(dest) });
      setPlan(null);
    } catch {
      // error toasted by the provider
    }
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">Sync (bucket → bucket)</h2>

      <div className="grid max-w-2xl grid-cols-2 gap-6">
        <EndpointPicker label="Source" value={source} onChange={(v) => { setSource(v); clearOutputs(); }} />
        <EndpointPicker label="Destination" value={dest} onChange={(v) => { setDest(v); clearOutputs(); }} />
      </div>

      {identical && <p className="mt-3 text-sm text-red-600 dark:text-red-400">Source and destination are the same.</p>}
      {!identical && overlap && <p className="mt-3 text-sm text-red-600 dark:text-red-400">Destination overlaps the source prefix in the same bucket.</p>}

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
