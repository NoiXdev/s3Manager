import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  it('lists buckets and fires onSelect on choose', async () => {
    const onSelect = vi.fn();
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByLabelText('Bucket'));
    await userEvent.click(await screen.findByRole('option', { name: 'assets' }));
    expect(onSelect).toHaveBeenCalledWith('assets');
  });

  it('disables the combobox with a hint when no account is selected', () => {
    wrap(<BucketSelect accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Bucket')).toBeDisabled();
    expect(screen.getByLabelText('Bucket')).toHaveTextContent('Select account first');
  });

  it('is disabled by the disabled prop even when an account is selected', () => {
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={() => {}} disabled />);
    expect(screen.getByLabelText('Bucket')).toBeDisabled();
  });

  it('opens the create-bucket dialog from the footer action', async () => {
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByLabelText('Bucket'));
    await userEvent.click(screen.getByRole('button', { name: '+ Create bucket' }));
    expect(screen.getByText('Create bucket', { selector: 'p' })).toBeInTheDocument();
  });

  it('selects the bucket created via the dialog', async () => {
    (window.s3 as unknown as Record<string, unknown>).createBucket = vi
      .fn()
      .mockResolvedValue({ ok: true, data: true });
    const onSelect = vi.fn();
    wrap(<BucketSelect accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByLabelText('Bucket'));
    await userEvent.click(screen.getByRole('button', { name: '+ Create bucket' }));
    await userEvent.type(screen.getByLabelText('Bucket name'), 'new-bucket');
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('new-bucket'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
