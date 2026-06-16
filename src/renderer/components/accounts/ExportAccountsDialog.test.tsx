import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { ExportAccountsDialog } from './ExportAccountsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { export: vi.fn().mockResolvedValue({ ok: true, data: 'EXPORT-BLOB' }) },
    saveTextFile: vi.fn().mockResolvedValue({ ok: true, data: { saved: true } }),
  };
});

describe('ExportAccountsDialog', () => {
  it('warns when no password is set and generates the export string', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    expect(screen.getByText(/secret keys are not encrypted/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    const out = await screen.findByLabelText('Export string');
    expect(out).toHaveValue('EXPORT-BLOB');
  });

  it('downloads the generated string via saveTextFile', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    await screen.findByLabelText('Export string');
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(window.s3.saveTextFile).toHaveBeenCalledWith({ defaultName: 's3manager-accounts.txt', contents: 'EXPORT-BLOB' }),
    );
  });

  it('hides the warning once a password is entered', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Password (optional)'), 'pw');
    expect(screen.queryByText(/secret keys are not encrypted/i)).not.toBeInTheDocument();
  });

  it('toasts an error when generation fails', async () => {
    (window.s3 as unknown as { accounts: { export: ReturnType<typeof vi.fn> } }).accounts.export = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'SecretUnavailable', message: 'Cannot read the secret.' } });
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    expect(await screen.findByText(/Cannot read the secret\./)).toBeInTheDocument();
  });

  it('hides the password field once the export string is shown', async () => {
    wrap(<ExportAccountsDialog accountIds={['a']} onClose={() => {}} />);
    expect(screen.getByLabelText('Password (optional)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate export' }));
    await screen.findByLabelText('Export string');
    expect(screen.queryByLabelText('Password (optional)')).not.toBeInTheDocument();
  });
});
