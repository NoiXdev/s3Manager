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
