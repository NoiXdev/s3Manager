import { useObjects } from '../../hooks/useObjects';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { Breadcrumb } from './Breadcrumb';

export function FileBrowser({
  accountId,
  bucket,
  prefix,
  selectedKey,
  onNavigate,
  onSelectFile,
}: {
  accountId: string | null;
  bucket: string | null;
  prefix: string;
  selectedKey: string | null;
  onNavigate: (prefix: string) => void;
  onSelectFile: (key: string) => void;
}) {
  const { query, folders, files } = useObjects(accountId, bucket, prefix);

  if (bucket === null) {
    return <div className="flex h-full items-center justify-center text-slate-400">Select a bucket</div>;
  }

  const isEmpty = query.isSuccess && folders.length === 0 && files.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
      </div>

      {query.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {query.isError && <p className="p-3 text-red-600">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500">This folder is empty</p>}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <tbody>
            {folders.map((folder) => (
              <tr
                key={folder.prefix}
                onClick={() => onNavigate(folder.prefix)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-1.5">📁 <span>{folder.name}</span></td>
                <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                <td className="px-3 py-1.5 text-slate-400">—</td>
              </tr>
            ))}
            {files.map((file) => (
              <tr
                key={file.key}
                onClick={() => onSelectFile(file.key)}
                className={`cursor-pointer border-b border-slate-100 ${
                  file.key === selectedKey ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <td className="px-3 py-1.5">📄 <span>{file.name}</span></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(file.size)}</td>
                <td className="px-3 py-1.5 text-slate-500">{formatTimestamp(file.lastModified)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {query.hasNextPage && (
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
            className="m-3 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
