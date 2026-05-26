import { describe, it, expect } from "vitest";
import { formatRelativeExpiry } from "./relativeTime";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const now = new Date("2026-04-22T12:00:00Z").getTime();

describe("formatRelativeExpiry", () => {
  it('returns "expired" for a past timestamp older than one day', () => {
    expect(formatRelativeExpiry(now - 3 * DAY_MS, now)).toBe("expired 3d ago");
  });

  it('returns "expired today" for a past timestamp within the last day', () => {
    expect(formatRelativeExpiry(now - 2 * HOUR_MS, now)).toBe("expired today");
  });

  it('returns "expires today" when the timestamp is within the next 24h', () => {
    expect(formatRelativeExpiry(now + 3 * HOUR_MS, now)).toBe("expires today");
  });

  it('returns "expires in Nd" for future timestamps', () => {
    expect(formatRelativeExpiry(now + 3 * DAY_MS, now)).toBe("expires in 3d");
    expect(formatRelativeExpiry(now + 1 * DAY_MS + 5 * MIN_MS, now)).toBe(
      "expires in 1d",
    );
  });

  it('returns "expires in 1d" for anything between 24h and 48h (rounds down)', () => {
    expect(formatRelativeExpiry(now + 47 * HOUR_MS, now)).toBe("expires in 1d");
  });
});
