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
});
