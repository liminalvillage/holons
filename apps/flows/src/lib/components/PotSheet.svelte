<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What a tap on a pot of the Flow view brings up: its numbers — its share
  // of the Pot, what it keeps, what it passes on, what that is in money —
  // where it pours, and what can be done from it. A pot that gathers several
  // ("More", "Straight from the Pot") lists who is in it instead, each one a
  // tap from its own sheet.
  import type { FlowGraphIndex, FlowGraphNode } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import ActionRow from "./ActionRow.svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import { amount } from "$lib/format";
  import { locale, t, pctOf } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { hrefFor } from "$lib/urls";
  import type { AccountAction } from "$lib/viewTypes";

  export let index: FlowGraphIndex;
  /** A party, or a pot that gathers several. */
  export let subject:
    | { type: "party"; id: string }
    | {
        type: "group";
        label: string;
        kind: string;
        value: number;
        note?: string;
        members: string[];
      };
  /** The party the view is poured from now. */
  export let focusId: string;
  /** Where "Flow from here" goes for a party. */
  export let fromHref: (id: string) => string;

  const dispatch = createEventDispatcher<{
    close: void;
    pick: string;
    fund: FlowGraphNode;
  }>();

  /** Rows of a list in the sheet. */
  const LIST = 8;

  $: node = subject.type === "party" ? index.byId.get(subject.id) : undefined;
  $: isRoot = node?.id === index.graph.root;
  $: keeps = node && node.share > 0 ? (node.rest / node.share) * 100 : 0;
  $: outs = node
    ? [...(index.out.get(node.id) ?? [])]
        .filter((l) => l.local > 0)
        .sort((a, b) => b.local - a.local)
    : [];
  /** The widest pour fills its bar; the rest are drawn against it. */
  $: widest = outs[0]?.local ?? 0;
  $: payers = node ? (index.into.get(node.id)?.length ?? 0) : 0;
  $: unit = $potLive.units[0] ?? "";
  $: total = unit ? ($potLive.totals[unit] ?? 0) : 0;
  $: money = node && total > 0 ? (node.share / 100) * total : 0;
  $: members =
    subject.type === "group"
      ? subject.members
          .map((id) => index.byId.get(id))
          .filter((n): n is FlowGraphNode => !!n)
          .sort((a, b) => b.share - a.share)
      : [];
  let showAll = false;

  $: isHolon = !!node && node.kind !== "person" && node.kind !== "placeholder";
  $: actions = node
    ? ([
        ...(outs.length && node.id !== focusId
          ? [
              {
                id: "from",
                icon: "flow",
                label: $t("falls.fromHere"),
                href: fromHref(node.id),
                main: true,
              },
            ]
          : []),
        { id: "fund", icon: "plus", label: $t("action.fund") },
        ...(isHolon
          ? [
              {
                id: "split",
                icon: "sliders",
                label: $t("action.split"),
                href: `/h/${encodeURIComponent(node.id)}/split`,
              },
            ]
          : []),
        {
          id: "account",
          icon: "wallet",
          label: $t("falls.account"),
          href: hrefFor(node),
        },
      ] as AccountAction[])
    : [];
  $: title = node ? node.label : subject.type === "group" ? subject.label : "";
</script>

