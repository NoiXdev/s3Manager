# S3 Manager — Operations UI (Plan 2b-2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the File Manager MVP by adding the operations UI on top of the existing plumbing — drag-and-drop multi-file upload with byte-level progress, download (native save dialog), copy presigned GET URL, and delete file/folder (with confirmation) — plus toast feedback.

**Architecture:** New React components/hooks under `src/renderer`. A `ToastProvider` (context) supplies app-wide feedback. `useUploads` owns the upload queue, subscribes to `window.s3.onUploadProgress`, and correlates events by `uploadId`. `useObjectActions` wraps download/copy-URL/delete with toasts + TanStack Query invalidation. A `DropZone` wraps the file browser for drag-drop; an `UploadsPanel` shows progress bars. Delete is gated by a generic `ConfirmDialog`. Every component/hook is tested with Vitest + React Testing Library against a mocked `window.s3`.

**Tech Stack:** React 19, TanStack Query, Tailwind 4, Vitest + RTL + `@testing-library/user-event`.

**Prerequisite:** Plans 1, 2a, 2b-1, 2b-2a merged. Renderer-facing `window.s3` (all `Promise<Result<T>>` unless noted):
- `uploadObject({ accountId, bucket, key, filePath, contentType?, uploadId }): Result<{ key: string }>`
- `onUploadProgress(cb: (p: { uploadId: string; loaded: number; total: number | null }) => void): () => void` (returns unsubscribe; sync)
- `getDropPath(file: File): string` (sync)
- `downloadObject({ accountId, bucket, key }): Result<{ path: string | null }>` (null path = user cancelled)
- `presignGet({ accountId, bucket, key, expiresIn }): Result<string>`
- `deleteObject({ accountId, bucket, key }): Result<number>`
- `deleteFolder({ accountId, bucket, prefix }): Result<number>`

Existing: `objectsKey(accountId, bucket, prefix) = ['objects', accountId, bucket, prefix]` (from `src/renderer/hooks/useObjects.ts`); `unwrap` (`src/renderer/lib/result.ts`); `MetadataPanel({ accountId, bucket, objectKey, onClose })`; `FileBrowser({ accountId, bucket, prefix, selectedKey, onNavigate, onSelectFile })`; `UploadProgress` type from `src/main/ipc/channels.ts`.

Invalidation strategy: after upload/delete, invalidate `['objects', accountId, bucket]` (partial key) so every prefix listing under the bucket refetches.

---

## File Structure

```
src/renderer/
  components/ui/ToastProvider.tsx     # ToastProvider + useToast + <Toaster/>
  components/ui/ConfirmDialog.tsx     # generic confirm modal
  hooks/useUploads.ts                 # upload queue + progress subscription + orchestration
  hooks/useObjectActions.ts           # download / copyPresignedUrl / deleteObject / deleteFolder
  components/files/UploadsPanel.tsx   # active-uploads list with progress bars
  components/files/DropZone.tsx       # drag-over overlay; onDrop(files)
  components/files/MetadataPanel.tsx  # MODIFY: add Download / Copy URL / Delete actions
  components/files/FileBrowser.tsx    # MODIFY: folder-row delete; wrap in DropZone; render UploadsPanel
  App.tsx                             # MODIFY: wrap in ToastProvider
```

---

## Task 1: ToastProvider + useToast + Toaster

**Files:**
- Create: `src/renderer/components/ui/ToastProvider.tsx`
- Test: `src/renderer/components/ui/ToastProvider.test.tsx`

