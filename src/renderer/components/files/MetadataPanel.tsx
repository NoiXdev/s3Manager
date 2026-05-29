import { useObjectDetails } from '../../hooks/useObjectDetails';
import { formatBytes, formatTimestamp } from '../../lib/format';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col border-b border-slate-100 py-1.5">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

export function MetadataPanel({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string | null;
  bucket: string | null;
  objectKey: string;
  onClose: () => void;
}) {
  const { metadata, visibility } = useObjectDetails(accountId, bucket, objectKey);

  return (
    <div className="flex h-full w-80 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</span>
        <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 text-sm">
        <Row label="Key" value={objectKey} />

        <div className="flex flex-col border-b border-slate-100 py-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400">Visibility</span>
          <span>
            {visibility.isSuccess ? (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                  visibility.data === 'public' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {visibility.data}
              </span>
            ) : visibility.isError ? (
              <span className="text-xs text-slate-400">unavailable</span>
            ) : (
              '…'
            )}
          </span>
        </div>

        {metadata.isLoading && <p className="py-2 text-slate-500">Loading…</p>}
        {metadata.isError && <p className="py-2 text-red-600">{(metadata.error as Error).message}</p>}

        {metadata.isSuccess && (
          <>
            <Row label="Size" value={formatBytes(metadata.data.size)} />
            <Row label="Content type" value={metadata.data.contentType ?? '—'} />
            <Row label="Last modified" value={formatTimestamp(metadata.data.lastModified)} />
            <Row label="Storage class" value={metadata.data.storageClass ?? '—'} />
            <Row label="ETag" value={metadata.data.etag ?? '—'} />
            {Object.entries(metadata.data.metadata).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
