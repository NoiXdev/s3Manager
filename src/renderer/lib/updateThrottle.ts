export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldAutoCheck({
  autoCheckUpdates,
  lastUpdateCheckAt,
  now,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
}: {
  autoCheckUpdates: boolean;
  lastUpdateCheckAt: number | null;
  now: number;
  intervalMs?: number;
}): boolean {
  if (!autoCheckUpdates) return false;
  if (lastUpdateCheckAt === null) return true;
  return now - lastUpdateCheckAt >= intervalMs;
}
