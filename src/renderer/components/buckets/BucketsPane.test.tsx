import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BucketsPane } from './BucketsPane';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets', 'backups'] }),
  };
});

describe('BucketsPane', () => {
  it('prompts to select an account when none is selected', () => {
    wrap(<BucketsPane accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.getByText('Select an account')).toBeInTheDocument();
  });

  it('lists buckets and selects one on click', async () => {
    const onSelect = vi.fn();
    wrap(<BucketsPane accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await userEvent.click(await screen.findByText('backups'));
    expect(onSelect).toHaveBeenCalledWith('backups');
  });
});
