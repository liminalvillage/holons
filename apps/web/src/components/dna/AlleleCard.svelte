<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // One allele of a gene, as a card: icon, kicker, title, body. A card that
  // has a `detail` is a button that asks to open it; one that is a ref shows
  // the card it names (core resolved it) with where it comes from. Pure
  // display — what the card says is core's (`buildHolonFront`).
  import { createEventDispatcher } from 'svelte';
  import type { AlleleView } from '@holons/core/dna';
  import { iconClass } from '$lib/dna/icons';
  import { safeHref, isExternal } from '$lib/dna/links';
  import { t, type Lang } from '$lib/dna/copy';

  export let allele: AlleleView;
  export let lang: Lang = 'en';

  const dispatch = createEventDispatcher<{ open: AlleleView }>();

  $: icon = iconClass(allele.icon);
  $: expandable = !!allele.detail;
  $: link = allele.link ? { ...allele.link, href: safeHref(allele.link.href) } : null;
</script>

<div class="card" class:card--open={expandable}>
  <span class="head">
    {#if icon}<span class="ico" aria-hidden="true"><i class={icon}></i></span>{/if}
    <span class="titles">
      {#if allele.kicker}<span class="kicker">{allele.kicker}</span>{/if}
      {#if expandable}
        <!-- The whole card is the button's hit area (see .hit::after). -->
        <button type="button" class="title hit" on:click={() => dispatch('open', allele)}>{allele.title}</button>
      {:else}
        <span class="title">{allele.title}</span>
      {/if}
    </span>
  </span>
  {#if allele.body}<span class="body">{allele.body}</span>{/if}
  {#if allele.from}<span class="from">{t(lang, 'dna.shownFrom', { gene: allele.from.title })}</span>{/if}
  {#if link && link.href}
    <a class="link" href={link.href} target={isExternal(link.href) ? '_blank' : undefined} rel="noopener noreferrer">
      {link.label} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
    </a>
  {/if}
  {#if expandable}<span class="more" aria-hidden="true"><i class="fa-solid fa-chevron-right"></i></span>{/if}
</div>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: 100%;
    padding: 0.85rem 0.95rem;
    text-align: left;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-top: 3px solid var(--gene, var(--color-accent));
    border-radius: 14px;
    color: var(--color-text-primary);
    font: inherit;
  }

  .card--open {
    cursor: pointer;
    padding-right: 2rem;
    transition: transform var(--transition-fast), border-color var(--transition-fast);
  }

  .card--open:hover {
    transform: translateY(-1px);
    border-color: var(--gene, var(--color-accent));
  }

  .card--open:focus-within {
    outline: 2px solid var(--gene, var(--color-accent));
    outline-offset: 2px;
  }

  .hit {
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 0.98rem;
    font-weight: 600;
    line-height: 1.3;
    text-align: left;
    cursor: pointer;
  }

  .hit:focus {
    outline: none;
  }

  .hit::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 14px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
  }

  .ico {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    font-size: 0.9rem;
    color: var(--gene, var(--color-accent));
    background: color-mix(in srgb, var(--gene, var(--color-accent)) 16%, transparent);
  }

  .titles {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .kicker {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .title {
    font-size: 0.98rem;
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }

  .body {
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .from {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .link {
    position: relative;
    z-index: 1;
    align-self: flex-start;
    font-size: 0.8rem;
    color: color-mix(in srgb, var(--gene, var(--color-accent)) 62%, var(--color-text-primary));
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .more {
    position: absolute;
    top: 50%;
    right: 0.8rem;
    transform: translateY(-50%);
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }
</style>
