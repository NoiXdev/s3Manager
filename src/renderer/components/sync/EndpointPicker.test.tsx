import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { EndpointPicker, type EndpointValue } from './EndpointPicker';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'acc-1', label: 'AWS' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['bucket-a', 'bucket-b'] }),
  };
});

const empty: EndpointValue = { accountId: null, bucket: null, prefix: '' };

describe('EndpointPicker', () => {
  it('selecting an account emits a reset endpoint with that account', async () => {
    const onChange = vi.fn();
    wrap(<EndpointPicker label="Source" value={empty} onChange={onChange} />);
    await screen.findByRole('option', { name: 'AWS' });
    await userEvent.selectOptions(screen.getByLabelText('Source account'), 'acc-1');
    expect(onChange).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: null, prefix: '' });
  });

  it('editing the prefix emits the updated value', async () => {
    const onChange = vi.fn();
    wrap(<EndpointPicker label="Destination" value={{ accountId: 'acc-1', bucket: 'bucket-a', prefix: '' }} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Destination prefix'), 'x');
    expect(onChange).toHaveBeenLastCalledWith({ accountId: 'acc-1', bucket: 'bucket-a', prefix: 'x' });
  });
});
