// Merges the logged-in user (Telegram first, Nostr as fallback) into a
// holon's user store, and wraps QueryManager so every subscriber to the
// `users` lens gets this for free.
//
// Why this exists: the holon's `users` lens only contains people who have
// touched data in that holon. The current viewer might not yet have a record
// there — but we still want them to appear in pickers, badge lists, etc.
//
// Used everywhere we render or pick from a holon's user list. Consolidates
// what used to be a per-component `ensureCurrentUserInStore` copy in
// TaskModal and Offers.

import { get } from "svelte/store";
import { telegramStore } from "$lib/stores/telegram";
import { nostrPublicKey } from "$lib/stores/nostr";
import { nameMap, resolvedName } from "$lib/stores/nameResolver";
import { queryManager } from "$lib/holosphere/QueryManager";

export interface UserLike {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  picture?: string;
  [k: string]: any;
}

export type UserStore = Record<string, UserLike>;

function buildSelfUser(): { key: string; user: UserLike } | null {
  const tgUser = telegramStore.getState().user;
  if (tgUser) {
    const id = String(tgUser.id);
    return {
      // Match the majority convention used by users-lens subscribers
      // (Badges, Calendar, Expenses, Roles) — key by id.
      key: id,
      user: {
        id,
        first_name: tgUser.first_name,
        last_name: tgUser.last_name,
        username: tgUser.username || id,
        picture: tgUser.photo_url,
      },
    };
  }

  const pubKey = get(nostrPublicKey);
  if (pubKey) {
    return {
      key: pubKey,
      user: {
        id: pubKey,
        first_name: resolvedName(pubKey, get(nameMap)) || "",
        last_name: "",
        username: pubKey,
      },
    };
  }

  return null;
}

/**
 * The logged-in user as a Quest/marketplace `initiator` (id + name fields),
 * or null if no identity is available. Single source for "who is creating
 * this" on the web side.
 */
export function getSelfInitiator(): {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
} | null {
  const self = buildSelfUser();
  if (!self) return null;
  return {
    id: String(self.user.id),
    username: self.user.username || String(self.user.id),
    firstName: self.user.first_name || "",
    lastName: self.user.last_name || "",
  };
}

/**
 * Returns a userStore that includes the logged-in user when not already
 * present. Returns the original reference if no merge was needed, so
 * downstream reactivity only triggers on actual changes.
 */
export function mergeSelfIntoUsers<T extends UserStore>(
  store: T,
): T | UserStore {
  const self = buildSelfUser();
  if (!self) return store;

  const selfId = String(self.user.id);
  const alreadyPresent = Object.values(store).some(
    (u) => u && String(u.id) === selfId,
  );
  if (alreadyPresent) return store;

  return { ...store, [self.key]: self.user };
}

/**
 * Build a userStore from an items array (as returned by QueryManager) and
 * fold in the logged-in user.
 */
export function buildUserStoreWithSelf(
  items: UserLike[] | null | undefined,
): UserStore {
  const store: UserStore = {};
  if (Array.isArray(items)) {
    for (const u of items) {
      if (u && u.id != null) store[String(u.id)] = u;
    }
  }
  return mergeSelfIntoUsers(store);
}

export interface SubscribeHolonUsersOptions {
  holonId: string;
  onUpdate: (store: UserStore) => void;
  onError?: (err: unknown) => void;
}

/**
 * Subscribe to a holon's `users` lens via QueryManager and always include
 * the logged-in user in the emitted store. Returns the unsubscribe fn.
 */
export function subscribeHolonUsers(
  opts: SubscribeHolonUsersOptions,
): () => void {
  return queryManager.subscribe({
    holonId: opts.holonId,
    lens: "users",
    onUpdate: (items) => {
      opts.onUpdate(buildUserStoreWithSelf(items as UserLike[]));
    },
    onError: opts.onError,
  });
}
