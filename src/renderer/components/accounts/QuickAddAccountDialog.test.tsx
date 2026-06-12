import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { QuickAddAccountDialog } from './QuickAddAccountDialog';

const created = { id: 'acc-9', label: 'New acc', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

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
    accounts: { create: vi.fn().mockResolvedValue({ ok: true, data: created }) },
  };
});

describe('QuickAddAccountDialog', () => {
  it('renders the account form inside a dialog', () => {
    wrap(<QuickAddAccountDialog onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add account', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });

  it('submits the form and reports the created account', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    wrap(<QuickAddAccountDialog onClose={onClose} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Label'), 'New acc');
    await userEvent.type(screen.getByLabelText('Region'), 'eu-central-1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'sek');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via the close button without creating', async () => {
    const onClose = vi.fn();
    wrap(<QuickAddAccountDialog onClose={onClose} onCreated={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(
      (window.s3 as unknown as { accounts: { create: ReturnType<typeof vi.fn> } }).accounts.create,
    ).not.toHaveBeenCalled();
  });

  it('shows an error and stays open when creation fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { create: vi.fn().mockResolvedValue({ ok: false, error: { code: 'Unknown', message: 'create failed' } }) },
    };
    const onClose = vi.fn();
    const onCreated = vi.fn();
    wrap(<QuickAddAccountDialog onClose={onClose} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Label'), 'New acc');
    await userEvent.type(screen.getByLabelText('Region'), 'eu-central-1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'sek');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    expect(await screen.findByText(/create failed/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
