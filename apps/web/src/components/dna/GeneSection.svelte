<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // One gene of a holon's DNA: title, blurb and gene links, then its alleles
  // as cards (or, for terms, as one long text; for a gene with none, the
  // blurb alone). A card with a detail opens in a sheet that also says where
  // the card is expressed. Used by the front page and by each screen of the
  // walk; everything it shows is core's view of the gene.
  import type { AlleleView, GeneView } from '@holons/core/dna';
  import AlleleCard from './AlleleCard.svelte';
  import Sheet from '../flows/Sheet.svelte';
  import { iconClass } from '$lib/dna/icons';
  import { isExternal, safeHref } from '$lib/dna/links';
  import { kindLabel, t, type Lang } from '$lib/dna/copy';

  export let gene: GeneView;
  export let lang: Lang = 'en';
  /** Show the "agree" / "terms" badge (the front page does; the walk says it itself). */
  export let badges = true;
  /** Render as a section the rail can jump to. */
  export let anchor = true;
  /** Show the title row (the walk's screen has its own heading). */
  export let heading = true;

  let opened: AlleleView | null = null;

  $: links = (gene.links ?? []).map((l) => ({ ...l, href: safeHref(l.href) })).filter((l) => !!l.href) as { label: string; href: string; icon?: string }[];
  $: detail = opened?.detail;
  $: detailLinks = (detail?.links ?? []).map((l) => ({ ...l, href: safeHref(l.href) })).filter((l) => !!l.href) as { label: string; href: string }[];
  $: image = detail?.image && safeHref(detail.image.src) ? detail.image : null;
  $: openedSource = opened?.from ? t(lang, 'dna.shownFrom', { gene: opened.from.title }) : '';
</script>

<section class="gene" id={anchor ? `gene-${gene.id}` : undefined} style={gene.color ? `--gene:${gene.color}` : undefined}>
  {#if heading}
    <header class="top">
      <span class="dot" aria-hidden="true"></span>
      <h2>{gene.title}</h2>
      {#if kindLabel(lang, gene.kind).toLowerCase() !== gene.title.trim().toLowerCase()}
        <span class="kind">{kindLabel(lang, gene.kind)}</span>
      {/if}
      {#if badges && gene.kind === 'terms'}
        <span class="badge badge--agree">{t(lang, 'dna.termsBadge')}</span>
      {:else if badges && gene.ack === 'agree'}
        <span class="badge badge--agree">{t(lang, 'dna.agreeBadge')}</span>
      {/if}
    </header>
  {/if}
  {#if gene.blurb}<p class="blurb">{gene.blurb}</p>{/if}

  {#if links.length}
    <ul class="links">
      {#each links as l (l.href + l.label)}
        <li>
          <a href={l.href} target={isExternal(l.href) ? '_blank' : undefined} rel="noopener noreferrer">
            {#if iconClass(l.icon)}<i class={iconClass(l.icon)} aria-hidden="true"></i>{/if}
            {l.label}
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if gene.layout === 'longform'}
    <div class="long">
      {#each gene.alleles as a (a.id)}
        <article>
          <h3>{a.title}</h3>
          {#if a.body}<p>{a.body}</p>{/if}
        </article>
      {/each}
    </div>
  {:else if gene.layout === 'cards'}
    <div class="grid">
      {#each gene.alleles as a (a.id)}
        <AlleleCard allele={a} {lang} on:open={(e) => (opened = e.detail)} />
      {/each}
    </div>
  {/if}
</section>

{#if opened}
  <Sheet title={opened.title} on:close={() => (opened = null)}>
    <div class="detail" style={gene.color ? `--gene:${gene.color}` : undefined}>
      {#if opened.kicker}<p class="d-kicker">{opened.kicker}</p>{/if}
      {#if openedSource}<p class="d-from">{openedSource}</p>{/if}
      {#if opened.body}<p class="d-text">{opened.body}</p>{/if}
      {#if detail?.body}<p class="d-text">{detail.body}</p>{/if}
      {#if detail?.steps?.length}
        <ol class="d-steps">
          {#each detail.steps as s}<li>{s}</li>{/each}
        </ol>
      {/if}
      {#if image}<img class="d-img" src={image.src} alt={image.alt} loading="lazy" />{/if}
      {#if detailLinks.length}
        <ul class="links">
          {#each detailLinks as l (l.href + l.label)}
            <li><a href={l.href} target={isExternal(l.href) ? '_blank' : undefined} rel="noopener noreferrer">{l.label}</a></li>
          {/each}
        </ul>
      {/if}
      {#if opened.expressedIn.length}
        <p class="d-expr">
          <span>{t(lang, 'dna.expressedIn')}</span>
          {#each opened.expressedIn as r (r.gene)}
            <a class="chip" href={`#gene-${r.gene}`} on:click={() => (opened = null)}>{r.title}</a>
          {/each}
        </p>
      {/if}
    </div>
  </Sheet>
{/if}

<style>
  .gene {
    scroll-margin-top: 4.5rem;
  }

  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.4rem;
  }

  .dot {
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 999px;
    background: var(--gene, var(--color-accent));
  }

  h2 {
    margin: 0;
    font-size: 1.35rem;
    font-weight: 650;
    color: var(--color-text-primary);
  }

  .kind {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .badge {
    padding: 0.12rem 0.55rem;
    border-radius: 999px;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .badge--agree {
    color: color-mix(in srgb, var(--gene, var(--color-accent)) 62%, var(--color-text-primary));
    background: color-mix(in srgb, var(--gene, var(--color-accent)) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--gene, var(--color-accent)) 40%, transparent);
  }

  .blurb {
    margin: 0 0 0.7rem;
    max-width: 46rem;
    font-size: 0.98rem;
    line-height: 1.6;
    color: var(--color-text-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0 0 0.9rem;
    padding: 0;
    list-style: none;
  }

  .links a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .links a:hover {
    border-color: var(--gene, var(--color-accent));
    color: var(--color-text-primary);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.7rem;
  }

  .long {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 46rem;
    padding: 1rem 1.1rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--gene, var(--color-accent));
    border-radius: 14px;
  }

  .long h3 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    font-weight: 600;
  }

  .long p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.65;
    color: var(--color-text-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding-bottom: 0.4rem;
  }

  .detail p {
    margin: 0;
  }

  .d-kicker {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .d-from {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .d-text {
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--color-text-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .d-steps {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--color-text-secondary);
  }

  .d-img {
    max-width: 100%;
    border-radius: 10px;
  }

  .d-expr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .chip {
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .chip:hover {
    border-color: var(--gene, var(--color-accent));
  }
</style>
