// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ValueFlows ontology for the REA event stream.
 *
 * Holons records "what happened" as Resource–Event–Agent events. This module
 * pins that stream to the ValueFlows vocabulary (https://valueflo.ws), so an
 * event written by any Holons UI is a `vf:EconomicEvent` that another
 * ValueFlows implementation can read without a translation layer:
 *
 *   - Agents are `vf:Person` (users) or `vf:Organization` (holons, and the
 *     outside world an expense is paid to).
 *   - Every event carries a `vf:Action` from the fixed ValueFlows action
 *     vocabulary — `work`, `transfer`, `transferCustody`, `deliverService`, …
 *   - Quantities are `vf:Measure`s: `{ hasNumericalValue, hasUnit }`.
 *     `resourceQuantity` measures a resource that changes hands;
 *     `effortQuantity` measures labour (`work`) applied to a process.
 *   - `resourceConformsTo` names a `vf:ResourceSpecification` — the *kind* of
 *     thing (appreciation, time, money, credit, a library item), while
 *     `resourceInventoriedAs` names a concrete `vf:EconomicResource` (a
 *     specific library item).
 *   - A quest is a `vf:Process`: work flows *into* it (`inputOf`) and its
 *     completion is a service delivered *out* of it (`outputOf`).
 *   - The holon the event happened in is `inScopeOf`.
 *   - `hasPointInTime` is the observation instant (ISO 8601).
 *
 * The pre-ValueFlows shape (`eventType`, `resource`, `timestamp`, `context`,
 * `status`) is kept on every record as a *projection* of the ValueFlows
 * fields, so events written before this module and readers that still key on
 * `eventType` keep working. `normalizeReaEvent` is the single place the two
 * views are reconciled: it derives whichever side is missing, and is
 * idempotent. Event stores call it on read; the factory calls it on write.
 *
 * Reference: ValueFlows specification, https://valueflo.ws/specification/all_vf/
 * and the action vocabulary, https://valueflo.ws/concepts/actions/
 */

export const VF_NAMESPACE = 'https://w3id.org/valueflows/ont/vf#';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The ValueFlows action vocabulary (`vf:Action` instances), verbatim. */
export type VfAction =
  | 'produce'
  | 'consume'
  | 'use'
  | 'cite'
  | 'work'
  | 'pickup'
  | 'dropoff'
  | 'accept'
  | 'modify'
  | 'combine'
  | 'separate'
  | 'deliverService'
  | 'transferAllRights'
  | 'transferCustody'
  | 'transfer'
  | 'move'
  | 'copy'
  | 'raise'
  | 'lower';

/** `vf:resourceEffect` / `vf:onhandEffect` values. */
export type VfResourceEffect =
  | 'increment'
  | 'decrement'
  | 'decrementIncrement'
  | 'incrementTo'
  | 'noEffect';

/** `vf:inputOutput` values: which side of a process the action sits on. */
export type VfInputOutput = 'input' | 'output' | 'outputInput' | 'notApplicable';

/** One row of the ValueFlows action table. */
export interface VfActionSpec {
  readonly label: string;
  readonly resourceEffect: VfResourceEffect;
  readonly onhandEffect: VfResourceEffect;
  readonly inputOutput: VfInputOutput;
  readonly pairsWith?: VfAction;
  readonly createResource: boolean;
  readonly description: string;
}

/**
 * The ValueFlows action table, as published at
 * https://valueflo.ws/concepts/actions/ — descriptions are the spec's own.
 */
export const VF_ACTIONS: Readonly<Record<VfAction, VfActionSpec>> = Object.freeze({
  produce: {
    label: 'produce',
    resourceEffect: 'increment',
    onhandEffect: 'increment',
    inputOutput: 'output',
    pairsWith: 'consume',
    createResource: true,
    description:
      'A new resource is created in the process, or an addition to an existing stock resource.',
  },
  consume: {
    label: 'consume',
    resourceEffect: 'decrement',
    onhandEffect: 'decrement',
    inputOutput: 'input',
    pairsWith: 'produce',
    createResource: false,
    description:
      'Input ingredient or component is transformed into the output(s) of the process.',
  },
  use: {
    label: 'use',
    resourceEffect: 'decrement',
    onhandEffect: 'decrement',
    inputOutput: 'input',
    createResource: false,
    description:
      'Equipment or tools employed in a process but not consumed; remains available after.',
  },
  cite: {
    label: 'cite',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'input',
    createResource: false,
    description:
      'Resource is input to a process, but is neither used nor consumed, and remains available.',
  },
  work: {
    label: 'work',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'input',
    createResource: false,
    description: 'Labor applied to a process with no identifiable resource involved.',
  },
  pickup: {
    label: 'pickup',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'input',
    pairsWith: 'dropoff',
    createResource: false,
    description:
      'Transported resource enters the process; the same resource appears in the output.',
  },
  dropoff: {
    label: 'dropoff',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'output',
    pairsWith: 'pickup',
    createResource: false,
    description:
      'Transported resource leaves the process; the same resource appeared as input.',
  },
  accept: {
    label: 'accept',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'input',
    pairsWith: 'modify',
    createResource: false,
    description:
      'Input to a process involving repair, modification, testing of a resource.',
  },
  modify: {
    label: 'modify',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'output',
    pairsWith: 'accept',
    createResource: false,
    description:
      'Identified resource that was accepted appears in the output with modifications made.',
  },
  combine: {
    label: 'combine',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'output',
    pairsWith: 'separate',
    createResource: true,
    description:
      'Resource placed in a package or combination; the same resource may appear later when separated.',
  },
  separate: {
    label: 'separate',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'output',
    pairsWith: 'combine',
    createResource: false,
    description: 'Resource removed from a package or combination resource.',
  },
  deliverService: {
    label: 'deliverService',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'outputInput',
    createResource: false,
    description: 'New service is produced and delivered as output of a process.',
  },
  transferAllRights: {
    label: 'transferAllRights',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'notApplicable',
    createResource: false,
    description:
      'Gives full rights and responsibilities to another agent, without physical custody.',
  },
  transferCustody: {
    label: 'transferCustody',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'notApplicable',
    createResource: false,
    description:
      'Gives physical custody and control to another agent, without involving rights.',
  },
  transfer: {
    label: 'transfer',
    resourceEffect: 'decrementIncrement',
    onhandEffect: 'decrementIncrement',
    inputOutput: 'notApplicable',
    createResource: false,
    description: 'Full rights and responsibilities plus physical custody.',
  },
  move: {
    label: 'move',
    resourceEffect: 'noEffect',
    onhandEffect: 'noEffect',
    inputOutput: 'notApplicable',
    createResource: false,
    description:
      'Changes resource location without transferring agent rights or custodianship.',
  },
  copy: {
    label: 'copy',
    resourceEffect: 'incrementTo',
    onhandEffect: 'incrementTo',
    inputOutput: 'notApplicable',
    createResource: true,
    description:
      'New resource is created for the receiver, an exact copy of the original provider resource.',
  },
  raise: {
    label: 'raise',
    resourceEffect: 'increment',
    onhandEffect: 'increment',
    inputOutput: 'notApplicable',
    createResource: false,
    description:
      'Adjusts quantity upward for system initialization or inventory correction.',
  },
  lower: {
    label: 'lower',
    resourceEffect: 'decrement',
    onhandEffect: 'decrement',
    inputOutput: 'notApplicable',
    createResource: false,
    description: 'Adjusts quantity downward for inventory correction.',
  },
});

export function isVfAction(value: unknown): value is VfAction {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VF_ACTIONS, value);
}

