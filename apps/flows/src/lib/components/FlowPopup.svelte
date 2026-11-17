<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dialog the orb in focus wears. Everything about a place on the map
  // happens here, over the navigator, never on a page of its own: close it
  // and the scene is where it was, a row in it is a way on.
  //
  //   card   who it is, where an amount tried out would go (the scene shows
  //          where it trickles: core's `trickleAmount` — a preview, nothing
  //          is paid or recorded), and what flows in and out. Paying in is
  //          real money on a real rail (`FundSheet`), never a typed number.
  //   more   the card opened out: the same, and what the place is in full
  //          (`FractalDetail`: bandwidth, needs, yields, who is under it).
  //          A tap on the orb in focus opens it.
  //   split  how it divides what reaches it, the sliders right here; the
  //          scene draws the draft as they move (`onDraft`). Only a
  //          steward's save counts — anyone else reads the same controls.
  //
  // Every number is the snapshot's; every write goes through the same sheets
  // and stores the account page uses.
  import type {
    Fractal,
    FlowGraphIndex,
    FlowGraphLink,
    FractalNode,
  } from "@holons/core/flows";
  import { isClaimWindowOpen } from "@holons/core/flows";
  import ApplySheet from "./ApplySheet.svelte";
  import ClaimProjectSheet from "./ClaimProjectSheet.svelte";
  import FractalDetail from "./FractalDetail.svelte";
  import FundSheet from "./FundSheet.svelte";
  import GiveSheet from "./GiveSheet.svelte";
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import SplitEditor from "./SplitEditor.svelte";
  import { canSteer } from "$lib/account";
  import { labelOf } from "$lib/graph";
  import { steeredHolons } from "$lib/me";
  import { currentUser, displayName } from "$lib/auth";
  import { amount as money } from "$lib/format";
  import { t, pctOf } from "$lib/i18n";
  import { seatingHolonOf } from "$lib/projectClaims";
  import { sessionKeyPub } from "$lib/sessionKey";

  export let fractal: Fractal;
  export let index: FlowGraphIndex;
  export let focus: FractalNode;
  /** Go to another place: a row is a way on. */
  export let onPick: (id: string) => void;
  /** What the dialog shows; the page opens `more` on a tap on the orb. */
  export let mode: "card" | "more" | "split" = "card";
  /** An amount being put in, and where: the scene draws where it goes. */
  export let funding: { from: string; amount: number } | null = null;
  export let onFund: (
    f: { from: string; amount: number } | null,
  ) => void = () => {};
  /** How tall the dialog is, so the page can keep the scene above it. */
  export let height = 0;
  /** The split being edited, for the scene to draw. */
  export let onDraft: (
    d: {
      shares: Map<string, number>;
      names: Map<string, string>;
      widest: number;
    } | null,
  ) => void = () => {};

  /** Rows a side shows before "show all". */
  const SHORT = 6;
  const UNIT = "EUR";

  $: id = focus.id;
  $: node = index.byId.get(id) ?? null;
  $: isHolon = !!node && node.kind !== "person" && node.kind !== "placeholder";

  let side: "in" | "out" = "out";
  /** In the card, a side opened. */
  let open = false;
  let all = false;
  let sheet: "none" | "give" | "apply" | "claim" | "pay" = "none";
  let steer = false;
  let askedFor = "";
  let seen = "";
  let typed = "";

  $: ins = [...(index.into.get(id) ?? [])].sort((a, b) => b.share - a.share);
  $: outs = [...(index.out.get(id) ?? [])].sort((a, b) => b.share - a.share);
  // A new place starts folded, on the side something flows.
  $: if (id !== seen) {
    seen = id;
    side = (index.out.get(id)?.length ?? 0) ? "out" : "in";
    all = false;
    open = false;
    if (mode !== "card") mode = "card";
    typed = funding?.from === id ? String(funding.amount) : "";
  }
  $: if (mode !== "split") onDraft(null);
  function show(next: "in" | "out") {
    open = !(open && side === next);
    side = next;
    all = false;
  }
  $: listed = mode === "more" || open;
  $: links = side === "in" ? ins : outs;
  $: shown = all ? links : links.slice(0, SHORT);
  $: widest = Math.max(1e-9, ...links.map((l) => l.local));

  $: selfId = $currentUser ? String($currentUser.id) : null;
  $: unsigned = !!selfId && !$sessionKeyPub;
  $: {
    const key = `${id}:${selfId ?? ""}`;
    if (key !== askedFor) {
      askedFor = key;
      steer = false;
      if (isHolon && selfId)
        void canSteer(id).then((ok) => {
          if (askedFor === key) steer = ok;
        });
    }
  }
  $: givers =
    selfId && !unsigned
      ? [{ id: selfId, label: displayName($currentUser!) }]
      : [];
  $: canGive = !!node && !!selfId && !unsigned && (id !== selfId || steer);
  // Any pot that is not one's own can be asked to take one in — oneself, or
  // a pot one looks after.
  $: canAsk = isHolon && !!selfId && !unsigned && id !== selfId && !steer;
  let askers: { id: string; label: string }[] = [];
  async function ask() {
    const mine = selfId
      ? await steeredHolons(index, selfId, canSteer).catch(() => [])
      : [];
    askers = [
      ...givers,
      ...mine
        .filter((h) => h !== id)
        .map((h) => ({ id: h, label: labelOf(h) })),
    ];
    sheet = "apply";
  }

  /**
   * An imported project nobody claimed yet, its window open: the person
   * signed in may ask to steward it, on the holon that seats it; the master
   * keys answer, and approval seats the key that signed.
   */
  $: claimHolder = node?.kind === "project" ? seatingHolonOf(index, id) : null;
  $: canClaim =
    !!claimHolder && isClaimWindowOpen(node) && !!selfId && !unsigned && !steer;

  const other = (l: FlowGraphLink) =>
    index.byId.get(side === "in" ? l.source : l.target) ?? null;

  // ── Fund it ──
  $: typedAmount = Number(typed.replace(",", "."));
  function onType() {
    onFund(typedAmount > 0 ? { from: id, amount: typedAmount } : null);
  }
  $: elsewhere =
    funding && funding.from !== id
      ? (fractal.byId.get(funding.from)?.label ?? funding.from)
      : null;
  $: reachesHere =
    funding && funding.from !== id ? (funding.amount * focus.share) / 100 : 0;
  function split(
    p: {
      before: { rows: { id: string; name: string; percentage: number }[] };
      now: { rows: { id: string; name: string; percentage: number }[] };
    } | null,
  ) {
    // Nobody placed, before or now: nothing to draw instead of the map.
    if (!p || mode !== "split" || !(p.before.rows.length || p.now.rows.length))
      return onDraft(null);
    onDraft({
      shares: new Map(p.now.rows.map((r) => [r.id, r.percentage])),
      names: new Map(p.now.rows.map((r) => [r.id, r.name])),
      // Against the widest as stored; a split passing nothing yet, as drafted.
      widest:
        Math.max(0, ...p.before.rows.map((r) => r.percentage)) ||
        Math.max(0, ...p.now.rows.map((r) => r.percentage)),
    });
  }
