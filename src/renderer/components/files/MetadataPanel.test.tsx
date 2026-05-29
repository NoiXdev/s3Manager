import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
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

describe('MetadataPanel rename/move', () => {
  beforeEach(() => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/new.png' } }),
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
    };
  });

  it('renames a file and closes the panel', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'new.png');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'images/logo.png', destKey: 'images/new.png' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('MetadataPanel visibility editing', () => {
  it('makes a private object public after confirmation', async () => {
    const setObjectVisibility = vi.fn().mockResolvedValue({ ok: true, data: 'public' });
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      setObjectVisibility,
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make public' }));
    // The trigger hides while confirming, so this resolves the dialog's confirm button.
    await userEvent.click(screen.getByRole('button', { name: 'Make public' }));
    await waitFor(() => expect(setObjectVisibility).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'k', visibility: 'public' }));
  });

  it('makes a public object private immediately (no confirm)', async () => {
    const setObjectVisibility = vi.fn().mockResolvedValue({ ok: true, data: 'private' });
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
      setObjectVisibility,
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Make private' }));
    await waitFor(() => expect(setObjectVisibility).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'k', visibility: 'private' }));
  });

  it('shows no visibility toggle when ACLs are unsupported', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'unknown' }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('unknown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make public' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull();
  });
});

describe('MetadataPanel retention section', () => {
  it('shows the Retention & legal hold section when the bucket has Object Lock enabled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: true, defaultRetention: null } }),
      getObjectRetention: vi.fn().mockResolvedValue({ ok: true, data: { mode: null, retainUntil: null } }),
      getObjectLegalHold: vi.fn().mockResolvedValue({ ok: true, data: 'OFF' }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('Retention & legal hold')).toBeInTheDocument();
  });

  it('hides the section when Object Lock is not enabled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
    };
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('private')).toBeInTheDocument();
    expect(screen.queryByText('Retention & legal hold')).toBeNull();
  });
});
