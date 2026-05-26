const DAY_MS = 24 * 60 * 60 * 1000;

export function formatRelativeExpiry(
  expiresAtMs: number,
  nowMs: number,
): string {
  const deltaMs = expiresAtMs - nowMs;

  if (deltaMs >= DAY_MS) {
    const days = Math.floor(deltaMs / DAY_MS);
    return `expires in ${days}d`;
  }
  if (deltaMs >= 0) {
    return "expires today";
  }
  const pastMs = -deltaMs;
  if (pastMs < DAY_MS) {
    return "expired today";
  }
  const daysAgo = Math.floor(pastMs / DAY_MS);
  return `expired ${daysAgo}d ago`;
}
