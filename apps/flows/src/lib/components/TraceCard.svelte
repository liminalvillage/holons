<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Every flow, traceable. Put an amount into the Pot and follow it down to
  // this account, path by path — each hop with the part of its split it
  // passes on — then everything else that reached it, each with who gave it
  // and its proof. The paths are core's (`traceAmount`) and add up to what
  // the map says reaches the account.
  import {
    traceAmount,
    type FlowGraphIndex,
    type ResourcesContext,
  } from "@holons/core/flows";
  import { capitalColour, capitalName } from "$lib/capitals";
  import { amount as amountText, pct } from "$lib/format";
  import { nameFor } from "$lib/graph";
  import { locale, t } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { hrefFor } from "$lib/urls";

  export let index: FlowGraphIndex;
  export let id: string;
  export let resources: ResourcesContext;

  const PATHS = 5;

  let put = 1000;
  let showAll = false;

  $: unit = $potLive.units[0] ?? "EUR";
  $: root = index.byId.get(index.graph.root);
  $: node = index.byId.get(id);
  $: trace = traceAmount(index, id, Number(put) || 0);
  $: paths = showAll ? trace.paths : trace.paths.slice(0, PATHS);
  $: money = (v: number) => amountText(v, unit, $locale);
  $: received = resources.received;
</script>

{#if root && node && node.id !== root.id}
  <h2 class="section-title">{$t("trace.title")}</h2>
  <section class="card trace">
    <label class="put">
      <span>{$t("trace.put", { pot: root.label })}</span>
      <span class="input">
        <input
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          bind:value={put}
          aria-label={$t("trace.amount")}
        />
        <b>{unit}</b>
      </span>
    </label>
    <p class="reach">
      <b>{money(trace.reached)}</b>
      {$t("trace.reaches", { name: node.label })}
      {#if trace.truncated}<span class="muted">{$t("trace.atLeast")}</span>{/if}
    </p>

    {#if paths.length}
      <ol class="paths">
        {#each paths as p, i (i)}
          <li>
            <span class="hops">
              {#each p.hops as h, k (k)}
                {@const n = index.byId.get(h.id)}
                {#if k}<span class="arrow" aria-hidden="true">→</span>{/if}
                <span class="hop">
                  {#if n && h.id !== id}<a href={hrefFor(n)}
                      >{nameFor(h.id, h.label)}</a
                    >{:else}{nameFor(h.id, h.label)}{/if}
                  {#if k}<small>{pct(h.local)}</small>{/if}
                </span>
              {/each}
            </span>
            <b>{money(p.amount)}</b>
          </li>
        {/each}
      </ol>
      {#if trace.paths.length > paths.length}
        <button class="more" on:click={() => (showAll = true)}
          >{$t("common.showMore", {
            n: trace.paths.length - paths.length,
          })}</button
        >
      {/if}
    {:else}
      <p class="muted">{$t("trace.none")}</p>
    {/if}

    <h3>{$t("trace.besides")}</h3>
    <ul class="kinds">
      <li>
        <span class="dot" style="background:{capitalColour('financial')}"
        ></span>
        <span class="what"
          ><b>{$t("capital.financial")}</b>
          <i>{$t("trace.moneyLine", { pot: root.label })}</i></span
        >
        <span class="val">{money(trace.reached)}</span>
      </li>
      {#each received as g (g.id)}
        {@const giver = index.byId.get(g.from)}
        <li>
          <span class="dot" style="background:{capitalColour(g.capital)}"
          ></span>
          <span class="what">
            <b>{g.what ?? $t(capitalName(g.capital))}</b>
            <i>
              {$t("gifts.from")}
              {#if giver}<a href={hrefFor(giver)}
                  >{g.name || nameFor(g.from, giver.label)}</a
                >{:else}{g.name || nameFor(g.from)}{/if}
              ·
              {#if g.proof}<a
                  href={g.proof}
                  target="_blank"
                  rel="noopener noreferrer">{$t("gifts.proof")}</a
                >{:else}{$t("trace.signedProof")}{/if}
            </i>
          </span>
          <span class="val">{amountText(g.amount, g.unit, $locale)}</span>
        </li>
      {/each}
    </ul>
    {#if !received.length}
      <p class="muted">{$t("trace.noResources")}</p>
    {/if}
  </section>
{/if}

<style>
  .trace {
    display: grid;
    gap: 12px;
    padding: 16px;
  }
  .put {
    display: grid;
    gap: 6px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .input {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .input input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--tap);
    padding: 8px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .input b {
    color: var(--ink);
  }
  .reach {
    font-size: 1rem;
  }
  .reach b {
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .paths li {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--paper);
  }
  .hops {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
    font-size: 0.86rem;
  }
  .hop {
    overflow-wrap: anywhere;
  }
  .hop small {
    margin-left: 3px;
    color: var(--muted);
    font-size: 0.72rem;
  }
  .arrow {
    color: var(--muted);
  }
  .paths b {
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  h3 {
    font-size: 0.95rem;
    margin-top: 4px;
  }
  .kinds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .kinds li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .dot {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    margin-top: 5px;
    border-radius: 4px;
  }
  .what {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .what i {
    font-style: normal;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .val {
    flex: 0 0 auto;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .more {
    justify-self: start;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 700;
    color: var(--teal-ink);
  }
</style>
