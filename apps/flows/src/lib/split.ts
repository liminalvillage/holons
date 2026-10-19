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
  resourceCount,
  saveAllocationConfig,
  type SplitDraft,
} from "@holons/core/flows";
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
    const [inputs, federation, users, applications] = await Promise.all([
      loadAllocationInputs(hs, holon),
      quiet(() => getFederationSnapshot(hs, holon), {
        federated: [] as string[],
        lensConfig: {},
        partnerNames: {} as Record<string, string>,
      } as any),
      quiet<any[]>(() => hs.getAll(holon, "users"), []),
      fundApplications(holon),
    ]);
    const map = get(index);
    const names: Record<string, string> = {
      ...(federation.partnerNames ?? {}),
    };
    const persons: string[] = [];
    for (const u of users ?? []) {
      const id = String(u?.id ?? "");
      if (!/^\d+$/.test(id)) continue;
      persons.push(id);
      if (nameOfUser(u)) names[id] = nameOfUser(u);
    }
    for (const a of applications.applications) {
      if (a.name && !names[a.party]) names[a.party] = a.name;
      if (a.status === "approved" && /^(\d+|[0-9a-f]{64})$/i.test(a.party))
        persons.push(a.party);
    }
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

/** Save a draft, then redraw the holon from what was stored. */
export async function saveSplit(
  holon: string,
  draft: SplitDraft,
): Promise<void> {
  const hs = await getHolosphere();
  const save = draftToSave(draft);
  await saveAllocationConfig(hs, holon, save.config, save.zones, save.people);
  await refine(holon, true);
}
