<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // One gene of a holon's DNA, read: its number and kind, its title in the
  // reading face, its summary and links, then its alleles as a grid of
  // cards — or, for terms, as one long text; a gene without alleles is its
  // summary alone. The layout, the refs and "expressed in" are core's
  // (`GeneView`); this only lays them out. Used by the front page and by
  // each screen of the walk.
  import { createEventDispatcher } from "svelte";
  import type { AlleleView, GeneView } from "@holons/core/dna";
  import { KIND_LABEL, alleleIconName } from "$lib/dna";
  import { t, type MessageKey } from "$lib/i18n";
  import AlleleCard from "./AlleleCard.svelte";
  import Icon from "./Icon.svelte";

  export let gene: GeneView;
  /** Its place on the page, 1-based (shown as 01, 02 …). */
  export let index: number;
  /** The heading level of the gene's title. */
  export let level: 1 | 2 = 2;
  /** Say what joining asks of this gene (read it, agree to it). */
  export let asks = true;

  const dispatch = createEventDispatcher<{
    open: { allele: AlleleView; gene: GeneView };
    gene: string;
  }>();

  $: num = String(index).padStart(2, "0");
  $: kind = gene.kind === "custom" ? null : KIND_LABEL[gene.kind];
  let askKey: MessageKey | null;
  $: askKey =
    gene.ack === "agree"
      ? "front.askAgree"
      : gene.ack === "read"
        ? "front.askRead"
        : null;
</script>

<section
  class="gene"
  id="gene-{gene.id}"
  style:--g={gene.color || null}
  aria-labelledby="gene-title-{gene.id}"
>
  <header class="head">
    <p class="num">
      <span class="n">{num}</span>
      {#if kind}<span class="kind">{$t(kind)}</span>{/if}
      {#if asks && askKey}
        <span class="ask" class:agree={gene.ack === "agree"}
          ><Icon name={gene.ack === "agree" ? "handshake" : "eye"} />
          {$t(askKey)}</span
        >
      {/if}
    </p>
    {#if level === 1}
      <h1 class="title" id="gene-title-{gene.id}">{gene.title}</h1>
    {:else}
      <h2 class="title" id="gene-title-{gene.id}">{gene.title}</h2>
    {/if}
    {#if gene.blurb}<p class="blurb">{gene.blurb}</p>{/if}
    {#if gene.links?.length}
      <ul class="links">
        {#each gene.links as l (l.href)}
          <li>
            <a href={l.href} target="_blank" rel="noopener noreferrer"
              ><Icon
                name={l.icon ? alleleIconName(l.icon) : "arrow-up-right"}
              />{l.label}</a
            >
          </li>
        {/each}
      </ul>
    {/if}
  </header>

  {#if gene.layout === "cards"}
    <ul class="grid">
      {#each gene.alleles as allele (allele.id)}
        <li>
          <AlleleCard
            {allele}
            on:open={(e) => dispatch("open", { allele: e.detail, gene })}
          />
        </li>
      {/each}
    </ul>
  {:else if gene.layout === "longform"}
    <div class="longform">
      {#each gene.alleles as allele (allele.id)}
        <article>
          {#if allele.kicker}<p class="lf-kicker">{allele.kicker}</p>{/if}
          <h3>{allele.title}</h3>
          {#if allele.body}<p class="lf-body">{allele.body}</p>{/if}
          {#if allele.detail?.body}<p class="lf-body">
              {allele.detail.body}
            </p>{/if}
        </article>
      {/each}
    </div>
  {/if}

  {#if gene.expressedIn.length}
    <p class="expressed">
      <span>{$t("front.expressedIn")}</span>
      {#each gene.expressedIn as r (r.gene)}
        <button
          type="button"
          class="chip"
          on:click={() => dispatch("gene", r.gene)}>{r.title}</button
        >
      {/each}
    </p>
  {/if}
</section>

<style>
  .gene {
    --g-ink: color-mix(in srgb, var(--g, var(--teal)) 32%, var(--ink));
    position: relative;
    scroll-margin-top: 4.5rem;
  }
  .head {
    position: relative;
    padding-left: 1.1rem;
    max-width: 44rem;
  }
  /* The gene's colour runs down its title like a strand segment. */
  .head::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.2rem;
    bottom: 0.2rem;
    width: 4px;
    border-radius: 4px;
    background: var(--g, var(--teal));
  }
  .num {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.7rem;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .n {
    font-variant-numeric: tabular-nums;
    color: var(--g-ink);
  }
  .ask {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    letter-spacing: 0.04em;
    text-transform: none;
    font-weight: 600;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .ask.agree {
    background: color-mix(in srgb, var(--g, var(--teal)) 13%, var(--card));
    border-color: transparent;
    color: var(--ink);
  }
  .title {
    margin: 0.45rem 0 0.4rem;
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: clamp(1.75rem, 1.2rem + 1.8vw, 2.6rem);
    line-height: 1.08;
    letter-spacing: 0.005em;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .blurb {
    margin: 0;
    font-size: 1.02rem;
    line-height: 1.65;
    color: var(--ink-soft);
    white-space: pre-line;
  }
  .links {
    list-style: none;
    margin: 0.8rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .links a {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0 0.95rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font-size: 0.86rem;
    text-decoration: none;
    transition: border-color 0.2s ease;
  }
  .links a :global(.icon) {
    color: var(--g-ink);
  }
  .links a:hover {
    border-color: color-mix(in srgb, var(--g, var(--teal)) 55%, var(--line));
  }

  .grid {
    list-style: none;
    margin: 1.4rem 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16.5rem), 1fr));
    gap: 0.8rem;
  }
  .grid li {
    display: flex;
  }

  .longform {
    margin: 1.3rem 0 0;
    max-width: 44rem;
    padding: 1.3rem 1.4rem;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
  }
  .longform article + article {
    margin-top: 1.2rem;
    padding-top: 1.2rem;
    border-top: 1px solid var(--line);
  }
  .lf-kicker {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .longform h3 {
    margin: 0.15rem 0 0.4rem;
    font-family: var(--font-serif);
    font-weight: 500;
    font-size: 1.25rem;
    color: var(--ink);
  }
  .lf-body {
    margin: 0.4rem 0 0;
    font-family: var(--font-serif);
    font-size: 1.04rem;
    line-height: 1.7;
    color: var(--ink);
    white-space: pre-line;
  }

  .expressed {
    margin: 1rem 0 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .chip {
    min-height: 44px;
    padding: 0 0.85rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.82rem;
  }
</style>
