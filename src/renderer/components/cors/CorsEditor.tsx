import { useEffect, useRef, useState } from 'react';
import { useCors } from '../../hooks/useCors';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CorsRuleCard } from './CorsRuleCard';
import { rulesToJson, parseCorsJson } from './corsJson';
import type { CorsRule } from '../../../main/s3/cors';

const NEW_RULE: CorsRule = {
  id: null,
  allowedMethods: ['GET'],
  allowedOrigins: ['*'],
  allowedHeaders: [],
  exposeHeaders: [],
  maxAgeSeconds: null,
};

type Mode = 'form' | 'json';

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
  const [mode, setMode] = useState<Mode>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Reset the working set whenever the selection changes; the data effect below
  // repopulates it once the new bucket's rules load.
  useEffect(() => {
    setRules([]);
    setMode('form');
    setJsonText('');
    setJsonError(null);
  }, [accountId, bucket]);

  useEffect(() => {
    if (!cors.query.data) return;
    setRules(cors.query.data);
    // When data reloads (e.g. after a save-triggered refetch) while in JSON
    // mode, reseed the textarea so it stays in sync with the canonical rules.
    if (modeRef.current === 'json') {
      setJsonText(rulesToJson(cors.query.data));
      setJsonError(null);
    }
  }, [cors.query.data]);

  const enterJsonMode = () => {
    setJsonText(rulesToJson(rules));
    setJsonError(null);
    setMode('json');
  };

  const onJsonChange = (text: string) => {
    setJsonText(text);
    const result = parseCorsJson(text);
    if (result.ok) {
      setRules(result.rules);
      setJsonError(null);
    } else {
      setJsonError(result.error);
    }
  };

  const jsonInvalid = mode === 'json' && jsonError !== null;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">CORS configuration</h2>

      {bucket === null && <p className="mt-4 text-slate-500">Select a bucket to edit its CORS rules.</p>}

      {bucket !== null && cors.query.isLoading && <p className="mt-4 text-slate-500">Loading CORS…</p>}
      {bucket !== null && cors.query.isError && <p className="mt-4 text-red-600">{(cors.query.error as Error).message}</p>}

      {bucket !== null && cors.query.isSuccess && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="inline-flex w-fit rounded border border-slate-300 text-sm">
            <button
              type="button"
              className={`rounded-l px-3 py-1 ${mode === 'form' ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'}`}
              aria-pressed={mode === 'form'}
              disabled={jsonInvalid}
              onClick={() => setMode('form')}
            >
              Form
            </button>
            <button
              type="button"
              className={`rounded-r px-3 py-1 ${mode === 'json' ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'}`}
              aria-pressed={mode === 'json'}
              onClick={enterJsonMode}
            >
              JSON
            </button>
          </div>

          {mode === 'form' && (
            <>
              {rules.map((rule, i) => (
                <CorsRuleCard
                  key={i}
                  rule={rule}
                  onChange={(updated) => setRules(rules.map((r, j) => (j === i ? updated : r)))}
                  onRemove={() => setRules(rules.filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                className="w-fit rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => setRules([...rules, { ...NEW_RULE }])}
              >
                + Add rule
              </button>
            </>
          )}

          {mode === 'json' && (
            <div className="flex flex-col gap-1">
              <textarea
                aria-label="CORS JSON"
                aria-invalid={jsonError !== null}
                aria-describedby={jsonError ? 'cors-json-error' : undefined}
                className="h-72 w-full rounded border border-slate-300 bg-slate-900 p-3 font-mono text-xs text-slate-100"
                spellCheck={false}
                value={jsonText}
                onChange={(e) => onJsonChange(e.target.value)}
              />
              {jsonError && <p id="cors-json-error" className="text-sm text-red-600">{jsonError}</p>}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
              disabled={jsonInvalid}
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
              setMode('form');
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
