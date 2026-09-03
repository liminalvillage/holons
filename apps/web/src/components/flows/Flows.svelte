<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Value Flows — the dashboard twin of the kiosk's Flows board.
  //
  // MOVEMENT: what came in and went out, from the expenses lens, the REA stream
  // and (when a collective is configured) OpenCollective.
  // ALLOCATION: where the holon's resources are committed — the same
  // interior/exterior split Flow Management pushes on-chain, read off-chain from
  // the settings lens and applied to the collective's real balance.
  //
  // Both are Sankeys over one core domain, so this view and the kiosk's cannot
  // disagree. Distinct from /[id]/flow, the concentric editor: reading here
  // needs no wallet, and the allocation panel only asks for one at the moment
  // somebody pushes the split on-chain — a save off-chain works without.
  //
  // LEDGER: the entries both halves are drawn from, listed in full — same core
  // walk, so a row and the bar above it are the same number. Search narrows it,
  // and clicking a bar in Movement filters the list to what is inside it.
  //
  // Units never mix: no exchange rates exist in this repo, so each unit gets its
  // own track rather than being summed into a fictional total.

  import { onDestroy, onMount, getContext } from "svelte";
  import type { HoloSphere } from "holosphere";
  import { ID } from "../../dashboard/store";
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
    allocate,
    allocationToGraph,
    buildLedger,
    buildValueFlows,
    DEFAULT_ALLOCATION_CONFIG,
    filterLedger,
    HUB_ID,
    layoutSankey,
    ledgerTrackKey,
    readAllocationConfig,
    readCollectiveSlug,
    readZoneAssignments,
    sortLedger,
    summarizeLedger,
    toAllocationPartners,
    type LedgerDirection,
    type LedgerEntry,
    type LedgerSource,
    type LedgerTotals,
    type OpenCollectiveSnapshot,
    type SankeyLayoutLink,
    type SankeyLayoutNode,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { buildNameMap } from "@holons/core/identity";
  import type { Expense } from "@holons/core/expenses";
  import SankeyChart from "./SankeyChart.svelte";
  import AllocationEditor from "./AllocationEditor.svelte";

  const holosphere = getContext("holosphere") as HoloSphere;

  const WINDOWS = [
    { id: "30", label: "30 days", days: 30 },
    { id: "90", label: "90 days", days: 90 },
    { id: "all", label: "All time", days: null },
  ] as const;

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

  let windowId = "90";
  let trackId = "";
  let selected: SankeyLayoutNode | null = null;

  let expensesSub: any;
  let usersSub: any;
  let settingsSub: any;
  let reaSub: any;
  let rescoreTimer: ReturnType<typeof setTimeout> | null = null;

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
  // It used to ride along on settings echoes, which is why deduping those needs
  // a replacement here.
  let federationTimer: ReturnType<typeof setInterval> | null = null;
  const FEDERATION_POLL_MS = 60_000;

  $: windowDays = WINDOWS.find((w) => w.id === windowId)?.days ?? 90;

  $: if ($ID && $ID !== holonID) void bind($ID);

  // Priority order is reaUsers < profiles, so a users-lens profile wins over
  // whatever username the event stream happened to carry.
  $: nameMap = buildNameMap({
    reaUsers: extractReaUsers(events),
    profiles: Object.values(usersById),
  });

  // One input, two readings of it: the diagram and the ledger under it are the
  // same core walk, so a bar and the rows inside it can never disagree.
  $: flowInput = {
    holonId: holonID,
    events,
    expenses,
    collective,
    settings,
    windowDays,
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

  // The split is a live draft, seeded from the settings mirror and edited by
  // the panel below the diagram. `allocate()` runs off the draft, so a slider
  // moves the Sankey immediately — nothing is written until Save.
  let allocationConfig = { ...DEFAULT_ALLOCATION_CONFIG };
  let zoneOf: Record<string, number> = {};
  let savedAllocation = {
    ...DEFAULT_ALLOCATION_CONFIG,
    zones: {} as Record<string, number>,
  };

  $: allocationDirty =
    allocationConfig.interiorPercent !== savedAllocation.interiorPercent ||
    allocationConfig.steepness !== savedAllocation.steepness ||
    allocationConfig.nzones !== savedAllocation.nzones ||
    partners.some(
      (p) => (zoneOf[p.id] ?? 0) !== (savedAllocation.zones[p.id] ?? 0),
    );

  /**
   * Take the saved split as the draft.
   *
   * Settings echo back on every write and on every relay reconnect, so an edit
   * in progress is never overwritten — only an untouched draft is re-seeded.
   */
  function seedAllocation(doc: unknown) {
    const config = readAllocationConfig(doc);
    const zones = readZoneAssignments(doc);
    const wasDirty = allocationDirty;
    savedAllocation = { ...config, zones };
    if (!wasDirty) {
      allocationConfig = { ...config };
      zoneOf = { ...zones };
    }
  }

  /** Partners carry the draft's rings, not the saved ones. */
  $: zonedPartners = partners.map((p) => ({
    ...p,
    zone: zoneOf[p.id] ?? 0,
  }));

  $: allocationResult = allocate({
    // The collective balance is the honest pot; without one, show the shape of
    // the split as percentages rather than inventing an amount.
    total: collective?.balance ?? null,
    unit: collective?.currency ?? "",
    config: allocationConfig,
    members: memberShares,
    zoned: zonedPartners,
  });
  $: allocationLayout = layoutSankey(
    allocationToGraph(allocationResult, {
      pot: collective ? collective.name : "Total",
      interior: "Interior",
      exterior: "Exterior",
    }),
  );
  // The panel is the reason this section exists even when nothing is placed
  // yet: somebody has to be able to place the first partner.
  $: hasAllocation = memberShares.length > 0 || partners.length > 0;

  function trackKey(track: ValueFlowTrack): string {
    return `${track.id}:${track.unit}`;
  }

  function trackLabel(track: ValueFlowTrack): string {
    if (track.id === "time") return "Hours";
    if (track.id === "appreciation") return "Kudos";
    if (track.unit === "credit" || track.unit === "credits") return "Credits";
    return track.unit.toUpperCase();
  }

  /**
   * Format a value in its track's unit. Real ISO codes get locale currency
   * formatting; a holon's own scrip falls back to a plain number plus the unit.
   */
  function formatter(track: ValueFlowTrack | null): (value: number) => string {
    if (!track) return (v) => String(Math.round(v));
    const code = track.unit.toUpperCase();
    if (track.id === "money" && /^[A-Z]{3}$/.test(code)) {
      try {
        const fmt = new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: code,
          maximumFractionDigits: 0,
        });
        return (v) => fmt.format(v);
      } catch {
        // Not a currency Intl knows; fall through rather than throwing.
      }
    }
    const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
    const unit =
      track.id === "time" ? "h" : track.id === "appreciation" ? "kudos" : track.unit;
    return (v) => `${fmt.format(v)} ${unit}`;
  }

  $: formatMovement = formatter(activeTrack);
  $: formatAllocation = collective
    ? formatter({ id: "money", unit: collective.currency } as ValueFlowTrack)
    : (v: number) => `${Math.round(v)}%`;

  // ---- Ledger ---------------------------------------------------------------

  const PAGE = 50;

  const SOURCES: { id: LedgerSource | "all"; label: string }[] = [
    { id: "all", label: "Every source" },
    { id: "expenses", label: "Expenses" },
    { id: "rea", label: "Activity" },
    { id: "opencollective", label: "OpenCollective" },
    { id: "derived", label: "Rules" },
  ];

  let search = "";
  let ledgerDirection: LedgerDirection | "all" = "all";
  let ledgerTrack = "";
  let ledgerNode = "";
  let ledgerSource: LedgerSource | "all" = "all";
  let newestFirst = true;
  let rowLimit = PAGE;

  $: entries = buildLedger(flowInput).entries;

  // Unit tabs for the list, in the order the entries first mention them.
  $: entryTracks = [
    ...new Map(
      entries.map((e) => [
        ledgerTrackKey(e),
        { id: e.track, unit: e.unit } as ValueFlowTrack,
      ]),
    ),
  ];

  // A window change can retire the unit that was being filtered on; fall back
  // to everything rather than showing an empty list with no visible cause.
  $: if (ledgerTrack && !entryTracks.some(([key]) => key === ledgerTrack)) {
    ledgerTrack = "";
  }
  $: if (ledgerNode && !entries.some((e) => e.nodeId === ledgerNode)) {
    ledgerNode = "";
  }

  $: filteredEntries = sortLedger(
    filterLedger(entries, {
      query: search,
      track: ledgerTrack,
      direction: ledgerDirection,
      nodeId: ledgerNode,
      source: ledgerSource,
    }),
    newestFirst,
  );

  $: ledgerTotals = summarizeLedger(filteredEntries);

  // Any change to what is being asked for starts the list at the top again.
  $: filterKey = `${search}|${ledgerDirection}|${ledgerTrack}|${ledgerNode}|${ledgerSource}`;
  $: if (filterKey) rowLimit = PAGE;

  $: visibleEntries = filteredEntries.slice(0, rowLimit);

  $: ledgerNodeLabel =
    entries.find((e) => e.nodeId === ledgerNode)?.nodeLabel ?? ledgerNode;

  $: hasLedgerFilter =
    !!search ||
    ledgerDirection !== "all" ||
    !!ledgerTrack ||
    !!ledgerNode ||
    ledgerSource !== "all";

  function clearLedgerFilters() {
    search = "";
    ledgerDirection = "all";
    ledgerTrack = "";
    ledgerNode = "";
    ledgerSource = "all";
  }

  /** Formatters are keyed by unit, so building one per unit is enough. */
  const entryFormatters = new Map<string, (value: number) => string>();

  function unitFormatter(
    id: ValueFlowTrack["id"],
    unit: string,
  ): (value: number) => string {
    const key = `${id}:${unit}`;
    let fmt = entryFormatters.get(key);
    if (!fmt) {
      fmt = formatter({ id, unit } as ValueFlowTrack);
      entryFormatters.set(key, fmt);
    }
    return fmt;
  }

  function formatEntry(entry: LedgerEntry): string {
    return unitFormatter(entry.track, entry.unit)(entry.amount);
  }

  /** A totals row carries its track as a field, not as a track object. */
  function totalLabel(total: LedgerTotals): string {
    return trackLabel({ id: total.track, unit: total.unit } as ValueFlowTrack);
  }

  function formatTotal(total: LedgerTotals, value: number): string {
    return unitFormatter(total.track, total.unit)(value);
  }

  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const stampFmt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function sourceLabel(source: LedgerSource): string {
    return SOURCES.find((s) => s.id === source)?.label ?? source;
  }

  /** The other names on the record, so a row reads without being opened. */
  function others(entry: LedgerEntry): string[] {
    return entry.participants.filter((name) => name !== entry.party);
  }

  // ---- Hover detail ---------------------------------------------------------
  //
  // A bar is a sum; hovering asks what it is a sum OF. The rows come from the
  // same ledger entries the bar was built from, so the tooltip cannot claim
  // anything the list below would contradict.

  const MAX_NAMES = 4;

  function listNames(names: string[]): string {
    if (names.length <= MAX_NAMES) return names.join(", ");
    return `${names.slice(0, MAX_NAMES).join(", ")} +${names.length - MAX_NAMES}`;
  }

  /**
   * The entries behind one bar of the movement chart.
   *
   * The layout rolls everything past its top N into a single "+n more" bar; its
   * contents are whatever the chart is NOT otherwise showing on that side,
   * which is worked out here rather than guessed at from the layout's rule.
   */
  function entriesForNode(node: SankeyLayoutNode): LedgerEntry[] {
    const inTrack = entries.filter((e) => ledgerTrackKey(e) === trackId);
    if (node.kind === "other") {
      const shown = new Set(movementLayout?.nodes.map((n) => n.id) ?? []);
      const direction = node.depth === 0 ? "in" : "out";
      return inTrack.filter(
        (e) => e.direction === direction && !shown.has(e.nodeId),
      );
    }
    return inTrack.filter((e) => e.nodeId === node.id);
  }

  function movementDetails(
    node: SankeyLayoutNode,
  ): { label: string; value: string }[] {
    const inTrack = entries.filter((e) => ledgerTrackKey(e) === trackId);

    if (node.kind === "hub") {
      const totalIn = inTrack
        .filter((e) => e.direction === "in")
        .reduce((sum, e) => sum + e.amount, 0);
      const totalOut = inTrack
        .filter((e) => e.direction === "out")
        .reduce((sum, e) => sum + e.amount, 0);
      const rows = [
        { label: "In", value: formatMovement(totalIn) },
        { label: "Out", value: formatMovement(totalOut) },
        { label: "Entries", value: String(inTrack.length) },
      ];
      if (activeTrack?.balance != null) {
        rows.push({
          label: "Balance",
          value: formatMovement(activeTrack.balance),
        });
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
        : {
            label: "Between",
            value: `${dateFmt.format(first)} – ${dateFmt.format(last)}`,
          },
    );

    const names = [
      ...new Set(behind.flatMap((e) => [e.party, ...e.participants])),
    ].filter(Boolean);
    if (names.length) {
      rows.push({
        label: names.length === 1 ? "Name" : "Names",
        value: listNames(names),
      });
    }

    const largest = behind.reduce((a, b) => (b.amount > a.amount ? b : a));
    if (behind.length > 1) {
      rows.push({
        label: "Largest",
        value: largest.description
          ? `${formatEntry(largest)} · ${largest.description}`
          : formatEntry(largest),
      });
    } else if (largest.description) {
      rows.push({ label: "For", value: largest.description });
    }

    const sources = [...new Set(behind.map((e) => sourceLabel(e.source)))];
    rows.push({
      label: sources.length === 1 ? "Source" : "Sources",
      value: sources.join(", "),
    });

    return rows;
  }

  /** A ribbon carries exactly what its non-hub end does. */
  function movementLinkDetails(
    link: SankeyLayoutLink,
  ): { label: string; value: string }[] {
    const id = link.source === HUB_ID ? link.target : link.source;
    const node = movementLayout?.nodes.find((n) => n.id === id);
    return node ? movementDetails(node) : [];
  }

  function findSlice(nodeId: string) {
    if (nodeId.startsWith("member-")) {
      const id = nodeId.slice("member-".length);
      return allocationResult.interior.find((m) => m.id === id) ?? null;
    }
    if (nodeId.startsWith("zone-")) {
      const zone = Number(nodeId.slice("zone-".length));
      return allocationResult.exterior.find((z) => z.zone === zone) ?? null;
    }
    if (nodeId.startsWith("partner-")) {
      const id = nodeId.slice("partner-".length);
      for (const zone of allocationResult.exterior) {
        const hit = (zone.members ?? []).find((p) => p.id === id);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * Allocation has no entries behind it — it is a rule, not a history — so the
   * detail here is the rule: what share this is, and of whom.
   */
  function allocationDetails(
    node: SankeyLayoutNode,
  ): { label: string; value: string }[] {
    const pct = (value: number) => `${Math.round(value * 10) / 10}%`;
    const interiorPct = allocationResult.interior.reduce(
      (sum, m) => sum + m.percentage,
      0,
    );

    if (node.kind === "pot") {
      const rows = collective
        ? [
            { label: "Collective", value: collective.name },
            { label: "Balance", value: formatAllocation(collective.balance) },
          ]
        : [{ label: "Pot", value: "No collective configured yet" }];
      rows.push(
        { label: "Interior", value: `${allocationConfig.interiorPercent}%` },
        {
          label: "Exterior",
          value: `${100 - allocationConfig.interiorPercent}%`,
        },
      );
      return rows;
    }

    if (node.kind === "interior") {
      return [
        { label: "Share of pot", value: pct(interiorPct) },
        { label: "Members", value: String(allocationResult.interior.length) },
        { label: "Split by", value: "Contribution score" },
      ];
    }

    if (node.kind === "exterior") {
      return [
        { label: "Share of pot", value: pct(100 - interiorPct) },
        { label: "Zones", value: String(allocationConfig.nzones) },
        { label: "Split by", value: "Zone distance" },
      ];
    }

    const slice = findSlice(node.id);
    if (!slice) return [];

    const rows = [{ label: "Share of pot", value: pct(slice.percentage) }];
    if (node.kind === "member") {
      rows.push({ label: "Earned by", value: "Contribution score" });
    }
    if (node.kind === "zone") {
      const partners = (slice.members ?? []).map((p) => p.label);
      rows.push({
        label: "Ring",
        value: `Zone ${slice.zone}`,
      });
      rows.push({
        label: partners.length === 1 ? "Partner" : "Partners",
        value: partners.length ? listNames(partners) : "None yet",
      });
    }
    if (node.kind === "partner" && slice.zone) {
      rows.push({ label: "Ring", value: `Zone ${slice.zone}` });
    }
    return rows;
  }

  /** Clicking a bar in Movement asks the ledger what is inside it. */
  function inspect(node: SankeyLayoutNode) {
    selected = node;
    if (node.kind === "hub") return;
    ledgerNode = node.id;
    ledgerTrack = trackId;
    document
      .getElementById("ledger")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      partners = toAllocationPartners(
        snapshot.federated,
        snapshot.partnerNames,
        readZoneAssignments(settings),
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

<div class="p-4 md:p-6 text-gray-100">
  <h1 class="text-2xl font-semibold mb-1">Value Flows</h1>
  <p class="text-sm text-gray-400 mb-6">
    Where this holon's value comes from, where it goes, and how it is shared out.
  </p>

  {#if loading}
    <p class="text-gray-400 py-12 text-center">Reading the ledger…</p>
  {:else if !tracks.length && !hasAllocation}
    <p class="text-gray-400 py-12 text-center">Nothing has moved here yet.</p>
  {:else}
    {#if tracks.length}
      <section class="mb-10">
        <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 class="text-lg font-medium">Movement</h2>
            <p class="text-sm text-gray-400">
              Where value came from, and where it went.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if tracks.length > 1}
              <div class="seg" role="radiogroup" aria-label="Which unit to show">
                {#each tracks as track (trackKey(track))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={trackId === trackKey(track)}
                    class:active={trackId === trackKey(track)}
                    on:click={() => (trackId = trackKey(track))}
                  >
                    {trackLabel(track)}
                  </button>
                {/each}
              </div>
            {/if}
            <div class="seg" role="radiogroup" aria-label="Over what period">
              {#each WINDOWS as w (w.id)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={windowId === w.id}
                  class:active={windowId === w.id}
                  on:click={() => (windowId = w.id)}
                >
                  {w.label}
                </button>
              {/each}
            </div>
          </div>
        </div>

        {#if activeTrack}
          <div class="flex flex-wrap gap-8 mb-3">
            <div>
              <div class="k">In</div>
              <div class="v">{formatMovement(activeTrack.totalIn)}</div>
            </div>
            <div>
              <div class="k">Out</div>
              <div class="v">{formatMovement(activeTrack.totalOut)}</div>
            </div>
            {#if activeTrack.balance != null}
              <div>
                <div class="k">Balance</div>
                <div class="v">{formatMovement(activeTrack.balance)}</div>
              </div>
            {/if}
          </div>

          <SankeyChart
            layout={movementLayout}
            format={formatMovement}
            onSelect={inspect}
            nodeDetails={movementDetails}
            linkDetails={movementLinkDetails}
            hint="Click to list these entries below"
          >
            <p slot="empty" class="text-gray-400 py-12 text-center">
              Nothing moved in this window.
            </p>
          </SankeyChart>
        {/if}
      </section>
    {/if}

    {#if hasAllocation}
      <section>
        <h2 class="text-lg font-medium">Allocation</h2>
        <p class="text-sm text-gray-400 mb-3">
          {collective
            ? `How ${collective.name} is shared out.`
            : "How value is shared out."}
        </p>

        <div class="flex flex-wrap gap-8 mb-3">
          <div>
            <div class="k">Interior</div>
            <div class="v">{allocationConfig.interiorPercent}%</div>
          </div>
          <div>
            <div class="k">Exterior</div>
            <div class="v">{100 - allocationConfig.interiorPercent}%</div>
          </div>
          <div>
            <div class="k">Zones</div>
            <div class="v">{allocationConfig.nzones}</div>
          </div>
        </div>

        <SankeyChart
          layout={allocationLayout}
          format={formatAllocation}
          onSelect={(n) => (selected = n)}
          nodeDetails={allocationDetails}
        >
          <p slot="empty" class="text-gray-400 py-12 text-center">
            No members or partners to share with yet.
          </p>
        </SankeyChart>

        <!-- The same split, editable: sliders feed `allocate()` above, and the
             panel saves off-chain and (with a wallet and a deployed bundle) on
             it, through the same path Flow Management syncs with. -->
        <div class="mt-3">
          <AllocationEditor
            holonId={holonID}
            {holosphere}
            bind:interiorPercent={allocationConfig.interiorPercent}
            bind:steepness={allocationConfig.steepness}
            bind:nzones={allocationConfig.nzones}
            bind:zoneOf
            partners={partners.map((p) => ({ id: p.id, name: p.name }))}
            members={memberShares.map((m) => ({
              userId: m.id,
              percentage: m.percentage,
            }))}
            saved={savedAllocation}
            on:saved={() => {
              savedAllocation = { ...allocationConfig, zones: { ...zoneOf } };
            }}
          />
        </div>

        <p class="text-xs text-gray-500 mt-2">
          The concentric editor, deploys and interior-member detail live in Flow
          Management.
        </p>
      </section>
    {/if}

    {#if entries.length}
      <section id="ledger" class="mt-10">
        <div class="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 class="text-lg font-medium">Ledger</h2>
            <p class="text-sm text-gray-400">
              Every entry the diagrams are drawn from — who, when, and what for.
            </p>
          </div>

          <div class="search">
            <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              type="search"
              bind:value={search}
              aria-label="Search the ledger"
              placeholder="Search a name, a note, a source…"
            />
          </div>
        </div>

        <div class="filters">
          <div class="seg" role="radiogroup" aria-label="Which way it moved">
            {#each [{ id: "all", label: "All" }, { id: "in", label: "In" }, { id: "out", label: "Out" }] as option (option.id)}
              <button
                type="button"
                role="radio"
                aria-checked={ledgerDirection === option.id}
                class:active={ledgerDirection === option.id}
                on:click={() =>
                  (ledgerDirection = option.id as LedgerDirection | "all")}
              >
                {option.label}
              </button>
            {/each}
          </div>

          {#if entryTracks.length > 1}
            <label class="picker">
              <span class="sr-only">Unit</span>
              <select bind:value={ledgerTrack}>
                <option value="">Every unit</option>
                {#each entryTracks as [key, track] (key)}
                  <option value={key}>{trackLabel(track)}</option>
                {/each}
              </select>
            </label>
          {/if}

          <label class="picker">
            <span class="sr-only">Source</span>
            <select bind:value={ledgerSource}>
              {#each SOURCES as source (source.id)}
                <option value={source.id}>{source.label}</option>
              {/each}
            </select>
          </label>

          {#if ledgerNode}
            <button
              type="button"
              class="chip"
              on:click={() => (ledgerNode = "")}
              title="Show every entry again"
            >
              In {ledgerNodeLabel} <span aria-hidden="true">✕</span>
            </button>
          {/if}

          {#if hasLedgerFilter}
            <button type="button" class="link" on:click={clearLedgerFilters}>
              Clear filters
            </button>
          {/if}
        </div>

        <div class="totals">
          <span class="count">
            {filteredEntries.length}
            {filteredEntries.length === 1 ? "entry" : "entries"}
            {#if filteredEntries.length !== entries.length}
              <span class="text-gray-500">of {entries.length}</span>
            {/if}
          </span>
          <!-- One total per unit: hours are not euros, and this repo has no
               exchange rate that could honestly merge them. -->
          {#each ledgerTotals as total (total.key)}
            <span class="total">
              <span class="text-gray-500">{totalLabel(total)}</span>
              <span class="in">+{formatTotal(total, total.totalIn)}</span>
              <span class="out">−{formatTotal(total, total.totalOut)}</span>
            </span>
          {/each}
        </div>

        {#if !filteredEntries.length}
          <p class="text-gray-400 py-10 text-center">
            No entry matches that. <button
              type="button"
              class="link"
              on:click={clearLedgerFilters}>Clear the filters</button
            > to see them all.
          </p>
        {:else}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <button
                      type="button"
                      class="sort"
                      on:click={() => (newestFirst = !newestFirst)}
                      aria-label={newestFirst
                        ? "Sorted newest first; show oldest first"
                        : "Sorted oldest first; show newest first"}
                    >
                      Date <span aria-hidden="true">{newestFirst ? "↓" : "↑"}</span>
                    </button>
                  </th>
                  <th scope="col">Entry</th>
                  <th scope="col">Description</th>
                  <th scope="col">Grouped as</th>
                  <th scope="col">Source</th>
                  <th scope="col" class="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {#each visibleEntries as entry (entry.id)}
                  <tr class:derived={entry.derived}>
                    <td class="date" title={stampFmt.format(entry.timestamp)}>
                      {dateFmt.format(entry.timestamp)}
                    </td>
                    <td>
                      <span class="party">
                        <span class="arrow {entry.direction}" aria-hidden="true">
                          {entry.direction === "in" ? "↓" : "↑"}
                        </span>
                        <span class="sr-only">
                          {entry.direction === "in" ? "In from" : "Out to"}
                        </span>
                        {entry.party}
                      </span>
                      {#if others(entry).length}
                        <!-- Everyone else named on the record, so a shared cost
                             can be read without opening it. -->
                        <span class="with">with {others(entry).join(", ")}</span>
                      {/if}
                    </td>
                    <td class="desc">
                      {entry.description}
                      {#if entry.derived}
                        <span class="badge">rule</span>
                      {/if}
                    </td>
                    <td>
                      <!-- The bar this row sits inside; clicking it narrows the
                           list to the rest of that bar's entries. -->
                      <button
                        type="button"
                        class="node"
                        title="Show only what is inside {entry.nodeLabel}"
                        on:click={() => {
                          ledgerNode = entry.nodeId;
                          ledgerTrack = ledgerTrackKey(entry);
                        }}
                      >
                        {entry.nodeLabel}
                      </button>
                    </td>
                    <td class="src">{sourceLabel(entry.source)}</td>
                    <td class="right amount {entry.direction}">
                      {entry.direction === "in" ? "+" : "−"}{formatEntry(entry)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if filteredEntries.length > visibleEntries.length}
            <button
              type="button"
              class="more"
              on:click={() => (rowLimit += PAGE)}
            >
              Show {Math.min(PAGE, filteredEntries.length - visibleEntries.length)}
              more
            </button>
          {/if}
        {/if}
      </section>
    {/if}

    {#if collectiveError}
      <p class="text-sm text-amber-400 mt-4">{collectiveError}</p>
    {/if}
  {/if}

  {#if selected}
    <div class="detail">
      <span class="font-medium">{selected.label}</span>
      <span class="text-teal-300">{formatMovement(selected.value)}</span>
      <button type="button" class="ml-2 text-gray-400" on:click={() => (selected = null)}>
        ✕
      </button>
    </div>
  {/if}
</div>

<style>
  .k {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94a3b8;
  }

  .v {
    font-size: 1.3rem;
    color: #e2e8f0;
  }

  .seg {
    display: flex;
    background: #1e293b;
    border-radius: 9999px;
    padding: 2px;
  }

  .seg button {
    padding: 0.3rem 0.8rem;
    border-radius: 9999px;
    font-size: 0.82rem;
    color: #94a3b8;
  }

  .seg button.active {
    background: #0f766e;
    color: #f0fdfa;
  }

  .detail {
    position: fixed;
    bottom: 1.2rem;
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 9999px;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 14rem;
    flex: 1 1 16rem;
    max-width: 24rem;
  }

  .search-icon {
    position: absolute;
    left: 0.6rem;
    width: 15px;
    height: 15px;
    fill: none;
    stroke: #94a3b8;
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
  }

  .search input {
    width: 100%;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 0.5rem;
    color: #e2e8f0;
    font-size: 0.875rem;
    padding: 0.45rem 0.7rem 0.45rem 2rem;
  }

  .search input:focus {
    outline: none;
    border-color: #0f766e;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .picker select {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 9999px;
    color: #cbd5e1;
    font-size: 0.82rem;
    padding: 0.35rem 0.7rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    background: #0f766e;
    color: #f0fdfa;
    border-radius: 9999px;
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
  }

  .link {
    color: #5eead4;
    font-size: 0.8rem;
    text-decoration: underline;
  }

  .totals {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.1rem;
    font-size: 0.82rem;
    color: #cbd5e1;
    margin-bottom: 0.6rem;
  }

  .count {
    color: #94a3b8;
  }

  .total {
    display: inline-flex;
    gap: 0.45rem;
    align-items: baseline;
  }

  .in {
    color: #5eead4;
  }

  .out {
    color: #fca5a5;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid #1e293b;
    border-radius: 0.6rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    min-width: 44rem;
  }

  thead th {
    text-align: left;
    font-weight: 500;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94a3b8;
    padding: 0.5rem 0.75rem;
    background: #131c2e;
    white-space: nowrap;
  }

  tbody td {
    padding: 0.55rem 0.75rem;
    border-top: 1px solid #1e293b;
    vertical-align: top;
  }

  tbody tr:hover {
    background: #16202f;
  }

  tbody tr.derived td {
    color: #94a3b8;
  }

  .date {
    color: #94a3b8;
    white-space: nowrap;
  }

  .party {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    color: #e2e8f0;
  }

  .arrow.in {
    color: #5eead4;
  }

  .arrow.out {
    color: #fca5a5;
  }

  .with {
    display: block;
    color: #64748b;
    font-size: 0.75rem;
    margin-left: 1.1rem;
  }

  .desc {
    color: #cbd5e1;
    max-width: 22rem;
  }

  .badge {
    display: inline-block;
    background: #1e293b;
    color: #94a3b8;
    border-radius: 9999px;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.05rem 0.4rem;
    margin-left: 0.3rem;
  }

  .node {
    display: block;
    color: #7dd3fc;
    font-size: 0.8rem;
    text-align: left;
  }

  .node:hover {
    text-decoration: underline;
  }

  .src {
    color: #64748b;
    font-size: 0.72rem;
  }

  .right {
    text-align: right;
  }

  .amount {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .amount.in {
    color: #5eead4;
  }

  .amount.out {
    color: #fca5a5;
  }

  .sort {
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
  }

  .more {
    margin-top: 0.7rem;
    background: #1e293b;
    border-radius: 0.5rem;
    color: #cbd5e1;
    font-size: 0.82rem;
    padding: 0.45rem 0.9rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
