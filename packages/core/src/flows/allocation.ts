// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Resource allocation — where a holon's value is meant to go.
 *
 * This is the model behind the dashboard's Flow Management concentric chart,
 * moved into core. It used to live in `apps/web/src/components/flow/types.ts`,
 * which put domain meaning inside a UI (rule 1) and left it unreachable from
 * the kiosk, which has no wallet and no d3. The math is the same; only its home
 * changed, and `allocation.test.ts` pins the ported numbers so nothing shifted.
 *
 * The split has two sides:
 *
 *   interior — `interiorPercent` of the pot, divided among members in
 *              proportion to their contribution score
 *   exterior — the remainder, divided among the federated partners placed in
 *              `nzones` rings: each partner carries its ring's geometric decay
 *              weight and shares are normalized over placed partners only,
 *              exactly as the Bundle contract distributes on-chain
 *
 * The on-chain contract remains the authority wherever a bundle is deployed;
 * `readAllocationConfig` is the off-chain mirror that wallet-less surfaces read,
 * and this math is kept in lockstep with the contract so the mirror shows what
 * the chain would pay (pinned by the Sepolia-parity cases in the spec).
 */

/**
 * How the contributors' share is divided among members.
 *
 *   equation — by contribution score, as the holon's value equation ranks
 *              them (the default, and the only way it used to work)
 *   custom   — by a hand-set share per member (`interiorShares`), with the
 *              equation split offered as the starting point to copy from
 */
export type InteriorMode = 'equation' | 'custom';

/** The knobs that shape the split. */
export interface AllocationConfig {
  /** 0..100. The exterior gets whatever is left. */
  interiorPercent: number;
  /** 0..100 UI scale. Higher means a flatter spread across zones. */
  steepness: number;
  nzones: number;
  /** Absent means `equation`. */
  interiorMode?: InteriorMode;
}

/** A custom interior split: member id → share weight (0..100, need not sum). */
export type InteriorShares = Record<string, number>;

export interface AllocationSlice {
  id: string;
  label: string;
  /** Share of the WHOLE pot, not of this slice's side. All slices sum to 100. */
  percentage: number;
  /** `null` when no amount is being distributed (percentage-only view). */
  amount: number | null;
  side: 'interior' | 'exterior';
  /** Exterior only: which ring this belongs to (1-based). */
  zone?: number;
  /** Exterior zones only: the partners sharing this zone. */
  members?: AllocationSlice[];
}

export interface AllocationResult {
  config: AllocationConfig;
  /** Currency code, or '' for a percentage-only allocation. */
  unit: string;
  /** The pot being divided, or null when only shares are known. */
  total: number | null;
  interior: AllocationSlice[];
  exterior: AllocationSlice[];
}

/** A member with a contribution-score share, as `computeHolonUserScores` yields. */
export interface AllocationMember {
  id: string;
  name: string;
  /** Score share, 0..100. Re-normalized here, so it need not sum exactly. */
  percentage: number;
}

/** A federated partner assigned to a zone ring. Zone < 1 means unassigned. */
export interface AllocationPartner {
  id: string;
  name: string;
  zone: number;
  /** A federation partner holon, or a person placed on a ring. Absent means holon. */
  kind?: 'holon' | 'person';
}

export const DEFAULT_ALLOCATION_CONFIG: AllocationConfig = {
  interiorPercent: 50,
  steepness: 50,
  nzones: 6,
  interiorMode: 'equation',
};

/**
 * Per-zone percentages from the steepness decay.
 *
 * Ported verbatim from the web's `calculateZonePercentages`. Note that its
 * `total === 0` branch is unreachable in practice: zone 1 weighs `decay^0`,
 * which is 1 even at a steepness of 0, so the real behaviour at 0 is that the
 * innermost zone takes everything. Kept as-is anyway — the point of this port
 * is that the numbers do not move.
 */
