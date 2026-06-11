import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SettingsScreen } from './SettingsScreen';

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
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600 } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 86400 } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.2.3', encryptionAvailable: true, accountCount: 2 } }),
    openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('SettingsScreen', () => {
  it('shows the About info', async () => {
    wrap(<SettingsScreen />);
    expect(await screen.findByText('1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('reflects the current expiry and saves a new choice', async () => {
    wrap(<SettingsScreen />);
    const select = await screen.findByLabelText('Default link expiry');
    expect(select).toHaveValue('3600');
    await userEvent.selectOptions(select, '86400');
    await waitFor(() => expect(window.s3.setSettings).toHaveBeenCalledWith({ presignExpirySeconds: 86400 }));
  });

  it('toggles the open-source licenses list', async () => {
    wrap(<SettingsScreen />);
    const toggle = await screen.findByRole('button', { name: /open source licenses/i });
    expect(screen.queryByPlaceholderText('Filter packages…')).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByPlaceholderText('Filter packages…')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.queryByPlaceholderText('Filter packages…')).not.toBeInTheDocument();
  });

  it('renders the theme control and saves the chosen theme', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system' } }),
      setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'dark' } }),
      getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '1.0.0', encryptionAvailable: true, accountCount: 0 } }),
      openExternal: vi.fn().mockResolvedValue({ ok: true, data: true }),
    };
    wrap(<SettingsScreen />);
    const select = await screen.findByLabelText('Appearance');
    await userEvent.selectOptions(select, 'dark');
    await waitFor(() => expect(window.s3.setSettings).toHaveBeenCalledWith({ theme: 'dark' }));
  });
});
