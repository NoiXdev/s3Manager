import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountSelect } from './AccountSelect';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
  };
});

describe('AccountSelect', () => {
  it('lists accounts with provider label and fires onSelect on change', async () => {
    const onSelect = vi.fn();
    wrap(<AccountSelect selectedId={null} onSelect={onSelect} />);
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'acc-1');
    expect(onSelect).toHaveBeenCalledWith('acc-1');
  });

  it('shows a placeholder option when nothing is selected', async () => {
    wrap(<AccountSelect selectedId={null} onSelect={() => {}} />);
    await screen.findByRole('option', { name: 'Select account' });
    expect(screen.getByRole('option', { name: 'Select account' })).toBeInTheDocument();
  });
});
