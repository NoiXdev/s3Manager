import { useState } from 'react';
import { useBuckets } from '../../hooks/useBuckets';
import { CreateBucketDialog } from './CreateBucketDialog';

export function BucketsPane({
  accountId,
  selectedBucket,
  onSelect,
}: {
  accountId: string | null;
  selectedBucket: string | null;
  onSelect: (bucket: string) => void;
}) {
  const buckets = useBuckets(accountId);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buckets</span>
        {accountId !== null && (
          <button type="button" className="rounded px-2 py-0.5 text-sm hover:bg-slate-100" onClick={() => setCreating(true)}>
            + Create bucket
          </button>
        )}
      </div>

      {accountId === null && <p className="p-3 text-slate-500">Select an account</p>}
      {accountId !== null && buckets.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {buckets.isError && <p className="p-3 text-red-600">{(buckets.error as Error).message}</p>}
      {buckets.isSuccess && buckets.data.length === 0 && (
        <p className="p-3 text-slate-500">No buckets</p>
      )}

      <ul className="flex-1 overflow-auto">
        {buckets.data?.map((bucket) => (
          <li key={bucket}>
            <button
              type="button"
              onClick={() => onSelect(bucket)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                bucket === selectedBucket ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'
              }`}
            >
              <span aria-hidden>🪣</span>
              {bucket}
            </button>
          </li>
        ))}
      </ul>
      {creating && accountId !== null && (
        <CreateBucketDialog
          accountId={accountId}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            onSelect(name);
          }}
        />
      )}
    </div>
  );
}
