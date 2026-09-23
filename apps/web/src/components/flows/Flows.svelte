<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Value Flows — the dashboard twin of the kiosk's Flows board, built the way
  // the kiosk builds a board: one column, one pill to switch panels, cards a
  // thumb can tap, and sheets that slide up instead of tables that scroll
  // sideways. Every panel is a different reading of the same core domain, so
  // none of them can disagree.
  //
  //   MOVEMENT   what came in and went out — expenses lens, REA stream and
  //              (when a collective is configured) OpenCollective, as a Sankey.
  //   BALANCES   the mutual credit behind the expenses lens: who is owed, who
  //              owes, the fewest transfers that square everyone, and the way
  //              to add an expense or record a repayment.
  //   ALLOCATION where the holon's resources are committed — the interior /
  //              exterior split Flow Management pushes on-chain, editable here
  //              off-chain.
  //   LEDGER     every entry the diagrams are drawn from, one row each.
  //
  // Distinct from /[id]/flow, the concentric editor: reading here needs no
  // wallet, and only pushing the split on-chain asks for one.
  //
  // Units never mix: no exchange rates exist in this repo, so each unit gets
  // its own track and each currency its own balance sheet.

  import { onDestroy, onMount, getContext, tick } from "svelte";
  import type { HoloSphere } from "holosphere";
  import { ID } from "../../dashboard/store";
  import { telegramUser } from "$lib/stores/telegram";
  import { nostrPublicKey } from "$lib/stores/nostr";
  import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
  import { REAEventStore, type REAEvent } from "@holons/core/rea";
  import {
    REAAggregator,
    computeHolonUserScores,
    loadEquation,
    extractReaUsers,
    DEFAULT_EQUATION,
    type ScoreEquation,
  } from "@holons/core/scoring";
  import {
    UNATTRIBUTED_ID,
    allocate,
    allocationToGraph,
    partyIdOf,
    segmentTotal,
    buildFundUsage,
    buildLedger,
    buildPeopleFlows,
    buildValueFlows,
    chordBreakdown,
    layoutChord,
    DEFAULT_ALLOCATION_CONFIG,
    HUB_ID,
    layoutSankey,
    ledgerTrackKey,
    nodeBreakdown,
    normalizeInteriorShares,
    readAllocationConfig,
    readInteriorShares,
    readCollectiveSlug,
    readZoneAssignments,
    readZonePeople,
    resolveInteriorMembers,
    rightsTotal,
    toAllocationPartners,
    usageOf,
    usageTotals,
    usageUnits,
    FLOW_CLAIMS_LENS,
    buildClaim,
    buildClaimVerdict,
    buildPayout,
    foldClaimsFromLenses,
    type Claim,
    type AllocationSlice,
    type BreakdownRow,
    type ChordGroup,
    type FundUsageParty,
    type PeopleFlowTrack,
    type InteriorShares,
    type LedgerEntry,
    type LedgerSource,
    type OpenCollectiveSnapshot,
    type SankeyLayoutLink,
    type SankeyLayoutNode,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import { getFederationSnapshot } from "@holons/core/federation";
  import {
    MEMBERS_LENS,
    POLICY_LENS,
    POLICY_ROLES,
    importPartnerLogs,
    normalizePolicy,
    policyRecord,
    samePolicy,
    type PartnerImport,
    type Policy,
    type Role,
    readMembersLog,
    type LogEvent,
    type MembershipEnvelope,
  } from "@holons/core/protocol";
  import { attestationsFrom, SHIFT_IDENTITY_LENS, type IdentityAttestation } from "@holons/core/shifts";
  import { buildNameMap } from "@holons/core/identity";
  import {
    expenseCurrencies,
    normalizeCurrency,
    participantIds,
    type Expense,
  } from "@holons/core/expenses";
  import SankeyChart from "./SankeyChart.svelte";
  import ChordChart from "./ChordChart.svelte";
  import AllocationEditor from "./AllocationEditor.svelte";
  import PillSwitch from "./PillSwitch.svelte";
  import Sheet from "./Sheet.svelte";
  import BalancesPanel from "./BalancesPanel.svelte";
  import LedgerPanel from "./LedgerPanel.svelte";
  import { dateFmt, formatter, trackKey, trackLabel, type Formatter } from "./format";

  const holosphere = getContext("holosphere") as HoloSphere;

  const WINDOWS = [
    { id: "30", label: "30 days", days: 30 },
    { id: "90", label: "90 days", days: 90 },
    { id: "all", label: "All time", days: null },
  ] as const;

  type Panel = "movement" | "people" | "balances" | "allocation" | "ledger";
  const PANELS: { id: Panel; label: string; glyph: string }[] = [
    { id: "movement", label: "Movement", glyph: "⇄" },
    { id: "people", label: "Between people", glyph: "◎" },
    { id: "balances", label: "Balances", glyph: "⚖" },
    { id: "allocation", label: "Fund allocation rights", glyph: "◔" },
    { id: "ledger", label: "Ledger", glyph: "☰" },
  ];

  // What the person last looked at, per device — a board remembers its tab.
  let prefs = loadFilters("flows", { panel: "movement", currency: "", window: "90" });
  $: saveFilters("flows", prefs);

  let holonID = "";
  let loading = true;
  let events: REAEvent[] = [];
  let expenses: Expense[] = [];
  let settings: any = null;
  let usersById: Record<string, any> = {};
  let collective: OpenCollectiveSnapshot | null = null;
  let collectiveError = "";
  let equation: ScoreEquation = DEFAULT_EQUATION;
  let partners: { id: string; name: string; zone: number }[] = [];
  let memberShares: { id: string; name: string; percentage: number }[] = [];

  let trackId = "";

  let expensesSub: any;
  let usersSub: any;
  let settingsSub: any;
  let reaSub: any;
  let rescoreTimer: ReturnType<typeof setTimeout> | null = null;

  // ── The signed claims log ───────────────────────────────────────────────
  // A claim is a signed, append-only entry in the holon's own log (kind 1808).
  // This instance signs with the member's own derived key, so `append` is
  // enough; whether an entry counts is the fold's call (core), from the
  // membership log, settings, users and the identity directory — the same
  // fold the kiosk and the bot run.
  let claimEntries = new Map<string, LogEvent<unknown>>();
  let policyEntries = new Map<string, LogEvent<unknown>>();
  let membersLog: MembershipEnvelope[] = [];
  let attestations: IdentityAttestation[] = [];
  let claimImports: PartnerImport[] = [];
  let claimsOffs: Array<() => void> = [];
  let claimsBoundTo = "";
  let claimAmount = "";
  let claimMemo = "";
  let claimBusy = false;
  let claimError = "";
  $: if (holonID && holonID !== claimsBoundTo) bindClaims(holonID);
  function bindClaims(id: string) {
    unbindClaims();
    claimsBoundTo = id;
    claimEntries = new Map();
    policyEntries = new Map();
    membersLog = [];
    claimsOffs.push(
      holosphere.subscribeLog(id, FLOW_CLAIMS_LENS, (e) => {
        if (claimsBoundTo !== id) return;
        claimEntries.set(e.id, e as LogEvent<unknown>);
        claimEntries = claimEntries;
      }),
    );
    claimsOffs.push(
      holosphere.subscribeLog(id, POLICY_LENS, (e) => {
        if (claimsBoundTo !== id) return;
        policyEntries.set(e.id, e as LogEvent<unknown>);
        policyEntries = policyEntries;
        void refreshClaimImports(id);
      }),
    );
    void (async () => {
      try {
        await holosphere.getAll(id, MEMBERS_LENS);
        const log = await readMembersLog(holosphere, id);
        if (claimsBoundTo === id) membersLog = log;
      } catch {
        /* not founded yet */
      }
      try {
        const dir = (await holosphere.getAllGlobal(SHIFT_IDENTITY_LENS)) as never[];
        if (claimsBoundTo === id) attestations = attestationsFrom(dir || []);
      } catch {
        /* no directory */
      }
    })();
  }
  // The partners the policy pins are read by their own rules (their log,
  // their membership, their policy); re-read when the policy log moves.
  let importsFor = "";
  async function refreshClaimImports(id: string) {
    const key = [...policyEntries.keys()].sort().join(",");
    if (key === importsFor) return;
    importsFor = key;
    await tick(); // claimsCtx has folded the new policy entries
    try {
      const next = claimsCtx ? await importPartnerLogs(holosphere, FLOW_CLAIMS_LENS, claimsCtx.policy) : [];
      if (claimsBoundTo === id) claimImports = next;
    } catch {
      claimImports = [];
    }
  }
  function unbindClaims() {
    for (const off of claimsOffs) off();
    claimsOffs = [];
    claimsBoundTo = "";
    claimImports = [];
    importsFor = "";
  }
  onDestroy(unbindClaims);
  $: claimsCtx = holonID
    ? foldClaimsFromLenses({
        holonId: holonID,
        entries: [...claimEntries.values()],
        policyEntries: [...policyEntries.values()],
        membersLog,
        settings,
        users: Object.values(usersById),
        attestations,
        imports: claimImports,
      })
    : null;
  $: myLogRole = claimsCtx
    ? claimsCtx.actors.roleAt(holosphere.currentPubkey, Math.floor(Date.now() / 1000))
    : null;
  $: canAttest = !!(claimsCtx && myLogRole && claimsCtx.policy.attesters.includes(myLogRole));
  $: claimsProvisional = claimsCtx?.folded.source === "bootstrap";
  $: claimUnit = collective?.currency ?? usage?.unit ?? "";

  // ── The claims policy ───────────────────────────────────────────────────
  // A draft of the rule in force; "Set the rules" appends it to the policy
  // log. This instance signs with the member's derived key: an admin's entry
  // counts, anyone else's is recorded and ignored — said up front.
  let rulesOpen = false;
  let ruleAuthors: Role[] = [];
  let ruleAttesters: Role[] = [];
  let ruleQuorum = 0;
  let ruleConflict: Policy["conflict"] = "earliest";
  let rulePartners: Record<string, string> = {};
  let rulesSeeded = "";
  // Seed the draft from the rule in force whenever a different one lands.
  $: if (claimsCtx) seedRules(claimsCtx.policy);
  function seedRules(rule: Policy) {
    const sig = JSON.stringify(normalizePolicy(rule));
    if (sig === rulesSeeded) return;
    rulesSeeded = sig;
    const p = normalizePolicy(rule);
    ruleAuthors = p.authors;
    ruleAttesters = p.attesters;
    ruleQuorum = p.quorum;
    ruleConflict = p.conflict;
    rulePartners = { ...p.partners };
  }
  $: ruleDraft = { authors: ruleAuthors, attesters: ruleAttesters, quorum: ruleQuorum, conflict: ruleConflict, partners: rulePartners } satisfies Partial<Policy>;
  $: rulesUnchanged = samePolicy(ruleDraft, claimsCtx?.policy ?? null);
  $: rulesCanSign = myLogRole === "admin";
  function toggleRole(list: "authors" | "attesters", role: Role) {
    const cur = list === "authors" ? ruleAuthors : ruleAttesters;
    const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
    if (!next.length) return;
    if (list === "authors") ruleAuthors = next;
    else ruleAttesters = next;
  }
  // Each partner's published holon key, so a pin has something to pin.
  let partnerKeys: Record<string, string | null> = {};
  async function loadPartnerKeys() {
    const out: Record<string, string | null> = {};
    await Promise.all(
      partners.map(async (p) => {
        try {
          const doc = (await holosphere.get(p.id, "settings", p.id)) as { holonPubkey?: unknown } | null;
          const key = String(doc?.holonPubkey ?? "");
          out[p.id] = /^[0-9a-f]{64}$/i.test(key) ? key.toLowerCase() : null;
        } catch {
          out[p.id] = null;
        }
      }),
    );
    partnerKeys = out;
  }
  function togglePartner(id: string) {
    const key = partnerKeys[id];
    if (!key) return;
    const next = { ...rulePartners };
    if (next[id]) delete next[id];
    else next[id] = key;
    rulePartners = next;
  }
  async function saveRules() {
    if (!holonID || claimBusy || !rulesCanSign || rulesUnchanged) return;
    claimBusy = true;
    claimError = "";
    try {
      const a = policyRecord(FLOW_CLAIMS_LENS, ruleDraft);
      await holosphere.append(holonID, POLICY_LENS, a.item, { refs: a.refs });
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
    } finally {
      claimBusy = false;
    }
  }
  const claimStatusLabel: Record<Claim["status"], string> = {
    approved: "Approved",
    pending: "Awaiting attestation",
    disputed: "Disputed",
    over: "Over the right",
    conflict: "Conflict",
    settled: "Paid",
    rejected: "Not counted",
  };
  const partyName = (id: string) =>
    usersById[id]?.first_name || usersById[id]?.username || partners.find((p) => p.id === id)?.name || id;
  async function submitClaim() {
    if (!holonID || !selfId || claimBusy) return;
    const amount = Number(String(claimAmount).replace(",", "."));
    if (!(amount > 0) || !claimUnit) return;
    claimBusy = true;
    claimError = "";
    try {
      const a = buildClaim({ party: selfId, amount, unit: claimUnit, memo: claimMemo.trim() || undefined });
      await holosphere.append(holonID, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
      claimAmount = "";
      claimMemo = "";
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
    } finally {
      claimBusy = false;
    }
  }
  async function judgeClaim(c: Claim, verdict: "attest" | "dispute") {
    if (!holonID || claimBusy) return;
    claimBusy = true;
    claimError = "";
    try {
      const a = buildClaimVerdict(c.id, verdict);
      await holosphere.append(holonID, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
    } finally {
      claimBusy = false;
    }
  }
  async function markPaid(c: Claim) {
    if (!holonID || claimBusy) return;
    claimBusy = true;
    claimError = "";
    try {
      const a = buildPayout({ claimId: c.id, party: c.party, amount: c.amount, unit: c.unit });
      await holosphere.append(holonID, FLOW_CLAIMS_LENS, a.item, { refs: a.refs });
    } catch (err) {
      claimError = err instanceof Error ? err.message : String(err);
    } finally {
      claimBusy = false;
    }
  }

  // ---- Live lens state ------------------------------------------------------
  //
  // Every lens this component listens to is held as a keyed map and folded in
  // from the subscription payload itself. No handler reads the lens it is
  // listening to: a read makes the store re-emit that lens, the re-emission re-fires
  // the handler, and the handler reads again — a loop that never settles, it
  // only paces itself at whatever the debounce is. One pass here rebuilds the
  // event list, the name map, both Sankeys and the entire ledger, so the tab
  // ends up doing that several times a second for as long as the page is open
  // and eventually runs out of room.
  //
  // The store may re-emit value-identical records on ordinary relay traffic,
  // so each map also keeps a signature per id and drops echoes that carry no
  // change — otherwise the same rebuild happens for records that did not move.
  const eventsById = new Map<string, REAEvent>();
  const eventSigs = new Map<string, string>();
  const userSigs = new Map<string, string>();
  let expensesSig = "";
  let settingsSig = "";
  let loadedSlug = "";
  let eventsDirty = false;
  let rescoreDue = false;
  // The federation record is a global, not a lens, so there is nothing to
  // listen to — a slow poll keeps a newly linked partner from needing a reload.
  let federationTimer: ReturnType<typeof setInterval> | null = null;
  const FEDERATION_POLL_MS = 60_000;

  $: panel = (PANELS.some((p) => p.id === prefs.panel) ? prefs.panel : "movement") as Panel;
  $: windowDays = WINDOWS.find((w) => w.id === prefs.window)?.days ?? 90;

  $: if ($ID && $ID !== holonID) void bind($ID);

  // The viewer: Telegram first, a Nostr key as fallback — the same order the
  // rest of the dashboard resolves "me" in.
  $: selfId = $telegramUser ? String($telegramUser.id) : ($nostrPublicKey ?? null);

  // Priority order is reaUsers < profiles, so a users-lens profile wins over
  // whatever username the event stream happened to carry.
  $: nameMap = buildNameMap({
    reaUsers: extractReaUsers(events),
    profiles: Object.values(usersById),
  });

  // One input, every reading of it: the diagram, the ledger and the balances
  // are the same records, grouped differently.
  // The group an expense with no split is shared by: the users lens, less
  // the holon itself, which older bot records could carry as a member.
  $: memberIds = Object.keys(usersById).filter((id) => id && id !== holonID);

  $: flowInput = {
    holonId: holonID,
    events,
    expenses,
    collective,
    settings,
    windowDays,
    members: memberIds,
    nameOf: (id: string) => nameMap.get(id),
    hubLabel: "Holon",
  };

  $: graph = buildValueFlows(flowInput);
  $: tracks = graph.tracks;
  $: if (tracks.length && !tracks.some((t) => trackKey(t) === trackId)) {
    trackId = trackKey(tracks[0]);
  }
  $: activeTrack = tracks.find((t) => trackKey(t) === trackId) ?? null;
  $: movementLayout = activeTrack ? layoutSankey(activeTrack) : null;
  $: formatMovement = formatter(activeTrack);

  // ---- Between people ---------------------------------------------------------
  //
  // The same records with both ends kept: who gave what to whom, one matrix
  // per unit, drawn as a directed chord.
  $: peopleTracks = buildPeopleFlows(flowInput);
  let peopleTrackId = "";
  const peopleKey = (track: PeopleFlowTrack) => `${track.id}:${track.unit}`;
  $: if (peopleTracks.length && !peopleTracks.some((p) => peopleKey(p) === peopleTrackId)) {
    peopleTrackId = peopleKey(peopleTracks[0]);
  }
  $: activePeople = peopleTracks.find((p) => peopleKey(p) === peopleTrackId) ?? null;
  /** Stock and lends carry their own unit (kg, pack, lends). */
  const peopleLabel = (p: PeopleFlowTrack) =>
    p.id !== "items" ? trackLabel({ id: p.id, unit: p.unit }) : p.unit === "lends" ? "Lends" : p.unit;
  $: formatPeople =
    activePeople?.id === "items"
      ? ((unit: string) => (v: number) => `${Math.round(v * 10) / 10} ${unit}`)(activePeople.unit)
      : formatter(activePeople ? { id: activePeople.id as ValueFlowTrack["id"], unit: activePeople.unit } : null);

  let selectedParty: ChordGroup | null = null;
  // Who is rolled into whom does not depend on the radius, so any will do.
  $: partyBreakdown =
    selectedParty && activePeople
      ? chordBreakdown(layoutChord(activePeople, { innerRadius: 100, othersLabel: "Others" }), selectedParty.id)
      : null;

  $: entries = buildLedger(flowInput).entries;

  // ---- Balances: who can appear, and in which currency ------------------------
  //
  // The roster is everyone with any economic footprint — the users lens, the
  // REA stream, every payer and sharer on an expense. People only: older bot
  // records could carry the holon id in a split, so it is dropped here.
  $: people = (() => {
    const ids = new Set<string>();
    for (const id of Object.keys(usersById)) ids.add(id);
    for (const u of extractReaUsers(events)) ids.add(String(u.id));
    for (const id of participantIds(expenses)) ids.add(id);
    if (selfId) ids.add(selfId);
    ids.delete(holonID);
    const list = [...ids]
      .filter(Boolean)
      .map((id) => ({ id, name: nameMap.get(id) ?? usersById[id]?.first_name ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return list;
  })();

  // Every currency anyone has used or configured, normalized and deduped.
  $: currencies = [
    ...new Set(
      [
        ...expenseCurrencies(expenses),
        ...((Array.isArray(settings?.currencies) ? settings.currencies : []) as unknown[])
          .filter((c): c is string => typeof c === "string")
          .map(normalizeCurrency),
        ...events
          .filter((e: any) => e?.resource?.type === "money" && e?.resource?.unit)
          .map((e: any) => normalizeCurrency(String(e.resource.unit))),
      ].filter(Boolean),
    ),
  ];

  // Keep a valid currency selected: the remembered one if it is still in use,
  // else the first available; USD only so a fresh holon can add its first.
  $: currency = currencies.includes(prefs.currency)
    ? prefs.currency
    : (currencies[0] ?? (prefs.currency || "usd"));

  // ---- Allocation -------------------------------------------------------------

  // The split is a live draft, seeded from the settings mirror and edited by
  // the panel below the diagram. `allocate()` runs off the draft, so a slider
  // moves the Sankey immediately — nothing is written until Save.
  let allocationConfig = { ...DEFAULT_ALLOCATION_CONFIG };
  let zoneOf: Record<string, number> = {};
  // The hand-set contributors' split, read under `interiorMode: custom`.
  let interiorShares: InteriorShares = {};
  let savedAllocation = {
    ...DEFAULT_ALLOCATION_CONFIG,
    zones: {} as Record<string, number>,
    shares: {} as InteriorShares,
  };

  function sameShares(a: InteriorShares, b: InteriorShares): boolean {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
  }

  $: allocationDirty =
    allocationConfig.interiorPercent !== savedAllocation.interiorPercent ||
    allocationConfig.steepness !== savedAllocation.steepness ||
    allocationConfig.nzones !== savedAllocation.nzones ||
    (allocationConfig.interiorMode ?? "equation") !== (savedAllocation.interiorMode ?? "equation") ||
    !sameShares(normalizeInteriorShares(interiorShares), savedAllocation.shares) ||
    partners.some((p) => (zoneOf[p.id] ?? 0) !== (savedAllocation.zones[p.id] ?? 0));

  /**
   * Take the saved split as the draft.
   *
   * Settings echo back on every write and on every relay reconnect, so an edit
   * in progress is never overwritten — only an untouched draft is re-seeded.
   */
  function seedAllocation(doc: unknown) {
    const config = readAllocationConfig(doc);
    const zones = readZoneAssignments(doc);
    const shares = readInteriorShares(doc);
    const wasDirty = allocationDirty;
    savedAllocation = { ...config, zones, shares };
    if (!wasDirty) {
      allocationConfig = { ...config };
      zoneOf = { ...zones };
      interiorShares = { ...shares };
    }
  }

  /** Partners carry the draft's rings, not the saved ones. */
  $: zonedPartners = partners.map((p) => ({ ...p, zone: zoneOf[p.id] ?? 0 }));

  // Who the contributors' share goes to: the scored roster under the
  // equation, the draft's hand-set shares under a custom split — the same
  // resolver the kiosk reads with and the contract is synced by.
  $: interiorMembers = resolveInteriorMembers({
    config: allocationConfig,
    scored: memberShares,
    shares: interiorShares,
    nameOf: (id) => nameMap.get(id) ?? usersById[id]?.first_name,
  });

  // ---- Fund usage --------------------------------------------------------------
  //
  // Every rights-holder, with the names a collective payee might carry so
  // OpenCollective's "Ada Lovelace" lands on the member the users lens calls
  // Ada. Usage needs a real pot, so it only exists with a collective. Spending
  // follows the movement window; claims are owed whenever they were raised.
  function aliasesFor(users: Record<string, any>, id: string): string[] {
    const u = users[id];
    if (!u) return [];
    const first = String(u.first_name ?? "").trim();
    const last = String(u.last_name ?? "").trim();
    return [
      String(u.username ?? "").trim(),
      first,
      [first, last].filter(Boolean).join(" "),
    ].filter(Boolean);
  }
  $: usageParties = [
    ...interiorMembers.map((m) => ({ id: m.id, name: m.name, aliases: aliasesFor(usersById, m.id) })),
    ...zonedPartners
      .filter((p) => p.zone >= 1)
      .map((p) => ({ id: p.id, name: p.name, aliases: aliasesFor(usersById, p.id) })),
  ] as FundUsageParty[];
  $: usage = collective
    ? buildFundUsage({
        holonId: holonID,
        unit: collective.currency,
        parties: usageParties,
        members: memberIds,
        expenses,
        collective,
        windowDays,
        claims: claimsCtx?.folded ?? null,
      })
    : null;
  $: usageTotal = usageTotals(usage);

  $: allocationResult = allocate({
    // The collective's money is the honest pot — what is in the bank plus what
    // rights-holders already drew, since a right that was spent still was one.
    // Without a collective, show the shape of the split as percentages rather
    // than inventing an amount.
    total: collective ? rightsTotal(collective.balance, usage) : null,
    unit: collective?.currency ?? "",
    config: allocationConfig,
    members: interiorMembers,
    zoned: zonedPartners,
  });
  $: allocationTrack = allocationToGraph(
    allocationResult,
    {
      pot: collective ? collective.name : "Total",
      interior: "Contributors share",
      exterior: "Reciprocity zones",
      spent: "Spent",
      claimed: "Claimed",
      available: "Available",
      over: "Over",
      unattributed: "Outside rights",
    },
    usage,
  );
  $: allocationLayout = layoutSankey(allocationTrack);
  // What is left to the rights-holders, as the diagram draws it, and what was
  // taken beyond any right — both read off the same stacked bars.
  $: availableTotal = segmentTotal(allocationTrack, "available");
  $: overTotal = segmentTotal(allocationTrack, "over");
  $: hasAllocation = interiorMembers.length > 0 || partners.length > 0;
  $: formatAllocation = collective
    ? formatter({ id: "money", unit: collective.currency })
    : (v: number) => `${Math.round(v)}%`;

  // ---- Tap detail ---------------------------------------------------------------
  //
  // A bar is a sum; tapping asks what it is a sum OF. The rows come from the
  // same ledger entries the bar was built from, so the sheet cannot claim
  // anything the ledger would contradict.

  const MAX_NAMES = 4;
  const SOURCE_LABELS: Record<LedgerSource, string> = {
    expenses: "Expenses",
    rea: "Activity",
    opencollective: "OpenCollective",
    derived: "Rules",
  };

  let selected: { node: SankeyLayoutNode; chart: "movement" | "allocation" } | null = null;
  $: selectedFormat = (selected?.chart === "allocation" ? formatAllocation : formatMovement) as Formatter;
  $: selectedRows = selected
    ? selected.chart === "allocation"
      ? allocationDetails(selected.node)
      : movementDetails(selected.node)
    : [];

  // Who is behind the tapped bar, and how much of it is theirs. Core decides
  // the rows: out-links for a group, in-links for a sink, the swallowed bars
  // for a "+n more" rollup. A bar with nothing to list stays with its detail
  // rows and, on the movement side, the ledger hand-off.
  $: breakdown = ((): BreakdownRow[] => {
    if (!selected) return [];
    if (selected.chart === "allocation") {
      if (selected.node.id === UNATTRIBUTED_ID && usage) {
        const payees = usage.unattributedPayees
          .filter((p) => p.unit === usage.unit)
          .map((p) => ({
            id: `payee-${p.name}`,
            label: p.spent > 0 && p.claimed > 0 ? p.name : `${p.name} · ${p.spent > 0 ? "spent" : "claimed"}`,
            value: p.spent + p.claimed,
          }));
        if (payees.length) return payees;
      }
      return nodeBreakdown(allocationTrack, allocationLayout, selected.node.id).rows;
    }
    if (!activeTrack || !movementLayout) return [];
    return nodeBreakdown(activeTrack, movementLayout, selected.node.id).rows;
  })();

  function listNames(names: string[]): string {
    if (names.length <= MAX_NAMES) return names.join(", ");
    return `${names.slice(0, MAX_NAMES).join(", ")} +${names.length - MAX_NAMES}`;
  }

  /**
   * The entries behind one bar of the movement chart. The layout rolls
   * everything past its top N into a single "+n more" bar; its contents are
   * whatever the chart is NOT otherwise showing on that side.
   */
  function entriesForNode(node: SankeyLayoutNode): LedgerEntry[] {
    const inTrack = entries.filter((e) => ledgerTrackKey(e) === trackId);
    if (node.kind === "other") {
      const shown = new Set(movementLayout?.nodes.map((n) => n.id) ?? []);
      const direction = node.depth === 0 ? "in" : "out";
      return inTrack.filter((e) => e.direction === direction && !shown.has(e.nodeId));
    }
    return inTrack.filter((e) => e.nodeId === node.id);
  }

  function movementDetails(node: SankeyLayoutNode): { label: string; value: string }[] {
    const inTrack = entries.filter((e) => ledgerTrackKey(e) === trackId);
    if (node.kind === "hub") {
      const sum = (d: string) =>
        inTrack.filter((e) => e.direction === d).reduce((s, e) => s + e.amount, 0);
      const rows = [
        { label: "In", value: formatMovement(sum("in")) },
        { label: "Out", value: formatMovement(sum("out")) },
        { label: "Entries", value: String(inTrack.length) },
      ];
      if (activeTrack?.balance != null) {
        rows.push({ label: "Balance", value: formatMovement(activeTrack.balance) });
      }
      return rows;
    }

    const behind = entriesForNode(node);
    if (!behind.length) return [];
    const rows = [{ label: "Entries", value: String(behind.length) }];
    const stamps = behind.map((e) => e.timestamp).sort((a, b) => a - b);
    const first = stamps[0];
    const last = stamps[stamps.length - 1];
    rows.push(
      first === last
        ? { label: "Date", value: dateFmt.format(first) }
        : { label: "Between", value: `${dateFmt.format(first)} – ${dateFmt.format(last)}` },
    );
    const names = [...new Set(behind.flatMap((e) => [e.party, ...e.participants]))].filter(Boolean);
    if (names.length) {
      rows.push({ label: names.length === 1 ? "Name" : "Names", value: listNames(names) });
    }
    const largest = behind.reduce((a, b) => (b.amount > a.amount ? b : a));
    const fmt = formatter({ id: largest.track, unit: largest.unit });
    if (behind.length > 1) {
      rows.push({
        label: "Largest",
        value: largest.description
          ? `${fmt(largest.amount)} · ${largest.description}`
          : fmt(largest.amount),
      });
    } else if (largest.description) {
      rows.push({ label: "For", value: largest.description });
    }
    const sources = [...new Set(behind.map((e) => SOURCE_LABELS[e.source] ?? e.source))];
    rows.push({ label: sources.length === 1 ? "Source" : "Sources", value: sources.join(", ") });
    return rows;
  }

  /** A ribbon carries exactly what its non-hub end does. */
  function movementLinkDetails(link: SankeyLayoutLink): { label: string; value: string }[] {
    const id = link.source === HUB_ID ? link.target : link.source;
    const node = movementLayout?.nodes.find((n) => n.id === id);
    return node ? movementDetails(node) : [];
  }

  function findZone(nodeId: string) {
    if (!nodeId.startsWith("zone-")) return null;
    const zone = Number(nodeId.slice("zone-".length));
    return allocationResult.exterior.find((z) => z.zone === zone) ?? null;
  }

  /**
   * The seats behind one party's bar: their contributor share, if any, and
   * their place on a ring, if any. A person can hold both, and the bar sums
   * them — so the tooltip names each.
   */
  function findSeats(nodeId: string) {
    const id = partyIdOf(nodeId);
    if (id == null) return null;
    const member = allocationResult.interior.find((m) => m.id === id) ?? null;
    let ring: { zone: number; slice: AllocationSlice } | null = null;
    for (const zone of allocationResult.exterior) {
      const hit = (zone.members ?? []).find((p) => p.id === id);
      if (hit) {
        ring = { zone: zone.zone ?? 0, slice: hit };
        break;
      }
    }
    if (!member && !ring) return null;
    const percentage = (member?.percentage ?? 0) + (ring?.slice.percentage ?? 0);
    const amount =
      member?.amount == null && ring?.slice.amount == null
        ? null
        : (member?.amount ?? 0) + (ring?.slice.amount ?? 0);
    return { id, member, ring, percentage, amount };
  }

  /**
   * Allocation has no entries behind it — it is a rule, not a history — so the
   * detail here is the rule: what share this is, and of whom.
   */
  function allocationDetails(node: SankeyLayoutNode): { label: string; value: string }[] {
    const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
    const interiorPct = allocationResult.interior.reduce((s, m) => s + m.percentage, 0);

    if (node.kind === "pot") {
      const rows = collective
        ? [
            { label: "Collective", value: collective.name },
            { label: "Balance", value: formatAllocation(collective.balance) },
          ]
        : [{ label: "Pot", value: "No collective configured yet" }];
      rows.push(
        { label: "Contributors share", value: `${allocationConfig.interiorPercent}%` },
        {
          label: "Divided",
          value: allocationConfig.interiorMode === "custom" ? "Custom split" : "By value equation",
        },
        { label: "Reciprocity zones", value: `${100 - allocationConfig.interiorPercent}%` },
      );
      if (usage) {
        rows.push(
          { label: "Spent", value: formatAllocation(usageTotal.spent) },
          { label: "Claimed", value: formatAllocation(usageTotal.claimed) },
        );
      }
      return rows;
    }
    if (usage && node.id === UNATTRIBUTED_ID) {
      const rows = [{ label: "What", value: "Paid or promised to someone with no right here." }];
      const un = usageTotal.unattributed;
      if (un.spent > 0) rows.push({ label: "Spent", value: formatAllocation(un.spent) });
      if (un.claimed > 0) rows.push({ label: "Claimed", value: formatAllocation(un.claimed) });
      if (usage.unattributedPayees.length) {
        rows.push({ label: "Paid to", value: listNames(usage.unattributedPayees.map((p) => p.name)) });
      }
      return rows;
    }
    if (node.kind === "interior") {
      return [
        { label: "Share of pot", value: pct(interiorPct) },
        { label: "Contributors", value: String(allocationResult.interior.length) },
        { label: "Split by", value: "Value equation" },
      ];
    }
    if (node.kind === "exterior") {
      return [
        { label: "Share of pot", value: pct(100 - interiorPct) },
        { label: "Zones", value: String(allocationConfig.nzones) },
        { label: "Split by", value: "Zone distance" },
      ];
    }
    const zone = findZone(node.id);
    if (zone) {
      const names = (zone.members ?? []).map((p) => p.label);
      return [
        { label: "Share of pot", value: pct(zone.percentage) },
        { label: "Zone", value: `Zone ${zone.zone}` },
        {
          label: names.length === 1 ? "Partner" : "Partners",
          value: names.length ? listNames(names) : "None yet",
        },
      ];
    }

    const seats = findSeats(node.id);
    if (!seats) return [];
    // One bar, one total; then each seat that feeds it, when there is more
    // than one to tell apart.
    const rows = [{ label: "Share of pot", value: pct(seats.percentage) }];
    const both = !!seats.member && !!seats.ring;
    if (seats.member) {
      rows.push(
        both
          ? { label: "Contributors share", value: formatAllocation(seats.member.amount ?? seats.member.percentage) }
          : { label: "Earned by", value: "Value equation" },
      );
    }
    if (seats.ring) {
      rows.push({
        label: `Zone ${seats.ring.zone}`,
        value: both ? formatAllocation(seats.ring.slice.amount ?? seats.ring.slice.percentage) : "Zone distance",
      });
    }
    if (usage) rows.push(...usageRows(seats.id, seats.amount));
    return rows;
  }

  /**
   * A right's usage, in the pot's currency and then in every other unit the
   * party touched the fund in. Other units are text only — hours are not euros
   * and the diagram never sums across units, so neither do these rows.
   */
  function usageRows(partyId: string, right: number | null): { label: string; value: string }[] {
    if (!usage) return [];
    const rows: { label: string; value: string }[] = [];
    const use = usageOf(usage, partyId);
    if (right != null) {
      const left = right - use.spent - use.claimed;
      rows.push(
        { label: "Right", value: formatAllocation(right) },
        { label: "Spent", value: formatAllocation(use.spent) },
        { label: "Claimed", value: formatAllocation(use.claimed) },
        left >= 0
          ? { label: "Available", value: formatAllocation(left) }
          : { label: "Over", value: formatAllocation(-left) },
      );
    }
    for (const unit of usageUnits(usage, partyId)) {
      if (unit === usage.unit) continue;
      const other = usageOf(usage, partyId, unit);
      const fmt = formatter({ id: "money", unit });
      if (other.spent > 0) rows.push({ label: `Spent · ${unit.toUpperCase()}`, value: fmt(other.spent) });
      if (other.claimed > 0) rows.push({ label: `Claimed · ${unit.toUpperCase()}`, value: fmt(other.claimed) });
    }
    return rows;
  }

  /** A ribbon says what its deeper end would. */
  function allocationLinkDetails(link: SankeyLayoutLink): { label: string; value: string }[] {
    const node = allocationLayout?.nodes.find((n) => n.id === link.target);
    return node ? allocationDetails(node) : [];
  }

  // ---- Ledger hand-offs ----------------------------------------------------------
  //
  // Other panels can ask the ledger to show something: a tapped bar, a person.
  // The ledger owns its own filters; these are only what it opens with.
  let ledgerTrack = "";
  let ledgerNode = "";
  let ledgerSearch = "";

  function showInLedger(node: SankeyLayoutNode) {
    selected = null;
    if (node.kind !== "hub") {
      ledgerNode = node.id;
      ledgerTrack = trackId;
    }
    prefs.panel = "ledger";
    scrollTop();
  }

  function searchLedger(query: string) {
    ledgerSearch = query;
    ledgerNode = "";
    prefs.panel = "ledger";
    scrollTop();
  }

  function scrollTop() {
    document.getElementById("flows-top")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function teardown() {
    expensesSub?.unsubscribe();
    usersSub?.unsubscribe();
    settingsSub?.unsubscribe();
    reaSub?.unsubscribe();
    expensesSub = usersSub = settingsSub = reaSub = undefined;
    if (rescoreTimer) clearTimeout(rescoreTimer);
    rescoreTimer = null;
    if (federationTimer) clearInterval(federationTimer);
    federationTimer = null;
    eventsById.clear();
    eventSigs.clear();
    userSigs.clear();
    expensesSig = "";
    settingsSig = "";
    loadedSlug = "";
    eventsDirty = false;
    rescoreDue = false;
  }

  async function bind(id: string) {
    teardown();
    holonID = id;
    events = [];
    expenses = [];
    usersById = {};
    collective = null;
    collectiveError = "";
    memberShares = [];
    partners = [];
    loading = true;

    if (!holosphere || !id) {
      loading = false;
      return;
    }

    try {
      // subscribeFederated hands back a whole deduped snapshot per change, and
      // it fires once per change across every partner space — so an unchanged
      // snapshot still rebuilds the ledger unless it is compared first.
      expensesSub = holosphere.subscribeFederated(
        id,
        "expenses",
        (items: any) => {
          if (holonID !== id) return;
          const next = normalizeLens(items) as Expense[];
          const s = sig(next);
          if (s === expensesSig) return;
          expensesSig = s;
          expenses = next;
        },
      );

      usersSub = holosphere.subscribe(id, "users", (user: any, key?: string) => {
        if (holonID !== id) return;
        const uid = String(key ?? user?.id ?? "");
        if (!uid) return;
        const s = user ? sig(user) : "";
        if (userSigs.get(uid) === s) return;
        userSigs.set(uid, s);
        if (user) {
          usersById = { ...usersById, [uid]: user };
        } else {
          const { [uid]: _gone, ...rest } = usersById;
          usersById = rest;
        }
        // A changed roster changes who is scored, not what the events say.
        rescoreDue = true;
        scheduleSettle(id);
      });
      void reloadUsers(id);

      settingsSub = holosphere.subscribe(id, "settings", (doc: any) => {
        if (holonID !== id) return;
        // The bot's settings record is keyed by the holon id; ignore any other
        // record that happens to land on this lens.
        if (!doc || (doc.id && String(doc.id) !== String(id))) return;
        // Settings echo on ordinary relay traffic. Unguarded, every echo
        // re-seeded the draft, re-read the federation record and fired another
        // request at OpenCollective — one outbound fetch per echo, forever.
        const s = sig(doc);
        if (s === settingsSig) return;
        settingsSig = s;
        settings = doc;
        seedAllocation(doc);
        const slug = readCollectiveSlug(doc);
        if (slug && slug !== loadedSlug) {
          loadedSlug = slug;
          void loadCollective(slug, id);
        }
        void loadFederation(id);
      });

      // Live events are folded in from the payload — see the note on the state
      // maps above for why this handler must not read `rea_events` itself.
      reaSub = holosphere.subscribe(
        id,
        "rea_events",
        (event: any, key?: string) => {
          if (holonID !== id) return;
          const eid = String(key ?? event?.id ?? "");
          if (!eid) return;
          const s = event ? sig(event) : "";
          if (eventSigs.get(eid) === s) return;
          eventSigs.set(eid, s);
          if (event) eventsById.set(eid, event as REAEvent);
          else eventsById.delete(eid);
          eventsDirty = true;
          rescoreDue = true;
          scheduleSettle(id);
        },
      );
      await refreshEvents(id);

      void loadFederation(id);
      federationTimer = setInterval(
        () => void loadFederation(id),
        FEDERATION_POLL_MS,
      );

      void loadEquation(holosphere, id)
        .then((eq) => {
          if (holonID !== id) return;
          equation = eq;
          void rescoreMembers();
        })
        .catch(() => {});
    } catch (err) {
      console.error("[flows] bind failed", err);
    } finally {
      loading = false;
    }
  }

  /** Holosphere hands back a record map or an array depending on the call. */
  function normalizeLens(items: any): any[] {
    if (Array.isArray(items)) return items.filter(Boolean);
    if (items && typeof items === "object") return Object.values(items).filter(Boolean);
    return [];
  }

  /** Stable stringify for echo comparison; unstringifiable values never match. */
  function sig(value: unknown): string {
    try {
      return JSON.stringify(value) ?? "";
    } catch {
      return String(value);
    }
  }

  /**
   * One coalesced pass over whatever the subscriptions folded in.
   *
   * A single task completion writes several events at once (initiator, each
   * participant, each appreciation pair), so the burst collapses into one
   * rebuild instead of one per record.
   */
  function scheduleSettle(id: string) {
    if (rescoreTimer) clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(() => {
      rescoreTimer = null;
      if (holonID !== id) return;
      if (eventsDirty) {
        eventsDirty = false;
        events = [...eventsById.values()];
      }
      if (rescoreDue) {
        rescoreDue = false;
        void rescoreMembers();
      }
    }, 250);
  }

  /**
   * One cold read to seed the roster; changes arrive on the subscription.
   *
   * The subscription attaches first and can land records (or a delete) while
   * this read is still in flight, so anything it has already spoken for is left
   * alone — the live value is the newer one, and a flat overwrite here would
   * resurrect a member removed a moment ago.
   */
  async function reloadUsers(id: string) {
    try {
      const list = await holosphere.getAll(id, "users");
      if (holonID !== id) return;
      const map: Record<string, any> = { ...usersById };
      for (const u of normalizeLens(list)) {
        const uid = String(u?.id ?? "");
        if (!uid || userSigs.has(uid)) continue;
        map[uid] = u;
        userSigs.set(uid, sig(u));
      }
      usersById = map;
    } catch {
      // Names are a nicety; ids still render.
    }
  }

  /** One cold read to seed the events; changes arrive on the subscription. */
  async function refreshEvents(id: string) {
    try {
      const all = await holosphere.getAll(id, "rea_events");
      if (holonID !== id) return;
      for (const raw of normalizeLens(all) as REAEvent[]) {
        const eid = String(raw?.id ?? "");
        if (!eid || eventSigs.has(eid)) continue; // the subscription got there first
        eventsById.set(eid, raw);
        eventSigs.set(eid, sig(raw));
      }
      events = [...eventsById.values()];
      eventsDirty = false;
      rescoreDue = false;
      await rescoreMembers();
    } catch (err) {
      console.error("[flows] failed to read rea_events", err);
    }
  }

  async function loadFederation(id: string) {
    try {
      const snapshot = await getFederationSnapshot(holosphere, id);
      if (holonID !== id) return;
      // People the kiosk seats on rings ride along with the partner holons,
      // so both boards draw the same reciprocity zones.
      partners = toAllocationPartners(
        snapshot.federated,
        snapshot.partnerNames,
        readZoneAssignments(settings),
        readZonePeople(settings),
      );
    } catch {
      // A holon with no federation record simply has no exterior.
    }
  }

  /** A failure here is never fatal — the movement half stands on its own. */
  async function loadCollective(slug: string, id: string) {
    try {
      const resp = await fetch(
        `/api/opencollective?slug=${encodeURIComponent(slug)}`,
      );
      if (holonID !== id) return;
      const body = await resp.json();
      if (!resp.ok) {
        collectiveError = String(body?.error ?? "");
        return;
      }
      collective = body as OpenCollectiveSnapshot;
      collectiveError = "";
    } catch {
      collectiveError = "Could not reach OpenCollective.";
    }
  }

  /**
   * Member shares for the interior, scored through the same pipeline the Status
   * board ranks with — so the two views cannot disagree about contribution.
   * Runs against an in-memory view of the events rather than re-reading the store.
   */
  async function rescoreMembers() {
    const id = holonID;
    if (!id || !events.length) {
      memberShares = [];
      return;
    }
    try {
      // A fresh in-memory shim, NOT the memoized `getEventStore`: that one is
      // keyed on the holosphere handle, and handing it a new object each pass
      // would thrash its cache to no benefit.
      const aggregator = new REAAggregator(
        new REAEventStore({ getAll: async () => events } as any),
      );
      const roster = new Map<string, { id: string; name?: string }>();
      for (const u of extractReaUsers(events)) roster.set(String(u.id), u);
      for (const [uid, u] of Object.entries(usersById)) {
        roster.set(uid, { id: uid, name: u?.first_name ?? u?.username ?? uid });
      }
      const scored = await computeHolonUserScores(
        aggregator,
        id,
        [...roster.values()] as never,
        equation,
      );
      if (holonID !== id) return;
      memberShares = scored
        .filter((s) => s.percentage > 0)
        .map((s) => ({
          id: String(s.userId),
          name: nameMap.get(String(s.userId)) ?? String(s.userId),
          percentage: s.percentage,
        }));
    } catch (err) {
      console.warn("[flows] scoring failed", err);
      memberShares = [];
    }
  }

  onMount(() => {
    if ($ID) void bind($ID);
  });

  onDestroy(teardown);
</script>

<div class="board" id="flows-top">
  <header class="top">
    <div class="titles">
      <h1>Value Flows</h1>
      <p class="sub">Where this holon's value comes from, where it goes, and how it is shared out.</p>
    </div>
  </header>

  <!-- The board's one navigation: which reading of the ledger to show. -->
  <nav class="tabs">
    <PillSwitch
      options={PANELS}
      value={panel}
      onChange={(id) => (prefs.panel = id)}
      label="Which panel"
      stretch
    />
  </nav>

  {#if loading}
    <p class="empty">Reading the ledger…</p>
  {:else if panel === "movement"}
    <section class="panel">
      <header class="head">
        <div class="titles">
          <h2>Movement</h2>
          <p class="sub">Where value came from, and where it went.</p>
        </div>
        <div class="controls">
          {#if tracks.length > 1}
            <PillSwitch
              options={tracks.map((t) => ({ id: trackKey(t), label: trackLabel(t) }))}
              value={trackId}
              onChange={(id) => (trackId = id)}
              label="Which unit to show"
            />
          {/if}
          <PillSwitch
            options={WINDOWS.map((w) => ({ id: w.id, label: w.label }))}
            value={prefs.window}
            onChange={(id) => (prefs.window = id)}
            label="Over what period"
          />
        </div>
      </header>

      {#if !activeTrack}
        <p class="empty">Nothing has moved here yet.</p>
      {:else}
        <div class="stats">
          <div class="stat">
            <span class="k">In</span>
            <span class="v in">{formatMovement(activeTrack.totalIn)}</span>
          </div>
          <div class="stat">
            <span class="k">Out</span>
            <span class="v out">{formatMovement(activeTrack.totalOut)}</span>
          </div>
          {#if activeTrack.balance != null}
            <div class="stat">
              <span class="k">Balance</span>
              <span class="v">{formatMovement(activeTrack.balance)}</span>
            </div>
          {/if}
        </div>

        <div class="chart">
          <SankeyChart
            layout={movementLayout}
            format={formatMovement}
            onSelect={(n) => (selected = { node: n, chart: "movement" })}
            nodeDetails={movementDetails}
            linkDetails={movementLinkDetails}
            hint="Tap for the entries behind it"
          >
            <p slot="empty" class="empty">Nothing moved in this window.</p>
          </SankeyChart>
        </div>
        <p class="note">Tap a bar to see what is inside it.</p>
      {/if}
    </section>
  {:else if panel === "people"}
    <section class="panel">
      <header class="head">
        <div class="titles">
          <h2>Between people</h2>
          <p class="sub">Who gave what to whom — each arrow points at the person who received it.</p>
        </div>
        <div class="controls">
          {#if peopleTracks.length > 1}
            <PillSwitch
              options={peopleTracks.map((p) => ({
                id: peopleKey(p),
                label: peopleLabel(p),
              }))}
              value={peopleTrackId}
              onChange={(id) => (peopleTrackId = id)}
              label="Which unit to show"
            />
          {/if}
          <PillSwitch
            options={WINDOWS.map((w) => ({ id: w.id, label: w.label }))}
            value={prefs.window}
            onChange={(id) => (prefs.window = id)}
            label="Over what period"
          />
        </div>
      </header>

      {#if !activePeople}
        <p class="empty">Nothing passed between people in this window.</p>
      {:else}
        <div class="stats">
          <div class="stat">
            <span class="k">Moved between people</span>
            <span class="v">{formatPeople(activePeople.total)}</span>
          </div>
          <div class="stat">
            <span class="k">People</span>
            <span class="v">{activePeople.parties.length}</span>
          </div>
        </div>
        <div class="chart round">
          <ChordChart
            track={activePeople}
            format={formatPeople}
            onSelect={(g) => (selectedParty = g)}
            hint="Click for who, and how much"
          >
            <p slot="empty" class="empty">Nothing passed between people in this window.</p>
          </ChordChart>
        </div>
        <p class="note">Hover an arrow to see who gave to whom; click a person for the list.</p>
      {/if}
    </section>
  {:else if panel === "balances"}
    <BalancesPanel
      holonId={holonID}
      {holosphere}
      {expenses}
      {people}
      {currencies}
      {currency}
      {selfId}
      onShowLedger={searchLedger}
      on:currency={(e) => (prefs.currency = e.detail)}
    />
  {:else if panel === "allocation"}
    <section class="panel">
      <header class="head">
        <div class="titles">
          <h2>Fund allocation rights</h2>
          <p class="sub">
            {collective
              ? `Who may direct ${collective.name}, by how much — and how much of that is already spent or claimed.`
              : "Who may direct the fund, and by how much."}
          </p>
        </div>
      </header>

      {#if !hasAllocation}
        <p class="empty">No members or partners to share with yet.</p>
      {:else}
        <div class="stats">
          <div class="stat">
            <span class="k">Contributors share</span>
            <span class="v">{allocationConfig.interiorPercent}%</span>
            <span class="k sub">{allocationConfig.interiorMode === "custom" ? "custom split" : "by value equation"}</span>
          </div>
          <div class="stat">
            <span class="k">Reciprocity zones</span>
            <span class="v">{100 - allocationConfig.interiorPercent}%</span>
          </div>
          <div class="stat">
            <span class="k">Zones</span>
            <span class="v">{allocationConfig.nzones}</span>
          </div>
          {#if usage}
            <!-- These double as the legend for the stacked bars. -->
            <div class="stat">
              <span class="k"><i class="swatch spent"></i>Spent</span>
              <span class="v">{formatAllocation(usageTotal.spent)}</span>
            </div>
            <div class="stat">
              <span class="k"><i class="swatch claimed"></i>Claimed</span>
              <span class="v">{formatAllocation(usageTotal.claimed)}</span>
            </div>
            <div class="stat">
              <span class="k"><i class="swatch available"></i>Available</span>
              <span class="v">{formatAllocation(availableTotal)}</span>
            </div>
            {#if overTotal > 0}
              <div class="stat">
                <span class="k"><i class="swatch over"></i>Over</span>
                <span class="v">{formatAllocation(overTotal)}</span>
              </div>
            {/if}
          {/if}
        </div>

        <div class="chart">
          <SankeyChart
            layout={allocationLayout}
            format={formatAllocation}
            onSelect={(n) => (selected = { node: n, chart: "allocation" })}
            nodeDetails={allocationDetails}
            linkDetails={allocationLinkDetails}
          >
            <p slot="empty" class="empty">No members or partners to share with yet.</p>
          </SankeyChart>
        </div>

        <!-- The same split, editable: sliders feed `allocate()` above, and the
             panel saves off-chain and (with a wallet and a deployed bundle) on
             it, through the same path Flow Management syncs with. -->
        <div class="editor">
          <AllocationEditor
            holonId={holonID}
            {holosphere}
            bind:interiorPercent={allocationConfig.interiorPercent}
            bind:steepness={allocationConfig.steepness}
            bind:nzones={allocationConfig.nzones}
            bind:interiorMode={allocationConfig.interiorMode}
            bind:shares={interiorShares}
            bind:zoneOf
            partners={partners.map((p) => ({ id: p.id, name: p.name }))}
            members={memberShares.map((m) => ({ userId: m.id, percentage: m.percentage }))}
            {people}
            saved={savedAllocation}
            on:saved={() => {
              savedAllocation = {
                ...allocationConfig,
                zones: { ...zoneOf },
                shares: normalizeInteriorShares(interiorShares),
              };
            }}
          />
        </div>
        <!-- Claims on the fund: signed entries in the holon's own log, judged
             by its attesters, folded the same way on every surface. -->
        <div class="claims-panel">
          <h3>Claims on the fund</h3>
          {#if claimsProvisional}
            <p class="note">This holon is not founded yet: who counts is provisional until the bot signs its membership.</p>
          {/if}
          {#if selfId}
            <form class="claim-form" on:submit|preventDefault={submitClaim}>
              <label>Amount <input type="number" min="0.01" step="0.01" bind:value={claimAmount} required /></label>
              <label class="grow">What for <input type="text" maxlength="140" bind:value={claimMemo} /></label>
              <button type="submit" disabled={claimBusy || !claimUnit}>Record a claim{claimUnit ? ` (${claimUnit})` : ""}</button>
            </form>
          {/if}
          {#if claimError}<p class="note warn">{claimError}</p>{/if}
          {#if claimsCtx && claimsCtx.folded.claims.length}
            <table class="claims">
              <thead><tr><th>Who</th><th>Amount</th><th>What for</th><th>Status</th>{#if canAttest}<th></th>{/if}</tr></thead>
              <tbody>
                {#each claimsCtx.folded.claims.slice(-20).reverse() as c (c.id)}
                  <tr class={c.status}>
                    <th scope="row">{partyName(c.party)}</th>
                    <td>{c.amount} {c.unit}</td>
                    <td class="memo">{c.memo ?? ""}</td>
                    <td><span class="badge">{claimStatusLabel[c.status]}</span>{#if c.reason && c.status !== "approved" && c.status !== "settled"} <small>({c.reason})</small>{/if}</td>
                    {#if canAttest}
                      <td class="acts">
                        {#if c.status !== "settled" && c.status !== "rejected"}
                          {#if c.status !== "approved"}<button type="button" disabled={claimBusy} on:click={() => judgeClaim(c, "attest")}>Attest</button>{/if}
                          {#if c.status !== "disputed"}<button type="button" disabled={claimBusy} on:click={() => judgeClaim(c, "dispute")}>Dispute</button>{/if}
                          {#if c.status === "approved"}<button type="button" disabled={claimBusy} on:click={() => markPaid(c)}>Paid</button>{/if}
                        {/if}
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="empty">No claims recorded in the log yet.</p>
          {/if}
          {#if claimsCtx?.folded.imports.length}
            <p class="note">
              Partners folded in:
              {#each claimsCtx.folded.imports as im, i (im.holon)}{i ? ", " : ""}{partyName(im.holon)} ({im.accepted} accepted{im.source === "bootstrap" ? ", key only" : ""}){/each}.
            </p>
          {/if}
          <!-- The rules: an admin's signed word in the policy log, folded as-of-time. -->
          <details class="rules" bind:open={rulesOpen} on:toggle={() => rulesOpen && void loadPartnerKeys()}>
            <summary>
              Rules · quorum {claimsCtx?.policy.quorum ?? 0}, {claimsCtx?.policy.conflict === "quorum" ? "a human decides" : "the first wins"}
              {#if Object.keys(claimsCtx?.policy.partners ?? {}).length} · {Object.keys(claimsCtx?.policy.partners ?? {}).length} partner(s) pinned{/if}
            </summary>
            <p class="note">
              How claims are judged: who may raise one, who attests, how many attestations count, and what
              happens when two draw on the same thing. An admin's signed entry of the holon's policy log.
            </p>
            {#if !rulesCanSign}
              <p class="note warn">Only an admin's signature sets the rules; yours would be recorded but not counted.</p>
            {/if}
            <div class="rule-row">
              <span>Who may claim</span>
              {#each POLICY_ROLES as r (r)}
                <button type="button" class:on={ruleAuthors.includes(r)} aria-pressed={ruleAuthors.includes(r)} disabled={!rulesCanSign} on:click={() => toggleRole("authors", r)}>{r}s</button>
              {/each}
            </div>
            <div class="rule-row">
              <span>Who attests</span>
              {#each POLICY_ROLES as r (r)}
                <button type="button" class:on={ruleAttesters.includes(r)} aria-pressed={ruleAttesters.includes(r)} disabled={!rulesCanSign} on:click={() => toggleRole("attesters", r)}>{r}s</button>
              {/each}
            </div>
            <div class="rule-row">
              <label>Attestations needed <input type="number" min="0" max="9" step="1" disabled={!rulesCanSign} bind:value={ruleQuorum} /></label>
            </div>
            <div class="rule-row">
              <span>Two on one basis</span>
              <button type="button" class:on={ruleConflict === "earliest"} aria-pressed={ruleConflict === "earliest"} disabled={!rulesCanSign} on:click={() => (ruleConflict = "earliest")}>the first wins</button>
              <button type="button" class:on={ruleConflict === "quorum"} aria-pressed={ruleConflict === "quorum"} disabled={!rulesCanSign} on:click={() => (ruleConflict = "quorum")}>a human decides</button>
            </div>
            <div class="rule-row wrap">
              <span>Partners whose claims count</span>
              {#if partners.length}
                {#each partners as p (p.id)}
                  <button
                    type="button"
                    class:on={!!rulePartners[p.id]}
                    aria-pressed={!!rulePartners[p.id]}
                    disabled={!rulesCanSign || !partnerKeys[p.id]}
                    title={partnerKeys[p.id] ? "" : "no key published"}
                    on:click={() => togglePartner(p.id)}>{p.name}{rulePartners[p.id] ? " · pinned" : ""}</button
                  >
                {/each}
              {:else}
                <small>No partners.</small>
              {/if}
            </div>
            <div class="rule-row">
              <button type="button" class="primary" disabled={claimBusy || !rulesCanSign || rulesUnchanged} title={rulesUnchanged ? "These are the rules already in force." : ""} on:click={saveRules}>Set the rules</button>
            </div>
          </details>
        </div>
        <p class="note">
          The concentric editor, deploys and per-contributor detail live in
          <a href={`/${holonID}/flow`}>Flow Management</a>.
        </p>
      {/if}
    </section>
  {:else}
    {#if entries.length}
      <LedgerPanel
        {entries}
        bind:track={ledgerTrack}
        bind:node={ledgerNode}
        bind:search={ledgerSearch}
      />
    {:else}
      <p class="empty">Nothing has been recorded yet.</p>
    {/if}
  {/if}

  {#if collectiveError}
    <p class="note warn">{collectiveError}</p>
  {/if}
</div>

{#if selectedParty}
  {@const party = selectedParty}
  <Sheet title={party.label} on:close={() => (selectedParty = null)}>
    <dl class="detail">
      <div class="drow"><dt>Gave</dt><dd>{formatPeople(party.given)}</dd></div>
      <div class="drow"><dt>Received</dt><dd>{formatPeople(party.received)}</dd></div>
    </dl>
    {#each [{ caption: "Gave to", rows: partyBreakdown?.given ?? [], total: party.given }, { caption: "Received from", rows: partyBreakdown?.received ?? [], total: party.received }] as side (side.caption)}
      {#if side.rows.length}
        <table class="who">
          <caption>{side.caption}</caption>
          <tbody>
            {#each side.rows as row (row.id)}
              <tr>
                <th scope="row">{row.label}</th>
                <td class="share">{side.total > 0 ? `${Math.round((row.value / side.total) * 100)}%` : ""}</td>
                <td class="amt">{formatPeople(row.value)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/each}
  </Sheet>
{/if}

{#if selected}
  {@const node = selected.node}
  <Sheet title={node.label} on:close={() => (selected = null)}>
    <p class="big">{selectedFormat(node.value)}</p>
    {#if selectedRows.length}
      <dl class="detail">
        {#each selectedRows as row (row.label)}
          <div class="drow">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
    {#if breakdown.length}
      <!-- Who, and how much: the bars this one is made of. -->
      <table class="who">
        <tbody>
          {#each breakdown as row (row.id)}
            <tr>
              <th scope="row">{row.label}</th>
              <td class="share">{node.value > 0 ? `${Math.round((row.value / node.value) * 100)}%` : ""}</td>
              <td class="amt">{selectedFormat(row.value)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <svelte:fragment slot="actions">
      {#if selected?.chart === "movement"}
        <button type="button" class="primary" on:click={() => showInLedger(node)}>
          {node.kind === "hub" ? "Open the ledger" : "List these entries"}
        </button>
      {/if}
    </svelte:fragment>
  </Sheet>
{/if}

<style>
  .board {
    --flow-accent: #0f766e;
    padding: 0.9rem 1rem calc(1.6rem + env(safe-area-inset-bottom));
    max-width: 52rem;
    margin: 0 auto;
    color: var(--color-text-primary);
  }

  @media (min-width: 640px) {
    .board {
      padding: 1.2rem 1.5rem 2rem;
    }
  }

  .top {
    margin-bottom: 0.8rem;
  }

  h1 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 600;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  /* The tab pill stays put while the panel scrolls under it. */
  .tabs {
    position: sticky;
    top: 0;
    z-index: 10;
    margin: 0 -0.25rem 1rem;
    padding: 0.35rem 0.25rem;
    background: var(--color-bg-primary);
  }

  .panel {
    animation: flows-rise 0.42s ease both;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.6rem;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1.4rem;
    margin: 0.4rem 0 0.8rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .k {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .v {
    font-size: 1.3rem;
  }

  /* Legend dots, the same hues the stacked bars use. */
  .swatch {
    display: inline-block;
    width: 0.55em;
    height: 0.55em;
    border-radius: 999px;
    margin-right: 0.35em;
    vertical-align: 0.05em;
  }
  .swatch.spent {
    background: #f43f5e;
  }
  .swatch.claimed {
    background: #f59e0b;
  }
  .swatch.available {
    background: #10b981;
  }
  .swatch.over {
    background: #dc2626;
  }

  .in {
    color: #5eead4;
  }

  .out {
    color: #fca5a5;
  }

  /* The Sankey scrolls sideways inside its own card on a phone rather than
     pushing the page wider. */
  .chart {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border-radius: 18px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    padding: 0.5rem;
  }

  .chart > :global(*) {
    min-width: 32rem;
  }

  /* A chord is round and sizes itself to the card; it never scrolls. */
  .chart.round > :global(*) {
    min-width: 0;
  }

  .who caption {
    text-align: left;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    padding: 0.6rem 0 0.3rem;
  }

  .editor {
    margin-top: 0.8rem;
  }

  .empty {
    color: var(--color-text-muted);
    text-align: center;
    padding: 2.4rem 1rem;
  }

  .note {
    color: var(--color-text-muted);
    font-size: 0.8rem;
    text-align: center;
    margin: 0.7rem 0 0;
  }

  .note.warn {
    color: #fbbf24;
  }

  .note a {
    color: #5eead4;
  }

  .big {
    margin: 0;
    font-size: 1.8rem;
    color: #5eead4;
  }

  .detail {
    margin: 0.8rem 0 0;
    display: grid;
    gap: 0.5rem;
  }

  .drow {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    font-size: 0.92rem;
  }

  .drow dt {
    color: var(--color-text-muted);
    flex: 0 0 auto;
  }

  .drow dd {
    margin: 0;
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .who {
    width: 100%;
    margin: 0.8rem 0 0;
    border-collapse: collapse;
    font-size: 0.86rem;
  }
  .who th,
  .who td {
    padding: 0.3rem 0;
    border-top: 1px solid rgba(148, 163, 184, 0.2);
    vertical-align: baseline;
  }
  .who th {
    text-align: left;
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .who .share {
    text-align: right;
    padding-left: 0.6rem;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .who .amt {
    text-align: right;
    padding-left: 0.8rem;
    color: #5eead4;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  @keyframes flows-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }

  .claims-panel {
    margin-top: 1rem;
    display: grid;
    gap: 0.5rem;
  }
  .rules {
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 0.6rem;
    padding: 0.5rem 0.75rem;
  }
  .rules summary {
    cursor: pointer;
    font-weight: 600;
  }
  .rule-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.5rem;
    font-size: 0.9rem;
  }
  .rule-row.wrap {
    flex-wrap: wrap;
  }
  .rule-row > span {
    min-width: 11rem;
    color: inherit;
    opacity: 0.8;
  }
  .rule-row button {
    padding: 0.3rem 0.8rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    opacity: 0.7;
  }
  .rule-row button.on {
    opacity: 1;
    font-weight: 600;
  }
  .rule-row button:disabled {
    cursor: default;
    opacity: 0.4;
  }
  .rule-row input {
    width: 4rem;
    margin-left: 0.4rem;
  }
  .claims-panel h3 {
    margin: 0;
    font-size: 1rem;
  }
  .claim-form {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .claim-form label {
    display: grid;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .claim-form label.grow {
    flex: 1 1 10rem;
  }
  .claim-form input {
    padding: 0.4rem 0.6rem;
    border: 1px solid rgba(128, 128, 128, 0.4);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .claim-form button,
  .claims .acts button {
    padding: 0.4rem 0.8rem;
    border: 1px solid currentColor;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .claims {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .claims th,
  .claims td {
    text-align: left;
    padding: 0.35rem 0.5rem;
    border-top: 1px solid rgba(128, 128, 128, 0.25);
  }
  .claims .memo {
    opacity: 0.75;
  }
  .claims .acts {
    display: flex;
    gap: 0.3rem;
  }
  .claims .badge {
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid rgba(128, 128, 128, 0.4);
    font-size: 0.75rem;
  }
  .claims tr.approved .badge,
  .claims tr.settled .badge {
    border-color: #2a9d8f;
    color: #2a9d8f;
  }
  .claims tr.disputed .badge,
  .claims tr.over .badge,
  .claims tr.conflict .badge,
  .claims tr.rejected .badge {
    border-color: #e76f51;
    color: #e76f51;
  }
</style>
