function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** The final path segment of a key or folder prefix (no trailing slash). */
export function baseName(keyOrPrefix: string): string {
  const trimmed = trimTrailingSlash(keyOrPrefix);
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** The prefix up to and including the slash before the final segment ('' at top level). */
export function parentPrefix(keyOrPrefix: string): string {
  const trimmed = trimTrailingSlash(keyOrPrefix);
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? '' : trimmed.slice(0, i + 1);
}
