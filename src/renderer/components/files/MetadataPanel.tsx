import { useState } from 'react';
import { useObjectDetails } from '../../hooks/useObjectDetails';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { useObjectActions } from '../../hooks/useObjectActions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useTransfer } from '../../hooks/useTransfer';
import { useToast } from '../ui/ToastProvider';
import { parentPrefix, baseName } from '../../lib/keys';
import { NameDialog } from '../transfer/NameDialog';
import { MoveDialog } from '../transfer/MoveDialog';

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
  const { metadata, visibility, setVisibility } = useObjectDetails(accountId, bucket, objectKey);
  const actions = useObjectActions(accountId ?? '', bucket ?? '');
  const [confirming, setConfirming] = useState(false);
  const [confirmingPublic, setConfirmingPublic] = useState(false);
  const transfer = useTransfer(accountId ?? '', bucket ?? '');
  const { show } = useToast();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);

  return (
    <div className="flex h-full w-80 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</span>
        <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="flex gap-1 border-b border-slate-200 p-2">
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => void actions.download(objectKey)}>
          Download
        </button>
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => void actions.copyPresignedUrl(objectKey)}>
          Copy URL
        </button>
        {!renaming && (
          <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setRenaming(true)}>
            Rename
          </button>
        )}
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => setMoving(true)}>
          Move
        </button>
        {!confirming && (
          <button type="button" className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={`Delete ${objectKey}?`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await actions.deleteObject(objectKey);
            onClose();
          }}
        />
      )}

      {renaming && (
        <NameDialog
          title={`Rename ${baseName(objectKey)}`}
          initialValue={baseName(objectKey)}
          confirmLabel="Rename"
          onCancel={() => setRenaming(false)}
          onConfirm={async (name) => {
            setRenaming(false);
            try {
              await transfer.moveObject.mutateAsync({ sourceKey: objectKey, destKey: `${parentPrefix(objectKey)}${name}` });
              show('Renamed');
              onClose();
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

      {moving && (
        <MoveDialog
          accountId={accountId ?? ''}
          bucket={bucket ?? ''}
          item={{ kind: 'file', name: baseName(objectKey), parent: parentPrefix(objectKey), key: objectKey }}
          onClose={() => setMoving(false)}
          onMoved={onClose}
        />
      )}

      {confirmingPublic && (
        <ConfirmDialog
          message="Make this object publicly readable by anyone?"
          confirmLabel="Make public"
          onCancel={() => setConfirmingPublic(false)}
          onConfirm={async () => {
            setConfirmingPublic(false);
            try {
              await setVisibility.mutateAsync('public');
              show('Made public');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}

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
          {visibility.isSuccess && (visibility.data === 'public' || visibility.data === 'private') && !confirmingPublic && (
            <button
              type="button"
              disabled={setVisibility.isPending}
              className="mt-1 self-start rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
              onClick={async () => {
                if (visibility.data === 'private') {
                  setConfirmingPublic(true);
                  return;
                }
                try {
                  await setVisibility.mutateAsync('private');
                  show('Made private');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              {visibility.data === 'public' ? 'Make private' : 'Make public'}
            </button>
          )}
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
