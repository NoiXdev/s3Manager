import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { VersionsDialog } from './VersionsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const versions = [
  { versionId: 'v2', isLatest: true, isDeleteMarker: false, lastModified: '2024-03-01T00:00:00.000Z', size: 20, etag: '"e2"' },
  { versionId: 'v1', isLatest: false, isDeleteMarker: false, lastModified: '2024-01-01T00:00:00.000Z', size: 10, etag: '"e1"' },
  { versionId: 'dm1', isLatest: false, isDeleteMarker: true, lastModified: '2024-02-01T00:00:00.000Z', size: null, etag: null },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjectVersions: vi.fn().mockResolvedValue({ ok: true, data: versions }),
    restoreObjectVersion: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteObjectVersion: vi.fn().mockResolvedValue({ ok: true, data: true }),
    removeDeleteMarker: vi.fn().mockResolvedValue({ ok: true, data: true }),
    downloadObject: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/x' } }),
  };
});

describe('VersionsDialog', () => {
  it('lists versions with latest and deleted badges', async () => {
    wrap(<VersionsDialog accountId="acc-1" bucket="b" objectKey="a.txt" onClose={vi.fn()} />);
    expect(await screen.findByText('latest')).toBeInTheDocument();
    expect(screen.getByText('deleted')).toBeInTheDocument();
  });

  it('restores an older version', async () => {
    wrap(<VersionsDialog accountId="acc-1" bucket="b" objectKey="a.txt" onClose={vi.fn()} />);
    await screen.findByText('latest');
    const restoreButtons = screen.getAllByRole('button', { name: 'Restore' });
    await userEvent.click(restoreButtons[0]);
    expect(window.s3.restoreObjectVersion).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'v1' });
  });

  it('permanently deletes a version after confirmation', async () => {
    wrap(<VersionsDialog accountId="acc-1" bucket="b" objectKey="a.txt" onClose={vi.fn()} />);
    await screen.findByText('latest');
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(window.s3.deleteObjectVersion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete version' }));
    expect(window.s3.deleteObjectVersion).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'v2' });
  });

  it('removes a delete marker after confirmation', async () => {
    wrap(<VersionsDialog accountId="acc-1" bucket="b" objectKey="a.txt" onClose={vi.fn()} />);
    await screen.findByText('latest');
    await userEvent.click(screen.getByRole('button', { name: 'Remove marker' }));
    expect(window.s3.removeDeleteMarker).not.toHaveBeenCalled();
    // The row button and the confirm button share the English label; the confirm one is rendered last.
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove marker' }).at(-1)!);
    expect(window.s3.removeDeleteMarker).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'b', key: 'a.txt', versionId: 'dm1' });
  });

  it('closes on Escape (shared Modal)', async () => {
    const onClose = vi.fn();
    wrap(<VersionsDialog accountId="acc-1" bucket="b" objectKey="a.txt" onClose={onClose} />);
    await screen.findByText('latest');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
