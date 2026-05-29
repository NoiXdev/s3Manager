import { useState } from 'react';
import { SyncScreen } from './SyncScreen';
import { LocalSyncScreen } from './LocalSyncScreen';

export function SyncSection({
  initialAccountId,
  initialBucket,
}: {
  initialAccountId: string | null;
  initialBucket: string | null;
}) {
  const [mode, setMode] = useState<'bucket' | 'local'>('bucket');

  const tab = (m: 'bucket' | 'local', label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`rounded px-3 py-1 text-sm ${mode === m ? 'bg-slate-200 font-medium' : 'hover:bg-slate-100'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-200 p-2">
        {tab('bucket', 'Bucket → Bucket')}
        {tab('local', 'Local ↔ Bucket')}
      </div>
      <div className="flex-1 overflow-hidden">
        {mode === 'bucket' ? (
          <SyncScreen initialAccountId={initialAccountId} initialBucket={initialBucket} />
        ) : (
          <LocalSyncScreen initialAccountId={initialAccountId} initialBucket={initialBucket} />
        )}
      </div>
    </div>
  );
}
