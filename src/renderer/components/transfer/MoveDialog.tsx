import { FiX } from 'react-icons/fi';
import { useTransfer } from '../../hooks/useTransfer';
import { useToast } from '../ui/ToastProvider';
import { FolderPicker } from './FolderPicker';

export type MoveItem =
  | { kind: 'file'; name: string; parent: string; key: string }
  | { kind: 'folder'; name: string; parent: string; prefix: string };

export function MoveDialog({
  accountId,
  bucket,
  item,
  onClose,
  onMoved,
}: {
  accountId: string;
  bucket: string;
  item: MoveItem;
  /** Dismiss the dialog (cancel, and after a successful move). */
  onClose: () => void;
  /** Called on a successful move, before onClose — e.g. to close a panel whose object no longer exists. */
  onMoved?: () => void;
}) {
  const transfer = useTransfer(accountId, bucket);
  const { show } = useToast();

  const canPick = (dest: string) => {
    if (dest === item.parent) return false; // no-op: same location
    if (item.kind === 'folder' && (dest === item.prefix || dest.startsWith(item.prefix))) return false; // into itself
    return true;
  };

  const onPick = async (dest: string) => {
    try {
      if (item.kind === 'file') {
        await transfer.moveObject.mutateAsync({ sourceKey: item.key, destKey: dest + item.name });
      } else {
        await transfer.moveFolder.mutateAsync({ sourcePrefix: item.prefix, destPrefix: `${dest}${item.name}/` });
      }
      show('Moved');
      onMoved?.();
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-96 rounded bg-white p-4 shadow-lg">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800">Move &ldquo;{item.name}&rdquo; to&hellip;</p>
          <button type="button" aria-label="Cancel" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <FolderPicker accountId={accountId} bucket={bucket} canPick={canPick} onPick={onPick} />
      </div>
    </div>
  );
}
