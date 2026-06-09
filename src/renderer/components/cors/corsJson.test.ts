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

  it('reports the offending rule and field in the error message', () => {
    const result = parseCorsJson(JSON.stringify([{ AllowedOrigins: ['*'] }]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Rule 1/);
      expect(result.error).toMatch(/AllowedMethods/);
    }
  });

  it('rejects a rule whose MaxAgeSeconds is not a number', () => {
    const result = parseCorsJson(
      JSON.stringify([
        { AllowedMethods: ['GET'], AllowedOrigins: ['*'], MaxAgeSeconds: 'soon' },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a rule whose ID is not a string', () => {
    const result = parseCorsJson(
      JSON.stringify([{ AllowedMethods: ['GET'], AllowedOrigins: ['*'], ID: 5 }]),
    );
    expect(result.ok).toBe(false);
  });

  it('round-trips an empty array', () => {
    const result = parseCorsJson(rulesToJson([]));
    expect(result).toEqual({ ok: true, rules: [] });
  });

  it('preserves MaxAgeSeconds: 0 through a round-trip', () => {
    const rule: CorsRule = { ...minimal, maxAgeSeconds: 0 };
    const result = parseCorsJson(rulesToJson([rule]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rules[0].maxAgeSeconds).toBe(0);
    }
  });
});