export function calculateZonePercentages(
  steepness: number,
  nzones: number,
): number[] {
  if (nzones <= 0) return [];

  // steepness 0-100: the decay factor. Higher spreads value further out.
  const decay = steepness / 100;

  const weights: number[] = [];
  let total = 0;

  for (let z = 0; z < nzones; z++) {
    const weight = Math.pow(decay, z);
    weights.push(weight);
    total += weight;
  }

  if (total === 0) {
    return weights.map(() => 100 / nzones);
  }

  return weights.map((w) => (w / total) * 100);
}

/** Clamp a config to usable numbers, filling in defaults for anything unusable. */
export function normalizeAllocationConfig(raw: unknown): AllocationConfig {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const interiorPercent = Math.min(
    100,
    Math.max(0, num(doc.interiorPercent, DEFAULT_ALLOCATION_CONFIG.interiorPercent)),
  );
  const steepness = Math.min(
    100,
    Math.max(0, num(doc.steepness, DEFAULT_ALLOCATION_CONFIG.steepness)),
  );
  const nzones = Math.max(
    0,
    Math.floor(num(doc.nzones, DEFAULT_ALLOCATION_CONFIG.nzones)),
  );
  const interiorMode: InteriorMode = doc.interiorMode === 'custom' ? 'custom' : 'equation';
  return { interiorPercent, steepness, nzones, interiorMode };
}

