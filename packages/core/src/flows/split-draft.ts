// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A holon's way out, as something a hand can edit: how much it keeps, and
 * who the rest goes to, ring by ring.
 *
 * What a draft covers is what stays editable under a genesis lock — the
 * rings, the slope, who sits where — plus the keep, which the lock holds.
 * The contributors' split (shares, buckets) is not here: it is the rule the
 * lock protects, and it has its own tools.
 *
 * A holon placed on a ring only counts when the federation record names it
 * (`toAllocationPartners` drops the rest on every read), so a draft marks
 * the ones that would vanish instead of letting them be saved in silence.
 *
 * Pure: every step returns a new draft.
 */

import { allocate, normalizeAllocationConfig, type AllocationConfig, type AllocationPartner } from './allocation.js';

export const MAX_SPLIT_RINGS = 10;

export interface SplitRecipient {
  id: string;
  name: string;
  kind: 'holon' | 'person';
  /** 1-based; 0 means not placed. */
  ring: number;
  /** A holon the federation record names. Always true for a person: a person needs no link. */
  federated: boolean;
  /** Its resource base, when known: what a `resourced` split weighs. */
  resources?: number;
}

export interface SplitDraft {
  /** Percent the holon's own contributors keep; the rest goes down the rings. */
  keep: number;
  steepness: number;
  nzones: number;
  /** Percent of what goes down the rings that is sent by resource base instead (`resources.ts`). */
  resourced: number;
  /** Everyone placed on a ring. */
  recipients: SplitRecipient[];
  /** Who could be placed and is not: federated holons, and the people offered. */
  candidates: SplitRecipient[];
  /** The keep is held by the genesis lock. */
  locked: boolean;
}

export interface SplitDraftInput {
  config: Partial<AllocationConfig> | null | undefined;
  zones?: Record<string, number> | null;
  people?: Record<string, number> | null;
  /** The genesis lock, when the split has one. */
  genesis?: unknown;
  /** The holons the federation record names. */
  federated?: readonly string[] | null;
  /** People who may be placed: the holon's own, an approved applicant. */
  persons?: readonly string[] | null;
  names?: Record<string, string> | null;
  /** Party → resource base, for the preview of a `resourced` split. */
  resources?: Record<string, number> | null;
}

const ringOf = (raw: unknown, nzones: number): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, nzones) : 0;
};

const byName = (a: SplitRecipient, z: SplitRecipient) => a.ring - z.ring || a.name.localeCompare(z.name) || a.id.localeCompare(z.id);

/** The stored split, the federation record and the offered people, as a draft. */
export function draftFromInputs(input: SplitDraftInput): SplitDraft {
  const config = normalizeAllocationConfig(input.config ?? {});
  const nzones = Math.max(1, Math.min(MAX_SPLIT_RINGS, config.nzones));
  const names = input.names ?? {};
  const federated = new Set((input.federated ?? []).map((id) => String(id ?? '')).filter(Boolean));
  const all = new Map<string, SplitRecipient>();
  const put = (id: string, kind: SplitRecipient['kind'], ring: number, linked: boolean) => {
    if (!id || all.has(id)) return;
    const resources = Number(input.resources?.[id]);
    all.set(id, { id, name: names[id] || id, kind, ring, federated: linked, ...(resources > 0 ? { resources } : {}) });
  };
  // A person's id can also be a federation partner; the partner's seat wins, as on every read.
  for (const id of federated) put(id, 'holon', ringOf(input.zones?.[id] ?? input.people?.[id], nzones), true);
  for (const [id, ring] of Object.entries(input.zones ?? {})) put(String(id), 'holon', ringOf(ring, nzones), false);
  for (const [id, ring] of Object.entries(input.people ?? {})) put(String(id), 'person', ringOf(ring, nzones), true);
  for (const id of input.persons ?? []) put(String(id ?? ''), 'person', 0, true);

  const rows = [...all.values()];
  return {
    keep: config.interiorPercent,
    steepness: config.steepness,
    nzones,
    resourced: config.resourced ?? 0,
    recipients: rows.filter((r) => r.ring >= 1).sort(byName),
    // An unlinked holon with no ring is nothing: it is neither placed nor placeable.
    candidates: rows.filter((r) => r.ring < 1 && r.federated).sort(byName),
    locked: !!input.genesis,
  };
}

const clamp = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
};

/** Set what the holon keeps. A locked draft does not move. */
export function setKeep(draft: SplitDraft, keep: number): SplitDraft {
  if (draft.locked) return draft;
  return { ...draft, keep: Math.round(clamp(keep, 0, 100)) };
}

export function setSteepness(draft: SplitDraft, steepness: number): SplitDraft {
  return { ...draft, steepness: Math.round(clamp(steepness, 0, 100)) };
}