// ---------------------------------------------------------------------------
// Measures, units, agents, resource specifications
// ---------------------------------------------------------------------------

/** `vf:Measure` — a number and the unit it is expressed in. */
export interface VfMeasure {
  hasNumericalValue: number;
  /**
   * `vf:hasUnit`. Holons uses the OM (Ontology of units of Measure) label
   * where one exists — `hour`, `one` (the dimensionless count) — and the
   * lowercase ISO-4217-style code for money (`eur`, `usd`) and community
   * currencies (`credits`), which OM does not define.
   */
  hasUnit: string;
}

/** OM unit for a plain count of things ("one", "each"). */
export const VF_UNIT_ONE = 'one';
/** OM unit for hours of effort. */
export const VF_UNIT_HOUR = 'hour';

/** `vf:Agent` subclasses. */
export type VfAgentType = 'Person' | 'Organization' | 'EcologicalAgent';

/** Pre-ValueFlows agent kinds, kept as a projection of `agentType`. */
export type LegacyAgentType = 'user' | 'holon' | 'external';

/** A `vf:Agent` reference as carried on an event. */
export interface VfAgent {
  id: string;
  /** `vf:Person` | `vf:Organization` | `vf:EcologicalAgent`. */
  agentType: VfAgentType;
  name?: string;
  /** Legacy projection of `agentType` (`user` ↔ Person, `holon`/`external` ↔ Organization). */
  type?: LegacyAgentType | string;
  [key: string]: unknown;
}

