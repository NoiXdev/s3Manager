import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ImportAccountsDialog } from './ImportAccountsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }, { id: 'n2' }] }) },
    openTextFile: vi.fn().mockResolvedValue({ ok: true, data: 'FILE-BLOB' }),
  };
});

describe('ImportAccountsDialog', () => {
  it('imports a pasted blob and reports the count', async () => {
    const onImported = vi.fn();
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={onImported} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it('loads a file into the textarea', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load file' }));
    await waitFor(() => expect(screen.getByLabelText('Import data')).toHaveValue('FILE-BLOB'));
  });

  it('shows an inline error and stays open on an incorrect password', async () => {
    (window.s3 as unknown as { accounts: { import: ReturnType<typeof vi.fn> } }).accounts.import = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'IncorrectPassword', message: 'Incorrect password.' } });
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
