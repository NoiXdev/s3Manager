import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { RetentionSection } from './RetentionSection';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return {
    getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
    getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    putObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: true }),
    putObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('RetentionSection', () => {
  it('shows None / Off for an unset object', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    expect(await screen.findByText('None')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('applies a governance retention after confirmation', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    await screen.findByText('None');
    fireEvent.change(screen.getByLabelText('Retain until'), { target: { value: '2027-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply retention' })); // confirm dialog
    await waitFor(() =>
      expect(window.s3.putObjectRetention).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', retainUntil: '2027-01-01T00:00:00.000Z' }),
    );
  });

  it('renders a COMPLIANCE retention read-only (no date input)', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: 'COMPLIANCE', retainUntil: '2030-01-01T00:00:00.000Z' } }),
    });
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    expect(await screen.findByText(/COMPLIANCE until/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Retain until')).toBeNull();
  });

  it('turns on legal hold without a confirm', async () => {
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on legal hold' }));
    await waitFor(() =>
      expect(window.s3.putObjectLegalHold).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'k', status: 'ON' }),
    );
  });

  it('enforces extend-only: the date input min is the current retain-until', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: 'GOVERNANCE', retainUntil: '2030-01-01T00:00:00.000Z' } }),
    });
    wrap(<RetentionSection accountId="a" bucket="b" objectKey="k" />);
    expect(await screen.findByLabelText('Retain until')).toHaveAttribute('min', '2030-01-01');
  });
});
