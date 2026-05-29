import { useState } from 'react';
import { useObjects } from '../../hooks/useObjects';
import { Breadcrumb } from '../files/Breadcrumb';

export function FolderPicker({
  accountId,
  bucket,
  canPick,
  onPick,
}: {
  accountId: string;
  bucket: string;
  canPick: (prefix: string) => boolean;
  onPick: (prefix: string) => void;
}) {
  const [prefix, setPrefix] = useState('');
  const { query, folders } = useObjects(accountId, bucket, prefix);

  return (
    <div className="flex flex-col gap-2">
      <Breadcrumb prefix={prefix} onNavigate={setPrefix} />
      <div className="h-48 overflow-auto rounded border border-slate-200">
        {query.isLoading && <p className="p-2 text-sm text-slate-500">Loading…</p>}
        {query.isSuccess && folders.length === 0 && (
          <p className="p-2 text-sm text-slate-400">No subfolders</p>
        )}
        <ul>
          {folders.map((folder) => (
            <li key={folder.prefix}>
              <button
                type="button"
                aria-label={folder.name}
                className="block w-full px-2 py-1 text-left text-sm hover:bg-slate-50"
                onClick={() => setPrefix(folder.prefix)}
              >
                📁 {folder.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        disabled={!canPick(prefix)}
        className="self-end rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
        onClick={() => onPick(prefix)}
      >
        Move here
      </button>
    </div>
  );
}
