<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What reached an account besides its share of the Pot, and what it
  // offers. Three parts:
  //
  //   the base    its received gifts as coloured blocks, one per gift, by
  //               capital — what sets its financial bandwidth
  //   offers      what it makes available, each with its terms of access
  //               (when, for whom, how), visible to everyone
  //   gifts       every gift with who gave it, what it was, its proof, and
  //               whether a steward received it — stewards answer here
  //
  // Read live off the account's own log (`accountResources`); the rules are
  // core's.
  import type {
    FlowGraphIndex,
    ResourceGift,
    ResourceOffer,
    ResourcesContext,
  } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import CapitalBlocks from "./CapitalBlocks.svelte";
  import Icon from "./Icon.svelte";
  import { capitalColour, capitalName } from "$lib/capitals";
  import { amount as amountText, shortAddress } from "$lib/format";
  import { nameFor } from "$lib/graph";
  import { locale, t, type MessageKey } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { EMPTY_RESOURCES, dispute, receive } from "$lib/resources";
  import { hrefFor } from "$lib/urls";

  export let index: FlowGraphIndex;
  export let id: string;
  export let ctx: ResourcesContext = EMPTY_RESOURCES;
  export let reading = false;
  /** The reader stewards this account: receives gifts, edits offers. */
  export let steer = false;
  /** The reader may give to it. */
  export let canGive = false;
  /** The reader's own account. */
  export let own = false;

  const dispatch = createEventDispatcher<{
    give: ResourceOffer | null;
    offer: ResourceOffer | null;
    changed: void;
  }>();

  const STATUS: Record<ResourceGift["status"], MessageKey> = {
    pending: "gift.status.pending",
    received: "gift.status.received",
    disputed: "gift.status.disputed",
  };
  const LIST_LIMIT = 12;

  let showAll = false;
  let busy = "";
  let disputing = "";
  let reason = "";

  $: node = index.byId.get(id);
  $: gifts = steer
    ? ctx.gifts
    : ctx.gifts.filter((g) => g.status !== "disputed");
  $: shown = showAll ? gifts : gifts.slice(0, LIST_LIMIT);
  $: giverOf = (g: ResourceGift) => {
    const n = index.byId.get(g.from);
    return {
      label: g.name || nameFor(g.from, n?.label),
      href: n ? hrefFor(n) : null,
    };
  };
  const date = (s: number, loc: string) =>
    new Date(s * 1000).toLocaleDateString(loc);

  async function accept(g: ResourceGift) {
    busy = g.id;
    try {
      await receive(id, g.id);
      showNotice($t("gift.received"));
      dispatch("changed");
    } catch {
      showNotice($t("gift.failed"));
    } finally {
      busy = "";
    }
  }

  async function refuse(g: ResourceGift) {
    if (!reason.trim()) return;
    busy = g.id;
    try {
      await dispute(id, g.id, reason.trim());
      disputing = "";
      reason = "";
      showNotice($t("gift.disputed"));
      dispatch("changed");
    } catch {
      showNotice($t("gift.failed"));
    } finally {
      busy = "";
    }
  }
</script>

