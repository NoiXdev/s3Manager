import { describe, it, expect, vi } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Modal } from '../components/ui/Modal';
import type { Section } from '../components/SectionNav';
import { useF5Refresh, type F5RefreshContext } from './useF5Refresh';
import { accountsKey } from './useAccounts';
import { bucketsKey } from './useBuckets';
import { bucketVersioningKey } from './useBucketVersioning';
import { corsKey } from './useCors';
import { objectLockKey } from './useObjectLock';
import { objectsKey } from './useObjects';
import { objectVersionsKey } from './useObjectVersions';

const context: F5RefreshContext = {
  section: 'files',
  accountId: 'acc-1',
  bucket: 'assets',
  prefix: 'images/',
  selectedKey: null,
};

function pressF5(options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
}

function renderF5Refresh(initial: F5RefreshContext) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  let current = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useF5Refresh(current), { wrapper });
  return {
    invalidate,
    rendered,
    setContext: (next: F5RefreshContext) => {
      current = next;
    },
  };
}

describe('useF5Refresh', () => {
  it('prevents the default reload and refreshes the current file listing and bucket list', () => {
    const { invalidate } = renderF5Refresh(context);

    const event = pressF5();

    expect(event.defaultPrevented).toBe(true);
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: objectsKey('acc-1', 'assets', 'images/') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bucketsKey('acc-1') });
  });

  it('refreshes selected object data along with the current file listing', () => {
    const { invalidate } = renderF5Refresh({ ...context, selectedKey: 'images/logo.png' });

    pressF5();

    expect(invalidate).toHaveBeenCalledTimes(6);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['objectMetadata', 'acc-1', 'assets', 'images/logo.png'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['objectVisibility', 'acc-1', 'assets', 'images/logo.png'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: objectVersionsKey('acc-1', 'assets', 'images/logo.png') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: objectLockKey('acc-1', 'assets') });
  });

  const sectionCases: { section: Section; keys: QueryKey[] }[] = [
    { section: 'dashboard', keys: [accountsKey, ['buckets']] },
    { section: 'connections', keys: [accountsKey] },
    { section: 'cors', keys: [corsKey('acc-1', 'assets')] },
    { section: 'objectLock', keys: [objectLockKey('acc-1', 'assets')] },
    { section: 'versioning', keys: [bucketVersioningKey('acc-1', 'assets')] },
    { section: 'settings', keys: [['settings'], ['appInfo']] },
    { section: 'sync', keys: [] },
  ];

  it.each(sectionCases)('refreshes the $section view', ({ section, keys }) => {
    const { invalidate } = renderF5Refresh({ ...context, section });

    pressF5();

    expect(invalidate).toHaveBeenCalledTimes(keys.length);
    for (const queryKey of keys) expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });

  it('prevents the reload but does not refetch while a modal is open', () => {
    const { invalidate } = renderF5Refresh(context);
    render(<Modal onDismiss={() => {}}>open</Modal>);

    const event = pressF5();

    expect(event.defaultPrevented).toBe(true);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores other keys and F5 events already handled by another listener', () => {
    const { invalidate } = renderF5Refresh(context);

    pressF5({ key: 'F6' });
    const handled = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.dispatchEvent(handled);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('uses the latest context after navigation changes', () => {
    const { invalidate, rendered, setContext } = renderF5Refresh(context);

    setContext({ ...context, section: 'settings' });
    rendered.rerender();
    pressF5();

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settings'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appInfo'] });
  });
});