<BottomSheet {title} on:close>
  <div slot="head" class="head">
    <KindChip
      kind={node?.kind ?? (subject.type === "group" ? subject.kind : "other")}
    />
    <h2>{title}</h2>
  </div>

  {#if node}
    {#if node.description}<p class="about">{node.description}</p>{/if}

    <dl class="stats">
      {#if isRoot}
        {#if total > 0}
          <div class="tile wide">
            <dt>{$t("falls.inPot")}</dt>
            <dd>{amount(total, unit, $locale)}</dd>
          </div>
        {/if}
      {:else}
        <div class="tile">
          <dt>{$t("sheet.ofPot")}</dt>
          <dd>{$pctOf(node.share)}</dd>
        </div>
        {#if money > 0}
          <div class="tile">
            <dt>{$t("falls.reaches")}</dt>
            <dd>{amount(money, unit, $locale)}</dd>
          </div>
        {/if}
      {/if}
      <div class="tile">
        <dt>{$t("sheet.keeps")}</dt>
        <dd class="fee">{$pctOf(keeps)}</dd>
      </div>
      <div class="tile">
        <dt>{$t("falls.passes")}</dt>
        <dd>{$pctOf(outs.length ? 100 - keeps : 0)}</dd>
      </div>
    </dl>
    <p class="muted counts">
      {#if outs.length}{$t("space.pays", { n: outs.length })}{/if}
      {#if outs.length && payers}·{/if}
      {#if payers}{$t("space.paidBy", { n: payers })}{/if}
    </p>

    <ActionRow
      {actions}
      onAct={(act) => {
        if (act === "fund" && node) dispatch("fund", node);
      }}
    />

    {#if outs.length}
      <h3 class="list-title">{$t("falls.goesTo")}</h3>
      <ul class="rows">
        {#each showAll ? outs : outs.slice(0, LIST) as l (l.target)}
          {@const p = index.byId.get(l.target)}
          {#if p}
            <li>
              <button type="button" on:click={() => dispatch("pick", p.id)}>
                <KindChip kind={p.kind} />
                <span class="name">{p.label}</span>
                <span
                  class="bar"
                  style="--w:{widest > 0 ? (l.local / widest) * 100 : 0}%"
                ></span>
                <span class="value">{$pctOf(l.local)}</span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
      {#if !showAll && outs.length > LIST}
        <button class="more" type="button" on:click={() => (showAll = true)}
          >{$t("common.showMore", { n: outs.length - LIST })}</button
        >
      {/if}
    {/if}
  {:else if subject.type === "group"}
    <dl class="stats">
      <div class="tile">
        <dt>{$t("sheet.ofPot")}</dt>
        <dd>{$pctOf(subject.value)}</dd>
      </div>
    </dl>
    {#if subject.note}<p class="muted about">{subject.note}</p>{/if}
    <h3 class="list-title">{$t("falls.behind")}</h3>
    <ul class="rows">
      {#each showAll ? members : members.slice(0, LIST) as p (p.id)}
        <li>
          <button type="button" on:click={() => dispatch("pick", p.id)}>
            <KindChip kind={p.kind} />
            <span class="name">{p.label}</span>
            <span class="value">{$pctOf(p.share)}</span>
            <Icon name="chevron-right" />
          </button>
        </li>
      {/each}
    </ul>
    {#if !showAll && members.length > LIST}
      <button class="more" type="button" on:click={() => (showAll = true)}
        >{$t("common.showMore", { n: members.length - LIST })}</button
      >
    {/if}
  {/if}
</BottomSheet>

<style>
  .head {
    display: grid;
    gap: 2px;
  }
  .head h2 {
    font-size: 1.15rem;
    overflow-wrap: anywhere;
  }
  .about {
    margin: 0 0 10px;
    color: var(--ink-soft);
    font-size: 0.9rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 8px;
    margin: 0;
  }
  .tile {
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--paper-deep);
  }
  .tile.wide {
    grid-column: 1 / -1;
  }
  .tile dt {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tile dd {
    margin: 2px 0 0;
    font-size: 1.25rem;
    font-weight: 800;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .tile.wide dd {
    font-size: 1.6rem;
  }
  .fee {
    color: var(--caution) !important;
  }
  .counts {
    margin: 8px 2px 0;
    font-size: 0.85rem;
  }
  .list-title {
    margin: 14px 0 6px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .rows button {
    width: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 56px auto;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    padding: 0 8px;
    border-radius: 12px;
    text-align: start;
    color: var(--ink);
  }
  .rows button:hover,
  .rows button:focus-visible {
    background: var(--teal-wash);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--teal) var(--w),
      var(--paper-deep) var(--w)
    );
  }
  .value {
    font-size: 0.85rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
  .more {
    min-height: var(--tap);
    font-weight: 700;
    color: var(--teal-ink);
  }
</style>