<h2 class="section-title">
  {$t("resources.title")}{#if ctx.base.count}
    · {ctx.base.count}{/if}
</h2>
<section class="card base">
  {#if reading}
    <p class="muted">…</p>
  {:else if ctx.received.length}
    <CapitalBlocks byCapital={ctx.base.byCapital} size="large" legend />
    <p class="muted line">
      {$t("resources.baseLine", { n: ctx.base.count, givers: ctx.base.givers })}
    </p>
  {:else}
    <p class="muted">
      {own ? $t("resources.noneOwn") : $t("resources.none")}
    </p>
  {/if}
  {#if canGive && node}
    <button class="btn wide" on:click={() => dispatch("give", null)}
      ><Icon name="gift" />{$t("resources.give", { name: node.label })}</button
    >
  {/if}
</section>

{#if ctx.offers.length || steer}
  <h2 class="section-title">
    {$t("offers.title")}
    <span class="public">{$t("offers.public")}</span>
  </h2>
  {#if ctx.offers.length}
    <ul class="offers">
      {#each ctx.offers as o (o.id)}
        <li class="card offer">
          <p class="cap">
            <i style="background:{capitalColour(o.capital)}"></i>{$t(
              capitalName(o.capital),
            )}
          </p>
          <h3>
            {o.title}{#if o.quantity}
              <span class="qty"
                >· {amountText(o.quantity, o.unit ?? "", $locale)}</span
              >{/if}
          </h3>
          <dl>
            <dt>{$t("offer.when")}</dt>
            <dd>{o.terms.when ?? $t("offers.unsaid")}</dd>
            <dt>{$t("offer.who")}</dt>
            <dd>{o.terms.who ?? $t("offers.unsaid")}</dd>
            <dt>{$t("offer.how")}</dt>
            <dd>{o.terms.how ?? $t("offers.unsaid")}</dd>
          </dl>
          {#if o.note}<p class="muted note">{o.note}</p>{/if}
          {#if steer}
            <button
              class="btn quiet small"
              on:click={() => dispatch("offer", o)}>{$t("offers.edit")}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{$t("offers.none")}</p>
  {/if}
  {#if steer}
    <button class="more" on:click={() => dispatch("offer", null)}
      ><Icon name="plus" />{$t("offers.add")}</button
    >
  {/if}
{/if}

{#if gifts.length}
  <h2 class="section-title">{$t("gifts.title")}</h2>
  <ul class="gifts">
    {#each shown as g (g.id)}
      {@const giver = giverOf(g)}
      <li>
        <span class="dot" style="background:{capitalColour(g.capital)}"></span>
        <span class="body">
          <b
            >{g.what ?? $t(capitalName(g.capital))} · {amountText(
              g.amount,
              g.unit,
              $locale,
            )}</b
          >
          <i>
            {$t("gifts.from")}
            {#if giver.href}<a href={giver.href}>{giver.label}</a
              >{:else}{giver.label}{/if}
            · {date(g.createdAt, $locale)}
            {#if g.proof}
              · <a href={g.proof} target="_blank" rel="noopener noreferrer"
                >{$t("gifts.proof")}</a
              >{/if}
          </i>
          <i class="sig">
            {$t("gifts.signed", {
              key: shortAddress(g.pubkey),
            })}{#if g.decidedBy}
              · {$t("gifts.receivedBy", {
                key: shortAddress(g.decidedBy),
              })}{/if}{#if g.reason}
              · {g.reason}{/if}
          </i>
          {#if steer && g.status === "pending"}
            <span class="answer">
              {#if disputing === g.id}
                <input
                  bind:value={reason}
                  maxlength="500"
                  placeholder={$t("gifts.reason")}
                  aria-label={$t("gifts.reason")}
                />
                <button
                  class="btn quiet small"
                  disabled={busy === g.id || !reason.trim()}
                  on:click={() => refuse(g)}>{$t("gifts.dispute")}</button
                >
              {:else}
                <button
                  class="btn small"
                  disabled={busy === g.id}
                  on:click={() => accept(g)}>{$t("gifts.receive")}</button
                >
                <button
                  class="btn quiet small"
                  disabled={busy === g.id}
                  on:click={() => {
                    disputing = g.id;
                    reason = "";
                  }}>{$t("gifts.notArrived")}</button
                >
              {/if}
            </span>
          {/if}
        </span>
        <span class="status {g.status}">{$t(STATUS[g.status])}</span>
      </li>
    {/each}
  </ul>
  {#if gifts.length > shown.length}
    <button class="more" on:click={() => (showAll = true)}
      >{$t("common.showMore", { n: gifts.length - shown.length })}</button
    >
  {/if}
{/if}

<style>
  .base {
    display: grid;
    gap: 10px;
    padding: 16px;
  }
  .line {
    font-size: 0.86rem;
  }
  .wide {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .public {
    margin-left: 6px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: none;
    vertical-align: middle;
  }
  .offers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .offer {
    display: grid;
    gap: 6px;
    padding: 14px 16px;
  }
  .cap {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .cap i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .offer h3 {
    font-size: 1.05rem;
  }
  .qty {
    font-weight: 600;
    color: var(--ink-soft);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-size: 0.88rem;
  }
  dt {
    font-weight: 700;
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    font-size: 0.85rem;
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.86rem;
    justify-self: start;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin-top: 6px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--teal-ink);
  }
  .gifts {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .gifts li {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
  }
  .gifts li + li {
    border-top: 1px solid var(--line);
  }
  .dot {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    margin-top: 5px;
    border-radius: 4px;
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .body b {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .body i {
    font-style: normal;
    font-size: 0.8rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .body .sig {
    font-size: 0.74rem;
  }
  .answer {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .answer input {
    flex: 1 1 10rem;
    min-height: 40px;
    padding: 6px 12px;
    border-radius: 10px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .status {
    flex: 0 0 auto;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
    white-space: nowrap;
  }
  .status.pending {
    background: color-mix(in srgb, var(--caution) 18%, var(--card));
    color: var(--ink);
  }
  .status.disputed {
    background: color-mix(in srgb, var(--danger) 14%, var(--card));
    color: var(--ink);
  }
</style>
