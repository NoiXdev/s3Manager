import { unwrap } from '../../lib/result';

export function LocalFolderPicker({
  path,
  onPick,
}: {
  path: string | null;
  onPick: (p: string) => void;
}) {
  const choose = async () => {
    const picked = unwrap(await window.s3.selectSyncDirectory());
    if (picked) onPick(picked);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
        onClick={choose}
      >
        Choose folder…
      </button>
      <span className="truncate text-sm text-slate-600">{path ?? 'No folder chosen'}</span>
    </div>
  );
}
