import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { MoveDialog } from './MoveDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'docs', prefix: 'docs/' }], files: [], nextToken: null } }),
    moveObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'docs/logo.png' } }),
    moveFolder: vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } }),
  };
});

describe('MoveDialog', () => {
  it('moves a file into the picked folder', async () => {
    const onClose = vi.fn();
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'file', name: 'logo.png', parent: '', key: 'logo.png' }} onClose={onClose} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(window.s3.moveObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourceKey: 'logo.png', destKey: 'docs/logo.png' });
  });

  it('moves a folder into the picked folder', async () => {
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'folder', name: 'old', parent: '', prefix: 'old/' }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(window.s3.moveFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', sourcePrefix: 'old/', destPrefix: 'docs/old/' });
  });

  it('disables Move here at the item\'s current parent (no-op)', async () => {
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'file', name: 'logo.png', parent: '', key: 'logo.png' }} onClose={() => {}} />);
    // picker starts at root '' which equals the file's current parent -> no-op
    expect(await screen.findByRole('button', { name: 'Move here' })).toBeDisabled();
  });

  it('disables Move here inside the folder being moved (into-itself)', async () => {
    wrap(<MoveDialog accountId="acc-1" bucket="assets" item={{ kind: 'folder', name: 'docs', parent: '', prefix: 'docs/' }} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    // now at 'docs/' which is the source prefix -> into-itself, must be disabled
    expect(screen.getByRole('button', { name: 'Move here' })).toBeDisabled();
  });
});
