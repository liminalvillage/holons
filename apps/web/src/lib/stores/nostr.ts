import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { nostrUtils } from "holosphere";

const { getPublicKey, generatePrivateKey, parseNsecOrHex } = nostrUtils;

const STORAGE_KEY = "nostr_private_key";

export interface NostrKeyState {
  privateKey: string | null;
  publicKey: string | null;
  isLoading: boolean;
  isNewKey: boolean; // True if key was just generated (needs backup)
}

const initialState: NostrKeyState = {
  privateKey: null,
  publicKey: null,
  isLoading: true,
  isNewKey: false,
};

function createNostrStore() {
  const { subscribe, set, update } = writable<NostrKeyState>(initialState);

  return {
    subscribe,

    // Initialize - check localStorage for existing key
    init: async () => {
      if (!browser) return;

      update((state) => ({ ...state, isLoading: true }));

      try {
        const storedKey = localStorage.getItem(STORAGE_KEY);
        if (storedKey) {
          const publicKey = getPublicKey(storedKey);
          update((state) => ({
            ...state,
            privateKey: storedKey,
            publicKey,
            isLoading: false,
            isNewKey: false,
          }));
          console.log("Nostr key loaded from localStorage");
        } else {
          update((state) => ({
            ...state,
            isLoading: false,
          }));
        }
      } catch (error) {
        console.error("Error loading Nostr key:", error);
        update((state) => ({
          ...state,
          isLoading: false,
        }));
      }
    },

    // Adopt the signing key delivered by a verified Telegram session. This is
    // the primary path now: the key is derived server-side from the Telegram
    // identity (see lib/server/telegramAuth.ts) and handed to the client over
    // HTTPS. Cached in localStorage so an offline reload can still sign before
    // the session endpoint responds. Not "new" — never prompts for backup.
    setSessionKey: (privateKey: string) => {
      if (!browser) return null;
      try {
        const publicKey = getPublicKey(privateKey);
        // Update the in-memory store FIRST so the session is usable even when
        // persistence is unavailable. On mobile (private mode, "block site
        // data", or a partitioned/in-app context) localStorage.setItem can
        // throw — if we gated the store update behind it, the valid signing
        // key we already hold would be discarded, and the layout would treat
        // the user as having "no signing key" and dead-end on a blank screen.
        update((state) => ({
          ...state,
          privateKey,
          publicKey,
          isLoading: false,
          isNewKey: false,
        }));
        // Best-effort cache for offline reloads; never fatal.
        try {
          localStorage.setItem(STORAGE_KEY, privateKey);
        } catch (storageError) {
          console.warn(
            "Could not persist signing key (storage blocked) — continuing in-memory:",
            storageError,
          );
        }
        return { privateKey, publicKey };
      } catch (error) {
        console.error("Error adopting session signing key:", error);
        return null;
      }
    },

    // Generate a new keypair
    generateKey: async () => {
      if (!browser) return;

      update((state) => ({ ...state, isLoading: true }));

      try {
        // Generate private key using holosphere
        const privateKey = generatePrivateKey();

        // Derive public key
        const publicKey = getPublicKey(privateKey);

        // Store in localStorage
        localStorage.setItem(STORAGE_KEY, privateKey);

        update((state) => ({
          ...state,
          privateKey,
          publicKey,
          isLoading: false,
          isNewKey: true, // Mark as new for backup prompt
        }));

        console.log("New Nostr keypair generated");
        return { privateKey, publicKey };
      } catch (error) {
        console.error("Error generating Nostr key:", error);
        update((state) => ({
          ...state,
          isLoading: false,
        }));
        throw error;
      }
    },

    // Import an existing private key (accepts hex or nsec format)
    importKey: async (keyInput: string) => {
      if (!browser) return;

      // Parse key input (accepts nsec or hex). Library returns the
      // canonical hex string on success, or null if the input is neither
      // a valid nsec nor a 64-char hex.
      const privateKey = parseNsecOrHex(keyInput);
      if (!privateKey) {
        throw new Error("Invalid private key format");
      }

      update((state) => ({ ...state, isLoading: true }));

      try {
        // Derive public key
        const publicKey = getPublicKey(privateKey);

        // Store hex internally
        localStorage.setItem(STORAGE_KEY, privateKey);

        update((state) => ({
          ...state,
          privateKey,
          publicKey,
          isLoading: false,
          isNewKey: false,
        }));

        console.log("Nostr key imported successfully");
        return { privateKey, publicKey };
      } catch (error) {
        console.error("Error importing Nostr key:", error);
        update((state) => ({
          ...state,
          isLoading: false,
        }));
        throw error;
      }
    },

    // Mark key as backed up (no longer new)
    markBackedUp: () => {
      update((state) => ({
        ...state,
        isNewKey: false,
      }));
    },

    // Clear the key (logout)
    clearKey: () => {
      if (browser) {
        localStorage.removeItem(STORAGE_KEY);
      }
      set({
        ...initialState,
        isLoading: false,
      });
    },

    // Get current state synchronously
    getState: (): NostrKeyState => {
      return get({ subscribe });
    },
  };
}

export const nostrStore = createNostrStore();

// Derived stores for convenience
export const hasNostrKey = derived(nostrStore, ($store) => !!$store.privateKey);
export const nostrPublicKey = derived(nostrStore, ($store) => $store.publicKey);
export const nostrPrivateKey = derived(
  nostrStore,
  ($store) => $store.privateKey,
);
export const isNostrLoading = derived(nostrStore, ($store) => $store.isLoading);
export const isNewNostrKey = derived(nostrStore, ($store) => $store.isNewKey);
