import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [{ name: 'logo.png', key: 'logo.png', size: 5, lastModified: null, storageClass: null, etag: null }], nextToken: null } }),
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 5, contentType: 'image/png', lastModified: null, storageClass: null, etag: null, metadata: {} } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
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
