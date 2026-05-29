import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AddAccountForm } from './AddAccountForm';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { test: vi.fn().mockResolvedValue({ ok: true, data: true }) },
  };
});

describe('AddAccountForm', () => {
  it('submits the entered values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AddAccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Label'), 'AWS prod');
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'amazon-s3');
    await userEvent.clear(screen.getByLabelText('Region'));
    await userEvent.type(screen.getByLabelText('Region'), 'eu-central-1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIA');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(onSubmit).toHaveBeenCalledWith({
      label: 'AWS prod',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
    });
  });

  it('runs a connection test and reports success', async () => {
    wrap(<AddAccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection OK')).toBeInTheDocument();
  });

  it('shows the error message when the connection test fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { test: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'bad key' } }) },
    };
    wrap(<AddAccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('AccessDenied: bad key')).toBeInTheDocument();
  });
});
