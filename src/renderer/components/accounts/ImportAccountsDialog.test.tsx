import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function setS3(over: Record<string, unknown> = {}) {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: {
      import: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'n1' }] }),
      importPreview: vi.fn().mockResolvedValue({ ok: true, data: { encrypted: false, accounts: [{ label: 'AWS prod', provider: 'amazon-s3' }] } }),
      ...over,
    },
    openTextFile: vi.fn().mockResolvedValue({ ok: true, data: 'FILE-BLOB' }),
  };
}

beforeEach(() => setS3());

describe('ImportAccountsDialog', () => {
  it('previews an unencrypted blob: shows the list, no password field, import enabled', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    expect(await screen.findByText('AWS prod (Amazon S3)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('imports after previewing and reports the count', async () => {
    const onImported = vi.fn();
    const onClose = vi.fn();
    wrap(<ImportAccountsDialog onClose={onClose} onImported={onImported} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'BLOB');
    await screen.findByText('AWS prod (Amazon S3)');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await screen.findByText('AWS prod (Amazon S3)');
    expect(window.s3.accounts.import).toHaveBeenCalledWith({ blob: 'BLOB', password: undefined });
    expect(onImported).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the password field for an encrypted blob and previews after the password', async () => {
    setS3({
      importPreview: vi.fn().mockImplementation(async (input: { password?: string }) =>
        input.password
          ? { ok: true, data: { encrypted: true, accounts: [{ label: 'Hetzner', provider: 'hetzner' }] } }
          : { ok: true, data: { encrypted: true, accounts: null } },
      ),
    });
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'ENC');
    const pw = await screen.findByLabelText('Password');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    await userEvent.type(pw, 'secret');
    expect(await screen.findByText('Hetzner (Hetzner Object Storage)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('shows an inline error on an incorrect password and keeps Import disabled', async () => {
    setS3({
      importPreview: vi.fn().mockImplementation(async (input: { password?: string }) =>
        input.password
          ? { ok: false, error: { code: 'IncorrectPassword', message: 'Incorrect password.' } }
          : { ok: true, data: { encrypted: true, accounts: null } },
      ),
    });
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.type(screen.getByLabelText('Import data'), 'ENC');
    const pw = await screen.findByLabelText('Password');
    await userEvent.type(pw, 'wrong');
    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('loads a file into the textarea', async () => {
    wrap(<ImportAccountsDialog onClose={() => {}} onImported={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load file' }));
    expect(await screen.findByDisplayValue('FILE-BLOB')).toBeInTheDocument();
  });
});
