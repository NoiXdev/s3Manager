# CORS JSON Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users switch the CORS editor between the form GUI and an editable AWS-standard JSON view so CORS configs can be copy-pasted between buckets and to/from the AWS console.

**Architecture:** A new pure module `corsJson.ts` converts between the internal `CorsRule[]` shape and AWS-standard (PascalCase) JSON, with parse-time validation. `CorsEditor` keeps `CorsRule[]` as canonical state and adds a Form/JSON mode toggle; JSON mode is a view that re-parses on edit and disables Save + the Form switch while the JSON is invalid.

**Tech Stack:** TypeScript, React, Vitest, @testing-library/react, Tailwind.

---

## File Structure

- Create: `src/renderer/components/cors/corsJson.ts` — pure conversion + validation between `CorsRule[]` and AWS-standard JSON.
- Create: `src/renderer/components/cors/corsJson.test.ts` — unit tests for the module.
- Modify: `src/renderer/components/cors/CorsEditor.tsx` — replace the read-only "Show JSON" toggle with a Form/JSON mode switch backed by `corsJson.ts`.
- Modify: `src/renderer/components/cors/CorsEditor.test.tsx` — update the obsolete "Show JSON" test and add mode-switch / invalid-JSON tests.

The `CorsRule` interface already exists in `src/main/s3/cors.ts` and is imported by renderer components — reuse it, do not redefine it.

---

## Task 1: Conversion module `corsJson.ts`

**Files:**
- Create: `src/renderer/components/cors/corsJson.ts`
- Test: `src/renderer/components/cors/corsJson.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/renderer/components/cors/corsJson.test.ts
import { describe, it, expect } from 'vitest';
import { rulesToJson, parseCorsJson } from './corsJson';
import type { CorsRule } from '../../../main/s3/cors';

const full: CorsRule = {
  id: 'rule-1',
  allowedMethods: ['GET', 'PUT'],
  allowedOrigins: ['https://example.com'],
  allowedHeaders: ['*'],
  exposeHeaders: ['ETag'],
  maxAgeSeconds: 3000,
};

const minimal: CorsRule = {
  id: null,
  allowedMethods: ['GET'],
  allowedOrigins: ['*'],
  allowedHeaders: [],
  exposeHeaders: [],
  maxAgeSeconds: null,
};

describe('rulesToJson', () => {
  it('emits AWS-standard PascalCase keys', () => {
    const obj = JSON.parse(rulesToJson([full]));
    expect(obj).toEqual([
      {
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'PUT'],
        AllowedOrigins: ['https://example.com'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3000,
        ID: 'rule-1',
      },
    ]);
  });

  it('omits empty/null optional fields', () => {
    const obj = JSON.parse(rulesToJson([minimal]));
    expect(obj).toEqual([{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }]);
  });

  it('pretty-prints with 2-space indent', () => {
    expect(rulesToJson([minimal])).toContain('\n  ');
  });
});

describe('parseCorsJson', () => {
  it('round-trips through rulesToJson', () => {
    const result = parseCorsJson(rulesToJson([full, minimal]));
    expect(result).toEqual({ ok: true, rules: [full, minimal] });
  });

  it('parses AWS-console-format input, defaulting missing optionals', () => {
    const result = parseCorsJson(
      JSON.stringify([{ AllowedMethods: ['GET'], AllowedOrigins: ['*'] }]),
    );
    expect(result).toEqual({ ok: true, rules: [minimal] });
  });

  it('rejects non-JSON text', () => {
    const result = parseCorsJson('not json');
    expect(result.ok).toBe(false);
  });

  it('rejects a top-level object (must be an array)', () => {
    const result = parseCorsJson('{"AllowedMethods":["GET"]}');
    expect(result.ok).toBe(false);
  });

  it('rejects a rule missing AllowedMethods', () => {
    const result = parseCorsJson(JSON.stringify([{ AllowedOrigins: ['*'] }]));
    expect(result.ok).toBe(false);
  });

  it('rejects a rule whose AllowedOrigins is not a string array', () => {
    const result = parseCorsJson(
      JSON.stringify([{ AllowedMethods: ['GET'], AllowedOrigins: [1, 2] }]),
    );
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/components/cors/corsJson.test.ts`
Expected: FAIL — `Failed to resolve import './corsJson'` / functions not defined.

- [ ] **Step 3: Write the implementation**

