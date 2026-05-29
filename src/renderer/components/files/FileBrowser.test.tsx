import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    getDropPath: vi.fn((f: File) => `/local/${f.name}`),
    uploadObject: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    onUploadProgress: vi.fn(() => () => {}),
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
      getDropPath: vi.fn(),
      uploadObject: vi.fn().mockResolvedValue({ ok: true, data: {} }),
      onUploadProgress: vi.fn(() => () => {}),
    };
    wrap(<FileBrowser {...baseProps} />);
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
  });
});

describe('FileBrowser operations', () => {
  it('uploads dropped files to the current prefix', async () => {
    const uploadObject = vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/a.txt' } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
      getDropPath: vi.fn((f: File) => `/local/${f.name}`),
      uploadObject,
      onUploadProgress: vi.fn(() => () => {}),
    };
    wrap(<FileBrowser {...baseProps} />);
    await screen.findByText('This folder is empty');
    const file = new File(['x'], 'a.txt');
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file], types: ['Files'] } });
    await waitFor(() => expect(uploadObject).toHaveBeenCalled());
    expect(uploadObject.mock.calls[0][0]).toMatchObject({ bucket: 'assets', key: 'images/a.txt', filePath: '/local/a.txt' });
  });

  it('deletes a folder after confirmation', async () => {
    const deleteFolder = vi.fn().mockResolvedValue({ ok: true, data: 1 });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }], files: [], nextToken: null } }),
      getDropPath: vi.fn(),
      uploadObject: vi.fn(),
      onUploadProgress: vi.fn(() => () => {}),
      deleteFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete folder thumbs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/thumbs/' }));
  });
});

describe('FileBrowser transfer ops', () => {
  it('creates a folder via the New folder button', async () => {
    const createFolder = vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/reports/' } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
      getDropPath: vi.fn(), uploadObject: vi.fn(), onUploadProgress: vi.fn(() => () => {}),
      createFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await screen.findByText('This folder is empty');
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    await userEvent.type(screen.getByLabelText('Name'), 'reports');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/', name: 'reports' }));
  });

  it('renames a folder via the row Rename button', async () => {
    const moveFolder = vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }], files: [], nextToken: null } }),
      getDropPath: vi.fn(), uploadObject: vi.fn(), onUploadProgress: vi.fn(() => () => {}),
      moveFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename folder thumbs' }));
    const input = screen.getByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'thumbnails');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'images/thumbs/', destPrefix: 'images/thumbnails/' }));
  });
});
