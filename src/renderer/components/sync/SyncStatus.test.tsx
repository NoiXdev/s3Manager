import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncProgress } from '../../../main/s3/sync';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncRunProvider, useSyncRun } from './SyncRunProvider';
import { SyncStatus } from './SyncStatus';

const ARGS = { source: { accountId: 's', bucket: 'src', prefix: '' }, dest: { accountId: 'd', bucket: 'dst', prefix: '' } };

function Starter() {
  const sr = useSyncRun();
  return <button onClick={() => void sr.runBucket(ARGS).catch(() => {})}>start</button>;
}

let progressCb: ((p: SyncProgress) => void) | undefined;
beforeEach(() => {
  progressCb = undefined;
  (window as unknown as { s3: unknown }).s3 = {
    onSyncProgress: vi.fn((cb: (p: SyncProgress) => void) => { progressCb = cb; return () => {}; }),
    runSync: vi.fn(() => new Promise(() => {})), // hangs: run stays active
    cancelSync: vi.fn(),
  };
});

function renderWithRun(onOpen: () => void) {
  return render(
    <ToastProvider>
      <SyncRunProvider>
        <Starter />
        <SyncStatus onOpen={onOpen} />
      </SyncRunProvider>
    </ToastProvider>,
  );
}

describe('SyncStatus', () => {
  it('renders nothing when idle', () => {
    render(
      <ToastProvider>
        <SyncRunProvider><SyncStatus onOpen={() => {}} /></SyncRunProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Listing… then Syncing count, and calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    renderWithRun(onOpen);
    await userEvent.click(screen.getByRole('button', { name: 'start' }));
    expect(await screen.findByRole('button', { name: 'Listing…' })).toBeInTheDocument();
    act(() => progressCb!({ phase: 'copying', copied: 3, total: 10, bytesCopied: 0, bytesTotal: 0, failed: 0 }));
    const status = screen.getByRole('button', { name: 'Syncing… 3/10' });
    await userEvent.click(status);
    expect(onOpen).toHaveBeenCalled();
  });
});