/** Only members with a usable positive share survive; anything else is "not in". */
export function normalizeInteriorShares(raw: unknown): InteriorShares {
  const shares: InteriorShares = {};
  for (const [id, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const share = Number(value);
    if (id && Number.isFinite(share) && share > 0) shares[id] = share;
  }
  return shares;
}

/**
 * The equation split as a custom one — what "copy from the value equation"
 * hands the editor.
 *
 * The percentages are carried over EXACTLY as `normalizeShares` produced
 * them, with no rounding and no renormalizing of its own. That is the whole
 * point: a copied split has to draw the same diagram and pay the same shares
 * as the equation it came from, and an editor that rounded here would show a
 * member 4.1% beside an equation hint reading 4.2%. Shares are read in
 * proportion to each other (`allocate` normalizes them against their own sum),
 * so they need no tidying to be a valid split — only the display rounds, and
 * it rounds the equation figure and the copied one the same way.
 *
 * Members with no positive share are left out: a split is a list of who gets
 * something.
 */
export function sharesFromMembers(members: AllocationMember[]): InteriorShares {
  const shares: InteriorShares = {};
  for (const member of uniqueById(members ?? [])) {
    if (Number.isFinite(member.percentage) && member.percentage > 0) {
      shares[member.id] = member.percentage;
    }
  }
  return shares;
}

/**
 * The members the contributors' share is divided among, by the configured mode.
 *
 * `equation` returns the scored roster as is. `custom` builds the roster from
 * the shares map, naming each member from the scored roster when it is there
 * and through `nameOf` otherwise (someone hand-added who has no score yet).
 * A custom split with nobody in it is not a split: the equation stands until
 * someone is entered, so a half-configured holon never pays its interior to
 * no one — on the mirror or on the chain, which reads the same roster.
 */
export function resolveInteriorMembers(input: {
  config: Pick<AllocationConfig, 'interiorMode'>;
  scored: AllocationMember[];
  shares?: InteriorShares | null;
  nameOf?: (id: string) => string | undefined;
}): AllocationMember[] {
  const scored = uniqueById(input.scored ?? []);
  if (input.config?.interiorMode !== 'custom') return scored;
  const shares = normalizeInteriorShares(input.shares);
  const ids = Object.keys(shares);
  if (ids.length === 0) return scored;
  const named = new Map(scored.map((m) => [m.id, m.name]));
  return ids.map((id) => ({
    id,
    name: named.get(id) || input.nameOf?.(id) || id,
    percentage: shares[id],
  }));
}

/**
 * Divide a pot according to the config.
 *
 * Every returned `percentage` is a share of the whole, so the interior and
 * exterior slices together sum to 100 and their amounts sum to `total`. A zone
 * with no partners pays nothing while others are occupied — the contract
 * redistributes its weight to the placed partners, and the mirror must not
 * show value going where the chain would never send it. Only when no partner
 * is placed at all do zones keep their decay shares, as a structural preview.
 */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = String(item.id ?? '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function allocate(input: {
  total: number | null;
  unit?: string;
  config: AllocationConfig;
  members: AllocationMember[];
  zoned: AllocationPartner[];
}): AllocationResult {
  const config = normalizeAllocationConfig(input.config);
  const total =
    input.total != null && Number.isFinite(input.total) && input.total > 0
      ? input.total
      : null;
  const amountOf = (percentage: number) =>
    total == null ? null : (percentage / 100) * total;

  const interiorShare = config.interiorPercent;
  const exteriorShare = 100 - interiorShare;

  // Interior: split by contribution score. Scores are re-normalized against
  // their own sum so a partial roster (or rounding in the scorer) still fills
  // the interior exactly rather than quietly losing value.
  // Slices are keyed by id downstream; a roster or partner list that repeats
  // an id (replayed graph reads) must not produce two slices for one party.
  const members = uniqueById(input.members ?? []);
  const zoned = uniqueById(input.zoned ?? []);
  const scoreTotal = members.reduce(
    (s, m) => s + (Number.isFinite(m.percentage) && m.percentage > 0 ? m.percentage : 0),
    0,
  );
  const interior: AllocationSlice[] = [];
  if (interiorShare > 0 && members.length > 0 && scoreTotal > 0) {
    for (const member of members) {
      const share = Number.isFinite(member.percentage) && member.percentage > 0
        ? member.percentage
        : 0;
      if (share <= 0) continue;
      const percentage = (share / scoreTotal) * interiorShare;
      interior.push({
        id: member.id,
        label: member.name || member.id,
        percentage,
        amount: amountOf(percentage),
        side: 'interior',
      });
    }
  }

  // Exterior: contract parity. The Bundle contract weighs each PLACED member
  // by its zone's geometric decay and normalizes over those members only —
  // an empty zone pays nothing and the whole exterior pot reaches actual
  // partners (verified against the deployed contract on Sepolia, 2026-08-30).
  // With nobody placed the contract retains the exterior pot, so there is no
  // payout to mirror; the zones then keep their configured decay shares as a
  // structural preview of the split being edited.
  const exterior: AllocationSlice[] = [];
  if (exteriorShare > 0) {
    const decay = config.steepness / 100;
    const weightOf = (zone: number) => Math.pow(decay, zone - 1);
    const placed = zoned.filter((p) => p.zone >= 1 && p.zone <= config.nzones);
    const totalWeight = placed.reduce((s, p) => s + weightOf(p.zone), 0);
    const zonePercentages = calculateZonePercentages(config.steepness, config.nzones);

    for (let z = 0; z < config.nzones; z++) {
      const zone = z + 1;
      const partners = placed.filter((p) => p.zone === zone);
      const each = totalWeight > 0 ? (weightOf(zone) / totalWeight) * exteriorShare : 0;
      const percentage =
        totalWeight > 0
          ? each * partners.length
          : (zonePercentages[z] / 100) * exteriorShare;
      exterior.push({
        id: `zone-${zone}`,
        label: `Zone ${zone}`,
        percentage,
        amount: amountOf(percentage),
        side: 'exterior',
        zone,
        members: partners.map((p) => ({
          id: p.id,
          label: p.name || p.id,
          percentage: each,
          amount: amountOf(each),
          side: 'exterior' as const,
          zone,
        })),
      });
    }
  }

  return {
    config,
    unit: input.unit ?? '',
    total,
    interior,
    exterior,
  };
}
