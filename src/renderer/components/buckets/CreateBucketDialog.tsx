import { useState } from 'react';
import { FiX } from 'react-icons/fi';
import { useCreateBucket } from '../../hooks/useCreateBucket';
import { useToast } from '../ui/ToastProvider';

export function isValidBucketName(name: string): boolean {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name)) return false;
  if (name.includes('..')) return false; // no consecutive dots
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return false; // not IP-address formatted
  return true;
}

export function CreateBucketDialog({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: (bucket: string) => void;
}) {
  const create = useCreateBucket(accountId);
  const { show } = useToast();
  const [name, setName] = useState('');
  const [objectLock, setObjectLock] = useState(false);
  const [versioning, setVersioning] = useState(false);

  const trimmed = name.trim();
  const valid = isValidBucketName(trimmed);

  const onSubmit = async () => {
    try {
      await create.mutateAsync({ bucket: trimmed, objectLock, versioning: objectLock || versioning });
      show('Bucket created');
      onCreated(trimmed);
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-96 rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Create bucket</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <label className="block text-sm">
          Bucket name
          <input
            aria-label="Bucket name"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>
        {trimmed.length > 0 && !valid && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            3–63 characters, lowercase letters, numbers, hyphens or dots (no consecutive dots), starting and ending with a letter or number.
          </p>
        )}

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" aria-label="Enable Object Lock" checked={objectLock} onChange={(e) => setObjectLock(e.target.checked)} />
          Enable Object Lock
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="Enable versioning"
            checked={objectLock || versioning}
            disabled={objectLock}
            onChange={(e) => setVersioning(e.target.checked)}
          />
          Enable versioning
        </label>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          The bucket is created in this account's region. Object Lock can only be enabled at creation and requires versioning.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!valid || create.isPending}
            className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300"
            onClick={onSubmit}
          >
            Create bucket
          </button>
        </div>
      </div>
    </div>
  );
}
