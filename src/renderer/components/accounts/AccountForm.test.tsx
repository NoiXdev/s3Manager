import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AccountForm } from './AccountForm';
import type { Account } from '../../../main/storage/accountsRepo';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const existing: Account = {
  id: 'acc-1',
  label: 'AWS prod',
  provider: 'amazon-s3',
  endpoint: undefined,
  region: 'eu-central-1',
  accessKeyId: 'AKIA',
  forcePathStyle: false,
  createdAt: 1,
};

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { test: vi.fn().mockResolvedValue({ ok: true, data: true }) },
  };
});

describe('AccountForm (add mode)', () => {
  it('submits the entered values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm onSubmit={onSubmit} onCancel={() => {}} />);

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
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
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
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Region'), 'fsn1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'SK');
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('AccessDenied: bad key')).toBeInTheDocument();
  });

  it('hides custom fields unless the custom provider is selected', () => {
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Endpoint URL')).toBeNull();
    expect(screen.queryByLabelText('Path-style addressing')).toBeNull();
  });

  it('reveals custom fields and prefills the region when custom is selected', async () => {
    wrap(<AccountForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.getByLabelText('Endpoint URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Path-style addressing')).toBeInTheDocument();
    expect(screen.getByLabelText('Region')).toHaveValue('us-east-1');
  });

  it('submits the endpoint and path-style toggle for a custom provider', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm onSubmit={onSubmit} onCancel={() => {}} />);

    await userEvent.type(screen.getByLabelText('Label'), 'MinIO');
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'custom');
    await userEvent.type(screen.getByLabelText('Endpoint URL'), 'https://minio.example.com:9000');
    await userEvent.click(screen.getByLabelText('Path-style addressing')); // default ON -> toggle OFF
    await userEvent.type(screen.getByLabelText('Access key ID'), 'AKIA');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));

    expect(onSubmit).toHaveBeenCalledWith({
      label: 'MinIO',
      provider: 'custom',
      region: 'us-east-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'secret',
      endpoint: 'https://minio.example.com:9000',
      forcePathStyle: false,
    });
  });
});

describe('AccountForm (edit mode)', () => {
  it('prefills fields from the account and labels the submit button Save changes', () => {
    wrap(<AccountForm account={existing} onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByLabelText('Label')).toHaveValue('AWS prod');
    expect(screen.getByLabelText('Region')).toHaveValue('eu-central-1');
    expect(screen.getByLabelText('Access key ID')).toHaveValue('AKIA');
    expect(screen.getByLabelText('Secret access key')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('omits the secret when left blank and includes the id', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm account={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.clear(screen.getByLabelText('Label'));
    await userEvent.type(screen.getByLabelText('Label'), 'AWS renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: 'acc-1',
      label: 'AWS renamed',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
    });
  });

  it('includes the secret when a new one is typed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    wrap(<AccountForm account={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Secret access key'), 'NEWSECRET');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledWith({
      id: 'acc-1',
      label: 'AWS prod',
      provider: 'amazon-s3',
      region: 'eu-central-1',
      accessKeyId: 'AKIA',
      secretAccessKey: 'NEWSECRET',
    });
  });
});
