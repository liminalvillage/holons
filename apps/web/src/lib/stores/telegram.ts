import { writable, derived, get } from "svelte/store";
import { browser } from "$app/environment";
import { nostrStore } from "./nostr";

// The authenticated user, as returned by the server after verifying the
// Telegram signature. `id` is the Telegram user id.
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

// Minimal Telegram Mini App (WebApp) surface used for detection + theming.
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    query_id?: string;
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    auth_date?: number;
    hash?: string;
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
}

// Shape returned by /api/auth/* — the verified profile plus the per-user
// HoloSphere signing key derived server-side.
interface AuthResult {
  user: {
    id: number | string;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
  } | null;
  nostrPublicKey?: string;
  nostrPrivateKey?: string;
}

interface TelegramAuthState {
  isAuthenticated: boolean;
  user: TelegramUser | null;
  isTelegramWebApp: boolean;
  isLoading: boolean;
  error: string | null;
  // The derived signing key for this session (also mirrored into nostrStore).
  nostrPrivateKey: string | null;
  nostrPublicKey: string | null;
}

const initialState: TelegramAuthState = {
  isAuthenticated: false,
  user: null,
  isTelegramWebApp: false,
  isLoading: true,
  error: null,
  nostrPrivateKey: null,
  nostrPublicKey: null,
};

function normalizeUser(u: AuthResult["user"]): TelegramUser | null {
  if (!u || u.id == null) return null;
  return {
    id: Number(u.id),
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    photo_url: u.photo_url,
  };
}

function createTelegramStore() {
  const { subscribe, set, update } = writable<TelegramAuthState>(initialState);

  // Apply a verified auth result: populate the user and hand the derived
  // signing key to nostrStore (the HoloSphere signing layer).
  function applyAuthResult(result: AuthResult): AuthResult | null {
    const user = normalizeUser(result.user);
    if (!user) return null;
    if (result.nostrPrivateKey) {
      nostrStore.setSessionKey(result.nostrPrivateKey);
    }
    update((state) => ({
      ...state,
      isAuthenticated: true,
      user,
      isLoading: false,
      error: null,
      nostrPrivateKey: result.nostrPrivateKey ?? null,
      nostrPublicKey: result.nostrPublicKey ?? null,
    }));
    return result;
  }

  function detectWebApp(): TelegramWebApp | null {
    if (!browser) return null;
    return (window as any).Telegram?.WebApp ?? null;
  }

  return {
    subscribe,

    // Restore an existing session via the cookie. In dev the server mints a
    // session for VITE_DEV_TELEGRAM_USER_ID. Returns the AuthResult or null.
    init: async (): Promise<AuthResult | null> => {
      if (!browser) return null;
      update((state) => ({ ...state, isLoading: true }));

      // Detect Mini App context (for theming/UX); login itself always goes
      // through the standard OIDC redirect regardless.
      const webApp = detectWebApp();
      const inTelegram = Boolean(
        webApp?.initData && webApp.initData.length > 0,
      );
      if (inTelegram && webApp) {
        try {
          webApp.ready();
          webApp.expand();
        } catch {
          /* not fatal */
        }
      }
      update((state) => ({ ...state, isTelegramWebApp: inTelegram }));

      try {
        const res = await fetch("/api/auth/session", { method: "GET" });
        if (res.ok) return applyAuthResult(await res.json());
      } catch (err) {
        console.warn("Session restore failed:", err);
      }

      update((state) => ({
        ...state,
        isAuthenticated: false,
        user: null,
        isLoading: false,
        nostrPrivateKey: null,
        nostrPublicKey: null,
      }));
      return null;
    },

    // Start the Telegram OIDC login: a full-page redirect to our /login
    // endpoint, which bounces to Telegram and back to /callback. The callback
    // sets the session cookie and redirects home, where init() picks it up.
    login: () => {
      if (!browser) return;
      window.location.href = "/api/auth/telegram/login";
    },

    logout: async () => {
      if (browser) {
        try {
          await fetch("/api/auth/session", { method: "DELETE" });
        } catch {
          /* best effort */
        }
        nostrStore.clearKey();
        sessionStorage.setItem("just_logged_out", "true");
      }
      set({ ...initialState, isLoading: false });
    },

    setError: (error: string) => {
      update((state) => ({ ...state, error, isLoading: false }));
    },

    getWebApp: (): TelegramWebApp | null => detectWebApp(),

    getState: (): TelegramAuthState => get({ subscribe }),
  };
}

export const telegramStore = createTelegramStore();

// Derived stores for convenience
export const isAuthenticated = derived(
  telegramStore,
  ($s) => $s.isAuthenticated,
);
export const telegramUser = derived(telegramStore, ($s) => $s.user);
export const isTelegramWebApp = derived(
  telegramStore,
  ($s) => $s.isTelegramWebApp,
);
export const isLoading = derived(telegramStore, ($s) => $s.isLoading);