/** `vf:ResourceSpecification` — the kind of resource an event moves. */
export interface VfResourceSpecification {
  id: string;
  name: string;
  /** `vf:defaultUnitOfResource` — unit for `resourceQuantity`. */
  defaultUnitOfResource?: string;
  /** `vf:defaultUnitOfEffort` — unit for `effortQuantity`. */
  defaultUnitOfEffort?: string;
  /** `vf:mediumOfExchange` — true for money and credits. */
  mediumOfExchange: boolean;
  /** `vf:substitutable` — true when any unit is as good as any other. */
  substitutable: boolean;
  /** `vf:resourceClassifiedAs` — tags. */
  resourceClassifiedAs: string[];
}

/** The resource kinds Holons records, keyed by the legacy `resource.type`. */
export type HolonsResourceKind = 'appreciation' | 'time' | 'money' | 'credit' | 'item';

/** `vf:ResourceSpecification`s for every resource kind Holons records. */
export const RESOURCE_SPECIFICATIONS: Readonly<
  Record<HolonsResourceKind, VfResourceSpecification>
> = Object.freeze({
  appreciation: {
    id: 'appreciation',
    name: 'Appreciation',
    defaultUnitOfResource: VF_UNIT_ONE,
    mediumOfExchange: false,
    substitutable: false,
    resourceClassifiedAs: ['appreciation'],
  },
  time: {
    id: 'time',
    name: 'Time',
    defaultUnitOfEffort: VF_UNIT_HOUR,
    mediumOfExchange: false,
    substitutable: true,
    resourceClassifiedAs: ['labour', 'time'],
  },
  money: {
    id: 'money',
    name: 'Money',
    mediumOfExchange: true,
    substitutable: true,
    resourceClassifiedAs: ['money'],
  },
  credit: {
    id: 'credit',
    name: 'Mutual credit',
    defaultUnitOfResource: 'credits',
    mediumOfExchange: true,
    substitutable: true,
    resourceClassifiedAs: ['mutual-credit'],
  },
  item: {
    id: 'item',
    name: 'Library item',
    defaultUnitOfResource: VF_UNIT_ONE,
    mediumOfExchange: false,
    substitutable: false,
    resourceClassifiedAs: ['library-item'],
  },
});

export function isHolonsResourceKind(value: unknown): value is HolonsResourceKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(RESOURCE_SPECIFICATIONS, value)
  );
}

// ---------------------------------------------------------------------------
// EconomicEvent
// ---------------------------------------------------------------------------

/**
 * A `vf:EconomicEvent` as Holons stores it.
 *
 * Property names are ValueFlows' own. The `legacy*`-free fields at the bottom
 * (`eventType`, `resource`, `timestamp`, `context`, `status`) are the
 * pre-ValueFlows projection and are always present on a normalized record.
 */
export interface EconomicEvent {
  id: string;

