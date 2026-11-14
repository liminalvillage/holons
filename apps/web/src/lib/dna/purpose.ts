// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A holon's purpose, as the dashboard reads it. It lives in the DNA (the
// purpose gene's blurb, `@holons/core/dna` `purposeAbout`), no longer in
// `settings.purpose`; every reader here goes through this one helper.

import type { HoloSphere } from "holosphere";
import { purposeAbout, readGenes } from "@holons/core/dna";

/** The holon's purpose, or '' when it has none or its genes cannot be read. Never throws. */
export async function readPurpose(
  hs: HoloSphere | { getAll: HoloSphere["getAll"] } | null | undefined,
  holon: string,
): Promise<string> {
  if (!hs || !holon) return "";
  try {
    return purposeAbout(await readGenes(hs as HoloSphere, holon));
  } catch {
    return "";
  }
}
