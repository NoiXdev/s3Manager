import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncScreen } from './SyncScreen';
import { SyncRunProvider } from './SyncRunProvider';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SyncRunProvider>{node}</SyncRunProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a1', label: 'AWS' }, { id: 'a2', label: 'Hetzner' }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['src', 'dst'] }),
    onSyncProgress: vi.fn(() => () => {}),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

async function pick(triggerLabel: string, optionName: string) {
  await userEvent.click(screen.getByLabelText(triggerLabel));
  await userEvent.click(await screen.findByRole('option', { name: optionName }));
}

async function pickBothEndpoints() {
  await pick('Source account', 'AWS');
  await pick('Source bucket', 'src');
  await pick('Destination account', 'Hetzner');
  await pick('Destination bucket', 'dst');
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('SyncScreen', () => {
  it('Preview shows the plan summary', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 3, upToDate: 1, bytesToCopy: 4096, sample: [{ relKey: 'a.txt', size: 4096, reason: 'missing' }] } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/3 to copy/)).toBeInTheDocument();
    expect(screen.getByText(/1 up-to-date/)).toBeInTheDocument();
  });

  it('an empty plan disables Run sync', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 0, upToDate: 5, bytesToCopy: 0, sample: [] } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Already in sync/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run sync' })).toBeDisabled();
  });

  it('Run sync shows the final summary including failures', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      planSync: vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 2, upToDate: 0, bytesToCopy: 20, sample: [] } }),
      runSync: vi.fn().mockResolvedValue({ ok: true, data: { copied: 1, bytesCopied: 10, failed: [{ key: 'bad.txt', code: 'AccessDenied', message: 'denied' }], canceled: false } }),
    });
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pickBothEndpoints();
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run sync' }));
    expect(await screen.findByText(/Copied 1/)).toBeInTheDocument();
    expect(screen.getByText(/bad.txt/)).toBeInTheDocument();
  });

  it('refuses identical source and destination endpoints', async () => {
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pick('Source account', 'AWS');
    await pick('Source bucket', 'src');
    await pick('Destination account', 'AWS');
    await pick('Destination bucket', 'src');
    expect(screen.getByText(/Source and destination are the same/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });

  it('refuses same-bucket overlapping prefixes (destination inside source)', async () => {
    wrap(<SyncScreen initialAccountId={null} initialBucket={null} />);
    await pick('Source account', 'AWS');
    await pick('Source bucket', 'src');
    await userEvent.type(screen.getByLabelText('Source prefix'), 'a/');
    await pick('Destination account', 'AWS');
    await pick('Destination bucket', 'src');
    await userEvent.type(screen.getByLabelText('Destination prefix'), 'a/sub/');
    expect(screen.getByText(/Destination overlaps the source prefix/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
  });
});
