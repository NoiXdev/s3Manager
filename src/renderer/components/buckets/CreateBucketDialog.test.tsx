import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { CreateBucketDialog, isValidBucketName } from './CreateBucketDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

function baseS3(over: Record<string, unknown> = {}) {
  return { createBucket: vi.fn().mockResolvedValue({ ok: true, data: true }), ...over };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('isValidBucketName', () => {
  it('accepts a normal name', () => {
    expect(isValidBucketName('my-bucket-1')).toBe(true);
  });
  it('rejects too short, uppercase, bad start/end', () => {
    expect(isValidBucketName('ab')).toBe(false);
    expect(isValidBucketName('My-Bucket')).toBe(false);
    expect(isValidBucketName('-bucket')).toBe(false);
  });
  it('rejects consecutive dots and IP-formatted names', () => {
    expect(isValidBucketName('my..bucket')).toBe(false);
    expect(isValidBucketName('192.168.1.1')).toBe(false);
  });
});

describe('CreateBucketDialog', () => {
  it('disables Create until the name is valid', async () => {
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={() => {}} />);
    const create = screen.getByRole('button', { name: 'Create bucket' });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    expect(create).toBeEnabled();
  });

  it('checking Object Lock checks and disables versioning', async () => {
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={() => {}} />);
    const versioning = screen.getByLabelText('Enable versioning');
    expect(versioning).not.toBeChecked();
    await userEvent.click(screen.getByLabelText('Enable Object Lock'));
    expect(versioning).toBeChecked();
    expect(versioning).toBeDisabled();
  });

  it('submits with the entered name and toggles, then calls onCreated', async () => {
    const onCreated = vi.fn();
    wrap(<CreateBucketDialog accountId="a" onClose={() => {}} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    await userEvent.click(screen.getByLabelText('Enable Object Lock'));
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    await waitFor(() => expect(window.s3.createBucket).toHaveBeenCalled());
    expect(window.s3.createBucket).toHaveBeenCalledWith({ accountId: 'a', bucket: 'my-bucket', objectLock: true, versioning: true });
    expect(onCreated).toHaveBeenCalledWith('my-bucket');
  });

  it('shows an error and stays open when creation fails', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      createBucket: vi.fn().mockResolvedValue({ ok: false, error: { code: 'BucketAlreadyExists', message: 'bucket exists' } }),
    });
    const onClose = vi.fn();
    wrap(<CreateBucketDialog accountId="a" onClose={onClose} onCreated={() => {}} />);
    await userEvent.type(screen.getByLabelText('Bucket name'), 'my-bucket');
    await userEvent.click(screen.getByRole('button', { name: 'Create bucket' }));
    expect(await screen.findByText(/bucket exists/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
