import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Dashboard } from './Dashboard';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const accounts = [
  { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 },
  { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', createdAt: 2 },
];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: accounts }) },
    listBuckets: vi.fn((id: string) =>
      id === 'acc-1'
        ? Promise.resolve({ ok: true, data: ['assets'] })
        : Promise.resolve({ ok: true, data: ['x', 'y'] }),
    ),
  };
});

describe('Dashboard', () => {
  it('shows totals and a per-account breakdown', async () => {
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(await screen.findByText('Accounts')).toBeInTheDocument();
    expect(await screen.findByText('2')).toBeInTheDocument(); // accounts
    expect(await screen.findByText('3')).toBeInTheDocument(); // buckets (1 + 2)
    expect(await screen.findByRole('button', { name: 'Open account AWS prod' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'assets' })).toBeInTheDocument();
  });

  it('opens a bucket via click-through', async () => {
    const onOpenBucket = vi.fn();
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={onOpenBucket} />);
    await userEvent.click(await screen.findByRole('button', { name: 'assets' }));
    expect(onOpenBucket).toHaveBeenCalledWith('acc-1', 'assets');
  });

  it('shows an onboarding empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
      listBuckets: vi.fn(),
    };
    wrap(<Dashboard onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });
});
