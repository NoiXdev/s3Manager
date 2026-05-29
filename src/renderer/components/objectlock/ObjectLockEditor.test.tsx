import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ObjectLockEditor } from './ObjectLockEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

function setS3(lock: unknown) {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: lock }),
    putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
}

describe('ObjectLockEditor', () => {
  beforeEach(() => setS3({ enabled: true, defaultRetention: { mode: 'GOVERNANCE', days: 30, years: null } }));

  it('shows the read-only info panel when Object Lock is not enabled', async () => {
    setS3({ enabled: false, defaultRetention: null });
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    expect(await screen.findByText(/Object Lock is not enabled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('loads the default retention and saves an edited period', async () => {
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    const period = await screen.findByLabelText('Retention period');
    expect(period).toHaveValue(30);
    await userEvent.clear(period);
    await userEvent.type(period, '60');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({
      accountId: 'acc-1', bucket: 'assets', retention: { mode: 'GOVERNANCE', days: 60, years: null },
    });
  });

  it('removes the default retention after confirmation', async () => {
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    await screen.findByLabelText('Retention period');
    await userEvent.click(screen.getByRole('button', { name: 'Remove default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove default retention' }));
    expect(window.s3.putObjectLockConfig).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', retention: null });
  });

  it('disables Save when the period is empty', async () => {
    setS3({ enabled: true, defaultRetention: null });
    wrap(<ObjectLockEditor initialAccountId="acc-1" initialBucket="assets" />);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