</script>

<div
  bind:clientHeight={height}
  class="pop {mode}"
  class:open={listed}
  aria-label={focus.label}
  role="dialog"
>
  <header>
    {#if mode === "split"}
      <button
        class="x"
        aria-label={$t("common.back")}
        on:click={() => (mode = "card")}><Icon name="arrow-left" /></button
      >
    {/if}
    <div class="who">
      {#if node}<KindChip kind={node.kind} />{/if}
      <h2>
        {focus.label}{#if mode === "split"}<span class="muted">
            · {$t("split.title")}</span
          >{/if}
      </h2>
      {#if focus.share > 0}<p class="muted">
          {$t("stage.reaches", { pct: $pctOf(focus.share) })}
        </p>{/if}
    </div>
    {#if mode === "card"}
      <button
        class="x"
        aria-label={$t("stage.more")}
        aria-expanded="false"
        on:click={() => (mode = "more")}><Icon name="info" /></button
      >
    {:else if mode === "more"}
      <button
        class="x"
        aria-label={$t("common.close")}
        on:click={() => (mode = "card")}><Icon name="close" /></button
      >
    {/if}
  </header>

  <div class="body">
    {#if mode === "split"}
      <div class="in-sheet">
        <SplitEditor
          holon={id}
          onPreview={split}
          on:saved={() => (mode = "card")}
        />
      </div>
    {:else}
      {#if elsewhere && reachesHere > 0}
        <p class="small">
          {$t("fund.from", {
            amount: money(reachesHere, UNIT),
            of: money(funding?.amount ?? 0, UNIT),
            name: elsewhere,
          })}
          <button class="link" on:click={() => onFund(null)}
            >{$t("common.clear")}</button
          >
        </p>
      {/if}

      {#if node}
        <div class="sides" role="tablist" aria-label={focus.label}>
          <button
            role="tab"
            class="in"
            class:on={listed && side === "in"}
            aria-selected={listed && side === "in"}
            on:click={() => (mode === "more" ? (side = "in") : show("in"))}
            ><i></i>{$t("stage.in")} <b>{ins.length}</b></button
          >
          <button
            role="tab"
            class="out"
            class:on={listed && side === "out"}
            aria-selected={listed && side === "out"}
            on:click={() => (mode === "more" ? (side = "out") : show("out"))}
            ><i></i>{$t("stage.out")} <b>{outs.length}</b></button
          >
        </div>
      {/if}

      {#if node && listed && side === "in"}
        <div class="put">
          <p class="lead">{$t("stage.inLead", { name: focus.label })}</p>
          <form class="fund" on:submit|preventDefault>
            <label>
              <span class="sr-only"
                >{$t("fund.amount", { name: focus.label })}</span
              >
              <span class="cur" aria-hidden="true">€</span>
              <input
                inputmode="decimal"
                autocomplete="off"
                placeholder={$t("fund.placeholder")}
                bind:value={typed}
                on:input={onType}
              />
              {#if typed}
                <button
                  type="button"
                  class="clear"
                  aria-label={$t("common.clear")}
                  on:click={() => {
                    typed = "";
                    onFund(null);
                  }}><Icon name="close" /></button
                >
              {/if}
            </label>
          </form>
          {#if funding?.from === id && funding.amount > 0}
            <p class="small muted">{$t("fund.trickle")}</p>
          {:else}
            <p class="small muted">{$t("fund.previewOnly")}</p>
          {/if}
          {#if isHolon}
            <button class="btn wide" on:click={() => (sheet = "pay")}
              ><Icon name="wallet" />{$t("fund.payIn")}</button
            >
          {/if}
        </div>
      {/if}

      {#if node && listed && side === "out"}
        <p class="lead">
          {steer ? $t("stage.outLeadSteer") : $t("stage.outLead")}
        </p>
      {/if}

      {#if node && listed}
        <div class="list" role="tabpanel">
          {#if shown.length}
            <ul>
              {#each shown as l (l.source + l.target)}
                {@const party = other(l)}
                {#if party}
                  <li>
                    <button on:click={() => onPick(party.id)}>
                      <span class="name">{party.label}</span>
                      {#if funding && side === "out" && funding.from === id}
                        <span class="gold"
                          >+{money(
                            (funding.amount * l.local) / 100,
                            UNIT,
                          )}</span
                        >
                      {/if}
                      <span class="n">{$pctOf(l.local)}</span>
                      <span
                        class="bar {side}"
                        style="width:{(l.local / widest) * 100}%"
                      ></span>
                    </button>
                  </li>
                {/if}
              {/each}
            </ul>
            <p class="note">
              {side === "in"
                ? $t("stage.ofTheirSplit")
                : $t("stage.ofItsSplit")}
            </p>
            {#if links.length > SHORT && !all}
              <button class="more" on:click={() => (all = true)}
                >{$t("stage.showAll", { n: links.length })}</button
              >
            {/if}
          {:else}
            <p class="muted empty">
              {side === "in" ? $t("stage.noIn") : $t("stage.noOut")}
            </p>
          {/if}
        </div>

        <div class="acts">
          {#if side === "in"}
            {#if canGive}
              <button class="btn quiet" on:click={() => (sheet = "give")}
                ><Icon name="gift" />{$t("stage.give")}</button
              >
            {/if}
            {#if canAsk}
              <button class="btn quiet" on:click={ask}
                ><Icon name="flag" />{$t("stage.ask")}</button
              >
            {/if}
            {#if canClaim}
              <button class="btn quiet" on:click={() => (sheet = "claim")}
                ><Icon name="key" />{$t("action.claimProject")}</button
              >
            {/if}
          {:else if isHolon}
            <button
              class="btn"
              class:quiet={!steer}
              on:click={() => (mode = "split")}
              ><Icon name="sliders" />{steer
                ? $t("stage.defineOut")
                : $t("stage.seeOut")}</button
            >
          {/if}
          {#if mode === "card"}
            <button class="btn quiet" on:click={() => (mode = "more")}
              ><Icon name="info" />{$t("stage.more")}</button
            >
          {/if}
        </div>
      {/if}

      {#if mode === "more"}
        <div class="detail">
          <FractalDetail {fractal} {focus} {onPick} head={false} />
        </div>
      {:else if !node}
        <div class="acts">
          <button class="btn quiet" on:click={() => (mode = "more")}
            ><Icon name="info" />{$t("stage.more")}</button
          >
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if node && sheet === "give"}
  <GiveSheet to={node} {givers} {steer} on:close={() => (sheet = "none")} />
{:else if node && sheet === "claim" && claimHolder && selfId}
  <ClaimProjectSheet
    project={node}
    holder={claimHolder}
    party={selfId}
    partyName={$currentUser ? displayName($currentUser) : ""}
    on:close={() => (sheet = "none")}
  />
{:else if node && sheet === "apply"}
  <ApplySheet
    fund={node}
    applicants={askers}
    on:close={() => (sheet = "none")}
  />
{:else if node && sheet === "pay"}
  <FundSheet {node} {steer} on:close={() => (sheet = "none")} />
{/if}

<style>
  .in-sheet {
    --split-save-bottom: 0px;
  }
  .pop {
    position: absolute;
    color: var(--ink);
    left: max(var(--gutter), env(safe-area-inset-left));
    right: max(var(--gutter), env(safe-area-inset-right));
    bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 20px);
    z-index: 10;
    max-width: 24rem;
    max-height: min(62vh, 34rem);
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-radius: 22px;
    background: color-mix(in srgb, var(--card) 94%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    animation: rise 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
    transition: max-height 0.3s ease;
  }
  /* Opened out: most of the screen, the scene still glowing above it. */
  .pop.more {
    max-width: 34rem;
    max-height: calc(100dvh - env(safe-area-inset-top) - var(--nav-h) - 120px);
  }
  /* Configuring: the sliders here, the scene above drawing the draft. */
  .pop.split {
    max-width: 30rem;
    max-height: min(46vh, 34rem);
  }
  @media (min-width: 900px) {
    .pop {
      left: auto;
      top: 76px;
      bottom: auto;
      margin: 0;
      width: 24rem;
    }
    .pop.more,
    .pop.split {
      width: 30rem;
      max-height: calc(100vh - 76px - 24px);
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.98);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pop {
      animation: none;
      transition: none;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .pop.card:not(.open) .who :global(.chip) {
    display: none;
  }
  .pop.card:not(.open) h2 {
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  h2 {
    font-size: 1.2rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .who p {
    font-size: 0.86rem;
  }
  .x {
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--ink-soft);
    font-size: 1.2rem;
  }
  .body {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    overscroll-behavior: contain;
  }
  .fund {
    display: flex;
    gap: 8px;
  }
  .fund label {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 14px;
    min-height: 44px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  .fund input {
    flex: 1 1 auto;
    min-width: 0;
    border: 0;
    background: transparent;
    font: inherit;
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .fund label:focus-within {
    outline: 2px solid var(--teal);
  }
  .cur {
    font-weight: 800;
    color: #b38410;
  }
  .clear {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .fund .btn {
    flex: 0 0 auto;
  }
  .small {
    font-size: 0.8rem;
    margin: -4px 4px 0;
  }
  .link {
    color: var(--teal-ink);
    font-weight: 700;
  }
  .link {
    margin-left: 6px;
  }
  .gold {
    white-space: nowrap;
    font-size: 0.8rem;
    font-weight: 800;
    color: #9a6c08;
    font-variant-numeric: tabular-nums;
  }
  :global([data-theme="dark"]) .gold {
    color: #f2c14e;
  }
  .sides {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  .sides button {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  .sides button.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }
  .sides i {
    width: 9px;
    height: 9px;
    border-radius: 50%;
  }
  .sides b {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .in i,
  .bar.in {
    background: #1aa6d1;
  }
  .out i,
  .bar.out {
    background: #e0962a;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  li button {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 10px 10px;
    border-radius: 12px;
    font: inherit;
    color: var(--ink);
    text-align: left;
  }
  li button:hover {
    background: var(--paper-deep);
  }
  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    position: absolute;
    left: 10px;
    bottom: 4px;
    max-width: calc(100% - 20px);
    height: 3px;
    border-radius: 3px;
    opacity: 0.8;
  }
  .note {
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 6px;
  }
  .more {
    margin-top: 4px;
    min-height: 40px;
    font-weight: 700;
    color: var(--teal-ink);
  }
  .empty {
    font-size: 0.9rem;
    padding: 4px 2px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .acts .btn {
    flex: 1 1 auto;
  }
  .lead {
    margin: 0;
    font-size: 0.84rem;
    color: var(--ink-soft);
  }
  .wide {
    width: 100%;
  }
  .put {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
  .body > * {
    min-width: 0;
  }
  .detail {
    border-top: 1px solid var(--line);
    padding-top: 4px;
  }
</style>
