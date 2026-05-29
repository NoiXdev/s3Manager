export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function err(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export function isOk<T>(r: Result<T>): r is { ok: true; data: T } {
  return r.ok;
}
