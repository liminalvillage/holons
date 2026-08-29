import { derived, writable, type Readable, type Writable } from "svelte/store";
import { nostrPublicKey } from "./nostr";

/**
 * The currently authenticated user's "own" holon id — independent of which
 * holon they happen to be viewing in the URL.
 *
 * Key-based sessions (passkey / Nostr key / Ethereum wallet) populate this
 * transparently via the derived store below: their holon id is the signing
 * pubkey (`$nostrPublicKey`). Telegram sessions sign with a per-user derived
 * key but are namespaced by the Telegram user id, so `+layout.svelte` writes
 * that id into `homeHolonIdOverride` after authentication and it wins.
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
