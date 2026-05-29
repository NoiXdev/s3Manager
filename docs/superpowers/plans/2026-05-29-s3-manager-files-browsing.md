# S3 Manager — Files View: Browsing (Plan 2b-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the read-only half of the Files view — a buckets pane and a paginated file browser with prefix/breadcrumb folder navigation and an object metadata panel (size, type, dates, storage class, ETag, custom metadata, and public/private visibility) — all consuming the existing `window.s3` bridge.

**Architecture:** New React components and TanStack Query hooks under `src/renderer`, wired into the three-pane Files layout in `App.tsx` (panes 2 and 3, replacing the Plan-2a placeholders). Object listing uses `useInfiniteQuery` over `listObjects`'s `continuationToken` ("Load more"). Folder navigation manipulates the S3 key prefix. No backend or preload changes — browsing uses only existing read ops. Every component/hook is tested with Vitest + React Testing Library against a mocked `window.s3`.

**Tech Stack:** React 19, TanStack Query (incl. `useInfiniteQuery`), Tailwind 4, Vitest + RTL.

**Prerequisite:** Plans 1, 2a merged to `develop`. Existing relevant `window.s3` surface (all return `Promise<Result<T>>`):
- `listBuckets(accountId: string): Result<string[]>`
- `listObjects({ accountId, bucket, prefix, continuationToken? }): Result<ListObjectsResult>` where `ListObjectsResult = { folders: FolderEntry[]; files: FileEntry[]; nextToken: string | null }`, `FolderEntry = { name: string; prefix: string }`, `FileEntry = { name; key; size; lastModified: string|null; storageClass: string|null; etag: string|null }`.
- `headObject({ accountId, bucket, key }): Result<ObjectMetadata>` where `ObjectMetadata = { size; contentType; lastModified; storageClass; etag; metadata: Record<string,string> }`.
- `objectVisibility({ accountId, bucket, key }): Result<'public'|'private'|'unknown'>`.

Pure helpers importable into the renderer (no Node deps, like `providers`): `prefixToBreadcrumb`, `parentPrefix`, and types `FolderEntry`/`FileEntry`/`Crumb` from `src/main/s3/listTransform`; `ListObjectsResult`/`ObjectMetadata` from `src/main/s3/objects`; `Visibility` from `src/main/s3/visibility`.

---

## File Structure

```
src/renderer/
  lib/format.ts                              # formatBytes, formatTimestamp (pure) + test
  hooks/useBuckets.ts                        # buckets query
  hooks/useObjects.ts                        # objects infinite query (folders/files/nextToken)
  hooks/useObjectDetails.ts                  # headObject + objectVisibility queries
  components/buckets/BucketsPane.tsx         # pane 2: bucket list + select + states
  components/files/Breadcrumb.tsx            # prefix breadcrumb (root / a / b)
  components/files/FileBrowser.tsx           # pane 3: breadcrumb + folder/file table + load more
  components/files/MetadataPanel.tsx         # right slide-over: object metadata + visibility
  App.tsx                                    # lift bucket/prefix/selectedKey state; wire panes (modified)
```

State model (lifted into `App`): `selectedAccountId`, `selectedBucket: string | null`, `prefix: string`, `selectedKey: string | null`. Reset rules: changing account clears bucket+prefix+selectedKey; changing bucket clears prefix+selectedKey; navigating a folder/breadcrumb clears selectedKey.

---

## Task 1: Formatting utilities

**Files:**
- Create: `src/renderer/lib/format.ts`
- Test: `src/renderer/lib/format.test.ts`

- [ ] **Step 1: Write the failing test** — `src/renderer/lib/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatBytes, formatTimestamp } from './format';

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
});

describe('formatTimestamp', () => {
  it('renders an ISO string as a locale date-time', () => {
    const out = formatTimestamp('2024-01-02T03:04:05.000Z');
    expect(out).not.toBe('');
    expect(out).not.toBe('—');
  });
  it('renders an em dash for null', () => {
    expect(formatTimestamp(null)).toBe('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/lib/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Implement** — `src/renderer/lib/format.ts`:

```ts
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/lib/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/format.ts src/renderer/lib/format.test.ts
git commit -m "feat(ui): add byte and timestamp formatters"
```

---

## Task 2: useBuckets hook

**Files:**
- Create: `src/renderer/hooks/useBuckets.ts`
- Test: `src/renderer/hooks/useBuckets.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useBuckets.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useBuckets } from './useBuckets';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets', 'backups'] }),
  };
});

