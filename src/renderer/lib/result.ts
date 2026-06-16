export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/** Unwrap a Result for use with TanStack Query: returns data or throws so the
 *  query/mutation enters its error state with a readable message. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(`${result.error.code}: ${result.error.message}`);
}

/** Strip the leading "Code: " that {@link unwrap} prepends, leaving the human
 *  message — for inline error display. Returns the input unchanged if it has no
 *  prefix, and preserves any colons within the message body. */
export function humanErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes(': ') ? msg.split(': ').slice(1).join(': ') : msg;
}