```ts
// src/renderer/components/cors/corsJson.ts
import type { CorsRule } from '../../../main/s3/cors';

interface AwsCorsRule {
  AllowedMethods: string[];
  AllowedOrigins: string[];
  AllowedHeaders?: string[];
  ExposeHeaders?: string[];
  MaxAgeSeconds?: number;
  ID?: string;
}

export function rulesToJson(rules: CorsRule[]): string {
  const out: AwsCorsRule[] = rules.map((r) => {
    const rule: AwsCorsRule = {
      AllowedMethods: r.allowedMethods,
      AllowedOrigins: r.allowedOrigins,
    };
    if (r.allowedHeaders.length) rule.AllowedHeaders = r.allowedHeaders;
    if (r.exposeHeaders.length) rule.ExposeHeaders = r.exposeHeaders;
    if (r.maxAgeSeconds !== null) rule.MaxAgeSeconds = r.maxAgeSeconds;
    if (r.id) rule.ID = r.id;
    return rule;
  });
  return JSON.stringify(out, null, 2);
}

type ParseResult =
  | { ok: true; rules: CorsRule[] }
  | { ok: false; error: string };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function parseCorsJson(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: 'CORS config must be a JSON array of rules.' };
  }

  const rules: CorsRule[] = [];
  for (let i = 0; i < data.length; i++) {
    const raw = data[i] as Record<string, unknown>;
    const label = `Rule ${i + 1}`;
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, error: `${label}: each rule must be an object.` };
    }
    if (!isStringArray(raw.AllowedMethods)) {
      return { ok: false, error: `${label}: AllowedMethods must be an array of strings.` };
    }
    if (!isStringArray(raw.AllowedOrigins)) {
      return { ok: false, error: `${label}: AllowedOrigins must be an array of strings.` };
    }
    if (raw.AllowedHeaders !== undefined && !isStringArray(raw.AllowedHeaders)) {
      return { ok: false, error: `${label}: AllowedHeaders must be an array of strings.` };
    }
    if (raw.ExposeHeaders !== undefined && !isStringArray(raw.ExposeHeaders)) {
      return { ok: false, error: `${label}: ExposeHeaders must be an array of strings.` };
    }
    if (raw.MaxAgeSeconds !== undefined && typeof raw.MaxAgeSeconds !== 'number') {
      return { ok: false, error: `${label}: MaxAgeSeconds must be a number.` };
    }
    if (raw.ID !== undefined && typeof raw.ID !== 'string') {
      return { ok: false, error: `${label}: ID must be a string.` };
    }
    rules.push({
      id: (raw.ID as string | undefined) ?? null,
      allowedMethods: raw.AllowedMethods,
      allowedOrigins: raw.AllowedOrigins,
      allowedHeaders: (raw.AllowedHeaders as string[] | undefined) ?? [],
      exposeHeaders: (raw.ExposeHeaders as string[] | undefined) ?? [],
      maxAgeSeconds: (raw.MaxAgeSeconds as number | undefined) ?? null,
    });
  }
  return { ok: true, rules };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/components/cors/corsJson.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/cors/corsJson.ts src/renderer/components/cors/corsJson.test.ts
git commit -m "feat(cors): add AWS-standard JSON conversion module"
```

---

## Task 2: Form/JSON mode switch in `CorsEditor`

**Files:**
- Modify: `src/renderer/components/cors/CorsEditor.tsx`
- Test: `src/renderer/components/cors/CorsEditor.test.tsx`

### Step group A — update tests first

- [ ] **Step 1: Replace the obsolete "Show JSON" test and add new tests**

In `src/renderer/components/cors/CorsEditor.test.tsx`, delete the existing test
named `'JSON preview reflects edits (working set, not just server data)'`
(it relies on the removed `Show JSON` button and `cors-json` testid). Add these
tests inside the `describe('CorsEditor', ...)` block:

```ts
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: The 4 new tests FAIL (no `JSON` button / `CORS JSON` textbox yet); the
remaining original tests PASS.

### Step group B — implement

- [ ] **Step 3: Rewrite `CorsEditor.tsx` with the mode switch**

Replace the entire contents of `src/renderer/components/cors/CorsEditor.tsx`
with:

```tsx
import { useEffect, useState } from 'react';
import { useCors } from '../../hooks/useCors';
import { useToast } from '../ui/ToastProvider';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CorsRuleCard } from './CorsRuleCard';
import { rulesToJson, parseCorsJson } from './corsJson';
import type { CorsRule } from '../../../main/s3/cors';

const NEW_RULE: CorsRule = {
  id: null,
  allowedMethods: ['GET'],
  allowedOrigins: ['*'],
  allowedHeaders: [],
  exposeHeaders: [],
  maxAgeSeconds: null,
};

type Mode = 'form' | 'json';

