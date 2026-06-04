import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { BucketSelect } from './BucketSelect';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
  };
});

describe('BucketSelect', () => {
  it('lists buckets and fires onSelect on change', async () => {
    const onSelect = vi.fn();
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
    expect(onSelect).toHaveBeenCalledWith('assets');
  });

  it('disables the dropdown and hides create when no account is selected', () => {
    wrap(<BucketSelect accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Bucket')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Create bucket' })).not.toBeInTheDocument();
  });

  it('opens the create-bucket dialog from the + button', async () => {
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(screen.getByText('Create bucket', { selector: 'p' })).toBeInTheDocument();
  });
});
