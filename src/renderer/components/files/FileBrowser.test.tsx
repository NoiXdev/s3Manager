import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FileBrowser } from './FileBrowser';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }],
        files: [{ name: 'logo.png', key: 'images/logo.png', size: 2048, lastModified: '2024-01-01T00:00:00.000Z', storageClass: 'STANDARD', etag: '"a"' }],
        nextToken: null,
      },
    }),
  };
});

const baseProps = {
  accountId: 'acc-1',
  bucket: 'assets',
  prefix: 'images/',
  selectedKey: null as string | null,
  onNavigate: () => {},
  onSelectFile: () => {},
};

describe('FileBrowser', () => {
  it('lists folders and files for the current prefix', async () => {
    wrap(<FileBrowser {...baseProps} />);
    expect(await screen.findByText('thumbs')).toBeInTheDocument();
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('navigates into a folder on click', async () => {
    const onNavigate = vi.fn();
    wrap(<FileBrowser {...baseProps} onNavigate={onNavigate} />);
    await userEvent.click(await screen.findByText('thumbs'));
    expect(onNavigate).toHaveBeenCalledWith('images/thumbs/');
  });

  it('selects a file on click', async () => {
    const onSelectFile = vi.fn();
    wrap(<FileBrowser {...baseProps} onSelectFile={onSelectFile} />);
    await userEvent.click(await screen.findByText('logo.png'));
    expect(onSelectFile).toHaveBeenCalledWith('images/logo.png');
  });

  it('shows an empty state for an empty prefix', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
    };
    wrap(<FileBrowser {...baseProps} />);
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
  });
});
