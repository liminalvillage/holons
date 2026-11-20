/**
 * Shared holon types, kept apart from index.ts so requests.ts can use them
 * without importing the barrel that imports requests.ts (an import cycle).
 */

/** A member's request to join, as read from a kind-9021 event. */
export interface JoinRequest {
  pubkey: string;
  /** Unix seconds. */
  at: number;
  /** What they wrote — by convention their display name. */
  reason: string;
  eventId: string;
  /** The holon asked (the `h` tag). */
  holon: string;
  /** The Telegram user the request CLAIMS to be (its `i` tag) — unproven, see `describeApplicant`. */
  telegramId?: string;
  /** The DNA hash the person signed their agreement to (its `dna` tag, 64 hex), when any. */
  dna?: string;
}