  // --- ValueFlows ---------------------------------------------------------
  /** `vf:action`. */
  action: VfAction;
  /** `vf:provider`. */
  provider: VfAgent;
  /** `vf:receiver`. */
  receiver: VfAgent;
  /** `vf:resourceQuantity` — amount of resource moved or produced. */
  resourceQuantity?: VfMeasure;
  /** `vf:effortQuantity` — amount of labour applied (`work`). */
  effortQuantity?: VfMeasure;
  /** `vf:resourceConformsTo` — id of a `RESOURCE_SPECIFICATIONS` entry. */
  resourceConformsTo?: string;
  /** `vf:resourceInventoriedAs` — the concrete resource (e.g. a library item id). */
  resourceInventoriedAs?: string;
  /** `vf:resourceClassifiedAs` — tags on this event's resource. */
  resourceClassifiedAs?: string[];
  /** `vf:hasPointInTime` — ISO 8601 instant. */
  hasPointInTime: string;
  /** `vf:inScopeOf` — the holon (an Organization) the event happened in. */
  inScopeOf?: string;
  /** `vf:inputOf` — the quest (a `vf:Process`) this event feeds. */
  inputOf?: string;
  /** `vf:outputOf` — the quest (a `vf:Process`) this event comes out of. */
  outputOf?: string;
  /** `vf:note`. */
  note?: string;

  // --- Legacy projection -------------------------------------------------
  /** Holons event kind, e.g. `quest:completed`. Maps 1:1 to a ValueFlows action. */
  eventType: string;
  resource: {
    type?: string;
    quantity?: number;
    unit?: string;
    resourceId?: string | number;
    [key: string]: unknown;
  };
  /** Wall-clock ms; mirrors `hasPointInTime`. */
  timestamp: number;
  context: {
    holonId?: string;
    questId?: string | null;
    itemId?: string | number;
    expenseId?: string;
    note?: string | null;
    [key: string]: unknown;
  };
  /** `confirmed` | `pending` — Holons' own settlement flag. */
  status?: string;

  [key: string]: unknown;
}

/** How a Holons event kind maps onto the ValueFlows vocabulary. */
export interface EventKindMapping {
  action: VfAction;
  /** Which measure the legacy `resource.quantity` populates. */
  measure: 'resourceQuantity' | 'effortQuantity';
  resourceConformsTo: HolonsResourceKind;
  /** Which process link the legacy `context.questId` populates, if any. */
  process?: 'inputOf' | 'outputOf';
  resourceClassifiedAs?: string[];
}

/**
 * Every event kind Holons emits, mapped to ValueFlows.
 *
 *  - Initiating a quest and logging hours are `work` flowing *into* the quest
 *    process; completing it is a service delivered *out* of the process.
 *  - Appreciation is a `transfer` of an appreciation resource between people.
 *  - Money and credits change hands by `transfer`; an expense's shares are the
 *    transfers the sharers owe the payer.
 *  - Borrowing and returning a library item is `transferCustody`: the borrower
 *    holds the thing, the lender keeps the rights. A deposit is the same
 *    action on credits — the holon holds them, the borrower still owns them.
 */
export const EVENT_KIND_MAPPINGS: Readonly<Record<string, EventKindMapping>> = Object.freeze({
  'quest:initiated': {
    action: 'work',
    measure: 'effortQuantity',
    resourceConformsTo: 'appreciation',
    process: 'inputOf',
    resourceClassifiedAs: ['initiative'],
  },
  'quest:completed': {
    action: 'deliverService',
    measure: 'resourceQuantity',
    resourceConformsTo: 'appreciation',
    process: 'outputOf',
    resourceClassifiedAs: ['completion'],
  },
  'quest:time_logged': {
    action: 'work',
    measure: 'effortQuantity',
    resourceConformsTo: 'time',
    process: 'inputOf',
  },
  'appreciation:sent': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'appreciation',
    process: 'inputOf',
    resourceClassifiedAs: ['kudos'],
  },
  'appreciation:received': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'appreciation',
    process: 'inputOf',
    resourceClassifiedAs: ['kudos'],
  },
  'expense:paid': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'money',
    resourceClassifiedAs: ['expense'],
  },
  'expense:share': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'money',
    resourceClassifiedAs: ['expense-share'],
  },
  'transfer:direct': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'money',
  },
  'item:borrowed': {
    action: 'transferCustody',
    measure: 'resourceQuantity',
    resourceConformsTo: 'item',
    resourceClassifiedAs: ['borrow'],
  },
  'item:returned': {
    action: 'transferCustody',
    measure: 'resourceQuantity',
    resourceConformsTo: 'item',
    resourceClassifiedAs: ['return'],
  },
  'item:fee_paid': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'credit',
    resourceClassifiedAs: ['library-fee'],
  },
  'item:deposit_held': {
    action: 'transferCustody',
    measure: 'resourceQuantity',
    resourceConformsTo: 'credit',
    resourceClassifiedAs: ['deposit'],
  },
  'item:deposit_returned': {
    action: 'transferCustody',
    measure: 'resourceQuantity',
    resourceConformsTo: 'credit',
    resourceClassifiedAs: ['deposit'],
  },
  'credit:issued': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'credit',
    resourceClassifiedAs: ['issue'],
  },
  'credit:transfer': {
    action: 'transfer',
    measure: 'resourceQuantity',
    resourceConformsTo: 'credit',
  },
});

