import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { AccountSelect } from './AccountSelect';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const aws = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };
const hetzner = { id: 'acc-2', label: 'Hetzner backup', provider: 'hetzner', region: 'fsn1', accessKeyId: 'HK', createdAt: 2 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [aws, hetzner] }) },
  };
});

describe('AccountSelect', () => {
  it('lists accounts with provider label and fires onSelect on choose', async () => {
    const onSelect = vi.fn();
    wrap(<AccountSelect selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.click(await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' }));
    expect(onSelect).toHaveBeenCalledWith('acc-1');
  });

  it('shows the placeholder on the trigger when nothing is selected', () => {
    wrap(<AccountSelect selectedId={null} onSelect={() => {}} />);
    expect(screen.getByLabelText('Account')).toHaveTextContent('Select account');
  });

  it('filters accounts by search text', async () => {
    wrap(<AccountSelect selectedId={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByLabelText('Account'));
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.type(screen.getByRole('searchbox'), 'hetz');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Hetzner backup (Hetzner Object Storage)' })).toBeInTheDocument();
  });

  it('opens the quick-add dialog from the footer action and selects the created account', async () => {
    const created = { id: 'acc-9', label: 'New acc', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'NK', createdAt: 3 };
    (window.s3 as unknown as { accounts: Record<string, unknown> }).accounts.create = vi
      .fn()
      .mockResolvedValue({ ok: true, data: created });
    const onSelect = vi.fn();
    wrap(<AccountSelect selectedId={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByLabelText('Account'));
    await userEvent.click(screen.getByRole('button', { name: '+ Add account' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Label'), 'New acc');
    await userEvent.type(screen.getByLabelText('Region'), 'eu-central-1');
    await userEvent.type(screen.getByLabelText('Access key ID'), 'NK');
    await userEvent.type(screen.getByLabelText('Secret access key'), 'sek');
    await userEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('acc-9'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
