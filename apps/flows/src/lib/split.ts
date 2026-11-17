// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A holon's way out, read for editing and written back. The draft and every
// step on it are core's (`split-draft`); this gathers what a draft is made
// from — the stored split, the federation record, the people who may be
// placed — and saves the result through the one function every surface
// saves a split with.

import { getFederationSnapshot } from "@holons/core/federation";
import {
  draftFromInputs,
  draftToSave,
  loadAllocationInputs,
  placeablePeople,
  resourceCount,
  decideSplitProposal,
  loadSplitProposals,
  proposeSplit,
  withdrawSplitProposal,
  type SplitDraft,
  type SplitProposal,
  type SplitProposalsContext,
} from "@holons/core/flows";
import { holonMembers } from "@holons/core/protocol";
import { fundApplications } from "./applications";
import { index, refine } from "./graph";
import { getHolosphere } from "./holosphere";
import { get } from "svelte/store";

const quiet = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return (await run()) ?? fallback;
  } catch {
    return fallback;
  }
};

const nameOfUser = (u: any): string =>
  String(
    u?.name ||
      [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
      u?.username ||
      "",
  ).trim();

/** The holon's split as a draft, or null when it could not be read. */
export async function loadSplit(holon: string): Promise<SplitDraft | null> {
  return quiet(async () => {
    const hs = (await getHolosphere()) as any;
    const [inputs, federation, users, applications, members] =
      await Promise.all([
        loadAllocationInputs(hs, holon),
        quiet(() => getFederationSnapshot(hs, holon), {
          federated: [] as string[],
          lensConfig: {},
          partnerNames: {} as Record<string, string>,
        } as any),
        quiet<any[]>(() => hs.getAll(holon, "users"), []),
        fundApplications(holon),
        quiet(() => holonMembers(hs, holon), new Map<string, string>()),
      ]);
    const map = get(index);
    const names: Record<string, string> = {
      ...(federation.partnerNames ?? {}),
    };
    const placeable = placeablePeople({
      users: (users ?? []).map((u) => ({ id: u?.id, name: nameOfUser(u) })),
      members: members.keys(),
      applications: applications.applications,
    });
    const persons = placeable.persons;
    for (const [id, name] of Object.entries(placeable.names))
      if (!names[id]) names[id] = name;
    // The map's own names win: they are what every other screen shows.
    for (const id of [
      ...(federation.federated ?? []),
      ...Object.keys(inputs.zones ?? {}),
      ...Object.keys(inputs.people ?? {}),
      ...persons,
    ]) {
      const label = map?.byId.get(id)?.label;
      if (label && label !== id) names[id] = label;
    }
    // What the map knows each party was given: the resourced preview weighs it.
    const resources: Record<string, number> = {};
    for (const n of map?.graph.nodes ?? [])
      if (n.resources) resources[n.id] = resourceCount(n.resources);
    return draftFromInputs({
      resources,
      config: inputs.config,
      zones: inputs.zones,
      people: inputs.people,
      genesis: inputs.genesis,
      federated: federation.federated ?? [],
      persons,
      names,
    });
  }, null);
}

/**
 * A holon's split changes by proposal: its admins together, more than half
 * saying yes (core's `split-proposals`). With one admin, proposing applies.
 */
export async function readProposals(
  holon: string,
): Promise<SplitProposalsContext | null> {
  return quiet(
    async () => loadSplitProposals(await getHolosphere(), holon),
    null,
  );
}

/** Put a draft forward; redraw when it was applied at once. */
export async function propose(
  holon: string,
  draft: SplitDraft,
  note?: string,
): Promise<SplitProposal | null> {
  const { proposal } = await proposeSplit(await getHolosphere(), holon, {
    split: draftToSave(draft),
    note,
  });
  if (proposal?.status === "applied") await refine(holon, true);
  return proposal;
}

/** An admin's yes or no; redraw when the yes applied it. */
export async function decide(
  holon: string,
  id: string,
  verdict: "attest" | "dispute",
  reason?: string,
): Promise<SplitProposal | null> {
  const p = await decideSplitProposal(
    await getHolosphere(),
    holon,
    id,
    verdict,
    reason,
  );
  if (p?.status === "applied") await refine(holon, true);
  return p;
}

export async function withdraw(holon: string, id: string): Promise<void> {
  await withdrawSplitProposal(await getHolosphere(), holon, id);
}
