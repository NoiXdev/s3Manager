import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { UploadLinkDialog } from './UploadLinkDialog';

function wrap(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    presignPut: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed.example/upload?X-Amz-Expires=3600' }),
  };
});

describe('UploadLinkDialog', () => {
  it('disables Generate until a valid filename is entered', async () => {
    wrap(<UploadLinkDialog accountId="a" bucket="b" prefix="images/" onClose={() => {}} />);
    const gen = screen.getByRole('button', { name: 'Generate link' });
    expect(gen).toBeDisabled();
    await userEvent.type(screen.getByLabelText('File name'), 'a/b'); // slash invalid
    expect(gen).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('File name'));
    await userEvent.type(screen.getByLabelText('File name'), 'report.pdf');
    expect(gen).toBeEnabled();
  });

  it('generates a presigned PUT URL for prefix+filename and copies it', async () => {
    wrap(<UploadLinkDialog accountId="acc-1" bucket="assets" prefix="images/" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('File name'), 'report.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await waitFor(() =>
      expect(window.s3.presignPut).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'images/report.pdf', expiresIn: 3600 }),
    );
    const urlField = await screen.findByLabelText('Upload URL');
    expect(urlField).toHaveValue('https://signed.example/upload?X-Amz-Expires=3600');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed.example/upload?X-Amz-Expires=3600');
  });

  it('uses the chosen expiry', async () => {
    wrap(<UploadLinkDialog accountId="a" bucket="b" prefix="" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('File name'), 'f.bin');
    await userEvent.selectOptions(screen.getByLabelText('Expiry'), '604800');
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    await waitFor(() =>
      expect(window.s3.presignPut).toHaveBeenCalledWith({ accountId: 'a', bucket: 'b', key: 'f.bin', expiresIn: 604800 }),
    );
  });

  it('shows an error toast and no URL when presigning fails', async () => {
    (window.s3.presignPut as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'nope' } });
    wrap(<UploadLinkDialog accountId="a" bucket="b" prefix="" onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('File name'), 'f.bin');
    await userEvent.click(screen.getByRole('button', { name: 'Generate link' }));
    expect(await screen.findByText('AccessDenied: nope')).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload URL')).toBeNull();
  });
});
