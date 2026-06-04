import { useEffect, useState } from 'react';
import { useCors } from '../../hooks/useCors';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CorsRuleCard } from './CorsRuleCard';
import type { CorsRule } from '../../../main/s3/cors';

const NEW_RULE: CorsRule = {
  id: null,
  allowedMethods: ['GET'],
  allowedOrigins: ['*'],
  allowedHeaders: [],
  exposeHeaders: [],
  maxAgeSeconds: null,
};

export function CorsEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const cors = useCors(accountId, bucket);
  const { show } = useToast();

  const [rules, setRules] = useState<CorsRule[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset the working set whenever the selection changes; the data effect below
  // repopulates it once the new bucket's rules load.
  useEffect(() => {
    setRules([]);
  }, [accountId, bucket]);

  useEffect(() => {
    if (cors.query.data) setRules(cors.query.data);
  }, [cors.query.data]);

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">CORS configuration</h2>

      {bucket === null && <p className="mt-4 text-slate-500">Select a bucket to edit its CORS rules.</p>}

      {bucket !== null && cors.query.isLoading && <p className="mt-4 text-slate-500">Loading CORS…</p>}
      {bucket !== null && cors.query.isError && <p className="mt-4 text-red-600">{(cors.query.error as Error).message}</p>}

      {bucket !== null && cors.query.isSuccess && (
        <div className="mt-4 flex flex-col gap-3">
          {rules.map((rule, i) => (
            <CorsRuleCard
              key={i}
              rule={rule}
              onChange={(updated) => setRules(rules.map((r, j) => (j === i ? updated : r)))}
              onRemove={() => setRules(rules.filter((_, j) => j !== i))}
            />
          ))}

          <div className="flex gap-2">
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={() => setRules([...rules, { ...NEW_RULE }])}>
              + Add rule
            </button>
            <button type="button" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50" onClick={() => setShowJson((v) => !v)}>
              {showJson ? 'Hide JSON' : 'Show JSON'}
            </button>
          </div>

          {showJson && (
            <pre data-testid="cors-json" className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(rules, null, 2)}</pre>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700"
              onClick={async () => {
                try {
                  await cors.save.mutateAsync(rules);
                  show('CORS saved');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              Save
            </button>
            <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          message="Remove all CORS rules from this bucket?"
          confirmLabel="Clear all rules"
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            try {
              await cors.clear.mutateAsync();
              setRules([]);
              show('CORS cleared');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
