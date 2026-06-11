import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountBreakdown, type BreakdownItem } from './AccountBreakdown';

const items: BreakdownItem[] = [
  {
    account: { id: 'acc-1', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', forcePathStyle: false, createdAt: 1 },
    buckets: ['assets', 'backups'],
    isLoading: false,
    isError: false,
  },
  {
    account: { id: 'acc-2', label: 'Hetzner', provider: 'hetzner', region: 'fsn1', accessKeyId: 'AK', forcePathStyle: false, createdAt: 2 },
    buckets: [],
    isLoading: false,
    isError: true,
  },
];

describe('AccountBreakdown', () => {
  it('renders accounts with bucket chips and a per-account error', () => {
    render(<AccountBreakdown items={items} onOpenAccount={() => {}} onOpenBucket={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open account AWS prod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'backups' })).toBeInTheDocument();
    expect(screen.getByText("Couldn't load buckets")).toBeInTheDocument();
  });

  it('calls onOpenBucket when a bucket chip is clicked', async () => {
    const onOpenBucket = vi.fn();
    render(<AccountBreakdown items={items} onOpenAccount={() => {}} onOpenBucket={onOpenBucket} />);
    await userEvent.click(screen.getByRole('button', { name: 'assets' }));
    expect(onOpenBucket).toHaveBeenCalledWith('acc-1', 'assets');
  });

  it('calls onOpenAccount when the account header is clicked', async () => {
    const onOpenAccount = vi.fn();
    render(<AccountBreakdown items={items} onOpenAccount={onOpenAccount} onOpenBucket={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open account AWS prod' }));
    expect(onOpenAccount).toHaveBeenCalledWith('acc-1');
  });

  it('shows a loading hint while an account is loading', () => {
    render(
      <AccountBreakdown
        items={[{ account: items[0].account, buckets: [], isLoading: true, isError: false }]}
        onOpenAccount={() => {}}
        onOpenBucket={() => {}}
      />,
    );
    expect(screen.getByText('Loading buckets…')).toBeInTheDocument();
  });
});
