// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Which ways of signing in this kiosk offers. `VITE_FLOWS_LOGIN` lists them
// (comma- or space-separated: telegram, nostr, ethereum); unset, empty or
// nonsense means all of them. `VITE_FLOWS_LOGIN=telegram` is the switch for a
// hub that wants Telegram logins only — backward compatible because the
// session endpoint hands a Telegram login its derived key, so the person is
// linked wherever their chat is (see src/routes/api/auth/session).

export type LoginProvider = "telegram" | "nostr" | "ethereum";

export const ALL_LOGIN_PROVIDERS: readonly LoginProvider[] = [
  "nostr",
  "telegram",
  "ethereum",
];

/** Parse the env value; unknown names are dropped, nothing valid → all. */
export function parseLoginProviders(raw: unknown): LoginProvider[] {
  const names = String(raw ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (names.includes("all")) return [...ALL_LOGIN_PROVIDERS];
  const picked = ALL_LOGIN_PROVIDERS.filter((p) => names.includes(p));
  return picked.length ? picked : [...ALL_LOGIN_PROVIDERS];
}

/** The providers this build offers. */
export function loginProviders(): LoginProvider[] {
  return parseLoginProviders(import.meta.env.VITE_FLOWS_LOGIN);
}

/** Whether any key-based login (own key, wallet) is offered. */
export function keyLoginOffered(providers = loginProviders()): boolean {
  return providers.includes("nostr") || providers.includes("ethereum");
}
