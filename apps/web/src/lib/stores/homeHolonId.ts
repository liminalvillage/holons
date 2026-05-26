import { derived, writable, type Readable, type Writable } from "svelte/store";
import { nostrPublicKey } from "./nostr";

/**
 * The currently authenticated user's "own" holon id — independent of which
 * holon they happen to be viewing in the URL.
 *
 * Plain Nostr sessions populate this transparently via the derived store
 * below (it reads `$nostrPublicKey`). Telegram-mapped sessions use a shared
 * service key, so `$nostrPublicKey` is null — for those, `+layout.svelte`
 * writes the resolved Telegram user id (or the mapped pubkey) into
 * `homeHolonIdOverride` after authentication.
 *
 * Sidebar consumers (federation source, pinned home row) should read
 * `homeHolonId` rather than `$nostrPublicKey` or the URL-driven `$ID`,
 * so navigating to a federated peer doesn't change the user's identity.
 */
export const homeHolonIdOverride: Writable<string | null> = writable(null);

export const homeHolonId: Readable<string | null> = derived(
  [homeHolonIdOverride, nostrPublicKey],
  ([override, pubKey]) => override || pubKey || null,
);
