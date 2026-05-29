import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MetadataPanel } from './MetadataPanel';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 2048, contentType: 'image/png', lastModified: '2024-01-01T00:00:00.000Z', storageClass: 'STANDARD', etag: '"a"', metadata: { owner: 'me' } } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
  };
});

describe('MetadataPanel', () => {
  it('renders metadata fields and the visibility badge for the selected key', async () => {
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={() => {}} />);
    expect(screen.getByText('images/logo.png')).toBeInTheDocument();
    expect(await screen.findByText('image/png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(await screen.findByText('public')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('me')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows "unavailable" when the visibility check fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'no' } }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('unavailable')).toBeInTheDocument();
  });
});

describe('MetadataPanel actions', () => {
  beforeEach(() => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
      downloadObject: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/x' } }),
      deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    };
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('copies a presigned URL', async () => {
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="logo.png" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 3600 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed/x');
  });

  it('deletes after confirmation and closes the panel', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' })); // confirm in dialog
    expect(window.s3.deleteObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
    expect(onClose).toHaveBeenCalled();
  });
});
