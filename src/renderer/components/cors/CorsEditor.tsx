import { useEffect, useState } from 'react';
import { useAccounts } from '../../hooks/useAccounts';
import { useBuckets } from '../../hooks/useBuckets';
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
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState<string | null>(initialAccountId);
  const [bucket, setBucket] = useState<string | null>(initialBucket);
  const buckets = useBuckets(accountId);
  const cors = useCors(accountId, bucket);
  const { show } = useToast();

  const [rules, setRules] = useState<CorsRule[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (cors.query.data) setRules(cors.query.data);
  }, [cors.query.data]);

  const selectAccount = (id: string | null) => {
    setAccountId(id);
    setBucket(null);
    setRules([]);
  };
  const selectBucket = (b: string | null) => {
    setBucket(b);
    setRules([]);
  };

  const fieldClass = 'rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">CORS configuration</h2>

      <div className="flex gap-2">
        <select aria-label="Account" className={fieldClass} value={accountId ?? ''} onChange={(e) => selectAccount(e.target.value || null)}>
          <option value="">Select account…</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
        <select aria-label="Bucket" className={fieldClass} value={bucket ?? ''} disabled={accountId === null} onChange={(e) => selectBucket(e.target.value || null)}>
          <option value="">Select bucket…</option>
          {buckets.data?.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

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
            <pre className="overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(rules, null, 2)}</pre>
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
