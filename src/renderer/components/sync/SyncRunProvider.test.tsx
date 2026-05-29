import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SyncProgress } from '../../../main/s3/sync';
import { ToastProvider } from '../ui/ToastProvider';
import { SyncRunProvider, useSyncRun } from './SyncRunProvider';

const ARGS = { source: { accountId: 's', bucket: 'src', prefix: '' }, dest: { accountId: 'd', bucket: 'dst', prefix: '' } };
const LARGS = { direction: 'upload' as const, localPath: '/data', remote: { accountId: 'a', bucket: 'b', prefix: '' } };
const RESULT = { copied: 3, bytesCopied: 30, failed: [], canceled: false };

function Harness() {
  const sr = useSyncRun();
  return (
    <div>
      <span data-testid="running">{String(sr.running)}</span>
      <span data-testid="phase">{sr.progress?.phase ?? 'none'}</span>
      <span data-testid="copied">{sr.result?.copied ?? -1}</span>
      <button onClick={() => void sr.runBucket(ARGS).catch(() => {})}>runBucket</button>
      <button onClick={() => void sr.runLocal(LARGS).catch(() => {})}>runLocal</button>
      <button onClick={sr.cancel}>cancel</button>
      <button onClick={sr.clearResult}>clearResult</button>
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <SyncRunProvider><Harness /></SyncRunProvider>
    </ToastProvider>,
  );
}

let progressCb: ((p: SyncProgress) => void) | undefined;
beforeEach(() => {
  progressCb = undefined;
  (window as unknown as { s3: unknown }).s3 = {
    onSyncProgress: vi.fn((cb: (p: SyncProgress) => void) => { progressCb = cb; return () => {}; }),
    runSync: vi.fn().mockResolvedValue({ ok: true, data: RESULT }),
    localSyncRun: vi.fn().mockResolvedValue({ ok: true, data: { ...RESULT, copied: 2 } }),
    cancelSync: vi.fn().mockResolvedValue({ ok: true, data: true }),
  };
});

describe('SyncRunProvider', () => {
  it('runBucket stores the result, ends not-running, and toasts success', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runBucket' }));
    expect(window.s3.runSync).toHaveBeenCalledWith(ARGS);
    expect(screen.getByTestId('running')).toHaveTextContent('false');
    expect(screen.getByTestId('copied')).toHaveTextContent('3');
    expect(await screen.findByText('Synced 3 object(s)')).toBeInTheDocument();
  });

  it('runLocal calls window.s3.localSyncRun', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runLocal' }));
    expect(window.s3.localSyncRun).toHaveBeenCalledWith(LARGS);
  });

  it('toasts an error when the run fails', async () => {
    (window.s3.runSync as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: { code: 'AccessDenied', message: 'nope' } });
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'runBucket' }));
    expect(await screen.findByText('AccessDenied: nope')).toBeInTheDocument();
    expect(screen.getByTestId('running')).toHaveTextContent('false');
  });

  it('updates progress from the onSyncProgress subscription', async () => {
    renderHarness();
    act(() => progressCb!({ phase: 'copying', copied: 4, total: 9, bytesCopied: 0, bytesTotal: 0, failed: 0 }));
    expect(screen.getByTestId('phase')).toHaveTextContent('copying');
  });

  it('cancel calls window.s3.cancelSync', async () => {
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(window.s3.cancelSync).toHaveBeenCalled();
  });
});
