// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import type { AuthIdentity } from "@holons/core/auth";

/** What every browser provider adapter resolves to: a usable signing key. */
export interface ProviderLogin {
  privateKey: string;
  publicKey: string;
  identity: AuthIdentity;
}

/** A user-readable failure (already phrased for the login card). */
export class AuthUiError extends Error {
  constructor(
    message: string,
    /** `cancelled` errors are shown softly (the user backed out). */
    public readonly kind: "cancelled" | "unsupported" | "failed" = "failed",
  ) {
    super(message);
    this.name = "AuthUiError";
  }
}

export function isAbort(err: unknown): boolean {
  const e = err as { name?: string; code?: number; message?: string } | null;
  return (
    e?.name === "NotAllowedError" ||
    e?.name === "AbortError" ||
    e?.code === 4001 || // EIP-1193 user rejected
    /user rejected|denied|cancel/i.test(e?.message ?? "")
  );
}
