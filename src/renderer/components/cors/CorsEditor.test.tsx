import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { CorsEditor } from './CorsEditor';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const rule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };
const account = { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 };

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
    putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
    deleteBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('CorsEditor', () => {
  it('loads the seeded bucket rules and saves the working set', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    expect(await screen.findByRole('checkbox', { name: 'GET' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(window.s3.putBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', rules: [rule] });
  });

  it('clears all rules after confirmation', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all rules' }));
    expect(window.s3.deleteBucketCors).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets' });
  });

  it('adds a rule via "+ Add rule"', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
      getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [] }),
      putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
      deleteBucketCors: vi.fn(),
    };
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Add rule' }));
    expect(screen.getByRole('button', { name: 'Remove rule' })).toBeInTheDocument();
  });

  it('shows AWS-standard JSON for the working set in JSON mode', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' }) as HTMLTextAreaElement;
    const parsed = JSON.parse(textarea.value);
    expect(parsed).toEqual([{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }]);
  });

  it('applies edited JSON back to the form', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' });
    await userEvent.clear(textarea);
    await userEvent.paste(JSON.stringify([{ AllowedMethods: ['PUT'], AllowedOrigins: ['*'] }]));
    await userEvent.click(screen.getByRole('button', { name: 'Form' }));
    expect(screen.getByRole('checkbox', { name: 'PUT' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'GET' })).not.toBeChecked();
  });

  it('disables Save and Form switch and shows an error while JSON is invalid', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' });
    await userEvent.clear(textarea);
    await userEvent.paste('not json');
    expect(await screen.findByText(/Invalid JSON/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Form' })).toBeDisabled();
  });

  it('re-enables Save and Form switch once JSON is valid again', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' });
    await userEvent.clear(textarea);
    await userEvent.paste('not json');
    await screen.findByText(/Invalid JSON/);
    await userEvent.clear(textarea);
    await userEvent.paste(JSON.stringify([{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }]));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Form' })).toBeEnabled();
  });

  it('shows an error toast and preserves edits when Save fails', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
      getBucketCors: vi.fn().mockResolvedValue({ ok: true, data: [rule] }),
      putBucketCors: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'no perms' } }),
      deleteBucketCors: vi.fn(),
    };
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('AccessDenied: no perms')).toBeInTheDocument();
    // edits preserved: the rule card is still present
    expect(screen.getByRole('checkbox', { name: 'GET' })).toBeInTheDocument();
  });

  it('re-serializes the working set when switching to JSON after form edits', async () => {
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add rule' }));
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' }) as HTMLTextAreaElement;
    expect(JSON.parse(textarea.value)).toHaveLength(2);
  });

  it('resyncs the JSON textarea to refetched server data after Save', async () => {
    const getRule = { id: null, allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };
    const putRule = { id: null, allowedMethods: ['PUT'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null };
    (window as unknown as { s3: unknown }).s3 = {
      accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [account] }) },
      listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
      getBucketCors: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: [getRule] })
        .mockResolvedValue({ ok: true, data: [putRule] }),
      putBucketCors: vi.fn().mockResolvedValue({ ok: true, data: true }),
      deleteBucketCors: vi.fn(),
    };
    wrap(<CorsEditor accountId="acc-1" bucket="assets" />);
    await screen.findByRole('checkbox', { name: 'GET' });
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    const textarea = screen.getByRole('textbox', { name: 'CORS JSON' });
    // Local edit that we expect the server refetch to overwrite on save.
    await userEvent.clear(textarea);
    await userEvent.paste(JSON.stringify([{ AllowedMethods: ['DELETE'], AllowedOrigins: ['*'] }]));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const value = (screen.getByRole('textbox', { name: 'CORS JSON' }) as HTMLTextAreaElement).value;
      expect(JSON.parse(value)).toEqual([{ AllowedMethods: ['PUT'], AllowedOrigins: ['*'] }]);
    });
  });
});
