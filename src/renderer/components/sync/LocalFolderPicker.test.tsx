import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalFolderPicker } from './LocalFolderPicker';

describe('LocalFolderPicker', () => {
  it('calls selectSyncDirectory and reports the chosen path', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: '/picked/dir' }),
    };
    const onPick = vi.fn();
    render(<LocalFolderPicker path={null} onPick={onPick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('/picked/dir'));
  });

  it('shows the current path and does not call onPick when the dialog is cancelled', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      selectSyncDirectory: vi.fn().mockResolvedValue({ ok: true, data: null }),
    };
    const onPick = vi.fn();
    render(<LocalFolderPicker path="/data/photos" onPick={onPick} />);
    expect(screen.getByText('/data/photos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