/**
 * Mapping for an event kind. Unknown kinds fall back on the resource type:
 * time is `work`, anything else is a `transfer` of that resource.
 */
export function mappingForEventKind(
  eventType: string | undefined,
  resourceType?: string,
): EventKindMapping {
  const known = eventType ? EVENT_KIND_MAPPINGS[eventType] : undefined;
  if (known) return known;
  const kind: HolonsResourceKind = isHolonsResourceKind(resourceType) ? resourceType : 'money';
  if (kind === 'time') {
    return { action: 'work', measure: 'effortQuantity', resourceConformsTo: 'time' };
  }
  return { action: 'transfer', measure: 'resourceQuantity', resourceConformsTo: kind };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const LEGACY_TO_VF_AGENT: Record<string, VfAgentType> = {
  user: 'Person',
  person: 'Person',
  holon: 'Organization',
  external: 'Organization',
  organization: 'Organization',
};

const VF_TO_LEGACY_AGENT: Record<VfAgentType, LegacyAgentType> = {
  Person: 'user',
  Organization: 'holon',
  EcologicalAgent: 'external',
};

/**
 * Fill in whichever of `agentType` / `type` an agent reference is missing.
 * An `external` organization stays `external` on the legacy side so expense
 * balances keep ignoring it.
 */
export function normalizeAgent(agent: Record<string, unknown> | undefined | null): VfAgent {
  const a = { ...(agent ?? {}) } as Record<string, unknown>;
  const id = a.id == null ? '' : String(a.id);
  const legacy = typeof a.type === 'string' ? a.type : undefined;
  let agentType: VfAgentType | undefined =
    a.agentType === 'Person' || a.agentType === 'Organization' || a.agentType === 'EcologicalAgent'
      ? (a.agentType as VfAgentType)
      : undefined;
  if (!agentType) agentType = (legacy && LEGACY_TO_VF_AGENT[legacy]) || 'Person';
  const type = legacy ?? VF_TO_LEGACY_AGENT[agentType];
  return { ...a, id, agentType, type, ...(a.name != null ? { name: String(a.name) } : {}) };
}

// ---------------------------------------------------------------------------
// Normalization: legacy ⇄ ValueFlows
// ---------------------------------------------------------------------------

/** Unit for a legacy `resource.unit` given the resource kind. */
function vfUnitFor(kind: HolonsResourceKind, legacyUnit: unknown): string {
  const unit = legacyUnit == null ? '' : String(legacyUnit);
  switch (kind) {
    case 'time':
      return VF_UNIT_HOUR;
    case 'money':
      return unit || 'money';
    case 'credit':
      return unit || 'credits';
    case 'appreciation':
    case 'item':
    default:
      // Legacy units here are labels ('initiative', 'kudos', or the item id),
      // not units of measure — the quantity is a count.
      return VF_UNIT_ONE;
  }
}

function toIso(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : Date.now()).toISOString();
}

