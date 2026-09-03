<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The optional Flows board: where the holon's value comes from, where it goes,
  // and how it is meant to be shared out.
  //
  // Two Sankeys over one core domain. MOVEMENT answers "what came in and went
  // out" from the expenses lens, the REA stream and (when a collective is
  // configured) OpenCollective. ALLOCATION answers "where is it committed" —
  // the interior/exterior split behind the dashboard's Flow Management, applied
  // to the collective's real balance so it reads as money rather than knobs.
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
  import { holonId, rotationHold } from "$lib/stores";
  import { t, locale, type MessageKey, type Translator } from "$lib/i18n";
  import {
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
    allocate,
    allocationToGraph,
    buildValueFlows,
    layoutSankey,
    readAllocationConfig,
    readCollectiveSlug,
    readZoneAssignments,
    toAllocationPartners,
    type OpenCollectiveSnapshot,
    type SankeyLayoutLink,
    type SankeyLayoutNode,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { loadSettings } from "@holons/core/settings";
  import { buildNameMap } from "@holons/core/identity";
  import type { Expense } from "@holons/core/expenses";
  import SankeyChart from "$lib/components/SankeyChart.svelte";
  import PillSwitch from "$lib/components/PillSwitch.svelte";
  import Modal from "$lib/components/Modal.svelte";

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
  let partners: { id: string; name: string; zone: number }[] = [];

  let windowId: string = "90";
  let trackId = "";
  let selected: SankeyLayoutNode | null = null;
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

  $: graph = buildValueFlows({
    holonId: hid ?? "",
    events,
    expenses,
    collective,
    settings,
    windowDays,
    nameOf: (id) => nameMap.get(id),
    hubLabel: $t("flows.hub"),
  });

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
  $: allocationResult = allocate({
    // The collective balance is the honest pot; without one, show the shape of
    // the split as percentages rather than pretending to an amount.
    total: collective?.balance ?? null,
    unit: collective?.currency ?? "",
    config: allocationConfig,
    members: memberShares,
    zoned: partners,
  });
  $: allocationLayout = layoutSankey(
    allocationToGraph(allocationResult, {
      pot: collective ? collective.name : $t("flows.allocationPot"),
      interior: $t("flows.interior"),
      exterior: $t("flows.exterior"),
    }),
  );

  $: hasAllocation =
    memberShares.length > 0 || partners.some((p) => p.zone >= 1);

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

    const slice = findSlice(node.id);
    if (!slice) return [];

    const rows = [
      { label: $t("flows.tipShareOfPot"), value: pctOf(slice.percentage) },
    ];
    if (node.kind === "member") {
      rows.push({
        label: $t("flows.tipSplitBy"),
        value: $t("flows.tipByContribution"),
      });
    }
    if (node.kind === "zone") {
      const partnerNames = (slice.members ?? []).map((p) => p.label);
      rows.push({
        label: $t("flows.tipRing"),
        value: $t("flows.tipZoneN", { n: String(slice.zone) }),
      });
      rows.push({
        label: $t("flows.tipPartners"),
        value: partnerNames.length
          ? partnerNames.join(", ")
          : $t("flows.tipNoPartners"),
      });
    }
    if (node.kind === "partner" && slice.zone) {
      rows.push({
        label: $t("flows.tipRing"),
        value: $t("flows.tipZoneN", { n: String(slice.zone) }),
      });
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
    memberShares = [];
    partners = [];
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
    } catch (err) {
      console.warn("[kiosk] flows: settings load failed", err);
    }
  }

  /** Federated partners are the exterior; their zones come from settings. */
  async function loadFederation(hs: HoloSphere, holon: string) {
    try {
      const snapshot = await getFederationSnapshot(hs, holon);
      if (hid !== holon) return;
      const zones = readZoneAssignments(settings);
      partners = toAllocationPartners(
        snapshot.federated,
        snapshot.partnerNames,
        zones,
      );
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
          name: nameMap.get(String(s.userId)) ?? String(s.userId),
          percentage: s.percentage,
        }));
    } catch (err) {
      console.warn("[kiosk] flows: scoring failed", err);
      memberShares = [];
    }
  }

  // Suspend auto-rotation while the detail sheet is open so the screen cannot
  // flip away mid-read.
  $: rotationHold.set(selected != null);
</script>

<div class="board">
  <div class="scrollarea scroll">
    {#if loading}
      <p class="empty">{$t("flows.loading")}</p>
    {:else if !tracks.length && !hasAllocation}
      <p class="empty">{$t("flows.empty")}</p>
    {:else}
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
                selected = n;
              }}
            >
              <p slot="empty" class="empty">{$t("flows.emptyTrack")}</p>
            </SankeyChart>
          {/if}
        </section>
      {/if}

      <!-- Allocation -->
      {#if hasAllocation}
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
          </header>

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
          </div>

          <SankeyChart
            layout={allocationLayout}
            format={formatAllocation}
            {shareLine}
            nodeDetails={allocationDetails}
            linkDetails={allocationLinkDetails}
            onSelect={(n) => {
              selectedFormat = formatAllocation;
              selected = n;
            }}
          >
            <p slot="empty" class="empty">{$t("flows.emptyAllocation")}</p>
          </SankeyChart>
        </section>
      {/if}

      {#if collectiveError}
        <p class="note">{collectiveError}</p>
      {/if}
    {/if}
  </div>
</div>

{#if selected}
  <Modal on:close={() => (selected = null)}>
    <div class="detail">
      <h3>{selected.label}</h3>
      <p class="amount">{selectedFormat(selected.value)}</p>
      {#if allocationLayout?.nodes.some((n) => n.id === selected?.id)}
        <dl class="detail-rows">
          {#each allocationDetails(selected) as row (row.label)}
            <div class="detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          {/each}
        </dl>
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
</style>
