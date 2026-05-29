import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountsPane } from './AccountsPane';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const oneAccount = [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }];

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: oneAccount }),
      remove: vi.fn().mockResolvedValue({ ok: true, data: true }),
    },
  };
});

describe('AccountsPane', () => {
  it('shows the onboarding empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = { accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    wrap(<AccountsPane selectedId={null} onSelect={() => {}} />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('lists accounts and selects one on click', async () => {
    const onSelect = vi.fn();
    wrap(<AccountsPane selectedId={null} onSelect={onSelect} />);
    const row = await screen.findByText('AWS prod');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('opens the add-account form', async () => {
    wrap(<AccountsPane selectedId={null} onSelect={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add account' }));
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });
});