Context default is a no-op `show`, so components/hooks work without a provider in isolation (toasts simply don't render).

- [ ] **Step 1: Write the failing test** — `src/renderer/components/ui/ToastProvider.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from './ToastProvider';

function Trigger() {
  const { show } = useToast();
  return (
    <button type="button" onClick={() => show('Saved!', 'success')}>
      go
    </button>
  );
}

describe('ToastProvider', () => {
  it('shows a toast message when show() is called', async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('Saved!')).toBeInTheDocument();
  });

  it('useToast outside a provider is a no-op (does not throw)', async () => {
    render(<Trigger />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ui/ToastProvider.test.tsx`
Expected: FAIL — cannot find module `./ToastProvider`.

- [ ] **Step 3: Implement** — `src/renderer/components/ui/ToastProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}
interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded px-3 py-2 text-sm text-white shadow ${
              t.kind === 'error' ? 'bg-red-600' : 'bg-slate-800'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ui/ToastProvider.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ui/ToastProvider.tsx src/renderer/components/ui/ToastProvider.test.tsx
git commit -m "feat(ui): add ToastProvider/useToast"
```

---

## Task 2: ConfirmDialog

**Files:**
- Create: `src/renderer/components/ui/ConfirmDialog.tsx`
- Test: `src/renderer/components/ui/ConfirmDialog.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/ui/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders the message and fires onConfirm', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog message="Delete logo.png?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Delete logo.png?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('fires onCancel from the Cancel button', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog message="x" confirmLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/ui/ConfirmDialog.test.tsx`
Expected: FAIL — cannot find module `./ConfirmDialog`.

- [ ] **Step 3: Implement** — `src/renderer/components/ui/ConfirmDialog.tsx`:

```tsx
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
      <div className="w-80 rounded bg-white p-4 shadow-lg">
        <p className="text-sm text-slate-800">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-1 text-sm hover:bg-slate-100" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/ui/ConfirmDialog.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/ui/ConfirmDialog.tsx src/renderer/components/ui/ConfirmDialog.test.tsx
git commit -m "feat(ui): add ConfirmDialog"
```

---

## Task 3: useObjectActions (download / copy URL / delete)

**Files:**
- Create: `src/renderer/hooks/useObjectActions.ts`
- Test: `src/renderer/hooks/useObjectActions.test.tsx`

Returns async callbacks bound to an `(accountId, bucket)`. Each surfaces a toast; delete invalidates the bucket's object listings.

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectActions.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectActions } from './useObjectActions';

let client: QueryClient;
function wrapper() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    downloadObject: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/logo.png' } }),
    presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
    deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    deleteFolder: vi.fn().mockResolvedValue({ ok: true, data: 3 }),
  };
});

