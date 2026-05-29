import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [{ name: 'logo.png', key: 'logo.png', size: 5, lastModified: null, storageClass: null, etag: null }], nextToken: null } }),
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 5, contentType: 'image/png', lastModified: null, storageClass: null, etag: null, metadata: {} } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
    presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
    deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    getDropPath: vi.fn((f: File) => `/local/${f.name}`),
    uploadObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'logo.png' } }),
    onUploadProgress: vi.fn(() => () => {}),
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    getObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: { enabled: false, defaultRetention: null } }),
    putObjectLockConfig: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App — Files browsing', () => {
  it('drills from account to bucket to object and opens the metadata panel', async () => {
    renderApp();
    await userEvent.click(await screen.findByText('AWS prod'));
    await userEvent.click(await screen.findByText('assets'));
    await userEvent.click(await screen.findByText('logo.png'));
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(await screen.findByText('private')).toBeInTheDocument();
  });

  it('still shows Coming soon for non-Files sections', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});

describe('App — operations feedback', () => {
  it('shows a toast after copying a presigned URL from the metadata panel', async () => {
    renderApp();
    await userEvent.click(await screen.findByText('AWS prod'));
    await userEvent.click(await screen.findByText('assets'));
    await userEvent.click(await screen.findByText('logo.png'));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText('Signed URL copied')).toBeInTheDocument();
  });
});

describe('App — CORS', () => {
  it('renders the CORS editor for the CORS section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'CORS' }));
    expect(await screen.findByText('CORS configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Account')).toBeInTheDocument();
  });
});

describe('App — Object Lock', () => {
  it('renders the Object Lock editor for the Object Lock section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Object Lock' }));
    expect(await screen.findByRole('heading', { name: 'Object Lock' })).toBeInTheDocument();
    expect(screen.getByLabelText('Account')).toBeInTheDocument();
  });
});

describe('App — Dashboard', () => {
  it('shows the dashboard and click-through opens a bucket in the Files view', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    const bucketChip = await screen.findByRole('button', { name: 'assets' });
    await userEvent.click(bucketChip);
    expect(screen.getByRole('button', { name: 'Files' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('logo.png')).toBeInTheDocument();
  });
});
