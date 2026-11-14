<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // A holon's front page, read-only: the dashboard's rendering of core's
  // `HolonFront` (hero, gene index, genes, how joining works, footer). It
  // decides nothing: the text, the order, the call to action and who may
  // edit all come from the view model. The one editor is the kiosk's, so
  // "Edit DNA" leaves for it.
  import type { HolonFront } from '@holons/core/dna';
  import GeneSection from './GeneSection.svelte';
  import { applyHref as applyLink, editDnaHref } from '$lib/dna/links';
  import { formatDate, kindLabel, peopleLabel, t, type Lang } from '$lib/dna/copy';

  export let front: HolonFront;
  export let lang: Lang = 'en';

  let showAll = false;

  $: apply = applyLink(front.holon);
  $: edit = editDnaHref(front.holon);
  $: cta = front.viewer.cta;
  $: long = front.about.length > front.teaser.length;
  $: about = showAll ? front.about : front.teaser;
  $: band = front.color ?? 'var(--color-accent)';
  $: updated = formatDate(lang, front.dna.updated);

  const howLabel = (s: HolonFront['how'][number]): string => {
    switch (s.kind) {
      case 'read':
        return t(lang, 'dna.howRead', { k: s.parts, m: s.minutes });
      case 'send':
        return t(lang, 'dna.howSend');
      case 'step':
        return s.title;
      default:
        return t(lang, 'dna.howLinked');
    }
  };
</script>

