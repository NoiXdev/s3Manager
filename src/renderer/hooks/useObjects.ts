import { useInfiniteQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { FolderEntry, FileEntry } from '../../main/s3/listTransform';
import type { ListObjectsResult } from '../../main/s3/objects';

export function objectsKey(accountId: string | null, bucket: string | null, prefix: string) {
  return ['objects', accountId, bucket, prefix] as const;
}

export function useObjects(accountId: string | null, bucket: string | null, prefix: string) {
  const query = useInfiniteQuery({
    queryKey: objectsKey(accountId, bucket, prefix),
    enabled: accountId !== null && bucket !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await window.s3.listObjects({ accountId: accountId!, bucket: bucket!, prefix, continuationToken: pageParam }),
      ),
    getNextPageParam: (last: ListObjectsResult) => last.nextToken ?? undefined,
  });

  const pages = query.data?.pages ?? [];
  const folderMap = new Map<string, FolderEntry>();
  for (const page of pages) for (const f of page.folders) folderMap.set(f.prefix, f);
  const folders: FolderEntry[] = [...folderMap.values()];
  const files: FileEntry[] = pages.flatMap((p) => p.files);

  return { query, folders, files };
}
