// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Namespace resolution for the web app's server-side Holosphere reads (the
// calendar feed). Mirrors the client's `envDefault` in $lib/stores/appName:
// HOLONS_APP wins, otherwise a production process reads the production
// namespace and only a dev one reads HolonsDebug. A deployed function that
// never set HOLONS_APP used to land on the empty debug namespace and serve a
// calendar with no events.

type Env = Record<string, string | undefined>;

export function resolveFeedAppName(env: Env): string {
  const set = (env.HOLONS_APP || "").trim();
  if (set) return set;
  return env.NODE_ENV === "development" ? "HolonsDebug" : "Holons";
}
