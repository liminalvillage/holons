<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The optional Status board: a simplified, read-only contribution leaderboard.
  // A trimmed cousin of the web dashboard's Status view — same numbers (it scores
  // through the one shared core pipeline) but without the pie chart, equation
  // editor, currency columns, or contract shares. Members are ranked by their
  // contribution score with a share bar; the value equation is read from settings
  // so the ranking matches the dashboard, but is never edited here.
  //
  // Self-contained and scoped to the kiosk's own holon (federation is out of
  // scope). It reads `rea_events` with a one-shot `getAll` (retried for the
  // replication race) and refreshes on an interval — deliberately NOT a live
  // subscription: a `map().on()` on that large lens triggers a Gun fire-storm.
  // Those events feed an in-memory store so all scoring runs offline/locally.
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { holonId, rawQuests, rotationHold } from "$lib/stores";
  import {
    getHolosphere,
    subscribeLens,
    type Subscription,
  } from "$lib/holosphere";
  import type { HoloSphere } from "holosphere";
  import { REAEventStore } from "@holons/core/rea";
  import {
    REAAggregator,
    computeHolonUserScores,
    loadEquation,
    extractReaUsers,
    DEFAULT_EQUATION,
    type ScoreEquation,
    type ReaUser,
    type UserAggregates,
    type ScoreBreakdown,
  } from "@holons/core/scoring";
  import {
    avatarUrl,
    avatarInitial,
    hideImg,
    showImg,
  } from "$lib/components/Avatars.svelte";
  import Modal from "$lib/components/Modal.svelte";

  type Row = {
    id: string;
    name: string;
    score: number;
    percentage: number;
    // Carried so the detail modal can explain how the score was reached.
    aggregates: UserAggregates;
    balances: Record<string, number>;
    breakdown: ScoreBreakdown;
  };

  let rows: Row[] = [];
  let loading = true;
  // The row whose score breakdown / ledger is open in the modal, or null.
  let selected: Row | null = null;

  // Per-holon scoring state. Rebound whenever the kiosk's holon changes.
  let hid: string | null = null;
  let aggregator: REAAggregator | null = null;
  // The holon's REA events, fetched one-shot and kept in memory. The aggregator
  // scores against this array (via an in-memory store), and the roster is
  // derived from it — so a single read serves the whole board.
  let events: any[] = [];
  // Starts as the canonical default so scoring never blocks on the settings
  // read; the holon's real equation is loaded off the critical path (see bind).
  let equation: ScoreEquation = DEFAULT_EQUATION;
  // The `users` lens, when populated — used for richer display names/avatars.
  // It is NOT the roster source: many holons never write profiles here, so the
  // roster is derived from REA activity (see `buildRoster`) and merely enriched
  // by this map.
  let usersById: Record<string, any> = {};

  let usersSub: Subscription | undefined;
  let rescoreTimer: ReturnType<typeof setTimeout> | null = null;
  // Periodic one-shot refresh of the event stream (no live subscription).
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  // Safety net: forces the loading state off if the data layer never settles.
  let loadingFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  // Monotonic guard so a slower score run can't overwrite a newer one's result.
  let scoreSeq = 0;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** Friendly display name, tolerating Telegram's snake_case member records. */
  function nameOf(u: any): string {
    const full = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
    return full || (u?.username ? `@${u.username}` : `#${u?.id ?? "?"}`);
  }

  /**
   * Real first/last names keyed by user id, harvested from quest participants and
   * initiators (the kiosk already streams `quests`). REA events only carry a
   * username, so this is what lets the board show "Anna Giunta" instead of
   * "@anna_flawsomeyoga". Only ids with an actual first/last name are mapped, so
   * we never downgrade a username to itself. Tolerates the participant
   * snake_case and the initiator camelCase shapes.
   */
  function questNameMap(): Map<string, string> {
    const m = new Map<string, string>();
    for (const q of get(rawQuests) as any[]) {
      const people = [
        ...(Array.isArray(q?.participants) ? q.participants : []),
        q?.initiator,
      ].filter(Boolean);
      for (const p of people) {
        if (p?.id == null) continue;
        const id = String(p.id);
        if (m.has(id)) continue;
        const full = [p.first_name ?? p.firstName, p.last_name ?? p.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (full) m.set(id, full);
      }
    }
    return m;
  }

  // ── Score breakdown (how the equation + ledger produced the score) ──────────

  type BreakdownLine = {
    label: string;
    count: number;
    weight: number;
    points: number;
  };

  /**
   * Display lines for the modal: each scored metric as `count × weight = points`,
   * skipping anything with a zero weight or zero count. Mirrors the dashboard's
   * Status breakdown so the explanation matches what people see on the web.
   */
  function breakdownLines(row: Row): BreakdownLine[] {
    const a = row.aggregates;
    const b = row.breakdown;
    const eq = equation;
    const lines: BreakdownLine[] = [];
    const flat: Array<[string, number, number, number]> = [
      ["Tasks initiated", a.initiated, eq.initiated ?? 0, b.initiated],
      ["Tasks completed", a.completed, eq.completed ?? 0, b.completed],
      ["Appreciations sent", a.sent, eq.sent ?? 0, b.sent],
      ["Appreciations received", a.received, eq.received ?? 0, b.received],
      [
        "Collaboration events",
        a.collaboration,
        eq.collaboration ?? 0,
        b.collaboration,
      ],
      [
        "Participation (quests)",
        a.participation ?? 0,
        eq.participation ?? 0,
        b.participation,
      ],
      [
        "Co-participants",
        a.coParticipants ?? 0,
        eq.coParticipants ?? 0,
        b.coParticipants,
      ],
      ["Activity (events)", a.activity ?? 0, eq.activity ?? 0, b.activity],
      ["Group size (avg)", a.groupSize ?? 0, eq.groupSize ?? 0, b.groupSize],
      ["Group-size variance", a.variance ?? 0, eq.variance ?? 0, b.variance],
    ];
    for (const [label, count, weight, points] of flat) {
      if (!weight || !count) continue;
      lines.push({ label, count, weight, points });
    }
    for (const [currency, points] of Object.entries(b.currencies)) {
      const weight = eq.currencies?.[currency] || 0;
      const balance =
        currency === "hour" ? (a.hours ?? 0) : (row.balances[currency] ?? 0);
      lines.push({
        label:
          currency === "hour"
            ? "Declared hours"
            : `${currency.toUpperCase()} balance`,
        count: balance,
        weight,
        points,
      });
    }
    return lines;
  }

  // ── Ledger (the actual REA events behind the score) ─────────────────────────

  type LedgerEntry = {
    id: string;
    label: string;
    quest: string;
    qty: number;
    unit: string;
    incoming: boolean;
    ts: number;
  };

  const EVENT_LABELS: Record<string, string> = {
    "quest:initiated": "Proposed a quest",
    "quest:completed": "Completed a quest",
    "quest:time_logged": "Logged time",
    "expense:share": "Expense share",
    "expense:paid": "Paid an expense",
    appreciation: "Appreciation",
  };

  function eventLabel(e: any): string {
    const t = String(e?.eventType ?? e?.resource?.type ?? "");
    return EVENT_LABELS[t] || t.replace(/[:_]/g, " ") || "Event";
  }

  /** Resolve a quest's title from the live `quests` lens, or a `#id` fallback. */
  function questTitle(id: unknown): string {
    if (id == null) return "";
    const q = (get(rawQuests) as any[]).find(
      (x) => String(x?.id) === String(id),
    );
    return q?.title || `Quest #${id}`;
  }

  /** The user's own REA events (provider or receiver), most recent first. */
  function ledgerFor(userId: string): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const e of events) {
      const prov = String(e?.provider?.id ?? "");
      const recv = String(e?.receiver?.id ?? "");
      if (prov !== userId && recv !== userId) continue;
      out.push({
        id: String(e?.id ?? `${e?.eventType}-${e?.timestamp}`),
        label: eventLabel(e),
        quest: e?.context?.questId != null ? questTitle(e.context.questId) : "",
        qty: Number(e?.resource?.quantity ?? 0),
        unit: String(e?.resource?.unit ?? ""),
        // Receiver-side events credit the user (e.g. appreciation received).
        incoming: recv === userId && prov !== userId,
        ts: Number(e?.timestamp ?? 0),
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  function fmtDate(ts: number): string {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString([], {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  /**
   * The contribution roster: core's `extractReaUsers` (every user-type agent in
   * the loaded REA events) enriched by the `users` lens. The REA stream is the
   * source of truth for *who has activity* — a holon can have a full event stream
   * while its `users` lens is empty (e.g. profiles were never written). The lens,
   * when present, supplies a richer display name than the username on the events.
   */
  function buildRoster(): ReaUser[] {
    const names = new Map(
      extractReaUsers(events).map((u) => [u.id, u.name] as const),
    );
    // Prefer real first/last names from quests over the REA username…
    for (const [id, full] of questNameMap()) names.set(id, full);
    // …and let the `users` lens (richest, when populated) win over everything.
    for (const u of Object.values(usersById)) {
      const id = String(u?.id ?? "");
      if (!id) continue;
      names.set(id, nameOf(u));
    }
    return [...names.entries()].map(([id, name]) => ({
      id,
      name: name || `#${id}`,
    }));
  }

  function teardown() {
    // Drop the holon binding so any in-flight refresh/score loop bails on its
    // next `hid !== holon` guard (covers unmount, where no rebind follows).
    hid = null;
    aggregator = null;
    usersSub?.unsubscribe();
    usersSub = undefined;
    if (rescoreTimer) clearTimeout(rescoreTimer);
    rescoreTimer = null;
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    if (loadingFallbackTimer) clearTimeout(loadingFallbackTimer);
    loadingFallbackTimer = null;
  }

  function scheduleRescore() {
    // Throttle-trailing: coalesce the initial equation/users/events triggers
    // into one score pass ~250ms out rather than running several back-to-back.
    if (rescoreTimer) return;
    rescoreTimer = setTimeout(() => {
      rescoreTimer = null;
      void rescore();
    }, 250);
  }

  async function rescore() {
    if (!aggregator || !hid) return;
    const holon = hid;
    const roster = buildRoster();
    if (roster.length === 0) {
      // No activity loaded yet — keep the loading state (the fallback clears it
      // if the holon really is empty) so we don't flash "no activity" before the
      // events arrive.
      rows = [];
      return;
    }
    const nameById = new Map(roster.map((r) => [r.id, r.name]));
    const seq = ++scoreSeq;
    let scored;
    try {
      scored = await computeHolonUserScores(
        aggregator,
        holon,
        roster,
        equation,
      );
    } catch (err) {
      console.error("[kiosk] status scoring failed", err);
      loading = false;
      return;
    }
    // A newer score run (or a holon switch) superseded this one — drop it.
    if (seq !== scoreSeq || holon !== hid) return;
    rows = scored
      .map((s) => ({
        id: s.userId,
        name: nameById.get(s.userId) ?? `#${s.userId}`,
        score: s.score,
        percentage: s.percentage,
        aggregates: s.aggregates,
        balances: s.balances,
        breakdown: s.breakdown,
      }))
      .sort((a, b) => b.score - a.score);
    // Keep the open detail modal in sync with the freshly scored data.
    if (selected) selected = rows.find((r) => r.id === selected!.id) ?? null;
    loading = false;
  }

  async function bind(holon: string | null) {
    teardown();
    hid = holon;
    aggregator = null;
    equation = DEFAULT_EQUATION;
    usersById = {};
    rows = [];
    loading = true;
    if (!holon) {
      loading = false;
      return;
    }

    // Arm the safety net BEFORE any await: a slow read (or the retry backoff in
    // refreshEvents) must never be able to pin the board on "tallying" forever.
    loadingFallbackTimer = setTimeout(() => {
      loading = false;
    }, 9000);

    let hs;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] status: failed to connect", err);
      loading = false;
      return;
    }
    if (hid !== holon) return; // holon changed while connecting

    // Score against an IN-MEMORY view of the events (the `events` array), not a
    // live store: each per-user aggregate query reads the cached array instead
    // of hitting Gun, and we never open a `map().on()` on the huge rea_events
    // lens (which storms). `getAll` here returns whatever we've loaded so far.
    aggregator = new REAAggregator(
      new REAEventStore({ getAll: async () => events } as any),
    );

    // Load the holon's value equation OFF the critical path — scoring starts on
    // the default weights and re-scores when the real equation lands.
    void loadEquation(hs, holon)
      .then((eq) => {
        if (hid !== holon) return;
        equation = eq;
        scheduleRescore();
      })
      .catch((err) =>
        console.warn("[kiosk] status: equation load failed", err),
      );

    // Live membership (small lens) for richer names; safe to subscribe.
    usersSub = subscribeLens(hs, holon, "users", (items) => {
      const map: Record<string, any> = {};
      for (const u of items as any[]) {
        const id = String(u?.id ?? "");
        if (id) map[id] = u;
      }
      usersById = map;
      scheduleRescore();
    });

    // Gentle periodic refresh via one-shot `getAll` (`.map().once()`) — NOT a
    // subscription, so the rea_events lens never storms. Registered before the
    // initial load awaits so teardown always clears it, even on a fast unmount.
    // A pinned kiosk thus still picks up new activity within ~30s.
    refreshTimer = setInterval(() => void refreshEvents(hs, holon), 30_000);
    await refreshEvents(hs, holon);
  }

  /**
   * Fetch the holon's REA events with a one-shot `getAll`, retried with backoff:
   * the stream replicates shortly after we connect, so an immediate read can
   * race and return []. On success we cache the events and re-score.
   */
  async function refreshEvents(hs: HoloSphere, holon: string) {
    for (const delay of [0, 600, 1500, 3000]) {
      if (delay) await sleep(delay);
      if (hid !== holon) return; // holon switched mid-load
      let all: any[] = [];
      try {
        all = (await hs.getAll(holon, "rea_events")) as any[];
      } catch (err) {
        console.error("[kiosk] status: failed to read rea_events", err);
      }
      if (Array.isArray(all) && all.length) {
        events = all;
        scheduleRescore();
        return;
      }
    }
    // Still nothing after retries — re-score once so an empty holon settles to
    // its empty state (via the loading fallback) rather than spinning forever.
    scheduleRescore();
  }

  // Quest data is the name source; re-score when it streams in or changes so the
  // board upgrades usernames to real names without waiting for the 30s refresh.
  $: if ($rawQuests) scheduleRescore();

  // Suspend the kiosk's auto-rotation while the breakdown modal is open so the
  // screen can't flip away mid-read.
  $: rotationHold.set(selected != null);

  onMount(() => {
    // Fires immediately with the current holon (initial bind) and again on any
    // change; the guard skips a redundant rebind to the same holon.
    const unsub = holonId.subscribe((h) => {
      if (h !== hid) void bind(h);
    });
    return () => {
      unsub();
      teardown();
      // Release the rotation hold if we unmount with the modal still open.
      rotationHold.set(false);
    };
  });
</script>

<div class="board">
  <div class="scrollarea scroll">
    {#if loading}
      <p class="empty">Tallying contributions… ♛</p>
    {:else if !rows.length}
      <p class="empty">No ranked activity yet. ♛</p>
    {:else}
      <ol class="ranks">
        {#each rows as row, i (row.id)}
          <li>
            <button
              class="rank"
              class:top={i === 0}
              on:click={() => (selected = row)}
              title="See how {row.name}'s score was reached"
            >
              <span class="place">
                {#if i === 0}🏆{:else if i === 1}🥈{:else if i === 2}🥉{:else}{i +
                    1}{/if}
              </span>
              <span class="av">
                <span class="ini">{avatarInitial(row.name)}</span>
                <img
                  src={avatarUrl(row.id)}
                  alt=""
                  loading="lazy"
                  on:error={hideImg}
                  on:load={showImg}
                />
              </span>
              <span class="name">{row.name}</span>
              <span class="bar">
                <span class="fill" style="width: {row.percentage}%"></span>
              </span>
              <span class="pct">{row.percentage.toFixed(1)}%</span>
              <span class="score">{row.score.toFixed(1)}</span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</div>

{#if selected}
  {@const lines = breakdownLines(selected)}
  {@const ledger = ledgerFor(selected.id)}
  <Modal on:close={() => (selected = null)}>
    <div class="detail">
      <div class="dhead">
        <span class="dav">
          <span class="ini">{avatarInitial(selected.name)}</span>
          <img
            src={avatarUrl(selected.id)}
            alt=""
            on:error={hideImg}
            on:load={showImg}
          />
        </span>
        <div class="dwho">
          <h3>{selected.name}</h3>
          <p class="dsub">
            Score <strong>{selected.score.toFixed(1)}</strong> ·
            {selected.percentage.toFixed(1)}% share
          </p>
        </div>
      </div>

      <section class="dsec">
        <h4>Value equation</h4>
        {#if lines.length}
          <table class="eq">
            <thead>
              <tr
                ><th>Metric</th><th>Count</th><th>×</th><th>Weight</th><th
                  >Points</th
                ></tr
              >
            </thead>
            <tbody>
              {#each lines as l (l.label)}
                <tr>
                  <td class="m">{l.label}</td>
                  <td class="n">{(+l.count.toFixed(2)).toString()}</td>
                  <td class="x">×</td>
                  <td class="n">{l.weight}</td>
                  <td class="p">{(+l.points.toFixed(2)).toString()}</td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr
                ><td colspan="4">Total</td><td class="p"
                  >{selected.score.toFixed(1)}</td
                ></tr
              >
            </tfoot>
          </table>
        {:else}
          <p class="dnote">No weighted contributions yet.</p>
        {/if}
      </section>

      <section class="dsec">
        <h4>
          Ledger · {ledger.length}
          {ledger.length === 1 ? "entry" : "entries"}
        </h4>
        {#if ledger.length}
          <ul class="ledger">
            {#each ledger as e (e.id)}
              <li class="lrow">
                <span class="licon" class:in={e.incoming}
                  >{e.incoming ? "↓" : "↑"}</span
                >
                <span class="ltext">
                  <span class="llabel">{e.label}</span>
                  {#if e.quest}<span class="lquest">{e.quest}</span>{/if}
                </span>
                {#if e.qty}
                  <span class="lqty">{e.qty}{e.unit ? ` ${e.unit}` : ""}</span>
                {/if}
                <span class="ldate">{fmtDate(e.ts)}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="dnote">No ledger entries.</p>
        {/if}
      </section>
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

  .ranks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .rank {
    width: 100%;
    text-align: left;
    display: grid;
    grid-template-columns: 2.2rem 2.4rem 1fr minmax(4rem, 9rem) 3rem 3rem;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.9rem;
    background: var(--paper);
    border-radius: 14px;
    animation: kiosk-rise 0.42s ease both;
    transition:
      transform 0.1s ease,
      background 0.15s ease;
  }
  .rank:hover {
    background: color-mix(in srgb, var(--teal) 10%, var(--paper));
  }
  .rank:active {
    transform: scale(0.99);
  }
  .rank.top:hover {
    background: var(--note-sun);
  }
  .rank.top {
    background: var(--note-sun);
  }

  .place {
    font-size: 1.1rem;
    font-weight: 800;
    text-align: center;
    color: var(--ink-soft);
  }

  .av {
    position: relative;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 2px var(--card);
  }
  .ini {
    font-size: 0.95rem;
    font-weight: 800;
    color: #fff;
  }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .name {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    height: 0.55rem;
    border-radius: 999px;
    background: var(--line);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--teal);
    transition: width 0.5s ease;
  }
  .pct {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .score {
    font-size: 0.95rem;
    font-weight: 800;
    color: var(--teal-deep);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  /* Narrow portrait screens: drop the share bar + percentage, keep the score. */
  @media (max-width: 560px) {
    .rank {
      grid-template-columns: 2rem 2.2rem 1fr 3rem;
      gap: 0.6rem;
    }
    .bar,
    .pct {
      display: none;
    }
  }

  /* ── Detail modal: how the score was reached ────────────────────────────── */
  .detail {
    text-align: left;
  }
  .dhead {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding-right: 2.5rem; /* clear the modal ✕ */
  }
  .dav {
    position: relative;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .dav .ini {
    font-size: 1.1rem;
    font-weight: 800;
    color: #fff;
  }
  .dav img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .dwho h3 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--ink);
    line-height: 1.2;
  }
  .dsub {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .dsub strong {
    color: var(--teal-deep);
  }

  .dsec {
    margin-top: 1.3rem;
  }
  .dsec h4 {
    margin: 0 0 0.5rem;
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .dnote {
    margin: 0;
    font-size: 0.9rem;
    color: var(--muted);
  }

  .eq {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .eq th {
    text-align: right;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    padding: 0 0.3rem 0.35rem;
  }
  .eq th:first-child {
    text-align: left;
  }
  .eq td {
    padding: 0.32rem 0.3rem;
    border-top: 1px solid var(--line);
  }
  .eq .m {
    color: var(--ink);
  }
  .eq .n,
  .eq .p {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .eq .x {
    text-align: center;
    color: var(--muted);
  }
  .eq .p {
    font-weight: 800;
    color: var(--teal-deep);
  }
  .eq tfoot td {
    border-top: 2px solid var(--line);
    padding-top: 0.45rem;
    font-weight: 800;
    color: var(--ink);
  }
  .eq tfoot td:first-child {
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .eq tfoot .p {
    color: var(--teal-deep);
  }

  .ledger {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .lrow {
    display: grid;
    grid-template-columns: 1.6rem 1fr auto auto;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.55rem;
    background: var(--paper);
    border-radius: 10px;
  }
  .licon {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 0.85rem;
    color: var(--teal-deep);
    background: color-mix(in srgb, var(--teal) 16%, transparent);
  }
  .licon.in {
    color: #2f9e6b;
    background: color-mix(in srgb, #2f9e6b 16%, transparent);
  }
  .ltext {
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .llabel {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink);
  }
  .lquest {
    font-size: 0.78rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lqty {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .ldate {
    font-size: 0.76rem;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
