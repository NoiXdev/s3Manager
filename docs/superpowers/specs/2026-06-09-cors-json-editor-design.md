# CORS JSON editor — design

Date: 2026-06-09

## Problem

The CORS editor (`src/renderer/components/cors/CorsEditor.tsx`) only offers a
form-based GUI plus a **read-only** "Show JSON" view. There is no way to paste a
CORS configuration in, so copying CORS from one bucket to another — or pasting a
config from the AWS console — requires manually re-entering every rule.

## Goal

Let the user switch between the existing form editor and an **editable JSON
editor**, so CORS can be copy-pasted between buckets and to/from the AWS console.

## UI

Replace the current read-only "Show JSON" / "Hide JSON" toggle with a two-mode
segmented control at the top of the editor:

- **Form** — the existing `CorsRuleCard` list (unchanged).
- **JSON** — a single editable `<textarea>` containing the rules as JSON.

The two modes are mutually exclusive. "Add rule" belongs to Form mode; Save and
Clear all remain visible in both modes.

## JSON format

The JSON editor uses the **AWS-standard (PascalCase)** shape — identical to what
the AWS console and CLI show — so configs are interoperable:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://example.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000,
    "ID": "rule-1"
  }
]
```

This differs from the internal `CorsRule` shape (camelCase) used by the form and
the old read-only view. The new view is AWS-standard.

## Canonical state

`CorsEditor` keeps `CorsRule[]` (internal camelCase shape) as its single source
of truth, exactly as today. JSON mode is a *view*:

- **Entering JSON mode**: serialize current `rules` → AWS-standard JSON text,
  seed the textarea.
- **Editing the textarea**: re-parse on every change. On a successful parse, the
  parsed rules become the canonical `rules` state. On failure, canonical state is
  left untouched and an inline error is shown.

## Conversion module

A new well-bounded, unit-testable module `src/renderer/components/cors/corsJson.ts`
owns both directions of conversion. It is the only place that knows the
AWS-standard shape on the renderer side.

```ts
// CorsRule is imported from ../../../main/s3/cors
export function rulesToJson(rules: CorsRule[]): string;
export function parseCorsJson(
  text: string,
): { ok: true; rules: CorsRule[] } | { ok: false; error: string };
```

`rulesToJson` emits pretty-printed (2-space) AWS-standard JSON. Optional fields
are omitted when empty/null (no empty `AllowedHeaders`, no `MaxAgeSeconds: null`,
no `ID` when absent) to keep output clean and console-like.

`parseCorsJson` validates:

1. Text parses as JSON.
2. Top level is an array.
3. Each entry has `AllowedMethods` and `AllowedOrigins` as arrays of strings.
4. Optional fields (`AllowedHeaders`, `ExposeHeaders`, `MaxAgeSeconds`, `ID`) are
   tolerated when present and well-typed; missing → internal defaults
   (`[]` / `null`).

On any failure it returns `{ ok: false, error }` with a human-readable message.

## Validation & guardrails

When the textarea content does not parse into valid CORS rules:

- An inline error message is shown beneath the textarea.
- **Save is disabled.**
- **Switching back to Form mode is disabled.**

Both re-enable as soon as the JSON parses cleanly. Because a clean parse updates
the canonical `rules`, switching to Form or saving then operates on the
up-to-date rules with no extra conversion step.

## Save / Clear

Unchanged. Both operate on the canonical `CorsRule[]` through the existing
`useCors` hook and IPC handlers (`putBucketCors` / `deleteBucketCors`). The
main-process `toSdkRule` mapping is untouched.

## Testing

- **`corsJson.test.ts`** (new): round-trip `rulesToJson` → `parseCorsJson`;
  parsing AWS-console-format input; omission of empty optional fields; malformed
  input (not JSON, not an array, missing required fields, wrong types) returns
  `{ ok: false }`.
- **`CorsEditor.test.tsx`** (update): switching Form ↔ JSON; editing JSON updates
  what the form shows; invalid JSON disables Save and the Form switch and shows
  the error; valid JSON re-enables them.

## Out of scope

- No change to the main-process CORS code or IPC contract.
- No JSON syntax highlighting / code-editor component — a plain `<textarea>`.
- No migration of the camelCase read-only view format anywhere else.