<article class="front" style={`--band:${band}`}>
  <header class="hero">
    {#if front.picture}<img class="pic" src={front.picture} alt="" loading="lazy" />{/if}
    <div class="hero__text">
      <h1>{front.name}</h1>
      {#if about}
        <p class="about">{about}</p>
        {#if long}
          <button type="button" class="more" on:click={() => (showAll = !showAll)}>
            {showAll ? t(lang, 'dna.readLess') : t(lang, 'dna.readMore')}
          </button>
        {/if}
      {/if}
      <p class="meta">{peopleLabel(lang, front.members)}</p>
      <div class="actions">
        {#if cta === 'apply'}
          <a class="btn btn--primary" href={apply}>{t(lang, 'dna.apply')}</a>
        {:else if cta === 'continue'}
          <a class="btn btn--primary" href={apply}>{t(lang, 'dna.pending')}</a>
        {:else if cta === 'review'}
          <a class="btn btn--primary" href={apply}>{t(lang, 'dna.blocked')}</a>
        {:else if cta === 'linked'}
          <span class="chip chip--ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> {t(lang, 'dna.linked')}</span>
        {:else}
          <p class="note">{t(lang, 'dna.noAdmins', { holon: front.name })}</p>
        {/if}
        {#if front.viewer.edit}
          <a class="btn btn--secondary" href={edit} target="_blank" rel="noopener noreferrer">
            {front.empty ? t(lang, 'dna.write') : t(lang, 'dna.edit')}
          </a>
        {/if}
      </div>
    </div>
  </header>

  {#if front.empty}
    <p class="empty">{t(lang, 'dna.empty', { holon: front.name })}</p>
  {:else}
    <div class="body">
      <nav class="index" aria-label={t(lang, 'dna.index')}>
        <ul>
          {#each front.genes as g (g.id)}
            <li style={g.color ? `--gene:${g.color}` : undefined}>
              <a href={`#gene-${g.id}`}>
                <span class="dot" aria-hidden="true"></span>
                <span class="label">{g.title}</span>
                {#if g.ack === 'agree'}<span class="agree" title={t(lang, 'dna.agreeBadge')}>{t(lang, 'dna.agreeBadge')}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      </nav>

      <div class="genes">
        {#each front.genes as g (g.id)}
          <GeneSection gene={g} {lang} />
        {/each}

        <section class="how">
          <h2>{t(lang, 'dna.howTitle')}</h2>
          <ol>
            {#each front.how as s}
              <li>{howLabel(s)}</li>
            {/each}
          </ol>
          {#if cta === 'apply' || cta === 'review'}
            <a class="btn btn--primary" href={apply}>{cta === 'review' ? t(lang, 'dna.blocked') : t(lang, 'dna.apply')}</a>
          {/if}
        </section>

        <footer class="foot">
          {#if front.dna.short}
            <p>{t(lang, 'dna.footer', { short: front.dna.short, date: updated })}</p>
          {/if}
          <p>{t(lang, 'dna.living', { holon: front.name })}</p>
        </footer>
      </div>
    </div>
  {/if}
</article>

<style>
  .front {
    max-width: 66rem;
    margin: 0 auto;
    padding: 0.9rem 1rem calc(4rem + env(safe-area-inset-bottom));
    color: var(--color-text-primary);
  }

  .hero {
    display: flex;
    gap: 1.1rem;
    align-items: flex-start;
    padding: 1.4rem 1.3rem 1.2rem;
    margin-bottom: 1.4rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-top: 6px solid var(--band);
    border-radius: 18px;
    background-image: linear-gradient(180deg, color-mix(in srgb, var(--band) 11%, transparent), transparent 55%);
  }

  .pic {
    flex: none;
    width: 4.5rem;
    height: 4.5rem;
    object-fit: cover;
    border-radius: 16px;
    border: 1px solid var(--color-border);
  }

  .hero__text {
    min-width: 0;
  }

  h1 {
    margin: 0 0 0.45rem;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 2rem;
    font-weight: 600;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }

  .about {
    margin: 0;
    max-width: 44rem;
    font-size: 1.02rem;
    line-height: 1.6;
    color: var(--color-text-secondary);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }

  .more {
    margin-top: 0.3rem;
    padding: 0.25rem 0;
    min-height: 2.75rem;
    background: none;
    border: none;
    color: var(--color-accent-light);
    font-size: 0.85rem;
    cursor: pointer;
  }

  .meta {
    margin: 0.6rem 0 0.9rem;
    font-size: 0.82rem;
    color: var(--color-text-muted);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .actions :global(.btn) {
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .chip--ok {
    color: var(--color-success);
    background: var(--color-success-bg);
    border: 1px solid color-mix(in srgb, var(--color-success) 40%, transparent);
  }

  .note,
  .empty {
    margin: 0;
    font-size: 0.9rem;
    color: var(--color-text-muted);
  }

  .empty {
    padding: 2rem 1rem;
    text-align: center;
  }

  .body {
    display: block;
  }

  .index {
    position: sticky;
    top: 0;
    z-index: 5;
    margin: 0 -1rem 1.1rem;
    padding: 0.5rem 1rem;
    background: var(--color-bg-primary);
    border-bottom: 1px solid var(--color-border);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .index::-webkit-scrollbar {
    display: none;
  }

  .index ul {
    display: flex;
    gap: 0.45rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .index a {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.5rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: 0.82rem;
    white-space: nowrap;
    color: var(--color-text-secondary);
    text-decoration: none;
  }

  .index a:hover {
    border-color: var(--gene, var(--color-accent));
    color: var(--color-text-primary);
  }

  .dot {
    flex: none;
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    background: var(--gene, var(--color-accent));
  }

  .agree {
    padding: 0 0.4rem;
    border-radius: 999px;
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--gene, var(--color-accent)) 62%, var(--color-text-primary));
    background: color-mix(in srgb, var(--gene, var(--color-accent)) 15%, transparent);
  }

  .genes {
    display: flex;
    flex-direction: column;
    gap: 2.4rem;
    min-width: 0;
  }

  .how {
    padding: 1.1rem 1.2rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 16px;
  }

  .how h2 {
    margin: 0 0 0.6rem;
    font-size: 1.15rem;
  }

  .how ol {
    margin: 0 0 1rem;
    padding-left: 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.92rem;
    color: var(--color-text-secondary);
  }

  .how :global(.btn) {
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }

  .foot {
    font-size: 0.78rem;
    color: var(--color-text-muted);
  }

  .foot p {
    margin: 0 0 0.2rem;
  }

  @media (max-width: 640px) {
    .hero {
      flex-direction: column;
      padding: 1.1rem 1rem;
    }

    h1 {
      font-size: 1.6rem;
    }
  }

  /* Desktop: the index is a rail beside the genes. */
  @media (min-width: 1024px) {
    .body {
      display: grid;
      grid-template-columns: 13rem minmax(0, 1fr);
      gap: 2rem;
      align-items: start;
    }

    .index {
      top: 1rem;
      margin: 0;
      padding: 0;
      border: none;
      overflow: visible;
      background: none;
    }

    .index ul {
      flex-direction: column;
      gap: 0.2rem;
    }

    .index a {
      border: none;
      border-radius: 10px;
      padding: 0.35rem 0.6rem;
      white-space: normal;
    }

    .index a:hover {
      background: var(--color-bg-secondary);
    }
  }
</style>
