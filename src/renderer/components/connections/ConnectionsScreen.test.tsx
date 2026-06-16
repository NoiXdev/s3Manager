import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ConnectionsScreen } from './ConnectionsScreen';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      list: vi.fn().mockResolvedValue({ ok: true, data: [account] }),
      remove: vi.fn().mockResolvedValue({ ok: true, data: true }),
    },
  };
});

describe('ConnectionsScreen', () => {
  it('lists existing accounts', async () => {
    wrap(<ConnectionsScreen />);
    expect(await screen.findByText('AWS prod')).toBeInTheDocument();
  });

  it('opens the add-account form', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add account' }));
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
  });

  it('opens a pre-filled edit form and submits via the update path', async () => {
    const update = vi.fn().mockResolvedValue({ ok: true, data: { ...account, label: 'AWS renamed' } });
    (window as unknown as { s3: unknown }).s3 = {
      accounts: {
        list: vi.fn().mockResolvedValue({ ok: true, data: [account] }),
        update,
        test: vi.fn().mockResolvedValue({ ok: true, data: true }),
      },
    };
    wrap(<ConnectionsScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit AWS prod' }));

    // form opens pre-filled from the account
    const labelField = screen.getByLabelText('Label');
    expect(labelField).toHaveValue('AWS prod');
    expect(screen.getByLabelText('Region')).toHaveValue('eu-central-1');

    await userEvent.clear(labelField);
    await userEvent.type(labelField, 'AWS renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'acc-1', label: 'AWS renamed', provider: 'amazon-s3' }),
    );
  });

  it('removes an account', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, data: true });
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }), remove },
    };
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove AWS prod' }));
    expect(remove).toHaveBeenCalledWith('acc-1');
  });

  it('calls onAccountRemoved after a successful removal', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true, data: true });
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }), remove },
    };
    const onAccountRemoved = vi.fn();
    wrap(<ConnectionsScreen onAccountRemoved={onAccountRemoved} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove AWS prod' }));
    await waitFor(() => expect(onAccountRemoved).toHaveBeenCalledWith('acc-1'));
  });

  it('shows an empty state when there are no accounts', async () => {
    (window as unknown as { s3: unknown }).s3 = { accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) } };
    wrap(<ConnectionsScreen />);
    expect(await screen.findByText('No accounts yet')).toBeInTheDocument();
  });

  it('opens the export dialog from a row export button', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export AWS prod' }));
    expect(screen.getByText('Export accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('opens the import dialog from the header', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Import' }));
    expect(screen.getByText('Import accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('opens the export-all dialog from the header', async () => {
    wrap(<ConnectionsScreen />);
    await userEvent.click(await screen.findByRole('button', { name: 'Export all' }));
    expect(screen.getByText('Export accounts', { selector: 'p' })).toBeInTheDocument();
  });

  it('disables export-all when there are no accounts', async () => {
    (window.s3 as unknown as { accounts: { list: ReturnType<typeof vi.fn> } }).accounts.list = vi
      .fn()
      .mockResolvedValue({ ok: true, data: [] });
    wrap(<ConnectionsScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export all' })).toBeDisabled());
  });
});