function toMs(iso: unknown): number | undefined {
  if (typeof iso !== 'string') return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Reconcile the ValueFlows and legacy views of an event, filling in whichever
 * is missing. Idempotent: a normalized event normalizes to itself. Returns a
 * new object; the input is not mutated.
 *
 * Precedence when both views are present and disagree: the legacy projection
 * is the source of truth for the *kind* (`eventType`, `resource.type`), since
 * that is what every reader keys on; the ValueFlows measures are derived from
 * `resource.quantity` unless already set.
 */
export function normalizeReaEvent<T extends Record<string, unknown>>(input: T): T & EconomicEvent {
  const e = { ...input } as Record<string, unknown>;

  const resource = { ...((e.resource as Record<string, unknown>) ?? {}) };
  const context = { ...((e.context as Record<string, unknown>) ?? {}) };

  // --- kind ------------------------------------------------------------
  const conformsToHint = typeof e.resourceConformsTo === 'string' ? e.resourceConformsTo : undefined;
  if (resource.type == null && conformsToHint) resource.type = conformsToHint;
  const resourceType = typeof resource.type === 'string' ? resource.type : undefined;
  const eventType = typeof e.eventType === 'string' ? e.eventType : undefined;
  const mapping = mappingForEventKind(eventType, resourceType);
  const kind: HolonsResourceKind = isHolonsResourceKind(resourceType)
    ? resourceType
    : mapping.resourceConformsTo;

  if (!isVfAction(e.action)) e.action = mapping.action;
  if (!eventType) e.eventType = `${kind}:${String(e.action)}`;
  if (resource.type == null) resource.type = kind;
  if (typeof e.resourceConformsTo !== 'string') e.resourceConformsTo = kind;

  // --- agents ----------------------------------------------------------
  e.provider = normalizeAgent(e.provider as Record<string, unknown> | undefined);
  e.receiver = normalizeAgent(e.receiver as Record<string, unknown> | undefined);

  // --- quantities ------------------------------------------------------
  const existingResourceQ = e.resourceQuantity as VfMeasure | undefined;
  const existingEffortQ = e.effortQuantity as VfMeasure | undefined;
  const legacyQuantity =
    typeof resource.quantity === 'number' && Number.isFinite(resource.quantity)
      ? resource.quantity
      : undefined;

  if (!existingResourceQ && !existingEffortQ) {
    if (legacyQuantity !== undefined) {
      const measure: VfMeasure = {
        hasNumericalValue: legacyQuantity,
        hasUnit: vfUnitFor(kind, resource.unit),
      };
      e[mapping.measure] = measure;
    }
  } else if (legacyQuantity === undefined) {
    const m = existingResourceQ ?? existingEffortQ;
    if (m) {
      resource.quantity = m.hasNumericalValue;
      if (resource.unit == null) resource.unit = m.hasUnit;
    }
  }

  if (resource.resourceId != null && typeof e.resourceInventoriedAs !== 'string') {
    e.resourceInventoriedAs = String(resource.resourceId);
  } else if (typeof e.resourceInventoriedAs === 'string' && resource.resourceId == null && kind === 'item') {
    resource.resourceId = e.resourceInventoriedAs;
  }

  if (!Array.isArray(e.resourceClassifiedAs)) {
    const tags = [
      ...RESOURCE_SPECIFICATIONS[kind].resourceClassifiedAs,
      ...(mapping.resourceClassifiedAs ?? []),
    ];
    e.resourceClassifiedAs = [...new Set(tags)];
  }

  // --- time ------------------------------------------------------------
  const legacyMs =
    typeof e.timestamp === 'number' && Number.isFinite(e.timestamp) ? e.timestamp : undefined;
  const vfMs = toMs(e.hasPointInTime);
  if (legacyMs === undefined && vfMs !== undefined) e.timestamp = vfMs;
  if (legacyMs === undefined && vfMs === undefined) e.timestamp = Date.now();
  if (vfMs === undefined) e.hasPointInTime = toIso(e.timestamp as number);

  // --- scope & process -------------------------------------------------
  if (typeof e.inScopeOf !== 'string' && context.holonId != null) {
    e.inScopeOf = String(context.holonId);
  } else if (typeof e.inScopeOf === 'string' && context.holonId == null) {
    context.holonId = e.inScopeOf;
  }

  const questId = context.questId == null ? undefined : String(context.questId);
  if (mapping.process && questId && typeof e[mapping.process] !== 'string') {
    e[mapping.process] = questId;
  }
  if (context.questId === undefined) {
    const linked = e.inputOf ?? e.outputOf;
    context.questId = typeof linked === 'string' ? linked : null;
  }

  // --- note ------------------------------------------------------------
  if (typeof e.note !== 'string' && typeof context.note === 'string') e.note = context.note;
  else if (typeof e.note === 'string' && context.note == null) context.note = e.note;

  e.resource = resource;
  e.context = context;
  if (e.status == null) e.status = 'confirmed';

  return e as T & EconomicEvent;
}

/** True when the record already carries every required ValueFlows field. */
export function isEconomicEvent(value: unknown): value is EconomicEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    isVfAction(e.action) &&
    !!e.provider &&
    typeof (e.provider as VfAgent).id === 'string' &&
    !!e.receiver &&
    typeof (e.receiver as VfAgent).id === 'string' &&
    typeof e.hasPointInTime === 'string' &&
    (isMeasure(e.resourceQuantity) || isMeasure(e.effortQuantity))
  );
}