describe('useBuckets', () => {
  it('loads buckets for an account', async () => {
    const { result } = renderHook(() => useBuckets('acc-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['assets', 'backups']);
  });

  it('does not fetch when accountId is null', () => {
    const list = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { listBuckets: list };
    const { result } = renderHook(() => useBuckets(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useBuckets.test.tsx`
Expected: FAIL — cannot find module `./useBuckets`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useBuckets.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function bucketsKey(accountId: string | null) {
  return ['buckets', accountId] as const;
}

export function useBuckets(accountId: string | null) {
  return useQuery({
    queryKey: bucketsKey(accountId),
    queryFn: async () => unwrap(await window.s3.listBuckets(accountId!)),
    enabled: accountId !== null,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useBuckets.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useBuckets.ts src/renderer/hooks/useBuckets.test.tsx
git commit -m "feat(ui): add useBuckets query hook"
```

---

## Task 3: BucketsPane component

**Files:**
- Create: `src/renderer/components/buckets/BucketsPane.tsx`
- Test: `src/renderer/components/buckets/BucketsPane.test.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/components/buckets/BucketsPane.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BucketsPane } from './BucketsPane';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets', 'backups'] }),
  };
});

describe('BucketsPane', () => {
  it('prompts to select an account when none is selected', () => {
    wrap(<BucketsPane accountId={null} selectedBucket={null} onSelect={() => {}} />);
    expect(screen.getByText('Select an account')).toBeInTheDocument();
  });

  it('lists buckets and selects one on click', async () => {
    const onSelect = vi.fn();
    wrap(<BucketsPane accountId="acc-1" selectedBucket={null} onSelect={onSelect} />);
    await userEvent.click(await screen.findByText('backups'));
    expect(onSelect).toHaveBeenCalledWith('backups');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/buckets/BucketsPane.test.tsx`
Expected: FAIL — cannot find module `./BucketsPane`.

- [ ] **Step 3: Implement** — `src/renderer/components/buckets/BucketsPane.tsx`:

```tsx
import { useBuckets } from '../../hooks/useBuckets';

export function BucketsPane({
  accountId,
  selectedBucket,
  onSelect,
}: {
  accountId: string | null;
  selectedBucket: string | null;
  onSelect: (bucket: string) => void;
}) {
  const buckets = useBuckets(accountId);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Buckets</span>
      </div>

      {accountId === null && <p className="p-3 text-slate-500">Select an account</p>}
      {accountId !== null && buckets.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {buckets.isError && <p className="p-3 text-red-600">{(buckets.error as Error).message}</p>}
      {buckets.isSuccess && buckets.data.length === 0 && (
        <p className="p-3 text-slate-500">No buckets</p>
      )}

      <ul className="flex-1 overflow-auto">
        {buckets.data?.map((bucket) => (
          <li key={bucket}>
            <button
              type="button"
              onClick={() => onSelect(bucket)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                bucket === selectedBucket ? 'bg-slate-100 font-medium' : 'hover:bg-slate-50'
              }`}
            >
              <span aria-hidden>🪣</span>
              {bucket}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/buckets/BucketsPane.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/buckets/BucketsPane.tsx src/renderer/components/buckets/BucketsPane.test.tsx
git commit -m "feat(ui): add BucketsPane"
```

---

## Task 4: useObjects infinite-query hook

**Files:**
- Create: `src/renderer/hooks/useObjects.ts`
- Test: `src/renderer/hooks/useObjects.test.tsx`

Loads object pages via `continuationToken`; exposes flattened, de-duplicated folders and files.

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjects.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjects } from './useObjects';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }],
        files: [{ name: 'logo.png', key: 'images/logo.png', size: 10, lastModified: null, storageClass: null, etag: null }],
        nextToken: null,
      },
    }),
  };
});

describe('useObjects', () => {
  it('loads folders and files for a prefix', async () => {
    const { result } = renderHook(() => useObjects('acc-1', 'assets', 'images/'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.folders).toEqual([{ name: 'thumbs', prefix: 'images/thumbs/' }]);
    expect(result.current.files.map((f) => f.name)).toEqual(['logo.png']);
    expect(result.current.query.hasNextPage).toBe(false);
  });

  it('is idle when bucket is null', () => {
    const list = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { listObjects: list };
    const { result } = renderHook(() => useObjects('acc-1', null, ''), { wrapper: wrapper() });
    expect(result.current.query.fetchStatus).toBe('idle');
    expect(list).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjects.test.tsx`
Expected: FAIL — cannot find module `./useObjects`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjects.ts`:

```ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';
import type { FolderEntry, FileEntry } from '../../main/s3/listTransform';
import type { ListObjectsResult } from '../../main/s3/objects';

export function objectsKey(accountId: string | null, bucket: string | null, prefix: string) {
  return ['objects', accountId, bucket, prefix] as const;
}

export function useObjects(accountId: string | null, bucket: string | null, prefix: string) {
  const query = useInfiniteQuery({
    queryKey: objectsKey(accountId, bucket, prefix),
    enabled: accountId !== null && bucket !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await window.s3.listObjects({ accountId: accountId!, bucket: bucket!, prefix, continuationToken: pageParam }),
      ),
    getNextPageParam: (last: ListObjectsResult) => last.nextToken ?? undefined,
  });

  const pages = query.data?.pages ?? [];
  const folderMap = new Map<string, FolderEntry>();
  for (const page of pages) for (const f of page.folders) folderMap.set(f.prefix, f);
  const folders: FolderEntry[] = [...folderMap.values()];
  const files: FileEntry[] = pages.flatMap((p) => p.files);

  return { query, folders, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjects.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjects.ts src/renderer/hooks/useObjects.test.tsx
git commit -m "feat(ui): add useObjects infinite-query hook"
```

---

## Task 5: Breadcrumb component

**Files:**
- Create: `src/renderer/components/files/Breadcrumb.tsx`
- Test: `src/renderer/components/files/Breadcrumb.test.tsx`

Uses `prefixToBreadcrumb` (pure helper) to render navigable segments.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/Breadcrumb.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  it('renders root plus each segment and navigates on click', async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb prefix="images/thumbs/" onNavigate={onNavigate} />);
    expect(screen.getByRole('button', { name: 'root' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'images' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thumbs' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'images' }));
    expect(onNavigate).toHaveBeenCalledWith('images/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/Breadcrumb.test.tsx`
Expected: FAIL — cannot find module `./Breadcrumb`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/Breadcrumb.tsx`:

```tsx
import { Fragment } from 'react';
import { prefixToBreadcrumb } from '../../../main/s3/listTransform';

export function Breadcrumb({
  prefix,
  onNavigate,
}: {
  prefix: string;
  onNavigate: (prefix: string) => void;
}) {
  const crumbs = prefixToBreadcrumb(prefix);
  return (
    <nav className="flex flex-wrap items-center gap-1 text-slate-600">
      {crumbs.map((crumb, i) => (
        <Fragment key={crumb.prefix}>
          {i > 0 && <span className="text-slate-300">/</span>}
          <button
            type="button"
            onClick={() => onNavigate(crumb.prefix)}
            className="rounded px-1 hover:bg-slate-100"
          >
            {crumb.label}
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/Breadcrumb.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/Breadcrumb.tsx src/renderer/components/files/Breadcrumb.test.tsx
git commit -m "feat(ui): add Breadcrumb"
```

---

## Task 6: FileBrowser component

**Files:**
- Create: `src/renderer/components/files/FileBrowser.tsx`
- Test: `src/renderer/components/files/FileBrowser.test.tsx`

Renders the breadcrumb + a table of folders (navigate on click) then files (select on click, opening the metadata panel), with loading/empty/error states and a "Load more" button when more pages exist.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/FileBrowser.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { FileBrowser } from './FileBrowser';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    listObjects: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        folders: [{ name: 'thumbs', prefix: 'images/thumbs/' }],
        files: [{ name: 'logo.png', key: 'images/logo.png', size: 2048, lastModified: '2024-01-01T00:00:00.000Z', storageClass: 'STANDARD', etag: '"a"' }],
        nextToken: null,
      },
    }),
  };
});

const baseProps = {
  accountId: 'acc-1',
  bucket: 'assets',
  prefix: 'images/',
  selectedKey: null as string | null,
  onNavigate: () => {},
  onSelectFile: () => {},
};

describe('FileBrowser', () => {
  it('lists folders and files for the current prefix', async () => {
    wrap(<FileBrowser {...baseProps} />);
    expect(await screen.findByText('thumbs')).toBeInTheDocument();
    expect(screen.getByText('logo.png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('navigates into a folder on click', async () => {
    const onNavigate = vi.fn();
    wrap(<FileBrowser {...baseProps} onNavigate={onNavigate} />);
    await userEvent.click(await screen.findByText('thumbs'));
    expect(onNavigate).toHaveBeenCalledWith('images/thumbs/');
  });

  it('selects a file on click', async () => {
    const onSelectFile = vi.fn();
    wrap(<FileBrowser {...baseProps} onSelectFile={onSelectFile} />);
    await userEvent.click(await screen.findByText('logo.png'));
    expect(onSelectFile).toHaveBeenCalledWith('images/logo.png');
  });

  it('shows an empty state for an empty prefix', async () => {
    (window as unknown as { s3: unknown }).s3 = {
      listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [], nextToken: null } }),
    };
    wrap(<FileBrowser {...baseProps} />);
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: FAIL — cannot find module `./FileBrowser`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/FileBrowser.tsx`:

```tsx
import { useObjects } from '../../hooks/useObjects';
import { formatBytes, formatTimestamp } from '../../lib/format';
import { Breadcrumb } from './Breadcrumb';

export function FileBrowser({
  accountId,
  bucket,
  prefix,
  selectedKey,
  onNavigate,
  onSelectFile,
}: {
  accountId: string | null;
  bucket: string | null;
  prefix: string;
  selectedKey: string | null;
  onNavigate: (prefix: string) => void;
  onSelectFile: (key: string) => void;
}) {
  const { query, folders, files } = useObjects(accountId, bucket, prefix);

  if (bucket === null) {
    return <div className="flex h-full items-center justify-center text-slate-400">Select a bucket</div>;
  }

  const isEmpty = query.isSuccess && folders.length === 0 && files.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 p-2">
        <Breadcrumb prefix={prefix} onNavigate={onNavigate} />
      </div>

      {query.isLoading && <p className="p-3 text-slate-500">Loading…</p>}
      {query.isError && <p className="p-3 text-red-600">{(query.error as Error).message}</p>}
      {isEmpty && <p className="p-3 text-slate-500">This folder is empty</p>}

      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <tbody>
            {folders.map((folder) => (
              <tr
                key={folder.prefix}
                onClick={() => onNavigate(folder.prefix)}
                className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-1.5">📁 {folder.name}</td>
                <td className="px-3 py-1.5 text-right text-slate-400">—</td>
                <td className="px-3 py-1.5 text-slate-400">—</td>
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
                <td className="px-3 py-1.5">📄 {file.name}</td>
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
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/FileBrowser.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/FileBrowser.tsx src/renderer/components/files/FileBrowser.test.tsx
git commit -m "feat(ui): add FileBrowser with folder navigation and load-more"
```

---

## Task 7: useObjectDetails hook (metadata + visibility)

**Files:**
- Create: `src/renderer/hooks/useObjectDetails.ts`
- Test: `src/renderer/hooks/useObjectDetails.test.tsx`

Two queries, enabled only when a file key is provided.

- [ ] **Step 1: Write the failing test** — `src/renderer/hooks/useObjectDetails.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useObjectDetails } from './useObjectDetails';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 10, contentType: 'image/png', lastModified: null, storageClass: 'STANDARD', etag: '"a"', metadata: { owner: 'me' } } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
  };
});

describe('useObjectDetails', () => {
  it('loads metadata and visibility for a key', async () => {
    const { result } = renderHook(() => useObjectDetails('acc-1', 'assets', 'logo.png'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.metadata.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.visibility.isSuccess).toBe(true));
    expect(result.current.metadata.data?.contentType).toBe('image/png');
    expect(result.current.visibility.data).toBe('public');
  });

  it('is idle when key is null', () => {
    const head = vi.fn();
    (window as unknown as { s3: unknown }).s3 = { headObject: head, objectVisibility: vi.fn() };
    const { result } = renderHook(() => useObjectDetails('acc-1', 'assets', null), { wrapper: wrapper() });
    expect(result.current.metadata.fetchStatus).toBe('idle');
    expect(head).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/hooks/useObjectDetails.test.tsx`
Expected: FAIL — cannot find module `./useObjectDetails`.

- [ ] **Step 3: Implement** — `src/renderer/hooks/useObjectDetails.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../lib/result';

export function useObjectDetails(accountId: string | null, bucket: string | null, key: string | null) {
  const enabled = accountId !== null && bucket !== null && key !== null;

  const metadata = useQuery({
    queryKey: ['objectMetadata', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.headObject({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  const visibility = useQuery({
    queryKey: ['objectVisibility', accountId, bucket, key],
    enabled,
    queryFn: async () => unwrap(await window.s3.objectVisibility({ accountId: accountId!, bucket: bucket!, key: key! })),
  });

  return { metadata, visibility };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/hooks/useObjectDetails.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hooks/useObjectDetails.ts src/renderer/hooks/useObjectDetails.test.tsx
git commit -m "feat(ui): add useObjectDetails (metadata + visibility) hook"
```

---

## Task 8: MetadataPanel component

**Files:**
- Create: `src/renderer/components/files/MetadataPanel.tsx`
- Test: `src/renderer/components/files/MetadataPanel.test.tsx`

A right slide-over showing the selected object's key, size, content-type, last-modified, storage class, ETag, custom metadata, and a visibility badge; with a close button.

- [ ] **Step 1: Write the failing test** — `src/renderer/components/files/MetadataPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MetadataPanel } from './MetadataPanel';

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 2048, contentType: 'image/png', lastModified: '2024-01-01T00:00:00.000Z', storageClass: 'STANDARD', etag: '"a"', metadata: { owner: 'me' } } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'public' }),
  };
});

describe('MetadataPanel', () => {
  it('renders metadata fields and the visibility badge for the selected key', async () => {
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={() => {}} />);
    expect(screen.getByText('images/logo.png')).toBeInTheDocument();
    expect(await screen.findByText('image/png')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(await screen.findByText('public')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('me')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    wrap(<MetadataPanel accountId="acc-1" bucket="assets" objectKey="images/logo.png" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: FAIL — cannot find module `./MetadataPanel`.

- [ ] **Step 3: Implement** — `src/renderer/components/files/MetadataPanel.tsx`:

```tsx
import { useObjectDetails } from '../../hooks/useObjectDetails';
import { formatBytes, formatTimestamp } from '../../lib/format';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col border-b border-slate-100 py-1.5">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <span className="break-all">{value}</span>
    </div>
  );
}

export function MetadataPanel({
  accountId,
  bucket,
  objectKey,
  onClose,
}: {
  accountId: string | null;
  bucket: string | null;
  objectKey: string;
  onClose: () => void;
}) {
  const { metadata, visibility } = useObjectDetails(accountId, bucket, objectKey);

  return (
    <div className="flex h-full w-80 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 p-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Details</span>
        <button type="button" aria-label="Close" className="rounded px-2 hover:bg-slate-100" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 text-sm">
        <Row label="Key" value={objectKey} />

        <div className="flex flex-col border-b border-slate-100 py-1.5">
          <span className="text-xs uppercase tracking-wide text-slate-400">Visibility</span>
          <span>
            {visibility.isSuccess ? (
              <span
                className={`inline-block rounded px-1.5 py-0.5 text-xs ${
                  visibility.data === 'public' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {visibility.data}
              </span>
            ) : (
              '…'
            )}
          </span>
        </div>

        {metadata.isLoading && <p className="py-2 text-slate-500">Loading…</p>}
        {metadata.isError && <p className="py-2 text-red-600">{(metadata.error as Error).message}</p>}

        {metadata.isSuccess && (
          <>
            <Row label="Size" value={formatBytes(metadata.data.size)} />
            <Row label="Content type" value={metadata.data.contentType ?? '—'} />
            <Row label="Last modified" value={formatTimestamp(metadata.data.lastModified)} />
            <Row label="Storage class" value={metadata.data.storageClass ?? '—'} />
            <Row label="ETag" value={metadata.data.etag ?? '—'} />
            {Object.entries(metadata.data.metadata).map(([k, v]) => (
              <Row key={k} label={k} value={v} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer/components/files/MetadataPanel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/files/MetadataPanel.tsx src/renderer/components/files/MetadataPanel.test.tsx
git commit -m "feat(ui): add MetadataPanel slide-over"
```

---

## Task 9: Wire buckets + browser + metadata into App

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

Lift `selectedBucket`, `prefix`, `selectedKey` into `App`; apply the reset rules; replace the Plan-2a placeholder panes with `BucketsPane` and `FileBrowser`; render `MetadataPanel` when a file is selected.

- [ ] **Step 1: Update the test** — replace `src/renderer/App.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

beforeEach(() => {
  (window as unknown as { s3: unknown }).s3 = {
    accounts: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'a', label: 'AWS prod', provider: 'amazon-s3', region: 'eu-central-1', accessKeyId: 'AK', createdAt: 1 }] }) },
    listBuckets: vi.fn().mockResolvedValue({ ok: true, data: ['assets'] }),
    listObjects: vi.fn().mockResolvedValue({ ok: true, data: { folders: [], files: [{ name: 'logo.png', key: 'logo.png', size: 5, lastModified: null, storageClass: null, etag: null }], nextToken: null } }),
    headObject: vi.fn().mockResolvedValue({ ok: true, data: { size: 5, contentType: 'image/png', lastModified: null, storageClass: null, etag: null, metadata: {} } }),
    objectVisibility: vi.fn().mockResolvedValue({ ok: true, data: 'private' }),
  };
});

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App — Files browsing', () => {
  it('drills from account to bucket to object and opens the metadata panel', async () => {
    renderApp();
    // Select account
    await userEvent.click(await screen.findByText('AWS prod'));
    // Select bucket
    await userEvent.click(await screen.findByText('assets'));
    // Select file -> metadata panel opens with the visibility badge
    await userEvent.click(await screen.findByText('logo.png'));
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(await screen.findByText('private')).toBeInTheDocument();
  });

  it('still shows Coming soon for non-Files sections', async () => {
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: FAIL — App still renders the placeholder panes; no BucketsPane/FileBrowser/MetadataPanel.

- [ ] **Step 3: Implement** — replace `src/renderer/App.tsx`:

```tsx
import { useState } from 'react';
import { SectionNav, type Section } from './components/SectionNav';
import { AccountsPane } from './components/accounts/AccountsPane';
import { BucketsPane } from './components/buckets/BucketsPane';
import { FileBrowser } from './components/files/FileBrowser';
import { MetadataPanel } from './components/files/MetadataPanel';

export function App() {
  const [section, setSection] = useState<Section>('files');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectAccount = (id: string) => {
    setAccountId(id);
    setBucket(null);
    setPrefix('');
    setSelectedKey(null);
  };
  const selectBucket = (b: string) => {
    setBucket(b);
    setPrefix('');
    setSelectedKey(null);
  };
  const navigate = (p: string) => {
    setPrefix(p);
    setSelectedKey(null);
  };

  return (
    <div className="flex h-full text-sm text-slate-800">
      <aside className="w-48 shrink-0 border-r border-slate-200 bg-slate-50 p-3">
        <h1 className="px-2 pb-3 text-base font-semibold">S3 Manager</h1>
        <SectionNav active={section} onSelect={setSection} />
      </aside>

      <main className="flex-1 overflow-hidden">
        {section === 'files' ? (
          <div className="flex h-full">
            <div className="w-60 shrink-0 border-r border-slate-200">
              <AccountsPane selectedId={accountId} onSelect={selectAccount} />
            </div>
            <div className="w-56 shrink-0 border-r border-slate-200">
              <BucketsPane accountId={accountId} selectedBucket={bucket} onSelect={selectBucket} />
            </div>
            <div className="flex-1 overflow-hidden">
              <FileBrowser
                accountId={accountId}
                bucket={bucket}
                prefix={prefix}
                selectedKey={selectedKey}
                onNavigate={navigate}
                onSelectFile={setSelectedKey}
              />
            </div>
            {selectedKey !== null && (
              <MetadataPanel
                accountId={accountId}
                bucket={bucket}
                objectKey={selectedKey}
                onClose={() => setSelectedKey(null)}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-slate-400">Coming soon</div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test + full suite + typecheck**

Run: `npx vitest run src/renderer/App.test.tsx`
Expected: PASS (2 tests).
Run: `npm test`
Expected: all tests pass.
Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat(ui): wire buckets pane, file browser, and metadata panel into Files view"
```

---

## Manual smoke checklist (after Task 9)

`npm start`, then (with a real account + bucket containing objects):
1. Select an account → buckets load in pane 2.
2. Select a bucket → objects/folders load in the browser.
3. Click a folder → navigates in; breadcrumb updates; click a breadcrumb segment → navigates back.
4. File sizes and modified dates render; folders sort above files.
5. If the bucket has >1000 objects, "Load more" appears and loads the next page.
6. Click a file → metadata panel opens with size/type/dates/storage-class/ETag/custom-metadata and a visibility badge.
7. Close the panel; switch buckets/accounts → browser + panel reset correctly.

---

## Self-Review

**Spec coverage (browsing scope of `2026-05-29-s3-manager-foundation-mvp-design.md`, Files-view section):**
- Buckets pane (list per account) → Tasks 2, 3. ✅
- File browser with prefix folders + breadcrumb navigation → Tasks 4, 5, 6. ✅
- Columns name/size/last-modified; folders sort first → Task 6. ✅
- Paginated listing (load page-by-page, not all at once) → Task 4 (`useInfiniteQuery`) + Task 6 ("Load more"). ✅
- Metadata panel (key, size, content-type, last-modified, storage class, ETag, custom metadata) → Tasks 7, 8. ✅
- Visibility indicator → shown in the metadata panel via `getObjectVisibility` (Tasks 7, 8). ✅ (see scope note below)
- Empty/loading/error states → Tasks 3, 6, 8. ✅
- Upload/download/delete/presigned-URL → **Plan 2b-2** (out of scope here). ✅ (deferred, not missing)

**Intentional scope decisions (documented, not gaps):**
- **Visibility is shown in the metadata panel on selection**, not as a per-row table column — a per-row column would require one `GetObjectAcl` per object (≤1000/page), which is prohibitively costly. Per-row/batched visibility is a possible later enhancement.
- **Bucket-level visibility badge is deferred** — Plan 1 implemented only object visibility; a bucket-visibility op (`GetBucketAcl`/`GetBucketPolicyStatus`) would be needed and is out of scope.
- Pagination is an explicit **"Load more"** button (not auto-infinite-scroll) — simpler and predictable for the MVP.

**Placeholder scan:** none — every code step is complete and runnable. The non-Files "Coming soon" is intentional (other sections are later cycles).

**Type consistency:** Hook return shapes (`useObjects` returns `{ query, folders, files }`; `useObjectDetails` returns `{ metadata, visibility }`), the lifted `App` state names (`accountId`/`bucket`/`prefix`/`selectedKey`), and the component props (`FileBrowser`'s `onNavigate`/`onSelectFile`, `MetadataPanel`'s `objectKey`/`onClose`) are defined once and used consistently. Types `FolderEntry`/`FileEntry`/`ListObjectsResult`/`ObjectMetadata`/`Visibility`/`Crumb` and the pure helpers `prefixToBreadcrumb`/`parentPrefix` come from the Plan 1 modules (single-sourced). `AccountsPane`'s existing `onSelect` is now passed `selectAccount` (which resets dependent state) — compatible signature `(id: string) => void`.
