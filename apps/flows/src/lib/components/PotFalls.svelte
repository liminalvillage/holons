<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Flow view: the Pot as a vessel across the top, pouring down into the
  // pots it seats and on into theirs. Each band is as wide as the share of
  // the Pot it carries, so a split is something you can see; the bare end of
  // a vessel's bottom edge is what it keeps — its fee — before passing on.
  //
  // A tap on a vessel brings up its numbers and tools (`PotSheet`), and from
  // there "Flow from here" pours the view from that pot instead. All the
  // geometry is core's (`layoutPotTiers`); this only scales and paints it.
  import {
    FLOW_DIRECT_ID,
    centredTrack,
    ecosystemTrack,
    layoutPotTiers,
    partyIdOf,
    type FlowGraphIndex,
    type FlowGraphNode,
    type FlowViewLabels,
    type PotTierBand,
    type PotTierVessel,
  } from "@holons/core/flows";
  import FundSheet from "./FundSheet.svelte";
  import PotSheet from "./PotSheet.svelte";
  import { clip } from "$lib/format";
  import { t, pctOf } from "$lib/i18n";

  export let index: FlowGraphIndex;
  /** The party the view pours from: the root Pot, or any pot under it. */
  export let focusId: string;
  /** Where "Flow from here" goes. */
  export let fromHref: (id: string) => string;
  export let narrow = false;
  export let label = "";

  /** A vessel's height and the fall between two rows, in CSS pixels. */
  const VESSEL_PX = 66;
  $: DROP_PX = narrow ? 104 : 128;
  const PAD_X = 6;
  const TOP_PX = 4;
  /** Room under the last row for its names, turned to read downward. */
  const NAMES_PX = 132;
  const FONT_PX = 11.5;
  const CHAR_PX = 6.6;
  /** Below this a value is rounding, not a fee. */
  const EPSILON = 1e-6;
  /** A fee under this part of what reaches a vessel is not drawn or said. */
  const FEE_MIN = 0.0005;
  const hasFee = (v: PotTierVessel) =>
    v.passed > EPSILON && v.kept / v.value > FEE_MIN;

  $: labels = {
    kept: $t("view.kept"),
    otherFunds: $t("view.otherFunds"),
    otherProjects: $t("view.otherProjects"),
    direct: $t("view.direct"),
  } satisfies FlowViewLabels;
  $: named = narrow ? 4 : 6;
  $: isRoot = focusId === index.graph.root;
  // Nothing is gathered in the track: the layout rolls up, and says who it rolled.
  $: track = isRoot
    ? ecosystemTrack(index, { funds: 1e6, projects: 1e6, labels })
    : centredTrack(index, focusId, { up: 0, down: 2, scale: "root", labels });
  $: tiers = layoutPotTiers(track, {
    topN: isRoot ? named + 1 : named,
    moreLabel: $t("falls.more"),
    minWidth: narrow ? 0.1 : 0.075,
    gap: narrow ? 0.022 : 0.018,
    vesselHeight: VESSEL_PX / (VESSEL_PX + DROP_PX),
  });

  let width = 358;
  $: W = Math.max(280, width);
  $: drawH = Math.max(0, tiers.rows - 1) * (VESSEL_PX + DROP_PX) + VESSEL_PX;
  $: H = TOP_PX + drawH + NAMES_PX;
  $: sx = (x: number) => PAD_X + x * (W - 2 * PAD_X);
  $: sy = (y: number) => TOP_PX + y * drawH;
  $: lastRow = tiers.rows - 1;

  /** Scale a normalized path into pixels. */
  $: scalePath = (d: string) =>
    d.replace(
      /(-?\d*\.?\d+),(-?\d*\.?\d+)/g,
      (_m, x, y) => `${sx(Number(x)).toFixed(1)},${sy(Number(y)).toFixed(1)}`,
    );
  /** The line down the middle of a band the drops run along. */
  $: spine = (b: PotTierBand) => {
    const top = sx((b.x0 + b.x1) / 2);
    const bottom = sx((b.x2 + b.x3) / 2);
    const y0 = sy(b.y0);
    const y1 = sy(b.y1);
    const m = (y0 + y1) / 2;
    return `M${top},${y0} C${top},${m} ${bottom},${m} ${bottom},${y1}`;
  };

  const COLOUR: Record<string, string> = {
    pot: "--kind-pot",
    fund: "--kind-fund",
    project: "--kind-project",
    person: "--kind-person",
    placeholder: "--kind-placeholder",
    direct: "--kind-pot",
  };
  const colourOf = (kind?: string) =>
    `var(${COLOUR[kind ?? ""] ?? "--kind-other"})`;
  $: byId = new Map(tiers.vessels.map((v) => [v.id, v]));

  // ── Selection ──
  type Subject = import("svelte").ComponentProps<PotSheet>["subject"];
  let subject: Subject | null = null;
  let funding: FlowGraphNode | null = null;
  let selectedId: string | null = null;
  // A selection belongs to the pour it was made on.
  $: if (focusId) ((subject = null), (selectedId = null));

  /** Who a gathering vessel stands for, as party ids. */
  function membersOf(v: PotTierVessel): string[] {
    const ids = v.rolled
      ? v.rolled
      : v.id === FLOW_DIRECT_ID
        ? track.links
            .filter((l) => l.source === FLOW_DIRECT_ID)
            .map((l) => l.target)
        : [];
    return ids
      .map((id) => partyIdOf(id))
      .filter((id): id is string => !!id && index.byId.has(id));
  }
  function choose(v: PotTierVessel) {
    selectedId = v.id;
    const party = partyIdOf(v.id);
    subject =
      party && index.byId.has(party)
        ? { type: "party", id: party }
        : {
            type: "group",
            label: v.label,
            kind: v.kind ?? "other",
            value: v.value,
            note: v.id === FLOW_DIRECT_ID ? $t("sheet.directBody") : undefined,
            members: membersOf(v),
          };
  }
  function onKey(e: KeyboardEvent, v: PotTierVessel) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    choose(v);
  }

  $: lit = selectedId
    ? new Set(
        tiers.bands
          .filter((b) => b.source === selectedId || b.target === selectedId)
          .map((b) => b.id),
      )
    : null;

  /** What fits inside a vessel: a name cut to its width, and its share. */
  function inside(v: PotTierVessel): {
    name: string;
    share: string;
    turned?: boolean;
  } {
    const room = Math.floor((v.w * (W - 2 * PAD_X) - 10) / CHAR_PX);
    // Too narrow to read across: a middle vessel wears its name turned.
    if (room < 7 && v.row !== 0 && v.row !== lastRow)
      return {
        name: clip(v.label, Math.floor((v.h * drawH - 10) / CHAR_PX)),
        share: "",
        turned: true,
      };
    if (room < 4) return { name: "", share: "" };
    const keeps =
      v.row === 0 && hasFee(v)
        ? ` · ${$t("falls.keeps", { pct: $pctOf((v.kept / v.value) * 100) })}`
        : "";
    return {
      name: v.row === lastRow ? "" : clip(v.label, room),
      share: clip(`${$pctOf(v.value)}${keeps}`, Math.max(room, 5)),
    };
  }
