import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncRunProvider } from './SyncRunProvider';
import { LocalSyncScreen } from './LocalSyncScreen';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SyncRunProvider>{node}</SyncRunProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', label: 'AWS' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: '/data' }),
    onSyncProgress: vi.fn(() => () => {}),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

async function chooseFolderAndBucket() {
  await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
  await screen.findByText('/data');
  await screen.findByRole('option', { name: 'AWS' });
  await userEvent.selectOptions(screen.getByLabelText('Bucket account'), 'a1');
  await userEvent.selectOptions(await screen.findByLabelText('Bucket bucket'), 'assets');
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('LocalSyncScreen', () => {
  it('Preview shows the plan summary and sends upload args', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 0, bytesToCopy: 50, sample: [] } }),
    });
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    await chooseFolderAndBucket();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/2 to copy/)).toBeInTheDocument();
    expect(window.s3.localSyncPlan).toHaveBeenCalledWith({
      direction: 'upload', localPath: '/data', remote: { accountId: 'a1', bucket: 'assets', prefix: '' },
    });
  });

  it('toggles the direction to download', async () => {
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    const dl = screen.getByRole('button', { name: 'Download (bucket → local)' });
    await userEvent.click(dl);
    expect(dl).toHaveAttribute('aria-pressed', 'true');
  });

  it('an empty plan disables Run sync', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      localSyncPlan: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 0, upToDate: 3, bytesToCopy: 0, sample: [] } }),
    });
    wrap(<LocalSyncScreen initialAccountId={null} initialBucket={null} />);
    await chooseFolderAndBucket();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Already in sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeDisabled();
  });
});
