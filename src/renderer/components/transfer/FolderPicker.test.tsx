import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FolderPicker } from './FolderPicker';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: { folders: [{ name: 'docs', prefix: 'docs/' }], files: [], nextToken: null },
    }),
  };
});

describe('FolderPicker', () => {
  it('picks the current prefix (root by default) via Move here', async () => {
    const onPick = vi.fn();
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => true} onPick={onPick} />);
    await screen.findByRole('button', { name: 'docs' });
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(onPick).toHaveBeenCalledWith('');
  });

  it('navigates into a folder and picks that prefix', async () => {
    const onPick = vi.fn();
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => true} onPick={onPick} />);
    await userEvent.click(await screen.findByRole('button', { name: 'docs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move here' }));
    expect(onPick).toHaveBeenCalledWith('docs/');
  });

  it('disables Move here when canPick returns false', async () => {
    wrap(<FolderPicker accountId="acc-1" bucket="assets" canPick={() => false} onPick={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Move here' })).toBeDisabled();
  });
});
