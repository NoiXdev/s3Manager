import { useEffect, useState } from 'react';
import { FiX, FiTrash2 } from 'react-icons/fi';
import { useObjectMetadataEditor } from '../../hooks/useObjectMetadataEditor';
import { useToast } from '../ui/ToastProvider';

interface Pair {
  key: string;
  value: string;
}

export function MetadataDialog({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string;
  bucket: string;
  objectKey: string;
  onClose: () => void;
}) {
  const { editable, update } = useObjectMetadataEditor(accountId, bucket, objectKey);
  const { show } = useToast();
  const [contentType, setContentType] = useState('');
  const [cacheControl, setCacheControl] = useState('');
  const [contentDisposition, setContentDisposition] = useState('');
  const [pairs, setPairs] = useState<Pair[]>([]);

  useEffect(() => {
    if (editable.data) {
      setContentType(editable.data.contentType ?? '');
      setCacheControl(editable.data.cacheControl ?? '');
      setContentDisposition(editable.data.contentDisposition ?? '');
      setPairs(Object.entries(editable.data.metadata).map(([key, value]) => ({ key, value })));
    }
  }, [editable.data]);

  const onSave = async () => {
    const trimmed = pairs.map((p) => ({ key: p.key.trim(), value: p.value })).filter((p) => p.key);
    const seen = new Set<string>();
    for (const p of trimmed) {
      if (seen.has(p.key)) {
        show(`Duplicate metadata key: ${p.key}`, 'error');
        return;
      }
      seen.add(p.key);
    }
    const metadata: Record<string, string> = {};
    for (const p of trimmed) metadata[p.key] = p.value;
    try {
      await update.mutateAsync({
        contentType: contentType.trim() || null,
        cacheControl: cacheControl.trim() || null,
        contentDisposition: contentDisposition.trim() || null,
        metadata,
      });
      show('Metadata saved');
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  const field = 'mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm';

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-[34rem] overflow-auto rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Edit metadata</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}><FiX className="h-4 w-4" aria-hidden /></button>
        </div>

        {editable.isLoading && <p className="py-4 text-sm text-slate-500">Loading metadata…</p>}
        {editable.isError && <p className="py-4 text-sm text-red-600">{(editable.error as Error).message}</p>}

        {editable.isSuccess && (
          <>
            <label className="block text-sm">
              Content-Type
              <input aria-label="Content-Type" className={field} value={contentType} onChange={(e) => setContentType(e.target.value)} />
            </label>
            <label className="mt-2 block text-sm">
              Cache-Control
              <input aria-label="Cache-Control" className={field} value={cacheControl} onChange={(e) => setCacheControl(e.target.value)} />
            </label>
            <label className="mt-2 block text-sm">
              Content-Disposition
              <input aria-label="Content-Disposition" className={field} value={contentDisposition} onChange={(e) => setContentDisposition(e.target.value)} />
            </label>

            <p className="mt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom metadata</p>
            <div className="flex flex-col gap-1">
              {pairs.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Metadata key ${i + 1}`}
                    className="w-1/3 rounded border border-slate-300 px-1 py-0.5 text-xs"
                    placeholder="key"
                    value={p.key}
                    onChange={(e) => setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
                  />
                  <input
                    aria-label={`Metadata value ${i + 1}`}
                    className="flex-1 rounded border border-slate-300 px-1 py-0.5 text-xs"
                    placeholder="value"
                    value={p.value}
                    onChange={(e) => setPairs((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                  />
                  <button
                    type="button"
                    aria-label={`Remove metadata ${i + 1}`}
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setPairs((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <FiTrash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="mt-1 self-start rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                onClick={() => setPairs((prev) => [...prev, { key: '', value: '' }])}
              >
                Add field
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-400">Saving rewrites the object's metadata (its ETag and last-modified change).</p>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onClose}>Cancel</button>
              <button
                type="button"
                disabled={update.isPending}
                className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
                onClick={onSave}
              >
                Save metadata
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
