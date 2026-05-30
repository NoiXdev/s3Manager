import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '../ui/ToastProvider';
import { PermissionsDialog } from './PermissionsDialog';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{node}</ToastProvider>
    </QueryClientProvider>,
  );
}

const ALL_USERS = 'http://acs.amazonaws.com/groups/global/AllUsers';

function baseS3(over: Record<string, unknown> = {}) {
  return {
    getObjectAcl: vi.fn().mockResolvedValue({
      ok: true,
      data: { owner: { id: 'o', displayName: 'me' }, grants: [{ granteeType: 'CanonicalUser', id: 'o', displayName: 'me', permission: 'FULL_CONTROL' }] },
    }),
    putObjectAcl: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...over,
  };
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = baseS3();
});

describe('PermissionsDialog', () => {
  it('shows the owner and existing grants', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText('me')).toBeInTheDocument();
    expect(screen.getByLabelText('Permission for me')).toHaveValue('FULL_CONTROL');
  });

  it('adds a group grant and saves the edited ACL', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    await screen.findByText('me');
    await userEvent.selectOptions(screen.getByLabelText('New grant permission'), 'READ');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(window.s3.putObjectAcl).toHaveBeenCalled());
    const arg = (window.s3.putObjectAcl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.acl.grants).toContainEqual({ granteeType: 'Group', uri: ALL_USERS, permission: 'READ' });
  });

  it('removes a grant', async () => {
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Remove me' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(window.s3.putObjectAcl).toHaveBeenCalled());
    const arg = (window.s3.putObjectAcl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.acl.grants).toHaveLength(0);
  });

  it('preserves an existing email grant on save (no silent drop)', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectAcl: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          owner: { id: 'o', displayName: 'me' },
          grants: [{ granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' }],
        },
      }),
    });
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    await screen.findByText('x@y.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add' })); // add the default Group grant
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(window.s3.putObjectAcl).toHaveBeenCalled());
    const arg = (window.s3.putObjectAcl as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.acl.grants).toContainEqual({ granteeType: 'AmazonCustomerByEmail', email: 'x@y.com', permission: 'READ' });
  });

  it('shows a message when ACLs are unsupported', async () => {
    (window as unknown as { s3: Record<string, unknown> }).s3 = baseS3({
      getObjectAcl: vi.fn().mockResolvedValue({ ok: false, error: { code: 'AclUnsupported', message: 'This bucket does not support per-object ACLs' } }),
    });
    wrap(<PermissionsDialog accountId="a" bucket="b" objectKey="k" onClose={() => {}} />);
    expect(await screen.findByText(/does not support per-object ACLs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});
