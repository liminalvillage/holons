// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A pot's pay-in doors — a Safe, a Lightning address — read and set by its
// admins. The rules (what a valid one is, how it is stored) are core's
// `pay-in.ts`; this reads them off the pot's settings and writes them back.

import {
  NO_PAY_IN,
  readPayIn,
  savePayIn,
  type PayIn,
  type PayInSafe,
} from "@holons/core/flows";
import { getHolosphere } from "./holosphere";

/** A pot's doors. Quiet: none when its settings cannot be read. */
export async function loadPayIn(holon: string): Promise<PayIn> {
  try {
    const hs = await getHolosphere();
    return readPayIn(await hs.get(holon, "settings", holon));
  } catch {
    return NO_PAY_IN;
  }
}

/** Set (or, with null, remove) a door. Admins only: the write is refused otherwise. */
export async function linkPayIn(
  holon: string,
  patch: { safe?: PayInSafe | null; lightning?: string | null },
): Promise<PayIn> {
  return savePayIn(await getHolosphere(), holon, patch);
}
