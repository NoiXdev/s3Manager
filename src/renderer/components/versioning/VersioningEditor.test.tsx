import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { VersioningEditor } from './VersioningEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function setS3(status: string) {
  (window as unknown as { s3: unknown }).s3 = {
    getBucketVersioning: vi.fn().mockResolvedValue({ ok: true, data: { status } }),
    putBucketVersioning: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
}

describe('VersioningEditor', () => {
  beforeEach(() => setS3('Unversioned'));

  it('prompts to select a bucket when none chosen', () => {
    wrap(<VersioningEditor accountId="acc-1" bucket={null} />);
    expect(screen.getByText(/Select a bucket to view its versioning status/i)).toBeInTheDocument();
  });

  it('enables versioning directly when not enabled', async () => {
    wrap(<VersioningEditor accountId="acc-1" bucket="assets" />);
    expect(await screen.findByText('Not enabled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enable versioning' }));
    expect(window.s3.putBucketVersioning).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', enabled: true });
  });

  it('suspends with confirmation when enabled', async () => {
    setS3('Enabled');
    wrap(<VersioningEditor accountId="acc-1" bucket="assets" />);
    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Suspend versioning' }));
    // The confirm dialog's button shares the same English label; it is rendered last.
    await userEvent.click(screen.getAllByRole('button', { name: 'Suspend versioning' }).at(-1)!);
    expect(window.s3.putBucketVersioning).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', enabled: false });
  });

  it('shows an inline error when the query fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      getBucketVersioning: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'no perms' } }),
      putBucketVersioning: vi.fn(),
    };
    wrap(<VersioningEditor accountId="acc-1" bucket="assets" />);
    expect(await screen.findByText('AccessDenied: no perms')).toBeInTheDocument();
  });
});
