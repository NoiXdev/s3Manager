# S3 Manager — CORS Configuration

**Date:** 2026-05-29
**Status:** Approved design
**Scope:** A single feature cycle (new backend CORS ops + a CORS editor UI), built on the completed File Manager MVP + Dashboard (all merged to `develop`).

## Overview

Let users view and edit a bucket's CORS (Cross-Origin Resource Sharing) configuration: a structured per-rule editor with a read-only JSON preview, plus Save and Clear-all. It replaces the "Coming soon" placeholder shown for the CORS section. New main-process operations wrap the S3 `GetBucketCors` / `PutBucketCors` / `DeleteBucketCors` commands; both Amazon S3 and Hetzner Object Storage support these via the S3 API.

## Goals

- View a bucket's existing CORS rules; a bucket with no CORS config opens as an empty, editable rule set (not an error).
- Edit rules with a structured form: methods, allowed origins, allowed headers, expose headers, max-age — add/remove rules and entries.
- A read-only JSON preview of the exact rule set that will be saved.
- Save the full rule set (`PutBucketCors`) or clear all rules (`DeleteBucketCors`, behind a confirm).
- Self-contained target selection: the CORS section has its own account + bucket dropdowns (seeded from the app's current selection if any).

## Non-Goals (out of scope)

- CORS preflight testing / request simulation.
- Rule presets/templates beyond a single sensible default for a newly added rule.
- Editable (two-way) JSON — the JSON view is read-only.
- Per-bucket draft persistence across navigation (edits are in-memory and reload on target change).

## Architecture

A renderer UI on top of three new main-process operations. The backend follows the existing `objects.ts` pattern but lives in a **new `src/main/s3/cors.ts`** module (CORS is bucket-level config, conceptually separate from object operations, and `objects.ts` is already large).

### Backend operations (`src/main/s3/cors.ts`)

Each takes an `S3Client` and returns a `Result` (from `../shared/result`), catching errors via the existing `toErr` helper (imported from `./objects`).

- `getBucketCors(client, bucket): Promise<Result<CorsRule[]>>` — sends `GetBucketCorsCommand`, maps the SDK rules to `CorsRule[]`. **A bucket with no CORS config makes S3 throw `NoSuchCORSConfiguration`; this specific error is caught and returned as `ok([])`** (an empty, editable rule set). Other errors → `err` via `toErr`.
- `putBucketCors(client, bucket, rules: CorsRule[]): Promise<Result<true>>` — maps `CorsRule[]` back to SDK `CORSRule[]` (omitting empty arrays / null fields the SDK doesn't expect) and sends `PutBucketCorsCommand` with `CORSConfiguration: { CORSRules }`.
- `deleteBucketCors(client, bucket): Promise<Result<true>>` — sends `DeleteBucketCorsCommand`.

### CorsRule shape (shared, normalized)

```ts
export interface CorsRule {
  id: string | null;
  allowedMethods: string[];   // subset of GET, PUT, POST, DELETE, HEAD
  allowedOrigins: string[];   // '*' allowed
  allowedHeaders: string[];   // '*' allowed
  exposeHeaders: string[];
  maxAgeSeconds: number | null;
}
```

Mapping rules:
- **Read** (SDK → `CorsRule`): `ID → id ?? null`, `AllowedMethods → allowedMethods ?? []`, `AllowedOrigins → allowedOrigins ?? []`, `AllowedHeaders → allowedHeaders ?? []`, `ExposeHeaders → exposeHeaders ?? []`, `MaxAgeSeconds → maxAgeSeconds ?? null`.
- **Write** (`CorsRule` → SDK `CORSRule`): always include `AllowedMethods` + `AllowedOrigins` (required by S3); include `AllowedHeaders` / `ExposeHeaders` only when non-empty; include `ID` only when non-null/non-empty; include `MaxAgeSeconds` only when not null.

### Wiring

- `channels.ts`: three invoke channels — `CH.getBucketCors`, `CH.putBucketCors`, `CH.deleteBucketCors` — added to `CH` and `ApiMap`:
  - `getBucketCors`: args `[{ accountId, bucket }]`, res `Result<CorsRule[]>`.
  - `putBucketCors`: args `[{ accountId, bucket, rules: CorsRule[] }]`, res `Result<true>`.
  - `deleteBucketCors`: args `[{ accountId, bucket }]`, res `Result<true>`.
  `CorsRule` is imported type-only into `channels.ts`.
- `register.ts`: three handlers via the existing `h` helper + `clientFor(accountId)`.
- `preload.ts`: three `window.s3` methods forwarding to `invoke`.

No secrets cross the boundary; CORS rule payloads contain no credentials.

## UI

A `CorsEditor` view rendered by `App` when `section === 'cors'`.

### File structure

```
src/renderer/
  hooks/useCors.ts                              # query (getBucketCors) + save/clear mutations
  components/cors/CorsEditor.tsx                # target pickers + orchestration + Save/Clear
  components/cors/CorsRuleCard.tsx              # one rule's fields (methods, lists, max-age, remove)
  components/cors/StringListEditor.tsx          # reusable add/remove list of strings
  App.tsx                                       # MODIFY: render CorsEditor for section==='cors'
```

### Layout (top to bottom)

1. **Target pickers** — an account `<select>` (from `useAccounts`) + a bucket `<select>` (from `useBuckets` for the chosen account), seeded from the app's current `accountId`/`bucket` if present. Choosing a bucket loads its CORS.
2. **Rule cards** — one `CorsRuleCard` per rule:
   - **Methods**: checkboxes GET / PUT / POST / DELETE / HEAD.
   - **Allowed origins / Allowed headers / Expose headers**: `StringListEditor` (add/remove entries; `*` allowed).
   - **Max age (seconds)**: number input (blank = none).
   - **Remove rule** button.
3. **"+ Add rule"** — appends a rule with defaults `{ allowedMethods: ['GET'], allowedOrigins: ['*'], allowedHeaders: [], exposeHeaders: [], maxAgeSeconds: null, id: null }`.
4. **JSON view** — collapsible, **read-only** preview (`JSON.stringify(rules, null, 2)`) of the rule set that will be saved.
5. **Actions** — **Save** (`putBucketCors` → success toast + refetch) and **Clear all** (`ConfirmDialog` → `deleteBucketCors` → rules reset to `[]`).

### Components

- **`StringListEditor`** — props `{ label, values: string[], onChange(values) }`. Renders the list with per-entry remove + an add input. One responsibility: edit a `string[]`.
- **`CorsRuleCard`** — props `{ rule: CorsRule, onChange(rule), onRemove() }`. Renders one rule's controls; emits the updated `CorsRule` on any change. Pure/controlled.
- **`useCors(accountId, bucket)`** — `getBucketCors` query (enabled when both set) + `save(rules)` and `clear()` mutations (calling `putBucketCors`/`deleteBucketCors`, then invalidating the cors query). One responsibility: CORS data access for a target.
- **`CorsEditor`** — owns the target selection (account/bucket dropdowns), the working rule set (local `useState`, seeded from the loaded query data), add/remove/update of rules, the JSON preview, and Save/Clear (via `useCors` + toasts + confirm).

### Working-state model

`CorsEditor` keeps the editable rule set in local state, initialized from `useCors`'s query data when it loads (and re-initialized when the target bucket changes). Save persists the working set; Clear-all empties it and calls `deleteBucketCors`. No draft persistence across target changes (reloads from server).

## Data flow

1. CORS section → `App` renders `<CorsEditor>` (seeded with current `accountId`/`bucket`).
2. User picks account + bucket → `useCors` runs `getBucketCors` → working rule set initialized.
3. User edits rules (cards + string lists) → local working state updates; JSON preview reflects it.
4. **Save** → `useCors.save(workingRules)` → `putBucketCors` → toast + refetch.
5. **Clear all** → confirm → `useCors.clear()` → `deleteBucketCors` → working set reset to `[]`.

## States & error handling

- **No account or bucket selected** → prompt to choose a target; dropdowns always visible.
- **Loading** → "Loading CORS…" while the query resolves.
- **No CORS configured** → empty rule list + "+ Add rule" (from `getBucketCors` returning `[]`).
- **Query error** (non-`NoSuchCORSConfiguration`, e.g. `AccessDenied`) → inline error message.
- **Save/clear error** (e.g. `AccessDenied`, or `NotImplemented` from a provider) → error toast with code+message; working edits are preserved so nothing is lost.

## Testing

Vitest + React Testing Library against a mocked `window.s3` (renderer) and `aws-sdk-client-mock` (backend ops), consistent with the existing codebase.

- **`cors.ts`** — `getBucketCors` maps SDK rules → `CorsRule[]`; `NoSuchCORSConfiguration` → `ok([])`; other errors → `err`. `putBucketCors` sends mapped `CORSRules` (empty arrays / null fields omitted; required `AllowedMethods`/`AllowedOrigins` present). `deleteBucketCors` sends the delete command.
- **IPC register** — the three CORS channels are registered and invoke the ops with `clientFor(accountId)`.
- **`StringListEditor`** — adds an entry; removes an entry; emits the new array.
- **`CorsRuleCard`** — toggling a method, editing a list, and changing max-age each emit the updated `CorsRule`.
- **`useCors`** — query loads rules; `save`/`clear` mutations call the right `window.s3` method and invalidate the cors query.
- **`CorsEditor`** — selecting account+bucket loads rules; adding/editing a rule then Save calls `putBucketCors` with the working rule set; Clear-all → confirm → `deleteBucketCors`; the read-only JSON preview reflects edits; no-bucket prompt + no-CORS empty state.
- **`App`** — the CORS section renders `CorsEditor` (no longer "Coming soon").

## Dependencies

None new. Uses the installed `@aws-sdk/client-s3` CORS commands (`GetBucketCorsCommand` / `PutBucketCorsCommand` / `DeleteBucketCorsCommand` — all confirmed present), the existing `useAccounts` / `useBuckets` hooks, `ToastProvider`, and `ConfirmDialog`.
