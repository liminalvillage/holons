// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Claiming a project the importer seated, and answering. The rules are
// core's (`@holons/core/flows` project claims): anyone signed in may ask, on
// the log of the holon that seats the project; the master keys — admins of
// that holon and of the project — check the evidence and answer; approving
// seats the key that asked as the project's admin.

import {
  approveProjectClaim,
  declineProjectClaim,
  loadProjectClaims,
  requestProjectClaim,
  withdrawProjectClaim,
  type FlowGraphIndex,
  type ProjectClaimsContext,
} from "@holons/core/flows";
import { refine } from "./graph";
import { getHolosphere } from "./holosphere";

const EMPTY: ProjectClaimsContext = {
  claims: [],
  pending: [],
  approved: {},
  seats: {},
};

/** The holon whose own split seats `project`: where its claims are asked. */
export function seatingHolonOf(
  index: FlowGraphIndex,
  project: string,
): string | null {
  const link = (index.into.get(project) ?? []).find(
    (l) => l.via === "interior",
  );
  return link?.source ?? null;
}

/** A seating holon's project claims. Quiet: a holon that cannot be read has none. */
export async function projectClaims(
  holder: string,
): Promise<ProjectClaimsContext> {
  try {
    return await loadProjectClaims(await getHolosphere(), holder);
  } catch {
    return EMPTY;
  }
}

export async function claimProject(
  holder: string,
  input: {
    project: string;
    party: string;
    name?: string;
    role?: string;
    evidence?: string;
    note?: string;
  },
): Promise<void> {
  await requestProjectClaim(await getHolosphere(), holder, input);
}

export async function withdrawClaim(
  holder: string,
  claimId: string,
): Promise<void> {
  await withdrawProjectClaim(await getHolosphere(), holder, claimId);
}

/** Approve, then redraw the seating holon so the seat shows as claimed. */
export async function approveClaim(holder: string, claimId: string) {
  const out = await approveProjectClaim(await getHolosphere(), holder, claimId);
  void refine(holder, true);
  return out;
}

export async function declineClaim(
  holder: string,
  claimId: string,
  reason: string,
): Promise<void> {
  await declineProjectClaim(await getHolosphere(), holder, claimId, reason);
}
