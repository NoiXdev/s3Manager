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
    onSyncProgress: vi.fn(() => () => {}),
    getSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system' } }),
    setSettings: vi.fn().mockResolvedValue({ ok: true, data: { presignExpirySeconds: 3600, theme: 'system' } }),
    getAppInfo: vi.fn().mockResolvedValue({ ok: true, data: { version: '0.0.0', encryptionAvailable: true, accountCount: 1 } }),
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
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a');
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
    await userEvent.click(await screen.findByText('logo.png'));
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(await screen.findByText('private')).toBeInTheDocument();
  });

  it('renders the Settings screen for the Settings section', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Default link expiry')).toBeInTheDocument();
  });

  it('opens the Connections screen from the Manage connections button', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Manage connections' }));
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeInTheDocument();
  });
});

describe('App — operations feedback', () => {
  it('shows a toast after copying a presigned URL from the metadata panel', async () => {
    renderApp();
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a');
    await screen.findByRole('option', { name: 'assets' });
    await userEvent.selectOptions(screen.getByLabelText('Bucket'), 'assets');
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

describe('App — Connections removal', () => {
  it('clears the selected account when it is removed in Connections', async () => {
    (window.s3 as unknown as { accounts: Record<string, unknown> }).accounts.remove = vi
      .fn()
      .mockResolvedValue({ ok: true, data: true });
    renderApp();
    await screen.findByRole('option', { name: 'AWS prod (Amazon S3)' });
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a');
    await userEvent.click(screen.getByRole('button', { name: 'Manage connections' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove AWS prod' }));
    await userEvent.click(screen.getByRole('button', { name: 'Files' }));
    expect((screen.getByLabelText('Account') as HTMLSelectElement).value).toBe('');
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

describe('App — Sync', () => {
  it('shows the Sync screen when the Sync nav item is clicked', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Sync (bucket → bucket)')).toBeInTheDocument();
  });

  it('keeps a running sync visible (and uncancelled) after navigating away and back', async () => {
    const s3 = window.s3 as unknown as Record<string, ReturnType<typeof vi.fn>>;
    s3.selectSyncDirectory = vi.fn().mockResolvedValue({ ok: true, data: '/data' });
    s3.localSyncPlan = vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 1, upToDate: 0, bytesToCopy: 10, sample: [] } });
    s3.localSyncRun = vi.fn(() => new Promise(() => {})); // never resolves: the run stays in-flight
    s3.cancelSync = vi.fn().mockResolvedValue({ ok: true, data: true });

    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await userEvent.click(screen.getByRole('button', { name: 'Local ↔ Bucket' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByText('/data');
    await userEvent.selectOptions(screen.getByLabelText('Bucket account'), 'a');
    await userEvent.selectOptions(await screen.findByLabelText('Bucket bucket'), 'assets');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run sync' }));
    expect(await screen.findByText('Listing both sides…')).toBeInTheDocument();

    // Navigate away to another section and back.
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));

    // Progress is still shown (run state survived navigation) and nothing aborted it.
    expect(screen.getByText('Listing both sides…')).toBeInTheDocument();
    expect(window.s3.cancelSync).not.toHaveBeenCalled();
  });

  it('shows a sidebar sync indicator while a run is active and clicking it opens Sync', async () => {
    const s3 = window.s3 as unknown as Record<string, ReturnType<typeof vi.fn>>;
    s3.selectSyncDirectory = vi.fn().mockResolvedValue({ ok: true, data: '/data' });
    s3.localSyncPlan = vi.fn().mockResolvedValue({ ok: true, data: { toCopy: 1, upToDate: 0, bytesToCopy: 10, sample: [] } });
    s3.localSyncRun = vi.fn(() => new Promise(() => {})); // hangs: run stays active

    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await userEvent.click(screen.getByRole('button', { name: 'Local ↔ Bucket' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await screen.findByText('/data');
    await userEvent.selectOptions(screen.getByLabelText('Bucket account'), 'a');
    await userEvent.selectOptions(await screen.findByLabelText('Bucket bucket'), 'assets');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Run sync' }));

    // Navigate away; the sidebar indicator stays visible, and clicking it returns to Sync.
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const indicator = await screen.findByRole('button', { name: 'Listing…' });
    await userEvent.click(indicator);
    expect(screen.getByText('Sync (local ↔ bucket)')).toBeInTheDocument();
  });
});