/** Set how much of what goes down the rings follows resource base: the public rule, 0 to turn it off. */
export function setResourced(draft: SplitDraft, resourced: number): SplitDraft {
  return { ...draft, resourced: Math.round(clamp(resourced, 0, 100)) };
}

/** Set how many rings there are; whoever sat further out moves to the new outermost. */
export function setRingCount(draft: SplitDraft, nzones: number): SplitDraft {
  const n = Math.round(clamp(nzones, 1, MAX_SPLIT_RINGS));
  return {
    ...draft,
    nzones: n,
    recipients: draft.recipients.map((r) => (r.ring > n ? { ...r, ring: n } : r)).sort(byName),
  };
}

/**
 * Put a party on a ring, or take it off with ring 0. Works on a recipient
 * and on a candidate alike; an id the draft does not know is left alone —
 * `addRecipient` is how a new party enters.
 */
export function setRing(draft: SplitDraft, id: string, ring: number): SplitDraft {
  const known = [...draft.recipients, ...draft.candidates].find((r) => r.id === id);
  if (!known) return draft;
  const next: SplitRecipient = { ...known, ring: ringOf(ring, draft.nzones) };
  const recipients = draft.recipients.filter((r) => r.id !== id);
  const candidates = draft.candidates.filter((r) => r.id !== id);
  if (next.ring >= 1) recipients.push(next);
  else if (next.federated) candidates.push(next);
  return { ...draft, recipients: recipients.sort(byName), candidates: candidates.sort(byName) };
}

/**
 * The draft with a whole split laid over it — a proposal, read to see it:
 * keep, rings, slope and who sits where all come from `save`; a party it
 * places that the draft did not know joins with its id for a name. A locked
 * keep stays as it is.
 */
export function draftWithSave(draft: SplitDraft, save: SplitSave): SplitDraft {
  const c = save.config ?? {};
  let next: SplitDraft = {
    ...draft,
    ...(draft.locked || c.interiorPercent == null ? {} : { keep: Math.round(clamp(c.interiorPercent, 0, 100)) }),
    ...(c.steepness == null ? {} : { steepness: Math.round(clamp(c.steepness, 0, 100)) }),
    ...(c.resourced == null ? {} : { resourced: Math.round(clamp(c.resourced, 0, 100)) }),
  };
  next = setRingCount(next, c.nzones ?? draft.nzones);
  const placed = new Map<string, { ring: number; kind: SplitRecipient['kind'] }>();
  for (const [id, ring] of Object.entries(save.zones ?? {})) placed.set(id, { ring: Number(ring), kind: 'holon' });
  for (const [id, ring] of Object.entries(save.people ?? {})) placed.set(id, { ring: Number(ring), kind: 'person' });
  for (const r of next.recipients) if (!placed.has(r.id)) next = setRing(next, r.id, 0);
  for (const [id, p] of placed) next = addRecipient(next, { id, kind: p.kind }, Math.max(1, p.ring));
  return next;
}

/** Take a party off its ring. */
export const removeRecipient = (draft: SplitDraft, id: string): SplitDraft => setRing(draft, id, 0);

/** Offer a party the draft did not know and place it — on the outermost ring unless told otherwise. */
export function addRecipient(
  draft: SplitDraft,
  party: { id: string; name?: string; kind?: SplitRecipient['kind']; federated?: boolean },
  ring?: number,
): SplitDraft {
  const id = String(party.id ?? '').trim();
  if (!id) return draft;
  const known = [...draft.recipients, ...draft.candidates].some((r) => r.id === id);
  const kind = party.kind ?? 'holon';
  const base = known
    ? draft
    : {
        ...draft,
        candidates: [
          ...draft.candidates,
          { id, name: party.name || id, kind, ring: 0, federated: kind === 'person' ? true : party.federated !== false },
        ],
      };
  return setRing(base, id, ring ?? draft.nzones);
}

export interface SplitPreviewRow extends SplitRecipient {
  /** Share of everything the holon receives. */
  percentage: number;
}

export interface SplitPreview {
  keep: number;
  /** What actually leaves: the rest, when someone is placed to receive it. */
  passed: number;
  /** The rest when nobody is placed: it has nowhere to go and stays. */
  unplaced: number;
  rows: SplitPreviewRow[];
  rings: Array<{ ring: number; percentage: number; count: number }>;
}