</script>

<div class="falls" bind:clientWidth={width}>
  {#if tiers.empty}
    <slot name="empty" />
  {:else}
    <svg
      viewBox="0 0 {W} {H}"
      width={W}
      height={H}
      role="group"
      aria-label={label}
    >
      <defs>
        {#each tiers.bands as b (b.id)}
          <linearGradient id="fall-{b.id}" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              style="stop-color:{colourOf(byId.get(b.source)?.kind)}"
            />
            <stop
              offset="1"
              style="stop-color:{colourOf(byId.get(b.target)?.kind)}"
            />
          </linearGradient>
        {/each}
      </defs>

      <g class="bands">
        {#each tiers.bands as b (b.id)}
          {@const row = byId.get(b.source)?.row ?? 0}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <g
            class="band"
            class:dim={lit && !lit.has(b.id)}
            class:lit={lit?.has(b.id)}
            style="--row:{row}"
            on:click={() => {
              const target = byId.get(b.target);
              if (target) choose(target);
            }}
          >
            <path class="body" d={scalePath(b.path)} fill="url(#fall-{b.id})" />
            {#if (b.x1 - b.x0) * (W - 2 * PAD_X) >= 4}<path
                class="drops"
                d={spine(b)}
                style="stroke-width:{Math.max(
                  1.2,
                  Math.min(3.5, ((b.x1 - b.x0) * (W - 2 * PAD_X)) / 5),
                )}px"
              />{/if}
          </g>
        {/each}
      </g>

      {#each tiers.vessels as v (v.id)}
        {@const x = sx(v.x)}
        {@const y = sy(v.y)}
        {@const w = v.w * (W - 2 * PAD_X)}
        {@const h = v.h * drawH}
        {@const text = inside(v)}
        {@const feeAt = v.value > 0 ? x + (v.passed / v.value) * w : x + w}
        <g
          class="vessel"
          class:on={selectedId === v.id}
          class:dim={selectedId && selectedId !== v.id}
          class:top={v.row === 0}
          style="--k:{colourOf(v.kind)};--row:{v.row}"
          role="button"
          tabindex="0"
          aria-label="{v.label}, {$pctOf(v.value)}"
          on:click={() => choose(v)}
          on:keydown={(e) => onKey(e, v)}
        >
          <rect
            class="shell"
            {x}
            {y}
            width={w}
            height={h}
            rx={Math.min(14, w / 3)}
          />
          {#if v.row !== lastRow && hasFee(v) && x + w - feeAt > 2}
            <rect
              class="fee"
              x={feeAt}
              y={y + h - 6}
              width={x + w - feeAt}
              height="6"
              rx="3"
            />
          {/if}
          {#if v.row === 0}
            <text class="name big" x={x + w / 2} y={y + h / 2 - 3}
              >{clip(v.label, Math.floor(w / 9))}</text
            >
            <text class="share" x={x + w / 2} y={y + h / 2 + 15}
              >{text.share}</text
            >
          {:else if text.turned}
            <text
              class="name"
              transform="translate({x + w / 2 + 4},{y + h / 2}) rotate(90)"
              >{text.name}</text
            >
          {:else}
            {#if text.name}
              <text class="name" x={x + w / 2} y={y + h / 2 - 2}
                >{text.name}</text
              >
            {/if}
            {#if text.share}
              <text
                class="share"
                x={x + w / 2}
                y={text.name ? y + h / 2 + 13 : y + h / 2 + 4}
                >{text.share}</text
              >
            {/if}
          {/if}
          {#if v.row === lastRow}
            <text
              class="below"
              transform="translate({x + w / 2 + 4},{y + h + 8}) rotate(90)"
              style="font-size:{FONT_PX}px">{clip(v.label, 20)}</text
            >
          {/if}
        </g>
      {/each}
    </svg>
  {/if}
</div>

{#if subject}
  <PotSheet
    {index}
    {subject}
    {focusId}
    {fromHref}
    on:pick={(e) => {
      const v = tiers.vessels.find((x) => partyIdOf(x.id) === e.detail);
      selectedId = v?.id ?? null;
      subject = { type: "party", id: e.detail };
    }}
    on:fund={(e) => ((subject = null), (funding = e.detail))}
    on:close={() => ((subject = null), (selectedId = null))}
  />
{/if}
{#if funding}
  <FundSheet node={funding} on:close={() => (funding = null)} />
{/if}

<style>
  .falls {
    width: 100%;
    overflow: hidden;
  }
  svg {
    display: block;
    max-width: 100%;
    height: auto;
    overflow: visible;
  }
  .band {
    cursor: pointer;
    animation: pour 0.7s ease-out backwards;
    animation-delay: calc(var(--row) * 220ms + 120ms);
    transition: opacity 0.2s;
  }
  .band .body {
    opacity: 0.42;
    transition: opacity 0.2s;
  }
  .band:hover .body,
  .band.lit .body {
    opacity: 0.7;
  }
  .band.dim {
    opacity: 0.25;
  }
  .drops {
    fill: none;
    stroke: var(--card);
    stroke-linecap: round;
    stroke-dasharray: 1 11;
    opacity: 0.75;
    animation: drip 1.4s linear infinite;
    pointer-events: none;
  }
  .vessel {
    cursor: pointer;
    outline: none;
    animation: pour 0.5s ease-out backwards;
    animation-delay: calc(var(--row) * 220ms);
    transition: opacity 0.2s;
  }
  .vessel.dim {
    opacity: 0.55;
  }
  .shell {
    fill: color-mix(in srgb, var(--k) 22%, var(--card));
    stroke: var(--k);
    stroke-width: 1.5;
    transition: stroke-width 0.15s;
  }
  .top .shell {
    fill: color-mix(in srgb, var(--k) 32%, var(--card));
    stroke-width: 2;
  }
  .vessel:hover .shell,
  .vessel:focus-visible .shell,
  .vessel.on .shell {
    stroke-width: 3;
  }
  .vessel:focus-visible .shell {
    stroke: var(--ink);
  }
  .fee {
    fill: var(--caution);
    opacity: 0.85;
  }
  text {
    text-anchor: middle;
    fill: var(--ink);
    pointer-events: none;
  }
  .name {
    font-size: 11.5px;
    font-weight: 700;
  }
  .name.big {
    font-size: 15px;
    font-weight: 800;
  }
  .share {
    font-size: 11px;
    font-weight: 600;
    fill: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .below {
    text-anchor: start;
    font-weight: 600;
    fill: var(--ink-soft);
  }
  @keyframes pour {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }
  @keyframes drip {
    to {
      stroke-dashoffset: -24;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .band,
    .vessel,
    .drops {
      animation: none;
    }
  }
</style>
