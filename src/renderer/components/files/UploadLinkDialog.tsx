import { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { useToast } from '../ui/ToastProvider';

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

export function UploadLinkDialog({
  accountId,
  bucket,
  prefix,
  onClose,
}: {
  accountId: string;
  bucket: string;
  prefix: string;
  onClose: () => void;
}) {
  const { show } = useToast();
  const [name, setName] = useState('');
  const [expiresIn, setExpiresIn] = useState(3600);
  const [url, setUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed !== '' && !trimmed.includes('/');

  const generate = async () => {
    setPending(true);
    try {
      const r = await window.s3.presignPut({ accountId, bucket, key: prefix + trimmed, expiresIn });
      if (r.ok) setUrl(r.data);
      else show(`${r.error.code}: ${r.error.message}`, 'error');
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    show('Upload link copied');
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-[28rem] rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Upload link</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><FiX className="h-4 w-4" aria-hidden /></button>
        </div>

        <label className="block text-sm">
          File name
          <input
            aria-label="File name"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={name}
            onChange={(e) => { setName(e.target.value); setUrl(null); }}
            autoFocus
          />
        </label>

        <label className="mt-3 block text-sm">
          Expiry
          <select
            aria-label="Expiry"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={expiresIn}
            onChange={(e) => { setExpiresIn(Number(e.target.value)); setUrl(null); }}
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <p className="pt-2 text-xs text-slate-500 dark:text-slate-400">
          Uploads to <span className="break-all font-mono text-slate-600 dark:text-slate-400">{prefix}{trimmed}</span>
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>Close</button>
          <button
            type="button"
            disabled={!valid || pending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            onClick={generate}
          >
            Generate link
          </button>
        </div>

        {url && (
          <div className="mt-4 flex flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <input readOnly aria-label="Upload URL" className="w-full rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={url} />
            <button type="button" className="self-end rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800" onClick={copy}>
              Copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