/** What the draft would pay, by the same `allocate` every surface reads the split with. */
export function previewDraft(draft: SplitDraft): SplitPreview {
  const zoned: AllocationPartner[] = draft.recipients.map((r) => ({
    id: r.id,
    name: r.name,
    zone: r.ring,
    kind: r.kind,
    ...(r.resources ? { resources: r.resources } : {}),
  }));
  const result = allocate({
    total: null,
    config: { interiorPercent: draft.keep, steepness: draft.steepness, nzones: draft.nzones, resourced: draft.resourced ?? 0 },
    members: [],
    zoned,
  });
  const share = new Map<string, number>();
  const rings: SplitPreview['rings'] = [];
  for (const zone of result.exterior) {
    const members = zone.members ?? [];
    for (const m of members) share.set(m.id, (share.get(m.id) ?? 0) + m.percentage);
    // A ring nobody sits on passes nothing on: its share stays (`unplaced`).
    if (zone.zone != null) rings.push({ ring: zone.zone, percentage: members.length ? zone.percentage : 0, count: members.length });
  }
  const rows = draft.recipients
    .map((r) => ({ ...r, percentage: share.get(r.id) ?? 0 }))
    .sort((a, z) => a.ring - z.ring || z.percentage - a.percentage || a.name.localeCompare(z.name));
  const passed = rows.reduce((sum, r) => sum + r.percentage, 0);
  return { keep: draft.keep, passed, unplaced: Math.max(0, 100 - draft.keep - passed), rows, rings: rings.sort((a, z) => a.ring - z.ring) };
}

export type SplitChange =
  | { kind: 'keep' | 'steepness' | 'rings' | 'resourced'; from: number; to: number }
  | { kind: 'added'; id: string; name: string; ring: number }
  | { kind: 'removed'; id: string; name: string; ring: number }
  | { kind: 'moved'; id: string; name: string; from: number; to: number };

/** What changed between two drafts, in the order a person would read it back. */
export function draftChanges(before: SplitDraft, after: SplitDraft): SplitChange[] {
  const out: SplitChange[] = [];
  if (before.keep !== after.keep) out.push({ kind: 'keep', from: before.keep, to: after.keep });
  if (before.nzones !== after.nzones) out.push({ kind: 'rings', from: before.nzones, to: after.nzones });
  if (before.steepness !== after.steepness) out.push({ kind: 'steepness', from: before.steepness, to: after.steepness });
  if ((before.resourced ?? 0) !== (after.resourced ?? 0)) out.push({ kind: 'resourced', from: before.resourced ?? 0, to: after.resourced ?? 0 });
  const was = new Map(before.recipients.map((r) => [r.id, r]));
  const is = new Map(after.recipients.map((r) => [r.id, r]));
  for (const r of after.recipients) {
    const old = was.get(r.id);
    if (!old) out.push({ kind: 'added', id: r.id, name: r.name, ring: r.ring });
    else if (old.ring !== r.ring) out.push({ kind: 'moved', id: r.id, name: r.name, from: old.ring, to: r.ring });
  }
  for (const r of before.recipients) if (!is.has(r.id)) out.push({ kind: 'removed', id: r.id, name: r.name, ring: r.ring });
  return out;
}

export interface SplitSave {
  config: Partial<AllocationConfig>;
  /** The whole holon map: `saveAllocationConfig` replaces it. */
  zones: Record<string, number>;
  /** The whole people map. */
  people: Record<string, number>;
}

/**
 * The arguments for `saveAllocationConfig`. A locked draft leaves the keep
 * out, so the save cannot trip the lock over a number it never changed.
 */
export function draftToSave(draft: SplitDraft): SplitSave {
  const zones: Record<string, number> = {};
  const people: Record<string, number> = {};
  for (const r of draft.recipients) (r.kind === 'person' ? people : zones)[r.id] = r.ring;
  return {
    config: {
      ...(draft.locked ? {} : { interiorPercent: draft.keep }),
      steepness: draft.steepness,
      nzones: draft.nzones,
      resourced: draft.resourced ?? 0,
    },
    zones,
    people,
  };
}

/**
 * Who may be placed on a holon's rings besides its federated partners: the
 * people of its own `users` lens (Telegram ids), the keys seated in its
 * members log (a key-founded holon's people), and whoever its fund
 * approved — an approved application seats a Telegram id or a key. Names
 * come along where they are known; ids are kept once, in order.
 */
export function placeablePeople(input: {
  users?: ReadonlyArray<{ id?: unknown; name?: string }> | null;
  /** Keys seated in the holon's members log (hex). */
  members?: Iterable<string> | null;
  applications?: ReadonlyArray<{ party: string; status: string; name?: string }> | null;
}): { persons: string[]; names: Record<string, string> } {
  const persons: string[] = [];
  const names: Record<string, string> = {};
  const add = (id: string) => {
    if (!persons.includes(id)) persons.push(id);
  };
  for (const u of input.users ?? []) {
    const id = String(u?.id ?? '');
    if (!/^\d+$/.test(id)) continue;
    add(id);
    if (u.name) names[id] = u.name;
  }
  for (const key of input.members ?? []) {
    const id = String(key ?? '').toLowerCase();
    if (/^[0-9a-f]{64}$/.test(id)) add(id);
  }
  for (const a of input.applications ?? []) {
    if (a.name && !names[a.party]) names[a.party] = a.name;
    if (a.status === 'approved' && /^(\d+|[0-9a-f]{64})$/i.test(a.party)) add(a.party);
  }
  return { persons, names };
}
