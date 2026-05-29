import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncSection } from './SyncSection';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    onSyncProgress: vi.fn(() => () => {}),
  };
});

describe('SyncSection', () => {
  it('shows bucket sync by default and toggles to local sync', async () => {
    wrap(<SyncSection initialAccountId={null} initialBucket={null} />);
    expect(screen.getByText('Sync (bucket → bucket)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Local ↔ Bucket' }));
    expect(screen.getByText('Sync (local ↔ bucket)')).toBeInTheDocument();
  });
});
