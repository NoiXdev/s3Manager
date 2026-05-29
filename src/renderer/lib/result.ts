export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Unwrap a Result for use with TanStack Query: returns data or throws so the
 *  query/mutation enters its error state with a readable message. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(`${result.error.code}: ${result.error.message}`);
}