function isMeasure(value: unknown): value is VfMeasure {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as VfMeasure).hasNumericalValue === 'number' &&
    typeof (value as VfMeasure).hasUnit === 'string'
  );
}

/**
 * The problems that stop a record from being a `vf:EconomicEvent`; empty
 * when it is one. Used by the store to refuse malformed writes.
 */
export function economicEventProblems(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object') return ['not an object'];
  const e = value as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id) problems.push('missing id');
  if (!isVfAction(e.action)) problems.push(`action ${JSON.stringify(e.action)} is not a ValueFlows action`);
  if (!e.provider || (e.provider as VfAgent).id == null) problems.push('missing provider');
  if (!e.receiver || (e.receiver as VfAgent).id == null) problems.push('missing receiver');
  if (typeof e.hasPointInTime !== 'string' || !Number.isFinite(Date.parse(e.hasPointInTime))) {
    problems.push('hasPointInTime is not an ISO 8601 instant');
  }
  if (!isMeasure(e.resourceQuantity) && !isMeasure(e.effortQuantity)) {
    problems.push('needs a resourceQuantity or effortQuantity Measure');
  }
  return problems;
}

/**
 * The measure that carries this event's amount — `effortQuantity` for
 * labour, `resourceQuantity` for everything else.
 */
export function eventMeasure(event: Pick<EconomicEvent, 'resourceQuantity' | 'effortQuantity'>): VfMeasure | undefined {
  return event.effortQuantity ?? event.resourceQuantity;
}

/**
 * Export a record as JSON-LD carrying only ValueFlows terms, for
 * interoperability with other ValueFlows implementations. The legacy
 * projection is left out.
 */
export function toValueFlowsJsonLd(event: EconomicEvent): Record<string, unknown> {
  const agent = (a: VfAgent) => ({
    '@id': a.id,
    '@type': `vf:${a.agentType}`,
    ...(a.name ? { name: a.name } : {}),
  });
  const measure = (m?: VfMeasure) =>
    m ? { '@type': 'vf:Measure', 'vf:hasNumericalValue': m.hasNumericalValue, 'vf:hasUnit': m.hasUnit } : undefined;
  const out: Record<string, unknown> = {
    '@context': { vf: VF_NAMESPACE },
    '@id': event.id,
    '@type': 'vf:EconomicEvent',
    'vf:action': event.action,
    'vf:provider': agent(event.provider),
    'vf:receiver': agent(event.receiver),
    'vf:hasPointInTime': event.hasPointInTime,
  };
  const rq = measure(event.resourceQuantity);
  const eq = measure(event.effortQuantity);
  if (rq) out['vf:resourceQuantity'] = rq;
  if (eq) out['vf:effortQuantity'] = eq;
  if (event.resourceConformsTo) out['vf:resourceConformsTo'] = event.resourceConformsTo;
  if (event.resourceInventoriedAs) out['vf:resourceInventoriedAs'] = event.resourceInventoriedAs;
  if (event.resourceClassifiedAs?.length) out['vf:resourceClassifiedAs'] = event.resourceClassifiedAs;
  if (event.inScopeOf) out['vf:inScopeOf'] = event.inScopeOf;
  if (event.inputOf) out['vf:inputOf'] = event.inputOf;
  if (event.outputOf) out['vf:outputOf'] = event.outputOf;
  if (event.note) out['vf:note'] = event.note;
  return out;
}
