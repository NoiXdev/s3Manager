# S3 Manager — Dashboard

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle, built on the completed File Manager MVP (Plans 1, 2a, 2b-1, 2b-2a, 2b-2b — all merged to `develop`).

## Overview

A global, **scan-free** dashboard that gives a bird's-eye overview of every configured account: summary totals (accounts, buckets, provider split) plus a per-account bucket breakdown. It doubles as a launchpad — clicking an account or bucket jumps into the Files view at that location. It replaces the current "Coming soon" placeholder shown for the Dashboard section.

## Goals

- A global overview across **all** configured accounts (not just the selected one).
- **No object scanning** — all data comes from cheap, existing renderer APIs (`accounts.list`, `listBuckets`). Always fast regardless of bucket size.
- **Click-through navigation:** clicking a bucket opens it in the Files view; clicking an account opens its bucket list in the Files view.
- Resilient: one account failing to load its buckets must not break the rest of the board.

## Non-Goals (explicitly out of scope)

- Object counts, total storage size, or any per-bucket object scanning.
- CloudWatch / provider-specific metrics APIs.
- Charts, graphs, time-series, or activity/history.
- Editing anything from the dashboard (it is read-only except for navigation).

## Why no storage totals

S3 (and Hetzner's S3-compatible API) has no cheap "bucket size / object count" call. The only ways to get totals are (a) a full paginated `ListObjectsV2` scan of every object — slow and costly for large buckets, and (b) AWS CloudWatch — AWS-only, so unusable for Hetzner. The dashboard therefore shows only structural facts that are free to compute. (On-demand per-bucket analysis could be a future enhancement, but is out of scope here.)

## Architecture

The dashboard is a renderer-only feature. **No main-process or preload changes.** It is rendered by `App` when `section === 'dashboard'`.

Data sources (all existing):
- `useAccounts()` — the account list, including each account's `provider` (`amazon-s3` | `hetzner`).
- A new `useAllBuckets(accounts)` hook built on TanStack Query's `useQueries`, running one `listBuckets(account.id)` per account. Each sub-query reuses the **existing** `bucketsKey(accountId)` and the same `unwrap(window.s3.listBuckets(...))` query function, so the dashboard shares its cache with the Files view's `BucketsPane` (loading buckets in one warms the other).

All aggregates are **derived in the renderer** from `accounts` + the per-account bucket results:
- Total accounts (= `accounts.length`).
- Total buckets (= sum of successfully-loaded per-account bucket counts).
- Provider breakdown: counts of accounts by provider, and buckets by provider.
- Per account: bucket count + the bucket names.

### Data-fetching approach (chosen)

`useQueries` fan-out (one buckets query per account), reusing the existing key/fn. Rationale vs. alternatives:
- A single new "all buckets" IPC would add backend surface + tests and wouldn't share the `BucketsPane` cache.
- A single `useQuery` looping all accounts would lose per-account caching and let one account's failure fail the whole board.
The fan-out gives cache reuse, per-account error isolation, and zero backend work.

## File structure

```
src/renderer/
  hooks/useAllBuckets.ts                       # useQueries fan-out -> per-account buckets
  components/dashboard/Dashboard.tsx           # section view: fetch + aggregate + render
  components/dashboard/SummaryCards.tsx        # presentational: totals + provider split
  components/dashboard/AccountBreakdown.tsx    # presentational: per-account rows + bucket chips
  App.tsx                                      # MODIFY: render Dashboard for section==='dashboard'; openInFiles handler
```

`useBuckets.ts` already exports `bucketsKey(accountId)` and the buckets query function shape; `useAllBuckets` reuses that key and the same `unwrap(await window.s3.listBuckets(id))` query function.

### Component responsibilities

- **`useAllBuckets(accounts)`** — returns, per account, `{ accountId, buckets: string[], isLoading, isError }` (derived from `useQueries`). One responsibility: fan out bucket queries and expose per-account status. Depends on `window.s3.listBuckets` (via the shared query fn) + `bucketsKey`.
- **`SummaryCards`** — pure presentational. Props: `{ accountCount, bucketCount, providerCounts }`. Renders the stat cards. No data fetching.
- **`AccountBreakdown`** — pure presentational. Props: the accounts plus their per-account bucket results and the click handlers (`onOpenAccount`, `onOpenBucket`). Renders one row per account (label + provider badge + bucket count) with clickable bucket chips; shows per-account loading/error inline.
- **`Dashboard`** — composes the above: calls `useAccounts` + `useAllBuckets`, computes the aggregates, handles the no-accounts empty state, and wires the click handlers through to its `onOpenAccount`/`onOpenBucket` props.

## Click-through (navigation)

`Dashboard` receives two callbacks from `App`:
- `onOpenBucket(accountId, bucket)` → `App` sets `accountId` + `bucket`, clears `prefix` + `selectedKey`, and sets `section = 'files'`.
- `onOpenAccount(accountId)` → `App` sets `accountId`, clears `bucket` + `prefix` + `selectedKey`, and sets `section = 'files'`.

`App` already owns `section`, `accountId`, `bucket`, `prefix`, `selectedKey` state and the reset helpers (`selectAccount`, `selectBucket`). This adds one small `openInFiles(accountId, bucket?)` helper that sets the relevant state and switches the section.

## Data flow

1. User selects the Dashboard section → `App` renders `<Dashboard onOpenAccount onOpenBucket />`.
2. `Dashboard` calls `useAccounts()` and `useAllBuckets(accounts)`.
3. `useAllBuckets` issues one cached `listBuckets` query per account (progressively resolving).
4. `Dashboard` derives totals + provider split and passes them to `SummaryCards`, and passes accounts + per-account results + handlers to `AccountBreakdown`.
5. Clicking a bucket chip → `onOpenBucket(accountId, bucket)` → `App` updates selection + switches to Files → the Files three-pane shows that bucket.

## States & error handling

- **No accounts** → an onboarding card ("No accounts yet — add one in the Files view"), not empty stat cards.
- **Loading** → summary totals render as bucket queries resolve; each account row shows "loading buckets…" until its query settles. Because each account is its own query, the board fills in progressively.
- **Per-account error** → if one account's `listBuckets` fails (invalid credentials, network), that account's row shows an inline "couldn't load buckets" message while the rest of the board and the totals still render. Totals count only successfully-loaded accounts. (This isolation is the reason for the `useQueries` fan-out.)
- No global failure state: the dashboard always renders what it can.

## Testing

Component tests with Vitest + React Testing Library against a mocked `window.s3`, consistent with the rest of the renderer. RTL cleanup is already configured.

- **`useAllBuckets`** — fans out one query per account; returns each account's buckets; one account's `listBuckets` rejecting (or returning an error `Result`) leaves the others successful (mock resolves for account A, rejects for account B → A has buckets, B `isError`).
- **`SummaryCards`** — renders the account total, bucket total, and provider split from props.
- **`AccountBreakdown`** — renders one row per account with bucket chips; clicking a bucket chip calls `onOpenBucket(accountId, bucket)`; clicking an account calls `onOpenAccount(accountId)`; shows inline per-account loading/error.
- **`Dashboard`** — no-accounts empty state; renders cards + breakdown from mocked data; click handlers propagate.
- **`App`** — selecting the Dashboard section renders the dashboard; clicking a bucket there navigates to the Files view with that account + bucket selected (integration test against mocked `window.s3`).

## Dependencies

None new — uses the existing React, TanStack Query (`useQueries`), Tailwind, and the existing `window.s3.listBuckets` / `accounts.list` surface. `ProviderBadge` (from the accounts components) is reused for provider labels.