describe('useObjectActions', () => {
  it('copyPresignedUrl writes the signed URL to the clipboard', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.copyPresignedUrl('logo.png');
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 3600 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed/x');
  });

  it('download calls downloadObject with the key', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    await result.current.download('logo.png');
    expect(window.s3.downloadObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
  });

  it('deleteObject deletes and invalidates the bucket listings', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.deleteObject('logo.png');
    expect(window.s3.deleteObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });

  it('deleteFolder deletes and invalidates', async () => {
    const { result } = renderHook(() => useObjectActions('acc-1', 'assets'), { wrapper: wrapper() });
    const spy = vi.spyOn(client, 'invalidateQueries');
    await result.current.deleteFolder('images/');
    expect(window.s3.deleteFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['objects', 'acc-1', 'assets'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectActions.test.tsx`
Expected: FAIL — cannot find module `./useObjectActions`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectActions.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/ui/ToastProvider';

export function useObjectActions(accountId: string, bucket: string) {
  const qc = useQueryClient();
  const { show } = useToast();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });

  return {
    async download(key: string) {
      const r = await window.s3.downloadObject({ accountId, bucket, key });
      if (!r.ok) show(`${r.error.code}: ${r.error.message}`, 'error');
      else if (r.data.path) show('Download complete');
    },
    async copyPresignedUrl(key: string) {
      const r = await window.s3.presignGet({ accountId, bucket, key, expiresIn: 3600 });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      await navigator.clipboard.writeText(r.data);
      show('Signed URL copied');
    },
    async deleteObject(key: string) {
      const r = await window.s3.deleteObject({ accountId, bucket, key });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      invalidate();
      show('Deleted');
    },
    async deleteFolder(prefix: string) {
      const r = await window.s3.deleteFolder({ accountId, bucket, prefix });
      if (!r.ok) {
        show(`${r.error.code}: ${r.error.message}`, 'error');
        return;
      }
      invalidate();
      show('Folder deleted');
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectActions.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectActions.ts src/renderer/hooks/useObjectActions.test.tsx
git commit -m "feat(ui): add useObjectActions (download/copy-url/delete) with toasts + invalidation"
```

---

## Task 4: useUploads hook

**Files:**
- Create: `src/renderer/hooks/useUploads.ts`
- Test: `src/renderer/hooks/useUploads.test.tsx`

Owns the upload queue, subscribes to progress on mount, and uploads dropped files. Each item carries the `uploadId` used for correlation.

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useUploads.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUploads } from './useUploads';

let progressCb: (p: { uploadId: string; loaded: number; total: number | null }) => void = () => {};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    getDropPath: vi.fn((f: File) => `/local/${f.name}`),
    uploadObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/a.txt' } }),
    onUploadProgress: vi.fn((cb: typeof progressCb) => {
      progressCb = cb;
      return () => {};
    }),
  };
});

describe('useUploads', () => {
  it('uploads a dropped file with a resolved path and prefixed key, then marks it done', async () => {
    const { result } = renderHook(() => useUploads('acc-1', 'assets'), { wrapper: wrapper() });
    const file = new File(['hi'], 'a.txt', { type: 'text/plain' });

    await act(async () => {
      await result.current.upload([file], 'images/');
    });

    expect(window.s3.getDropPath).toHaveBeenCalledWith(file);
    const call = (window.s3.uploadObject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({ accountId: 'acc-1', bucket: 'assets', key: 'images/a.txt', filePath: '/local/a.txt', contentType: 'text/plain' });
    expect(typeof call.uploadId).toBe('string');
    expect(result.current.items[0].name).toBe('a.txt');
    expect(result.current.items[0].status).toBe('done');
  });

  it('updates progress for the matching uploadId', async () => {
    let resolveUpload: (v: unknown) => void = () => {};
    (window as unknown as { s3: unknown }).s3 = {
      getDropPath: vi.fn((f: File) => `/local/${f.name}`),
      uploadObject: vi.fn(() => new Promise((res) => { resolveUpload = res; })),
      onUploadProgress: vi.fn((cb: typeof progressCb) => { progressCb = cb; return () => {}; }),
    };
    const { result } = renderHook(() => useUploads('acc-1', 'assets'), { wrapper: wrapper() });

    await act(async () => {
      void result.current.upload([new File(['x'], 'b.txt')], '');
    });
    const id = (window.s3.uploadObject as ReturnType<typeof vi.fn>).mock.calls[0][0].uploadId as string;

    act(() => progressCb({ uploadId: id, loaded: 40, total: 100 }));
    await waitFor(() => expect(result.current.items[0].loaded).toBe(40));
    expect(result.current.items[0].total).toBe(100);
    expect(result.current.items[0].status).toBe('uploading');

    await act(async () => { resolveUpload({ ok: true, data: { key: 'b.txt' } }); });
    await waitFor(() => expect(result.current.items[0].status).toBe('done'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useUploads.test.tsx`
Expected: FAIL — cannot find module `./useUploads`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useUploads.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface UploadItem {
  id: string;
  name: string;
  status: 'uploading' | 'done' | 'error';
  loaded: number;
  total: number | null;
  error?: string;
}

export function useUploads(accountId: string | null, bucket: string | null) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  // Keep the latest update fn for the progress subscription without re-subscribing.
  const updateRef = useRef(update);
  updateRef.current = update;

  useEffect(() => {
    const unsubscribe = window.s3.onUploadProgress((p) => {
      updateRef.current(p.uploadId, { loaded: p.loaded, total: p.total });
    });
    return unsubscribe;
  }, []);

  const upload = useCallback(
    async (files: File[], prefix: string) => {
      if (accountId === null || bucket === null) return;
      await Promise.all(
        files.map(async (file) => {
          const id = crypto.randomUUID();
          setItems((prev) => [...prev, { id, name: file.name, status: 'uploading', loaded: 0, total: null }]);
          try {
            const filePath = window.s3.getDropPath(file);
            const r = await window.s3.uploadObject({
              accountId,
              bucket,
              key: `${prefix}${file.name}`,
              filePath,
              contentType: file.type || undefined,
              uploadId: id,
            });
            if (r.ok) {
              update(id, { status: 'done' });
              qc.invalidateQueries({ queryKey: ['objects', accountId, bucket] });
            } else {
              update(id, { status: 'error', error: `${r.error.code}: ${r.error.message}` });
            }
          } catch (e) {
            update(id, { status: 'error', error: (e as Error).message });
          }
        }),
      );
    },
    [accountId, bucket, qc, update],
  );

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'uploading'));
  }, []);

  return { items, upload, clearFinished };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useUploads.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useUploads.ts src/renderer/hooks/useUploads.test.tsx
git commit -m "feat(ui): add useUploads queue with progress correlation"
```

---

## Task 5: UploadsPanel

**Files:**
- Create: `src/renderer/components/files/UploadsPanel.tsx`
- Test: `src/renderer/components/files/UploadsPanel.test.tsx`

Renders nothing when empty; otherwise a compact list of upload items with a progress bar each.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/UploadsPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UploadsPanel } from './UploadsPanel';
import type { UploadItem } from '../../hooks/useUploads';

const items: UploadItem[] = [
  { id: '1', name: 'a.txt', status: 'uploading', loaded: 50, total: 100 },
  { id: '2', name: 'b.txt', status: 'done', loaded: 10, total: 10 },
];

describe('UploadsPanel', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<UploadsPanel items={[]} onClear={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists upload items with names and status', () => {
    render(<UploadsPanel items={items} onClear={() => {}} />);
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('calls onClear when Clear finished is clicked', async () => {
    const onClear = vi.fn();
    render(<UploadsPanel items={items} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear finished' }));
    expect(onClear).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/UploadsPanel.test.tsx`
Expected: FAIL — cannot find module `./UploadsPanel`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/UploadsPanel.tsx`:

```tsx
import type { UploadItem } from '../../hooks/useUploads';

function percent(item: UploadItem): number {
  if (item.status === 'done') return 100;
  if (!item.total || item.total === 0) return 0;
  return Math.min(100, Math.round((item.loaded / item.total) * 100));
}

export function UploadsPanel({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  if (items.length === 0) return null;

  return (
    <div className="border-t border-slate-200 bg-slate-50 p-2">
      <div className="flex items-center justify-between pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uploads</span>
        <button type="button" className="rounded px-2 text-xs hover:bg-slate-200" onClick={onClear}>
          Clear finished
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 text-xs">
            <span className="w-40 truncate">{item.name}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
              <span
                className={`block h-full ${item.status === 'error' ? 'bg-red-500' : 'bg-slate-700'}`}
                style={{ width: `${percent(item)}%` }}
              />
            </span>
            <span className="w-16 text-right text-slate-500">
              {item.status === 'error' ? 'error' : `${percent(item)}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/UploadsPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/UploadsPanel.tsx src/renderer/components/files/UploadsPanel.test.tsx
git commit -m "feat(ui): add UploadsPanel with progress bars"
```

---

## Task 6: DropZone

**Files:**
- Create: `src/renderer/components/files/DropZone.tsx`
- Test: `src/renderer/components/files/DropZone.test.tsx`

Wraps content; shows an overlay while dragging files; calls `onDropFiles(files)` on drop.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/DropZone.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropZone } from './DropZone';

describe('DropZone', () => {
  it('shows the overlay on drag-over and hides it on drag-leave', () => {
    render(
      <DropZone onDropFiles={() => {}}>
        <p>content</p>
      </DropZone>,
    );
    const zone = screen.getByTestId('dropzone');
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('Drop files to upload')).toBeInTheDocument();
    fireEvent.dragLeave(zone);
    expect(screen.queryByText('Drop files to upload')).not.toBeInTheDocument();
  });

  it('calls onDropFiles with the dropped files', () => {
    const onDropFiles = vi.fn();
    render(
      <DropZone onDropFiles={onDropFiles}>
        <p>content</p>
      </DropZone>,
    );
    const file = new File(['x'], 'a.txt');
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(onDropFiles).toHaveBeenCalledWith([file]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/DropZone.test.tsx`
Expected: FAIL — cannot find module `./DropZone`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/DropZone.tsx`:

```tsx
import { useState, type ReactNode } from 'react';

export function DropZone({
  onDropFiles,
  children,
}: {
  onDropFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      data-testid="dropzone"
      className="relative h-full"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) onDropFiles(files);
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-slate-400 bg-slate-100/80 text-slate-600">
          Drop files to upload
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/DropZone.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/DropZone.tsx src/renderer/components/files/DropZone.test.tsx
git commit -m "feat(ui): add DropZone with drag overlay"
```

---

## Task 7: Object actions in MetadataPanel (Download / Copy URL / Delete)

**Files:**
- Modify: `src/renderer/components/files/MetadataPanel.tsx`
- Modify: `src/renderer/components/files/MetadataPanel.test.tsx`

Adds an actions row (Download, Copy URL, Delete) using `useObjectActions`; Delete opens a `ConfirmDialog`, and on confirm deletes then calls `onClose` (the object is gone). Existing metadata/visibility rendering is unchanged.

- [ ] **Step 1: Add failing tests** — append to `src/renderer/components/files/MetadataPanel.test.tsx` (the file already has a `wrap` helper using `QueryClientProvider`; ensure imports include `userEvent`):

```tsx
describe('MetadataPanel actions', () => {
  beforeEach(() => {
    (window as unknown as { s3: unknown }).s3 = {
      headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 1, contentType: null, lastModified: null, storageClass: null, etag: null, metadata: {} } }),
      objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
      presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
      downloadObject: vi.fn().mockResolvedValue({ ok: true, data: { path: '/tmp/x' } }),
      deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    };
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('copies a presigned URL', async () => {
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="logo.png" onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy URL' }));
    expect(window.s3.presignGet).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png', expiresIn: 3600 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://signed/x');
  });

  it('deletes after confirmation and closes the panel', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' })); // confirm in dialog
    expect(window.s3.deleteObject).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', key: 'logo.png' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

(Note: after opening the dialog there are two "Delete" buttons; `getByRole` would throw on the second click. Implement the panel's trigger button labelled "Delete" and the dialog confirm labelled "Delete", but hide the panel trigger while the dialog is open — see Step 3 — so only one "Delete" is present at each click.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — actions row not implemented.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/MetadataPanel.tsx`. Add imports and a confirm state; render an actions row above the details. Add at the top of the file:

```tsx
import { useState } from 'react';
import { useObjectActions } from '../../hooks/useObjectActions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
```

Inside the component body (after the `useObjectDetails` call), add:

```tsx
  const actions = useObjectActions(accountId ?? '', bucket ?? '');
  const [confirming, setConfirming] = useState(false);
```

Then, immediately after the header `<div>` (the one containing "Details" + Close) and before the scrollable details `<div>`, insert the actions row:

```tsx
      <div className="flex gap-1 border-b border-slate-200 p-2">
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => void actions.download(objectKey)}>
          Download
        </button>
        <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50" onClick={() => void actions.copyPresignedUrl(objectKey)}>
          Copy URL
        </button>
        {!confirming && (
          <button type="button" className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          message={`Delete ${objectKey}?`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await actions.deleteObject(objectKey);
            onClose();
          }}
        />
      )}
```

(The `{!confirming && …}` guard hides the panel's Delete trigger while the dialog is open, so the dialog's "Delete" is the only one present during confirmation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (existing 3 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): add download/copy-url/delete actions to MetadataPanel"
```

---

## Task 8: FileBrowser — folder delete + drop-to-upload + uploads panel

**Files:**
- Modify: `src/renderer/components/files/FileBrowser.tsx`
- Modify: `src/renderer/components/files/FileBrowser.test.tsx`

Wrap the browser body in `DropZone` (dropping uploads to the current `prefix` via `useUploads`), render `UploadsPanel`, and add a delete button to each folder row (confirm → `deleteFolder`).

- [ ] **Step 1: Add failing tests** — append to `src/renderer/components/files/FileBrowser.test.tsx` (the file has a `wrap` helper + `baseProps`):

```tsx
describe('FileBrowser operations', () => {
  it('uploads dropped files to the current prefix', async () => {
    const uploadObject = vi.fn().mockResolvedValue({ ok: true, data: { key: 'images/a.txt' } });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
      getDropPath: vi.fn((f: File) => `/local/${f.name}`),
      uploadObject,
      onUploadProgress: vi.fn(() => () => {}),
    };
    wrap(<FileBrowser {...baseProps} />);
    await screen.findByText('This folder is empty');
    const file = new File(['x'], 'a.txt');
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file], types: ['Files'] } });
    await waitFor(() => expect(uploadObject).toHaveBeenCalled());
    expect(uploadObject.mock.calls[0][0]).toMatchObject({ bucket: 'assets', key: 'images/a.txt', filePath: '/local/a.txt' });
  });

  it('deletes a folder after confirmation', async () => {
    const deleteFolder = vi.fn().mockResolvedValue({ ok: true, data: 1 });
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }], files: [], nextToken: null } }),
      getDropPath: vi.fn(),
      uploadObject: vi.fn(),
      onUploadProgress: vi.fn(() => () => {}),
      deleteFolder,
    };
    wrap(<FileBrowser {...baseProps} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete folder thumbs' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ accountId: 'acc-1', bucket: 'assets', prefix: 'images/thumbs/' }));
  });
});
```

Ensure the test file imports `fireEvent`, `waitFor` (from `@testing-library/react`), and `userEvent`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: FAIL — no dropzone / no folder delete.

- [ ] **Step 3: Implement** — modify `src/renderer/components/files/FileBrowser.tsx`. Add imports:

```tsx
import { useState } from 'react';
import { DropZone } from './DropZone';
import { UploadsPanel } from './UploadsPanel';
import { useUploads } from '../../hooks/useUploads';
import { useObjectActions } from '../../hooks/useObjectActions';
import { ConfirmDialog } from '../ui/ConfirmDialog';
```

In the component body (after the `useObjects` call), add:

```tsx
  const uploads = useUploads(accountId, bucket);
  const actions = useObjectActions(accountId ?? '', bucket ?? '');
  const [folderToDelete, setFolderToDelete] = useState<{ name: string; prefix: string } | null>(null);
```

Wrap the existing scrollable browser body (`<div className="flex-1 overflow-auto"> … </div>`) so the whole content area becomes the drop target and the uploads panel + confirm dialog render. Replace the existing return's body region: keep the header (breadcrumb) and state messages, but wrap the table region with `DropZone` and append `UploadsPanel`. Concretely, change the structure so the component returns:

```tsx
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
      </div>

      {query.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {query.isError && <p className="p-3 text-red-600">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500">This folder is empty</p>}

      <DropZone onDropFiles={(files) => void uploads.upload(files, prefix)}>
        <div className="h-full overflow-auto">
          <table className="w-full border-collapse text-left">
            <tbody>
              {folders.map((folder) => (
                <tr
                  key={folder.prefix}
                  onClick={() => onNavigate(folder.prefix)}
                  className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-3 py-1.5">📁 <span>{folder.name}</span></td>
                  <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      aria-label={`Delete folder ${folder.name}`}
                      className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToDelete(folder);
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {files.map((file) => (
                <tr
                  key={file.key}
                  onClick={() => onSelectFile(file.key)}
                  className={`cursor-pointer border-b border-slate-100 ${
                    file.key === selectedKey ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-3 py-1.5">📄 <span>{file.name}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(file.size)}</td>
                  <td className="px-3 py-1.5 text-slate-500">{formatTimestamp(file.lastModified)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              className="m-3 rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </DropZone>

      <UploadsPanel items={uploads.items} onClear={uploads.clearFinished} />

      {folderToDelete && (
        <ConfirmDialog
          message={`Delete folder ${folderToDelete.name} and all its contents?`}
          confirmLabel="Delete"
          onCancel={() => setFolderToDelete(null)}
          onConfirm={async () => {
            const target = folderToDelete;
            setFolderToDelete(null);
            await actions.deleteFolder(target.prefix);
          }}
        />
      )}
    </div>
  );
```

Keep the `if (bucket === null) return …` guard and the `isEmpty` computation exactly as they are above this return. The file table now has a third column on folder rows (the delete button); leave file rows' third column as the last-modified cell (the folder delete button occupies folders' last cell). Note folders now have cells: name, "—", delete; files have: name, size, last-modified — both 3 columns.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: PASS (existing 4 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/FileBrowser.tsx src/renderer/components/files/FileBrowser.test.tsx
git commit -m "feat(ui): drop-to-upload, uploads panel, and folder delete in FileBrowser"
```

---

## Task 9: Wrap the app in ToastProvider

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

Toasts must render app-wide, so `ToastProvider` wraps the shell. (Existing tests that don't assert toasts keep passing because `ToastProvider` is transparent.)

- [ ] **Step 1: Add a failing test** — append to `src/renderer/App.test.tsx` (the `beforeEach` already stubs `window.s3` with account/bucket/object mocks; extend it to include the op mocks). Replace the existing `beforeEach` body's `window.s3` assignment with one that also includes `presignGet`, `deleteObject`, `getDropPath`, `uploadObject`, `onUploadProgress`, and add the clipboard stub:

```tsx
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [{ name: 'logo.png', key: 'logo.png', size: 5, lastModified: null, storageClass: null, etag: null }], nextToken: null } }),
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 5, contentType: 'image/png', lastModified: null, storageClass: null, etag: null, metadata: {} } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
    presignGet: vi.fn().mockResolvedValue({ ok: true, data: 'https://signed/x' }),
    deleteObject: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    getDropPath: vi.fn((f: File) => `/local/${f.name}`),
    uploadObject: vi.fn().mockResolvedValue({ ok: true, data: { key: 'logo.png' } }),
    onUploadProgress: vi.fn(() => () => {}),
  };
```

Append this test:
```tsx
describe('App — operations feedback', () => {
  it('shows a toast after copying a presigned URL from the metadata panel', async () => {
    renderApp();
    await userEvent.click(await screen.findByText('AWS prod'));
    await userEvent.click(await screen.findByText('assets'));
    await userEvent.click(await screen.findByText('logo.png'));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy URL' }));
    expect(await screen.findByText('Signed URL copied')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — no toast renders (no `ToastProvider`).

- [ ] **Step 3: Implement** — modify `src/renderer/App.tsx`. Add the import:

```tsx
import { ToastProvider } from './components/ui/ToastProvider';
```

Wrap the returned shell in `<ToastProvider>…</ToastProvider>`. The outermost element changes from the `<div className="flex h-full …">` to `<ToastProvider>` containing that div:

```tsx
  return (
    <ToastProvider>
      <div className="flex h-full text-sm text-slate-800">
        {/* …existing aside + main unchanged… */}
      </div>
    </ToastProvider>
  );
```

(Leave the entire inner shell — aside, SectionNav, AccountsPane, BucketsPane, FileBrowser, MetadataPanel — exactly as it is.)

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS.
Run: `npm test`
Expected: all pass.
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): wrap app in ToastProvider for operation feedback"
```

---

## Manual smoke checklist (after Task 9)

`npm start`, with a real account + writable bucket:
1. Drag files onto the file browser → overlay appears → drop → Uploads panel shows progress bars filling to 100% → files appear in the list (listing refetches). "Clear finished" empties completed rows.
2. Click a file → Details panel → **Copy URL** → toast "Signed URL copied"; paste the URL in a browser → the object downloads.
3. **Download** → native save dialog → choose a path → file written; toast "Download complete". Cancel the dialog → no toast, no error.
4. **Delete** a file → confirm → object disappears (listing refetches); panel closes; toast "Deleted".
5. Delete a folder via its ✕ → confirm → folder + contents removed; toast "Folder deleted".

---

## Self-Review

**Spec coverage (the remaining Files-view operations):**
- Drag-and-drop upload, multiple files, with per-file byte progress → Tasks 4, 5, 6, 8. ✅
- Download files (save dialog → disk) → Tasks 3, 7 (plumbing from 2b-2a). ✅
- Copy signed URL (GET) → Tasks 3, 7. ✅
- Delete files and folders (with confirmation) → Tasks 2, 3, 7 (file), 8 (folder). ✅
- Feedback / states → toasts (Task 1) used across actions; uploads panel shows per-file status incl. error. ✅
- Move files/folders, change permissions/ACLs, sync, CORS, object-lock, dashboard → **out of scope** (later cycles per the spec's Non-Goals). ✅

**Placeholder scan:** none — every step has complete code/commands. The Task 8 implementation block reproduces the full `FileBrowser` return (not "modify the existing table") so the engineer applies one coherent replacement.

**Type consistency:** `UploadItem` (`{id,name,status,loaded,total,error?}`) is defined in `useUploads.ts` and consumed by `UploadsPanel`. `useObjectActions(accountId, bucket)` returns `{download,copyPresignedUrl,deleteObject,deleteFolder}` used by both `MetadataPanel` and `FileBrowser`. `useUploads(accountId,bucket)` returns `{items,upload,clearFinished}`. `DropZone` prop is `onDropFiles(files: File[])`. `ConfirmDialog` props `{message,confirmLabel,onConfirm,onCancel}` are used consistently in Tasks 7 and 8. Invalidation key `['objects', accountId, bucket]` is a partial match of `objectsKey`'s `['objects', accountId, bucket, prefix]`, so it correctly invalidates every prefix listing under the bucket. `useObjectActions` is given `accountId ?? ''`/`bucket ?? ''` by callers that only render their action UI when a real object/bucket is in context (MetadataPanel renders only for a selected key; FileBrowser's folder delete only exists when a bucket is loaded).

**Note for implementers:** `crypto.randomUUID()` (used in `useUploads`) is available in the Electron renderer and in the Vitest jsdom/Node environment (Node 22). Clipboard and drag-drop are stubbed in tests (`navigator.clipboard`, `dataTransfer`); in the real app the Electron renderer provides them.