export function CorsEditor({
  accountId,
  bucket,
}: {
  accountId: string | null;
  bucket: string | null;
}) {
  const cors = useCors(accountId, bucket);
  const { show } = useToast();

  const [rules, setRules] = useState<CorsRule[]>([]);
  const [mode, setMode] = useState<Mode>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Reset the working set whenever the selection changes; the data effect below
  // repopulates it once the new bucket's rules load.
  useEffect(() => {
    setRules([]);
    setMode('form');
  }, [accountId, bucket]);

  useEffect(() => {
    if (cors.query.data) setRules(cors.query.data);
  }, [cors.query.data]);

  const enterJsonMode = () => {
    setJsonText(rulesToJson(rules));
    setJsonError(null);
    setMode('json');
  };

  const onJsonChange = (text: string) => {
    setJsonText(text);
    const result = parseCorsJson(text);
    if (result.ok) {
      setRules(result.rules);
      setJsonError(null);
    } else {
      setJsonError(result.error);
    }
  };

  const jsonInvalid = mode === 'json' && jsonError !== null;

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="pb-3 text-lg font-semibold">CORS configuration</h2>

      {bucket === null && <p className="mt-4 text-slate-500">Select a bucket to edit its CORS rules.</p>}

      {bucket !== null && cors.query.isLoading && <p className="mt-4 text-slate-500">Loading CORS…</p>}
      {bucket !== null && cors.query.isError && <p className="mt-4 text-red-600">{(cors.query.error as Error).message}</p>}

      {bucket !== null && cors.query.isSuccess && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="inline-flex w-fit rounded border border-slate-300 text-sm">
            <button
              type="button"
              className={`rounded-l px-3 py-1 ${mode === 'form' ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'}`}
              disabled={jsonInvalid}
              onClick={() => setMode('form')}
            >
              Form
            </button>
            <button
              type="button"
              className={`rounded-r px-3 py-1 ${mode === 'json' ? 'bg-slate-800 text-white' : 'hover:bg-slate-50'}`}
              onClick={enterJsonMode}
            >
              JSON
            </button>
          </div>

          {mode === 'form' && (
            <>
              {rules.map((rule, i) => (
                <CorsRuleCard
                  key={i}
                  rule={rule}
                  onChange={(updated) => setRules(rules.map((r, j) => (j === i ? updated : r)))}
                  onRemove={() => setRules(rules.filter((_, j) => j !== i))}
                />
              ))}
              <button
                type="button"
                className="w-fit rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
                onClick={() => setRules([...rules, { ...NEW_RULE }])}
              >
                + Add rule
              </button>
            </>
          )}

          {mode === 'json' && (
            <div className="flex flex-col gap-1">
              <textarea
                aria-label="CORS JSON"
                className="h-72 w-full rounded border border-slate-300 bg-slate-900 p-3 font-mono text-xs text-slate-100"
                spellCheck={false}
                value={jsonText}
                onChange={(e) => onJsonChange(e.target.value)}
              />
              {jsonError && <p className="text-sm text-red-600">{jsonError}</p>}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
              disabled={jsonInvalid}
              onClick={async () => {
                try {
                  await cors.save.mutateAsync(rules);
                  show('CORS saved');
                } catch (e) {
                  show((e as Error).message, 'error');
                }
              }}
            >
              Save
            </button>
            <button type="button" className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50" onClick={() => setConfirmClear(true)}>
              Clear all
            </button>
          </div>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          message="Remove all CORS rules from this bucket?"
          confirmLabel="Clear all rules"
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            try {
              await cors.clear.mutateAsync();
              setRules([]);
              setMode('form');
              show('CORS cleared');
            } catch (e) {
              show((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}
```

Note: the `Form` button is disabled when `jsonInvalid`; the `JSON` button stays
enabled so the user can always re-enter JSON mode. `disabled` on the `Form`
button makes `toBeDisabled()` pass; the active-mode highlight uses `bg-slate-800`.

- [ ] **Step 4: Run the CORS editor tests**

Run: `npx vitest run src/renderer/components/cors/CorsEditor.test.tsx`
Expected: PASS (all original + 4 new tests).

- [ ] **Step 5: Run the full cors test folder + lint**

Run: `npx vitest run src/renderer/components/cors && npm run lint`
Expected: All tests PASS; lint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/cors/CorsEditor.tsx src/renderer/components/cors/CorsEditor.test.tsx
git commit -m "feat(cors): switch between form and editable JSON editor"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests PASS.

- [ ] **Step 2: Manual smoke check**

Run: `npm start`
Then: select an account + bucket → open CORS → click `JSON` → confirm AWS-format
JSON appears → paste a rule from another bucket → switch to `Form` → confirm the
rules updated → `Save` → confirm "CORS saved" toast. Type garbage into JSON and
confirm Save + Form switch disable with an inline error.

- [ ] **Step 3: Commit any fixups** (only if Step 1/2 surfaced issues)

```bash
git add -A
git commit -m "fix(cors): address verification findings"
```

---

## Notes for the implementer

- `CorsRule` lives in `src/main/s3/cors.ts`; import it, never redefine it.
- The main-process `toSdkRule` (`src/main/s3/cors.ts:14`) and the IPC contract are
  unchanged — this feature is renderer-only.
- After changing only renderer code, Vite HMR is sufficient; no main-process
  restart is needed (that rule only applies to IPC-handler changes).
