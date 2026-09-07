<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The optional Flows board: where the holon's value comes from, where it goes,
  // and how it is meant to be shared out.
  //
  // Two Sankeys over one core domain. MOVEMENT answers "what came in and went
  // out" from the expenses lens, the REA stream and (when a collective is
  // configured) OpenCollective. FUND ALLOCATION RIGHTS answers "who may direct
  // the fund, and by how much" — the interior/exterior split behind the
  // dashboard's Flow Management, applied to the collective's real money so it
  // reads as amounts rather than knobs — and, with a collective, "how much of
  // each right is already gone": every party is one bar, whichever seats
  // feed it, stacked into spent / claimed / available, read from the expenses
  // lens as mutual credit with the holon and from the collective's own
  // expense queue (core `flows/usage`).
  //
  // The View pill picks one of three things to look at, and nothing else
  // changes the shape of the board:
  //
  //   MY BALANCE — the viewer's account, the way a banking app opens: their
  //     fund allocation right as a balance (core `fundAccount`: right, spent,
  //     claimed, available), then where they stand in the shared tab with a
  //     way to settle each debt (BalancesView, mine).
  //   ALL BALANCES — everyone's mutual credit: who is owed, who owes, the
  //     fewest transfers that square it, the records (BalancesView).
  //   GRAPH — the two Sankeys: movement, and the fund allocation rights.
  //
  // The Show pill (Personal / Local / Global) only FILTERS items, as it does
  // on every other board: Personal keeps the rows, transfers and records the
  // viewer is part of, and the movement the viewer took part in. Balances
  // and rights are computed over the whole tab and the whole fund under
  // every scope — half a split is nobody's debt, and half a fund is nobody's
  // right.
  //
  // Units never mix. Kudos are not hours and hours are not euros, this repo has
  // no exchange rates, and inventing one would be a lie — so each unit gets its
  // own track and the pill switches between them.
  //
  // Data rules inherited from StatusView, both learned the hard way:
  //   - `rea_events` is read with a one-shot `getAll` and a retry backoff, never
  //     a subscription: a live watch on that large lens re-renders on every event.
  //   - every `await` is followed by a holon-identity check, so a holon switch
  //     mid-load cannot paint the previous holon's numbers.
  // `expenses` is small enough to subscribe to normally.

  import { onMount } from "svelte";
  import { holonId, rotationHold, flowsViewMode, scope } from "$lib/stores";
  import { t, locale, type MessageKey, type Translator } from "$lib/i18n";
  import {
    getHolonName,
    getHolosphere,
    subscribeLens,
    type Subscription,
  } from "$lib/holosphere";
  import type { HoloSphere } from "holosphere";
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
    fundAccount,
    buildValueFlows,
    filterLedger,
    layoutSankey,
    nodeBreakdown,
    sortLedger,
    readAllocationConfig,
    readCollectiveSlug,
    readZoneAssignments,
    readZonePeople,
    rightsTotal,
    toAllocationPartners,
    usageOf,
    usageTotals,
    usageUnits,
    type AllocationSlice,
    type FundUsage,
    type FundUsageParty,
    type BreakdownRow,
    type LedgerEntry,
    type OpenCollectiveSnapshot,
    type SankeyLayoutLink,
    type SankeyLayoutNode,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { loadSettings } from "@holons/core/settings";
  import { buildNameMap } from "@holons/core/identity";
  import {
    coerceSplitWith,
    expenseCurrencies,
    normalizeCurrency,
    participantIds,
    type Expense,
  } from "@holons/core/expenses";
  import { currentUser, displayName, loginOpen } from "$lib/auth";
  import { get } from "svelte/store";
  import AllocationSettings from "$lib/components/AllocationSettings.svelte";
  import SankeyChart from "$lib/components/SankeyChart.svelte";
  import PillSwitch from "$lib/components/PillSwitch.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import BalancesView from "./BalancesView.svelte";

  // Window options. 90 days is the default: long enough that a quiet month
  // still shows structure, short enough to describe the holon as it is now.
  const WINDOWS = [
    { id: "30", labelKey: "flows.window30" as MessageKey, days: 30 },
    { id: "90", labelKey: "flows.window90" as MessageKey, days: 90 },
    { id: "all", labelKey: "flows.windowAll" as MessageKey, days: null },
  ] as const;

  let hid: string | null = null;
  let loading = true;
  let loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let expensesSub: Subscription | undefined;
  let usersSub: Subscription | undefined;

  let events: REAEvent[] = [];
  let expenses: Expense[] = [];
  let settings: any = null;
  let usersById: Record<string, any> = {};
  let collective: OpenCollectiveSnapshot | null = null;
  let collectiveError = "";
  let equation: ScoreEquation = DEFAULT_EQUATION;
  // The federation record's partner ids; zones and names are derived below so
  // a settings doc or a resolved name arriving later still lands on the board.
  let federated: string[] = [];

  let windowId: string = "90";
  let trackId = "";
  let selected: SankeyLayoutNode | null = null;
  // Which chart the tap came from: node ids repeat across the two ("+n more"
  // rollups above all), so the sheet must not look a movement bar up in the
  // allocation graph.
  let selectedChart: "movement" | "allocation" = "movement";
  // The detail modal must format in the unit of the chart the tap came from —
  // an allocation node shown with the movement track's currency would lie.
  let selectedFormat: (value: number) => string = (v) => String(Math.round(v));

  $: windowDays = WINDOWS.find((w) => w.id === windowId)?.days ?? 90;

  // ── Derived: the movement graph ─────────────────────────────────────────
  // Recomputed from in-memory arrays, so a pill tap is instant and costs no
  // reads. `nameOf` resolves ids through the same map the rest of the kiosk uses.
  // Priority order is reaUsers < profiles, so a real users-lens profile wins
  // over the username the event stream happened to carry.
  $: nameMap = buildNameMap({
    reaUsers: extractReaUsers(events),
    profiles: Object.values(usersById),
  });

  // ── Names for ids the name map cannot know ──────────────────────────────
  // The users lens and the REA stream name people. A HOLON id — a federation
  // partner in the REA stream, or a personal holon nobody here has a profile
  // for — would otherwise print as its raw number on a Sankey bar. Those resolve the way the dock resolves
  // them: partner names from the federation record, then HNS / the holon's
  // settings through `getHolonName`, asked once per id and folded in as they
  // arrive. Only positive answers are kept, so a lookup that finds nothing
  // never re-asks and the derivation settles.
  let holonNames: Record<string, string> = {};
  let partnerNameMap: Record<string, string> = {};
  const askedNames = new Set<string>();
  let hsRef: HoloSphere | null = null;

  function queueName(id: string) {
    if (!hsRef || !hid || askedNames.has(id)) return;
    askedNames.add(id);
    const holon = hid;
    void getHolonName(hsRef, id).then((name) => {
      if (hid !== holon || !name) return;
      holonNames = { ...holonNames, [id]: name };
    });
  }

  /** The name for any id on the board, or undefined while still unknown. */
  $: nameFor = (id: string): string | undefined => {
    // `buildNameMap` stands in "#<id>" for a REA agent that carried no name;
    // that is a placeholder, not an answer, so keep looking past it.
    const mapped = nameMap.get(id);
    const known =
      (mapped && mapped !== `#${id}` ? mapped : undefined) ??
      partnerNameMap[id] ??
      holonNames[id] ??
      undefined;
    if (known) return known;
    if ($currentUser && id === String($currentUser.id)) {
      return displayName($currentUser);
    }
    if (id) queueName(id);
    return mapped;
  };

  // Partners with their rings and best-known names. Derived, not loaded: the
  // federation record and the settings doc arrive in either order, and a
  // partner placed on a ring must not be drawn unplaced because its zones
  // were read a moment too early.
  $: partners = toAllocationPartners(
    federated,
    partnerNameMap,
    readZoneAssignments(settings),
    readZonePeople(settings),
  ).map((p) => ({ ...p, name: nameFor(p.id) ?? p.name }));

  $: flowsInput = {
    holonId: hid ?? "",
    events: scopedEvents,
    expenses: scopedExpenses,
    collective,
    settings,
    windowDays,
    nameOf: nameFor,
    hubLabel: holonNames[hid ?? ""] ?? $t("flows.hub"),
  };
  $: graph = buildValueFlows(flowsInput);
  // The rows the diagram was drawn from — what a tapped bar lists when it has
  // no group of its own to break down into.
  $: ledger = buildLedger(flowsInput).entries;

  $: tracks = graph.tracks;

  // Keep the selected track valid as data streams in and tracks appear.
  $: if (tracks.length && !tracks.some((t) => trackKey(t) === trackId)) {
    trackId = trackKey(tracks[0]);
  }

  $: activeTrack = tracks.find((t) => trackKey(t) === trackId) ?? null;
  $: movementLayout = activeTrack ? layoutSankey(activeTrack) : null;

  $: trackOptions = tracks.map((track) => ({
    id: trackKey(track),
    label: trackLabel(track, $t),
  }));

  // ── Derived: the allocation graph ───────────────────────────────────────
  // Scores come from the same pipeline the Status board ranks with, so the two
  // views cannot disagree about who contributed what.
  let memberShares: { id: string; name: string; percentage: number }[] = [];

  $: allocationConfig = readAllocationConfig(settings);

  // ── Derived: fund usage ─────────────────────────────────────────────────
  // Every rights-holder, with the names a collective payee might carry so
  // OpenCollective's "Ada Lovelace" lands on the member the users lens calls
  // Ada. Usage needs a real pot, so it only exists with a collective.
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
  // A member also seated on a ring is one party, listed once.
  $: usageParties = [
    ...new Map(
      [
        ...memberShares.map((m) => ({ id: m.id, name: m.name })),
        ...partners
          .filter((p) => p.zone >= 1)
          .map((p) => ({ id: p.id, name: p.name })),
      ].map((p) => [
        p.id,
        { id: p.id, name: p.name, aliases: aliasesFor(usersById, p.id) },
      ]),
    ).values(),
  ] as FundUsageParty[];
  $: usage = collective
    ? buildFundUsage({
        holonId: hid ?? "",
        unit: collective.currency,
        parties: usageParties,
        expenses,
        collective,
        windowDays,
      })
    : null;
  $: usageTotal = usageTotals(usage);

  $: allocationResult = allocate({
    // The collective's money is the honest pot — what is in the bank plus what
    // rights-holders already drew, since a right that was spent still was one.
    // Without a collective, show the shape of the split as percentages rather
    // than pretending to an amount.
    total: collective ? rightsTotal(collective.balance, usage) : null,
    unit: collective?.currency ?? "",
    config: allocationConfig,
    members: memberShares,
    zoned: partners,
  });
  $: allocationTrack = allocationToGraph(
    allocationResult,
    {
      pot: collective ? collective.name : $t("flows.allocationPot"),
      interior: $t("flows.interior"),
      exterior: $t("flows.exterior"),
      spent: $t("flows.spent"),
      claimed: $t("flows.claimed"),
      available: $t("flows.available"),
      over: $t("flows.over"),
      unattributed: $t("flows.unattributed"),
    },
    usage,
  );
  $: allocationLayout = layoutSankey(allocationTrack);

  // ── Derived: the viewer's account ───────────────────────────────────────
  // The same allocation and usage the diagram is drawn from, read for one
  // person. Null means "no right here", which the card says in words rather
  // than printing zeros that look like an empty account.
  $: selfId = $currentUser ? String($currentUser.id) : null;
  $: myAccount = selfId ? fundAccount(allocationResult, usage, selfId) : null;
  $: windowLabel = $t(
    WINDOWS.find((w) => w.id === windowId)?.labelKey ?? "flows.window90",
  );
  // A statement shows cents; the diagram rounds to whole units.
  $: formatAccount = collective
    ? moneyFormatter(collective.currency, 2)
    : (v: number) => `${Math.round(v * 10) / 10}%`;
  $: sharePct = (pct: number) => String(Math.round(pct * 10) / 10);

  // ── The Show pill: which items feed the board ───────────────────────────
  // Personal keeps the expenses the viewer paid or shares and the events they
  // took part in. Anything else (Local, Global) is everything this holon has;
  // partner data is folded in by the subscription layer, not here.
  $: involvesMe = (e: Expense): boolean =>
    !!selfId &&
    (String(e?.paidBy) === selfId ||
      coerceSplitWith(e?.splitWith).map(String).includes(selfId));
  $: scopedExpenses =
    $scope === "personal" && selfId ? expenses.filter(involvesMe) : expenses;
  $: scopedEvents =
    $scope === "personal" && selfId
      ? events.filter(
          (e: any) =>
            String(e?.provider?.id ?? "") === selfId ||
            String(e?.receiver?.id ?? "") === selfId,
        )
      : events;

  // What is left to the rights-holders, as the diagram draws it: the sum of
  // every right less what it has already used, never below zero per right —
  // and what was taken beyond any right, read off the same stacked bars.
  $: availableTotal = segmentTotal(allocationTrack, "available");
  $: overTotal = segmentTotal(allocationTrack, "over");

  $: hasAllocation =
    memberShares.length > 0 || partners.some((p) => p.zone >= 1);

  // The ⚙ on the Allocation section: edit the split, the rings and the
  // collective in place. Login-gated like every kiosk write; after a save the
  // settings and the federation record are re-read so the board shows what
  // actually landed.
  let allocationOpen = false;
  function openAllocation() {
    if (!get(currentUser)) {
      loginOpen.set(true);
      return;
    }
    allocationOpen = true;
  }
  async function afterAllocationSave() {
    if (!hsRef || !hid) return;
    await loadHolonSettings(hsRef, hid);
    await loadFederation(hsRef, hid);
  }

  // ── Derived: the balances roster ────────────────────────────────────────
  // Everyone with any economic footprint — the users lens, the REA stream,
  // every payer and sharer on an expense, the viewer. People only: older bot
  // records could carry the holon id in a split, so it is dropped here.
  $: people = (() => {
    const ids = new Set<string>();
    for (const id of Object.keys(usersById)) ids.add(id);
    for (const u of extractReaUsers(events)) ids.add(String(u.id));
    for (const id of participantIds(expenses)) ids.add(id);
    if ($currentUser) ids.add(String($currentUser.id));
    if (hid) ids.delete(hid);
    const list = [...ids]
      .filter(Boolean)
      .map((id) => ({
        id,
        name:
          nameFor(id) ??
          usersById[id]?.first_name ??
          (id === String($currentUser?.id) ? $currentUser?.first_name : "") ??
          id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return list;
  })();

  // Every currency anyone has used or configured, normalized and deduped.
  $: currencies = [
    ...new Set(
      [
        ...expenseCurrencies(expenses),
        ...(
          (Array.isArray(settings?.currencies)
            ? settings.currencies
            : []) as unknown[]
        )
          .filter((c): c is string => typeof c === "string")
          .map(normalizeCurrency),
      ].filter(Boolean),
    ),
  ];

  // The pill's choice, kept valid as currencies appear; the first in use
  // otherwise, and USD only so a fresh holon can record its first expense.
  let currencyId = "";
  $: currency = currencies.includes(currencyId)
    ? currencyId
    : (currencies[0] ?? "usd");

  function trackKey(track: ValueFlowTrack): string {
    return `${track.id}:${track.unit}`;
  }

  /** A track's pill label: the currency code, or a translated unit name. */
  function trackLabel(track: ValueFlowTrack, tr: Translator): string {
    if (track.id === "time") return tr("flows.trackTime");
    if (track.id === "appreciation") return tr("flows.trackAppreciation");
    if (track.unit === "credit" || track.unit === "credits")
      return tr("flows.trackCredits");
    return track.unit.toUpperCase();
  }

  /**
   * Format a value in its track's unit. Money gets the locale's currency
   * formatting where the code is a real ISO one, and falls back to a plain
   * number with the unit appended where it is not (`credits`, `hours`).
   */
  function formatter(track: ValueFlowTrack | null): (value: number) => string {
    if (!track) return (v) => String(Math.round(v));
    const code = track.unit.toUpperCase();
    if (track.id === "money" && /^[A-Z]{3}$/.test(code)) {
      try {
        const fmt = new Intl.NumberFormat($locale, {
          style: "currency",
          currency: code,
          maximumFractionDigits: 0,
        });
        return (v) => fmt.format(v);
      } catch {
        // An unknown three-letter code (a holon's own scrip) is not a currency
        // Intl knows; fall through to the plain form rather than throwing.
      }
    }
    const fmt = new Intl.NumberFormat($locale, { maximumFractionDigits: 1 });
    const unit =
      track.id === "time"
        ? $t("flows.unitHours")
        : track.id === "appreciation"
          ? $t("flows.unitKudos")
          : track.unit;
    return (v) => `${fmt.format(v)} ${unit}`;
  }

  /**
   * Money in one unit with a fixed number of decimals — the statement and
   * the credit cards show cents where the diagram rounds. A real ISO code
   * gets the locale's currency form; a holon's own scrip is a number plus
   * its unit.
   */
  function moneyFormatter(unit: string, digits: number): (v: number) => string {
    const code = unit.toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      try {
        const nf = new Intl.NumberFormat($locale, {
          style: "currency",
          currency: code,
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
        return (v) => nf.format(v);
      } catch {
        // Not a currency Intl knows — fall through.
      }
    }
    const nf = new Intl.NumberFormat($locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return (v) => `${nf.format(v)} ${unit}`;
  }

  $: formatMovement = formatter(activeTrack);
  $: formatAllocation = collective
    ? formatter({ id: "money", unit: collective.currency } as ValueFlowTrack)
    : (v: number) => `${Math.round(v)}%`;

  // ── Hover details ────────────────────────────────────────────────────────
  // The tooltip's extra rows. Same semantics as the dashboard's Flows view, so
  // both surfaces say the same thing about the same picture — and the shares
  // quoted are the ACTUAL slice sums from `allocate()`, which since the
  // contract-parity change are exactly what the Bundle contract pays.

  const pctOf = (value: number) => `${Math.round(value * 10) / 10}%`;

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
    const percentage =
      (member?.percentage ?? 0) + (ring?.slice.percentage ?? 0);
    const amount =
      member?.amount == null && ring?.slice.amount == null
        ? null
        : (member?.amount ?? 0) + (ring?.slice.amount ?? 0);
    return { id, member, ring, percentage, amount };
  }

  function allocationDetails(
    node: SankeyLayoutNode,
  ): { label: string; value: string }[] {
    const interiorPct = allocationResult.interior.reduce(
      (sum, m) => sum + m.percentage,
      0,
    );
    const exteriorPct = allocationResult.exterior.reduce(
      (sum, z) => sum + z.percentage,
      0,
    );

    if (node.kind === "pot") {
      const rows = collective
        ? [
            { label: $t("flows.tipCollective"), value: collective.name },
            {
              label: $t("flows.balance"),
              value: formatAllocation(collective.balance),
            },
          ]
        : [];
      rows.push(
        { label: $t("flows.interior"), value: pctOf(interiorPct) },
        { label: $t("flows.exterior"), value: pctOf(exteriorPct) },
      );
      if (usage) {
        rows.push(
          {
            label: $t("flows.spent"),
            value: formatAllocation(usageTotal.spent),
          },
          {
            label: $t("flows.claimed"),
            value: formatAllocation(usageTotal.claimed),
          },
        );
      }
      return rows;
    }

    if (usage && node.id === UNATTRIBUTED_ID) {
      const rows = [
        { label: $t("flows.tipWhat"), value: $t("flows.tipUnattributedAbout") },
      ];
      const un = usageTotal.unattributed;
      if (un.spent > 0)
        rows.push({
          label: $t("flows.spent"),
          value: formatAllocation(un.spent),
        });
      if (un.claimed > 0)
        rows.push({
          label: $t("flows.claimed"),
          value: formatAllocation(un.claimed),
        });
      if (usage.unattributedPayees.length) {
        rows.push({
          label: $t("flows.tipPayees"),
          value: usage.unattributedPayees.join(", "),
        });
      }
      return rows;
    }

    if (node.kind === "interior") {
      return [
        { label: $t("flows.tipShareOfPot"), value: pctOf(interiorPct) },
        {
          label: $t("flows.tipMembers"),
          value: String(allocationResult.interior.length),
        },
        { label: $t("flows.tipSplitBy"), value: $t("flows.tipByContribution") },
      ];
    }

    if (node.kind === "exterior") {
      return [
        { label: $t("flows.tipShareOfPot"), value: pctOf(exteriorPct) },
        { label: $t("flows.zones"), value: String(allocationConfig.nzones) },
        { label: $t("flows.tipSplitBy"), value: $t("flows.tipByZone") },
      ];
    }

    const zone = findZone(node.id);
    if (zone) {
      const partnerNames = (zone.members ?? []).map((p) => p.label);
      return [
        { label: $t("flows.tipShareOfPot"), value: pctOf(zone.percentage) },
        {
          label: $t("flows.tipRing"),
          value: $t("flows.tipZoneN", { n: String(zone.zone) }),
        },
        {
          label: $t("flows.tipPartners"),
          value: partnerNames.length
            ? partnerNames.join(", ")
            : $t("flows.tipNoPartners"),
        },
      ];
    }

    const seats = findSeats(node.id);
    if (!seats) return [];

    // One bar, one total; then each seat that feeds it, when there is more
    // than one to tell apart.
    const rows = [
      { label: $t("flows.tipShareOfPot"), value: pctOf(seats.percentage) },
    ];
    const both = !!seats.member && !!seats.ring;
    if (seats.member) {
      rows.push({
        label: both ? $t("flows.interior") : $t("flows.tipSplitBy"),
        value: both
          ? formatAllocation(seats.member.amount ?? seats.member.percentage)
          : $t("flows.tipByContribution"),
      });
    }
    if (seats.ring) {
      rows.push({
        label: $t("flows.tipZoneN", { n: String(seats.ring.zone) }),
        value: both
          ? formatAllocation(
              seats.ring.slice.amount ?? seats.ring.slice.percentage,
            )
          : $t("flows.tipByZone"),
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
  function usageRows(
    partyId: string,
    right: number | null,
  ): { label: string; value: string }[] {
    if (!usage) return [];
    const rows: { label: string; value: string }[] = [];
    const use = usageOf(usage, partyId);
    if (right != null) {
      rows.push({
        label: $t("flows.tipRight"),
        value: formatAllocation(right),
      });
      const left = right - use.spent - use.claimed;
      rows.push({
        label: $t("flows.spent"),
        value: formatAllocation(use.spent),
      });
      rows.push({
        label: $t("flows.claimed"),
        value: formatAllocation(use.claimed),
      });
      rows.push(
        left >= 0
          ? { label: $t("flows.available"), value: formatAllocation(left) }
          : { label: $t("flows.over"), value: formatAllocation(-left) },
      );
    }
    for (const unit of usageUnits(usage, partyId)) {
      if (unit === usage.unit) continue;
      const other = usageOf(usage, partyId, unit);
      const fmt = formatter({ id: "money", unit } as ValueFlowTrack);
      if (other.spent > 0) {
        rows.push({
          label: `${$t("flows.spent")} · ${unit.toUpperCase()}`,
          value: fmt(other.spent),
        });
      }
      if (other.claimed > 0) {
        rows.push({
          label: `${$t("flows.claimed")} · ${unit.toUpperCase()}`,
          value: fmt(other.claimed),
        });
      }
    }
    return rows;
  }

  /** A ribbon says what its deeper end would say. */
  function allocationLinkDetails(
    link: SankeyLayoutLink,
  ): { label: string; value: string }[] {
    const node = allocationLayout?.nodes.find((n) => n.id === link.target);
    return node ? allocationDetails(node) : [];
  }

  $: shareLine = (pct: number) =>
    $t("flows.tipShareShown", { pct: String(pct) });

  // ── Tap sheet: who is behind a bar, and how much ────────────────────────
  // A bar is a sum; the sheet lists what it sums. Core decides the rows
  // (`nodeBreakdown`): out-links for a group, in-links for a sink, the
  // swallowed bars for a "+n more" rollup. A movement bar with no group of its
  // own lists the ledger rows it was drawn from instead.
  $: breakdown = (() => {
    if (!selected) return { side: "out" as const, rows: [] as BreakdownRow[] };
    if (selectedChart === "allocation") {
      const rows = nodeBreakdown(
        allocationTrack,
        allocationLayout,
        selected.id,
      );
      if (selected.id === UNATTRIBUTED_ID && usage) {
        // The payees the collective named, in the pot's currency.
        const payees: BreakdownRow[] = usage.unattributedPayees
          .filter((p) => p.unit === usage.unit)
          .map((p) => ({
            id: `payee-${p.name}`,
            label:
              p.spent > 0 && p.claimed > 0
                ? p.name
                : `${p.name} · ${p.spent > 0 ? $t("flows.spent") : $t("flows.claimed")}`,
            value: p.spent + p.claimed,
          }));
        if (payees.length) return { side: "out" as const, rows: payees };
      }
      return rows;
    }
    if (!activeTrack || !movementLayout)
      return { side: "out" as const, rows: [] };
    return nodeBreakdown(activeTrack, movementLayout, selected.id);
  })();

  $: selectedEntries =
    selected && selectedChart === "movement" && breakdown.rows.length === 0
      ? sortLedger(
          filterLedger(ledger, { track: trackId, nodeId: selected.id }),
        )
      : ([] as LedgerEntry[]);

  $: entryDate = (ts: number) =>
    new Intl.DateTimeFormat($locale, { day: "numeric", month: "short" }).format(
      new Date(ts),
    );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  onMount(() => {
    const unsub = holonId.subscribe((h) => {
      if (h !== hid) void bind(h);
    });
    return () => {
      unsub();
      teardown();
      rotationHold.set(false);
    };
  });

  function teardown() {
    hid = null;
    expensesSub?.unsubscribe();
    expensesSub = undefined;
    usersSub?.unsubscribe();
    usersSub = undefined;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (loadingFallbackTimer) clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }

  async function bind(holon: string | null) {
    teardown();
    hid = holon;
    events = [];
    expenses = [];
    collective = null;
    collectiveError = "";
    holonNames = {};
    partnerNameMap = {};
    askedNames.clear();
    hsRef = null;
    memberShares = [];
    federated = [];
    loading = true;

    if (!holon) {
      loading = false;
      return;
    }

    // Armed BEFORE the first await: a slow relay (or the retry backoff below)
    // must never be able to pin the board on "reading" forever.
    loadingFallbackTimer = setTimeout(() => {
      loading = false;
    }, 9000);

    let hs: HoloSphere;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] flows: failed to connect", err);
      loading = false;
      return;
    }
    if (hid !== holon) return; // holon changed while connecting
    hsRef = hs;
    // The board's own name, for its hub bar and its seat at the table.
    queueName(holon);

    // Small lenses: safe to subscribe.
    expensesSub = subscribeLens(hs, holon, "expenses", (items) => {
      expenses = items as Expense[];
    });
    usersSub = subscribeLens(hs, holon, "users", (items) => {
      const map: Record<string, any> = {};
      for (const u of items as any[]) {
        const id = String(u?.id ?? "");
        if (id) map[id] = u;
      }
      usersById = map;
    });

    void loadEquation(hs, holon)
      .then((eq) => {
        if (hid !== holon) return;
        equation = eq;
        void rescoreMembers();
      })
      .catch((err) => console.warn("[kiosk] flows: equation load failed", err));

    void loadHolonSettings(hs, holon);
    void loadFederation(hs, holon);

    // Registered before the first load awaits so teardown always clears it.
    refreshTimer = setInterval(() => void refreshEvents(hs, holon), 30_000);
    await refreshEvents(hs, holon);
  }

  /** Settings carry the treasury rate, the allocation split and the OC slug. */
  async function loadHolonSettings(hs: HoloSphere, holon: string) {
    try {
      const doc = await loadSettings(hs, holon);
      if (hid !== holon) return;
      settings = doc;
      const slug = readCollectiveSlug(doc);
      if (slug) void loadCollective(slug, holon);
      else {
        collective = null;
        collectiveError = "";
      }
    } catch (err) {
      console.warn("[kiosk] flows: settings load failed", err);
    }
  }

  /** Federated partners are the reciprocity zones; their rings come from settings. */
  async function loadFederation(hs: HoloSphere, holon: string) {
    try {
      const snapshot = await getFederationSnapshot(hs, holon);
      if (hid !== holon) return;
      partnerNameMap = snapshot.partnerNames ?? {};
      federated = snapshot.federated ?? [];
    } catch (err) {
      console.warn("[kiosk] flows: federation load failed", err);
    }
  }

  /**
   * The collective, through this deploy's relay route.
   *
   * A failure here is never fatal: the movement board still has the expenses
   * and REA halves, and the allocation board falls back to percentages.
   */
  async function loadCollective(slug: string, holon: string) {
    try {
      const resp = await fetch(
        `/api/opencollective?slug=${encodeURIComponent(slug)}`,
      );
      if (hid !== holon) return;
      const body = await resp.json();
      if (!resp.ok) {
        collectiveError = String(body?.error ?? "");
        return;
      }
      collective = body as OpenCollectiveSnapshot;
      collectiveError = "";
    } catch (err) {
      console.warn("[kiosk] flows: collective load failed", err);
      collectiveError = $t("flows.collectiveFailed");
    }
  }

  /**
   * Read the holon's REA events with a one-shot `getAll`, retried with backoff:
   * the stream replicates shortly after we connect, so an immediate read can
   * race and come back empty.
   */
  async function refreshEvents(hs: HoloSphere, holon: string) {
    for (const delay of [0, 600, 1500, 3000]) {
      if (delay) await sleep(delay);
      if (hid !== holon) return; // holon switched mid-load
      let all: any[] = [];
      try {
        all = (await hs.getAll(holon, "rea_events")) as any[];
      } catch (err) {
        console.error("[kiosk] flows: failed to read rea_events", err);
      }
      if (Array.isArray(all) && all.length) {
        events = all;
        loading = false;
        await rescoreMembers();
        return;
      }
    }
    // Still nothing after the retries: settle to the empty state rather than
    // spinning.
    loading = false;
  }

  /**
   * Member shares for the interior, scored the same way the Status board ranks.
   *
   * Scoring runs against an IN-MEMORY view of the events, so each per-user
   * aggregate query reads the cached array instead of hitting the store.
   */
  async function rescoreMembers() {
    const holon = hid;
    if (!holon || !events.length) {
      memberShares = [];
      return;
    }
    try {
      const aggregator = new REAAggregator(
        new REAEventStore({ getAll: async () => events } as any),
      );
      const roster = extractReaUsers(events);
      const merged = new Map<string, { id: string; name?: string }>();
      for (const u of roster) merged.set(String(u.id), u);
      for (const [id, u] of Object.entries(usersById)) {
        merged.set(id, { id, name: u?.first_name ?? u?.username ?? id });
      }
      const scored = await computeHolonUserScores(
        aggregator,
        holon,
        [...merged.values()] as never,
        equation,
      );
      if (hid !== holon) return; // a holon switch beat us home
      memberShares = scored
        .filter((s) => s.percentage > 0)
        .map((s) => ({
          id: String(s.userId),
          name: nameFor(String(s.userId)) ?? String(s.userId),
          percentage: s.percentage,
        }));
    } catch (err) {
      console.warn("[kiosk] flows: scoring failed", err);
      memberShares = [];
    }
  }

  // Suspend auto-rotation while the detail sheet is open so the screen cannot
  // flip away mid-read.
  $: rotationHold.set(selected != null || allocationOpen);
</script>

<div class="board">
  <div class="scrollarea scroll">
    {#if loading}
      <p class="empty">{$t("flows.loading")}</p>
    {:else if $flowsViewMode === "mine"}
      <!-- ── My balance ─────────────────────────────────────────────────── -->
      {#if !$currentUser}
        <button class="account-line" on:click={() => loginOpen.set(true)}>
          {$t("flows.accountSignIn")}
        </button>
      {:else}
        <!-- The fund: what you may still direct, as a balance. -->
        <section class="hero">
          {#if myAccount}
            <div class="account" class:over={myAccount.over > 0}>
              <div class="account-head">
                <div>
                  <div class="k">{$t("flows.accountTitle")}</div>
                  <div class="account-sub">
                    {collective
                      ? $t("flows.accountAbout", { name: collective.name })
                      : $t("flows.accountAboutShares")}
                  </div>
                </div>
                <span class="chip"
                  >{$t("flows.accountShare", {
                    pct: sharePct(myAccount.percentage),
                  })}</span
                >
              </div>
              {#if myAccount.right != null}
                <div class="account-main">
                  <span class="k"
                    >{myAccount.over > 0
                      ? $t("flows.accountOverBy")
                      : $t("flows.available")}</span
                  >
                  <span class="v"
                    >{formatAccount(
                      myAccount.over > 0
                        ? myAccount.over
                        : (myAccount.available ?? 0),
                    )}</span
                  >
                </div>
                <dl class="statement">
                  <div>
                    <dt>{$t("flows.accountRight")}</dt>
                    <dd>{formatAccount(myAccount.right)}</dd>
                  </div>
                  <div>
                    <dt>{$t("flows.spent")} · {windowLabel}</dt>
                    <dd class="debit">−{formatAccount(myAccount.spent)}</dd>
                  </div>
                  <div>
                    <dt>{$t("flows.claimed")}</dt>
                    <dd class="debit">−{formatAccount(myAccount.claimed)}</dd>
                  </div>
                  {#each myAccount.otherUnits as other (other.unit)}
                    {#if other.spent > 0}
                      <div class="foot">
                        <dt>
                          {$t("flows.spent")} · {other.unit.toUpperCase()}
                        </dt>
                        <dd>{moneyFormatter(other.unit, 2)(other.spent)}</dd>
                      </div>
                    {/if}
                    {#if other.claimed > 0}
                      <div class="foot">
                        <dt>
                          {$t("flows.claimed")} · {other.unit.toUpperCase()}
                        </dt>
                        <dd>{moneyFormatter(other.unit, 2)(other.claimed)}</dd>
                      </div>
                    {/if}
                  {/each}
                  <div class="foot">
                    <dt>{$t("flows.accountVia")}</dt>
                    <dd>
                      {myAccount.side === "interior"
                        ? myAccount.zone != null
                          ? `${$t("flows.interior")} · ${$t("flows.tipZoneN", { n: String(myAccount.zone) })}`
                          : $t("flows.interior")
                        : $t("flows.tipZoneN", { n: String(myAccount.zone) })}
                    </dd>
                  </div>
                </dl>
              {:else}
                <div class="account-main">
                  <span class="k">{$t("flows.accountRight")}</span>
                  <span class="v">{sharePct(myAccount.percentage)}%</span>
                </div>
                <p class="account-sub">{$t("flows.accountNoPot")}</p>
              {/if}
            </div>
          {:else}
            <div class="account none">
              <div class="k">{$t("flows.accountTitle")}</div>
              <p class="account-sub">{$t("flows.accountNone")}</p>
            </div>
          {/if}
        </section>

        <!-- The shared tab: what you owe and are owed, and a way to settle. -->
        <BalancesView
          holonId={hid ?? ""}
          {expenses}
          {people}
          {currencies}
          {currency}
          mine
          onCurrency={(c) => (currencyId = c)}
        />
      {/if}
    {:else if $flowsViewMode === "balances"}
      <!-- ── All balances ───────────────────────────────────────────────── -->
      <BalancesView
        holonId={hid ?? ""}
        {expenses}
        {people}
        {currencies}
        {currency}
        filterMine={$scope === "personal"}
        onCurrency={(c) => (currencyId = c)}
      />
    {:else}
      <!-- ── Graph ──────────────────────────────────────────────────────── -->
      {#if !tracks.length && !hasAllocation}
        <p class="empty">{$t("flows.empty")}</p>
      {/if}
      <!-- Movement -->
      {#if tracks.length}
        <section>
          <header class="head">
            <div class="titles">
              <h2>{$t("flows.movementTitle")}</h2>
              <p class="sub">{$t("flows.movementAbout")}</p>
            </div>
            <div class="controls">
              {#if trackOptions.length > 1}
                <PillSwitch
                  options={trackOptions}
                  value={trackId}
                  onChange={(id) => (trackId = id)}
                  label={$t("flows.trackLabel")}
                  showText
                />
              {/if}
              <PillSwitch
                options={WINDOWS.map((w) => ({
                  id: w.id,
                  label: $t(w.labelKey),
                }))}
                value={windowId}
                onChange={(id) => (windowId = id)}
                label={$t("flows.windowLabel")}
                showText
              />
            </div>
          </header>

          {#if activeTrack}
            <div class="stats">
              <div class="stat">
                <span class="k">{$t("flows.in")}</span>
                <span class="v">{formatMovement(activeTrack.totalIn)}</span>
              </div>
              <div class="stat">
                <span class="k">{$t("flows.out")}</span>
                <span class="v">{formatMovement(activeTrack.totalOut)}</span>
              </div>
              {#if activeTrack.balance != null}
                <div class="stat">
                  <span class="k">{$t("flows.balance")}</span>
                  <span class="v">{formatMovement(activeTrack.balance)}</span>
                </div>
              {/if}
            </div>

            <SankeyChart
              layout={movementLayout}
              format={formatMovement}
              {shareLine}
              onSelect={(n) => {
                selectedFormat = formatMovement;
                selectedChart = "movement";
                selected = n;
              }}
            >
              <p slot="empty" class="empty">{$t("flows.emptyTrack")}</p>
            </SankeyChart>
          {/if}
        </section>
      {/if}

      <!-- Allocation. The header (and its ⚙) is always there: somebody has
           to be able to place the first partner or name the collective. -->
      <section>
        <header class="head">
          <div class="titles">
            <h2>{$t("flows.allocationTitle")}</h2>
            <p class="sub">
              {collective
                ? $t("flows.allocationAboutFunds", { name: collective.name })
                : $t("flows.allocationAboutShares")}
            </p>
          </div>
          <button
            class="gear"
            on:click={openAllocation}
            aria-label={$t("alloc.settings")}
            title={$t("alloc.settings")}>⚙</button
          >
        </header>
        {#if hasAllocation}
          <div class="stats">
            <div class="stat">
              <span class="k">{$t("flows.interior")}</span>
              <span class="v">{allocationConfig.interiorPercent}%</span>
            </div>
            <div class="stat">
              <span class="k">{$t("flows.exterior")}</span>
              <span class="v">{100 - allocationConfig.interiorPercent}%</span>
            </div>
            <div class="stat">
              <span class="k">{$t("flows.zones")}</span>
              <span class="v">{allocationConfig.nzones}</span>
            </div>
            {#if usage && collective}
              <!-- These double as the legend for the stacked bars. -->
              <div class="stat">
                <span class="k"
                  ><i class="swatch spent"></i>{$t("flows.spent")}</span
                >
                <span class="v">{formatAllocation(usageTotal.spent)}</span>
              </div>
              <div class="stat">
                <span class="k"
                  ><i class="swatch claimed"></i>{$t("flows.claimed")}</span
                >
                <span class="v">{formatAllocation(usageTotal.claimed)}</span>
              </div>
              <div class="stat">
                <span class="k"
                  ><i class="swatch available"></i>{$t("flows.available")}</span
                >
                <span class="v">{formatAllocation(availableTotal)}</span>
              </div>
              {#if overTotal > 0}
                <div class="stat">
                  <span class="k"
                    ><i class="swatch over"></i>{$t("flows.over")}</span
                  >
                  <span class="v">{formatAllocation(overTotal)}</span>
                </div>
              {/if}
            {/if}
          </div>

          <SankeyChart
            layout={allocationLayout}
            format={formatAllocation}
            {shareLine}
            nodeDetails={allocationDetails}
            linkDetails={allocationLinkDetails}
            onSelect={(n) => {
              selectedFormat = formatAllocation;
              selectedChart = "allocation";
              selected = n;
            }}
          >
            <p slot="empty" class="empty">{$t("flows.emptyAllocation")}</p>
          </SankeyChart>
        {:else}
          <p class="empty">{$t("flows.emptyAllocation")}</p>
        {/if}
      </section>

      {#if collectiveError}
        <p class="note">{collectiveError}</p>
      {/if}
    {/if}
  </div>
</div>

{#if allocationOpen}
  <AllocationSettings
    holonId={hid ?? ""}
    config={allocationConfig}
    zones={readZoneAssignments(settings)}
    zonePeople={readZonePeople(settings)}
    partners={partners
      .filter((p) => p.kind !== "person")
      .map((p) => ({ id: p.id, name: p.name }))}
    candidates={people.filter((p) => p.id !== hid)}
    collectiveSlug={readCollectiveSlug(settings)}
    on:close={() => (allocationOpen = false)}
    on:saved={() => void afterAllocationSave()}
  />
{/if}

{#if selected}
  <Modal on:close={() => (selected = null)}>
    <div class="detail">
      <h3>{selected.label}</h3>
      <p class="amount">{selectedFormat(selected.value)}</p>
      {#if selectedChart === "allocation"}
        <dl class="detail-rows">
          {#each allocationDetails(selected) as row (row.label)}
            <div class="detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
      {#if breakdown.rows.length}
        <!-- Who, and how much: the bars this one is made of. -->
        <table class="who">
          <caption
            >{breakdown.side === "in"
              ? $t("flows.whoFrom")
              : $t("flows.whoTo")}</caption
          >
          <tbody>
            {#each breakdown.rows as row (row.id)}
              <tr>
                <th scope="row">{row.label}</th>
                <td class="share"
                  >{selected.value > 0
                    ? `${Math.round((row.value / selected.value) * 100)}%`
                    : ""}</td
                >
                <td class="amt">{selectedFormat(row.value)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if selectedEntries.length}
        <!-- The ledger rows behind a bar that is one party's alone. -->
        <table class="who">
          <caption>{$t("flows.whoEntries")}</caption>
          <tbody>
            {#each selectedEntries.slice(0, 12) as e (e.id)}
              <tr>
                <th scope="row">
                  <span class="when">{entryDate(e.timestamp)}</span>
                  {e.party}{#if e.description}<span class="what"
                      >· {e.description}</span
                    >{/if}
                </th>
                <td class="amt">{selectedFormat(e.amount)}</td>
              </tr>
            {/each}
            {#if selectedEntries.length > 12}
              <tr class="more">
                <th scope="row" colspan="2"
                  >{$t("balances.showMore", {
                    n: String(selectedEntries.length - 12),
                  })}</th
                >
              </tr>
            {/if}
          </tbody>
        </table>
      {/if}
    </div>
  </Modal>
{/if}

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .scrollarea {
    flex: 1;
    min-height: 0;
    padding: 0.9rem 1.4rem 1.6rem;
  }

  section {
    margin-bottom: 2rem;
    animation: kiosk-rise 0.42s ease both;
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.6rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--ink);
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .gear {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 50%;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 1.25rem;
    display: grid;
    place-items: center;
    touch-action: manipulation;
  }

  .gear:active {
    transform: scale(0.92);
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

  .stat .k {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .stat .v {
    font-size: 1.3rem;
    color: var(--ink);
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

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 2.4rem 1rem;
  }

  .note {
    color: var(--muted);
    font-size: 0.82rem;
    text-align: center;
  }

  .detail {
    padding: 1.2rem 1.4rem;
    min-width: min(20rem, 80vw);
  }

  .detail h3 {
    margin: 0 0 0.3rem;
    color: var(--ink);
  }

  .amount {
    margin: 0;
    font-size: 1.6rem;
    color: var(--teal);
  }

  .detail-rows {
    margin: 0.7rem 0 0;
    display: grid;
    gap: 0.25rem;
  }

  .detail-row {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  .detail-row dt {
    color: var(--muted);
  }

  .detail-row dd {
    margin: 0;
    color: var(--ink);
    text-align: right;
  }

  .who {
    width: 100%;
    margin: 0.9rem 0 0;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .who caption {
    text-align: left;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding-bottom: 0.3rem;
  }
  .who th,
  .who td {
    padding: 0.35rem 0;
    border-top: 1px solid var(--line);
    vertical-align: baseline;
  }
  .who th {
    text-align: left;
    font-weight: 500;
    color: var(--ink);
    min-width: 0;
  }
  .who .share {
    color: var(--muted);
    text-align: right;
    padding-left: 0.6rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .who .amt {
    text-align: right;
    padding-left: 0.8rem;
    color: var(--teal-deep);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .who .when {
    color: var(--muted);
    font-size: 0.78rem;
    margin-right: 0.4rem;
  }
  .who .what {
    color: var(--muted);
    margin-left: 0.3rem;
  }
  .who .more th {
    color: var(--muted);
    font-size: 0.8rem;
  }

  /* ── Your account ──────────────────────────────────────────────────── */
  .account-line {
    display: block;
    width: 100%;
    margin: 0.2rem 0 0.9rem;
    padding: 0.7rem 1rem;
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-soft);
    color: var(--teal);
    font-size: 0.9rem;
    text-align: left;
    touch-action: manipulation;
  }

  /* The hero: the one card the personal scope opens with. */
  .hero {
    margin-bottom: 1.6rem;
  }
  .hero .account {
    margin: 0;
    padding: 1.2rem 1.4rem 1rem;
  }
  .hero .account-main .v {
    font-size: 2.6rem;
  }
  .account.none {
    border-left-color: var(--line);
  }
  .account.none .account-sub {
    margin-top: 0.3rem;
    font-size: 0.95rem;
    color: var(--ink-soft);
  }

  .account {
    margin: 0.2rem 0 1rem;
    padding: 0.9rem 1.1rem 0.8rem;
    border-radius: var(--radius);
    background: var(--card);
    box-shadow: var(--shadow-soft);
    border-left: 4px solid var(--teal);
  }
  .account.over {
    border-left-color: #c0392b;
  }

  .account-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .account .k {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .account-sub {
    margin: 0.1rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .chip {
    flex: none;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    background: var(--paper-deep);
    color: var(--ink-soft);
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .account-main {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin: 0.5rem 0 0.4rem;
  }
  .account-main .v {
    font-size: 2rem;
    line-height: 1.1;
    color: var(--teal);
    font-variant-numeric: tabular-nums;
  }
  .account.over .account-main .v {
    color: #c0392b;
  }
  :global(:root[data-theme="dark"]) .account.over .account-main .v,
  :global(:root[data-theme="dark"]) .statement .debit {
    color: #ff8a7a;
  }

  .statement {
    margin: 0;
    display: grid;
    gap: 0.15rem;
    font-size: 0.9rem;
  }
  .statement > div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.3rem 0;
    border-top: 1px solid var(--line);
  }
  .statement dt {
    color: var(--muted);
  }
  .statement dd {
    margin: 0;
    color: var(--ink);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .statement .debit {
    color: #c0392b;
  }
  .statement .foot dt,
  .statement .foot dd {
    font-size: 0.8rem;
    color: var(--muted);
  }
</style>
