import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { CorsEditor } from './CorsEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const rule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };
const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('CorsEditor', () => {
  it('loads the seeded bucket rules and saves the working set', async () => {
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    expect(await screen.findByRole('checkbox', { name: 'GET' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.s3.putBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', rules: [rule] });
  });

  it('clears all rules after confirmation', async () => {
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all rules' }));
    expect(window.s3.deleteBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets' });
  });

  it('adds a rule via "+ Add rule"', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
      getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
      deleteBucketCors: vi.fn(),
    };
    wrap(<CorsEditor initialAccountId="acc-1" initialBucket="assets" />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add rule' }));
    expect(screen.getByRole('button', { name: 'Remove rule' })).toBeInTheDocument();
  });
});
