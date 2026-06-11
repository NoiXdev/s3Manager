import { useEffect, useState } from 'react';
import { FiX, FiTrash2 } from 'react-icons/fi';
import { useObjectAcl } from '../../hooks/useObjectAcl';
import { useToast } from '../ui/ToastProvider';
import type { AclGrant, AclPermission } from '../../../main/s3/objectAcl';

const PERMISSIONS: AclPermission[] = ['FULL_CONTROL', 'WRITE', 'WRITE_ACP', 'READ', 'READ_ACP'];
const GROUPS = [
  { label: 'Everyone (public)', uri: 'http://acs.amazonaws.com/groups/global/AllUsers' },
  { label: 'Authenticated users', uri: 'http://acs.amazonaws.com/groups/global/AuthenticatedUsers' },
  { label: 'Log delivery', uri: 'http://acs.amazonaws.com/groups/s3/LogDelivery' },
];

function granteeLabel(g: AclGrant): string {
  if (g.granteeType === 'Group') return GROUPS.find((x) => x.uri === g.uri)?.label ?? g.uri ?? 'Group';
  if (g.granteeType === 'AmazonCustomerByEmail') return g.email ?? 'Email';
  return g.displayName || g.id || 'Canonical user';
}

export function PermissionsDialog({
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
  const { acl, save } = useObjectAcl(accountId, bucket, objectKey);
  const { show } = useToast();
  const [grants, setGrants] = useState<AclGrant[]>([]);
  const [addType, setAddType] = useState<'Group' | 'CanonicalUser'>('Group');
  const [addUri, setAddUri] = useState(GROUPS[0].uri);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addPerm, setAddPerm] = useState<AclPermission>('READ');

  useEffect(() => {
    if (acl.data) setGrants(acl.data.grants);
  }, [acl.data]);

  const canAdd = addType === 'Group' || addId.trim() !== '';

  const addGrant = () => {
    const grant: AclGrant =
      addType === 'Group'
        ? { granteeType: 'Group', uri: addUri, permission: addPerm }
        : { granteeType: 'CanonicalUser', id: addId.trim(), displayName: addName.trim() || undefined, permission: addPerm };
    setGrants((prev) => [...prev, grant]);
  };

  const onSave = async () => {
    if (!acl.data) return;
    try {
      await save.mutateAsync({ owner: acl.data.owner, grants });
      show('Permissions saved');
      onClose();
    } catch (e) {
      show((e as Error).message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="max-h-[80vh] w-[34rem] overflow-auto rounded bg-white p-4 shadow-lg dark:bg-slate-900">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Permissions</p>
          <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}><FiX className="h-4 w-4" aria-hidden /></button>
        </div>

        {acl.isLoading && <p className="py-4 text-sm text-slate-500 dark:text-slate-400">Loading permissions…</p>}
        {acl.isError && <p className="py-4 text-sm text-red-600">{(acl.error as Error).message}</p>}

        {acl.isSuccess && (
          <>
            <p className="pb-2 text-xs text-slate-500 dark:text-slate-400">
              Owner: <span className="text-slate-700 dark:text-slate-200">{acl.data.owner.displayName || acl.data.owner.id || '—'}</span>
            </p>

            <table className="w-full text-left text-sm">
              <tbody>
                {grants.map((g, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-2 break-all">{granteeLabel(g)}</td>
                    <td className="py-1.5 pr-2">
                      <select
                        aria-label={`Permission for ${granteeLabel(g)}`}
                        className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        value={g.permission}
                        onChange={(e) =>
                          setGrants((prev) => prev.map((x, j) => (j === i ? { ...x, permission: e.target.value as AclPermission } : x)))
                        }
                      >
                        {PERMISSIONS.map((p) => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Remove ${granteeLabel(g)}`}
                        className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-slate-500"
                        onClick={() => setGrants((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <FiTrash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
                {grants.length === 0 && (
                  <tr>
                    <td className="py-2 text-xs text-slate-400 dark:text-slate-500" colSpan={3}>No grants</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <select
                aria-label="Grantee type"
                className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                value={addType}
                onChange={(e) => setAddType(e.target.value as 'Group' | 'CanonicalUser')}
              >
                <option value="Group">Group</option>
                <option value="CanonicalUser">Canonical User</option>
              </select>
              {addType === 'Group' ? (
                <select aria-label="Group" className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={addUri} onChange={(e) => setAddUri(e.target.value)}>
                  {GROUPS.map((g) => (
                    <option key={g.uri} value={g.uri}>{g.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input aria-label="Canonical user ID" className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Canonical user ID" value={addId} onChange={(e) => setAddId(e.target.value)} />
                  <input aria-label="Display name" className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Display name (optional)" value={addName} onChange={(e) => setAddName(e.target.value)} />
                </>
              )}
              <select aria-label="New grant permission" className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" value={addPerm} onChange={(e) => setAddPerm(e.target.value as AclPermission)}>
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button type="button" disabled={!canAdd} className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800" onClick={addGrant}>
                Add
              </button>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>Cancel</button>
              <button type="button" disabled={save.isPending} className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-slate-300" onClick={onSave}>
                Save permissions
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
