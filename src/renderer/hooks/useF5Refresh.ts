import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Section } from '../components/SectionNav';
import { hasOpenModal } from '../components/ui/Modal';
import { accountsKey } from './useAccounts';
import { bucketsKey } from './useBuckets';
import { bucketVersioningKey } from './useBucketVersioning';
import { corsKey } from './useCors';
import { objectLockKey } from './useObjectLock';
import { objectsKey } from './useObjects';
import { objectVersionsKey } from './useObjectVersions';

export interface F5RefreshContext {
  section: Section;
  accountId: string | null;
  bucket: string | null;
  prefix: string;
  selectedKey: string | null;
}

function refreshKeys({ section, accountId, bucket, prefix, selectedKey }: F5RefreshContext): QueryKey[] {
  switch (section) {
    case 'files': {
      const keys: QueryKey[] = [objectsKey(accountId, bucket, prefix), bucketsKey(accountId)];
      if (selectedKey !== null) {
        keys.push(
          ['objectMetadata', accountId, bucket, selectedKey],
          ['objectVisibility', accountId, bucket, selectedKey],
          objectVersionsKey(accountId, bucket, selectedKey),
          objectLockKey(accountId, bucket),
        );
      }
      return keys;
    }
    case 'dashboard':
      return [accountsKey, ['buckets']];
    case 'connections':
      return [accountsKey];
    case 'cors':
      return [corsKey(accountId, bucket)];
    case 'objectLock':
      return [objectLockKey(accountId, bucket)];
    case 'versioning':
      return [bucketVersioningKey(accountId, bucket)];
    case 'settings':
      return [['settings'], ['appInfo']];
    default:
      return [];
  }
}

export function useF5Refresh(context: F5RefreshContext) {
  const queryClient = useQueryClient();
  const { section, accountId, bucket, prefix, selectedKey } = context;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'F5' || event.defaultPrevented) return;
      event.preventDefault();
      if (event.repeat || hasOpenModal()) return;
      void Promise.all(
        refreshKeys({ section, accountId, bucket, prefix, selectedKey }).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [queryClient, section, accountId, bucket, prefix, selectedKey]);
}
