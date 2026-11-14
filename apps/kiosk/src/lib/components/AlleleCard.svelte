<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // One allele of a gene, as the front page and the walk show it: its icon,
  // the small line above, its title in the reading face and its text. A card
  // with more to it — a longer text, steps, links, an image, or other genes
  // it is expressed in — opens the drawer (the page owns it: `open`). A card
  // shown here from another gene (a ref, already resolved by core) says
  // where it lives. A plain card with a link is that link.
  import { createEventDispatcher } from "svelte";
  import type { AlleleView } from "@holons/core/dna";
  import { alleleIconName } from "$lib/dna";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  export let allele: AlleleView;

  const dispatch = createEventDispatcher<{ open: AlleleView }>();

  $: more =
    !!allele.detail ||
    allele.expressedIn.length > 0 ||
    !!allele.from ||
    (allele.body?.length ?? 0) > 280;
  $: external = !more && allele.link ? allele.link : null;
</script>

{#if more}
  <button
    type="button"
    class="allele"
    class:ref={!!allele.from}
    aria-haspopup="dialog"
    on:click={() => dispatch("open", allele)}
  >
    <span class="ico" aria-hidden="true">
      <Icon name={allele.icon ? alleleIconName(allele.icon) : "leaf"} />
    </span>
    <span class="text">
      {#if allele.kicker}<span class="kicker">{allele.kicker}</span>{/if}
      <span class="title">{allele.title}</span>
      {#if allele.body}<span class="body clamp">{allele.body}</span>{/if}
      <span class="foot">
        {#if allele.from}
          <span class="from"
            ><Icon name="link" />
            {$t("front.from", { gene: allele.from.title })}</span
          >
        {:else if allele.expressedIn.length}
          <span class="from"
            ><Icon name="network" />
            {$t("front.expressedInN", {
              n: allele.expressedIn.length,
            })}</span
          >
        {/if}
        <span class="go">{$t("front.more")}<Icon name="chevron-right" /></span>
      </span>
    </span>
  </button>
{:else if external}
  <a
    class="allele"
    href={external.href}
    target="_blank"
    rel="noopener noreferrer"
  >
    <span class="ico" aria-hidden="true">
      <Icon name={allele.icon ? alleleIconName(allele.icon) : "leaf"} />
    </span>
    <span class="text">
      {#if allele.kicker}<span class="kicker">{allele.kicker}</span>{/if}
      <span class="title">{allele.title}</span>
      {#if allele.body}<span class="body">{allele.body}</span>{/if}
      <span class="foot">
        <span class="go"
          >{external.label || $t("front.visit")}<Icon
            name="arrow-up-right"
          /></span
        >
      </span>
    </span>
  </a>
{:else}
  <article class="allele">
    <span class="ico" aria-hidden="true">
      <Icon name={allele.icon ? alleleIconName(allele.icon) : "leaf"} />
    </span>
    <div class="text">
      {#if allele.kicker}<p class="kicker">{allele.kicker}</p>{/if}
      <h3 class="title">{allele.title}</h3>
      {#if allele.body}<p class="body">{allele.body}</p>{/if}
    </div>
  </article>
{/if}

<style>
  .allele {
    /* The gene's hue arrives as --g (a ground, never text as is). */
    display: flex;
    gap: 0.9rem;
    align-items: flex-start;
    width: 100%;
    min-height: 44px;
    box-sizing: border-box;
    padding: 1rem 1.1rem 1.05rem;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    text-align: left;
    font: inherit;
    text-decoration: none;
    transition:
      border-color 0.25s ease,
      box-shadow 0.25s ease,
      transform 0.25s ease;
    -webkit-tap-highlight-color: transparent;
  }
  button.allele,
  a.allele {
    cursor: pointer;
  }
  button.allele:hover,
  a.allele:hover {
    border-color: color-mix(in srgb, var(--g, var(--teal)) 55%, var(--line));
    box-shadow: var(--shadow-soft);
  }
  button.allele:active,
  a.allele:active {
    transform: scale(0.99);
  }
  button.allele:focus-visible,
  a.allele:focus-visible {
    outline: 2px solid var(--teal-ink);
    outline-offset: 2px;
  }
  .allele.ref {
    border-style: dashed;
  }

  .ico {
    flex: 0 0 auto;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.15rem;
    background: color-mix(in srgb, var(--g, var(--teal)) 16%, var(--card));
    color: color-mix(in srgb, var(--g, var(--teal)) 62%, var(--ink));
  }

  .text {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .kicker {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--g, var(--teal)) 30%, var(--ink-soft));
  }
  .title {
    margin: 0;
    font-family: var(--font-serif);
    font-size: 1.22rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .body {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--ink-soft);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  .body.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.3rem 0.8rem;
    margin-top: 0.45rem;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .from {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 0.7rem;
    color: var(--ink-soft);
    transition: color 0.2s ease;
  }
  .allele:hover .go {
    color: var(--teal-ink);
  }

  @media (prefers-reduced-motion: reduce) {
    .allele {
      transition: none;
    }
  }
</style>
