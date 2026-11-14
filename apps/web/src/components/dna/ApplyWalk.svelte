<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // The walk before asking to join a holon, on the dashboard: one gene per
  // screen (read it, or agree to it), then a review with the one consent
  // checkbox, then the request. The walk's rules are core's
  // (`@holons/core/dna` walk: steps, stale genes, the hash to sign);
  // signing is the page's `send`, which calls core `applyToHolon`. State is
  // kept per device in localStorage. A handoff link (`?dna=<hash>`) skips
  // the reading, never the consent: the checkbox is always the person's own.
  import { onMount } from 'svelte';
  import {
    acknowledgeStep,
    emptyWalkState,
    unacknowledgeStep,
    walkProgress,
    type HolonFront,
    type WalkState,
    type WalkStep,
  } from '@holons/core/dna';
  import GeneSection from './GeneSection.svelte';
  import { holonHref, dnaHref } from '$lib/dna/links';
  import { loadWalk, saveWalk } from '$lib/dna/walkState';
  import { kindLabel, t, type Lang } from '$lib/dna/copy';

  export let front: HolonFront;
  export let lang: Lang = 'en';
  /** The person holds a signing key on this device. */
  export let canSign = true;
  /** A name to start the request's name field with. */
  export let defaultName = '';
  /** The DNA hash a handoff link carried (`?dna=`), or null. */
  export let handoff: string | null = null;
  /** Sign and send the request; rejects with what went wrong (`DnaChanged` when the DNA moved under the person). */
  export let send: (input: { acknowledged: string | null; reason: string }) => Promise<void>;

  type Screen = 'intro' | 'review' | 'done' | number;

  let state: WalkState = emptyWalkState();
  let loaded = false;
  let at: Screen = 'intro';
  let name = defaultName;
  let consent = false;
  let busy = false;
  let error = '';
  let lastHash: string | null = front.dna.hash;

  $: steps = front.walk;
  $: progress = walkProgress(steps, state, front.dna.hash);
  $: if (loaded) saveWalk(front.holon, state);
  // A consent is to one DNA: when it moves, the box is the person's to tick again.
  $: if (front.dna.hash !== lastHash) {
    lastHash = front.dna.hash;
    consent = false;
  }
  $: current = typeof at === 'number' ? steps[at] : undefined;
  $: currentGene = current ? front.genes.find((g) => g.id === current!.gene) : undefined;
  $: currentDone = current ? state.acks[current.gene] === current.hash : false;
  $: currentStale = current ? !!state.acks[current.gene] && !currentDone : false;
  $: canSend = progress.complete && (!front.dna.hash || consent) && canSign && !busy;
  // An error belongs to the screen it happened on.
  $: if (at !== 'review') error = '';
  $: cta = front.viewer.cta;
  // A handoff link carries the DNA hash its maker read: it matches this DNA, or it is old.
  $: handoffNote = !handoff ? null : front.dna.hash && handoff.toLowerCase() === front.dna.hash ? 'ok' : 'stale';
  $: if (loaded && steps.length === 0 && at === 'intro') at = 'review';

  onMount(() => {
    state = loadWalk(front.holon);
    if (handoff) {
      if (front.dna.hash && handoff.toLowerCase() === front.dna.hash) {
        // The link says this DNA was read elsewhere: tick its parts and open the review. The consent stays unticked.
        for (const s of steps) state = acknowledgeStep(state, s);
        at = 'review';
      }
    }
    loaded = true;
  });

  const done = (s: WalkStep): boolean => state.acks[s.gene] === s.hash;
  const isStale = (s: WalkStep): boolean => !!state.acks[s.gene] && !done(s);

  function advance() {
    if (typeof at !== 'number') return;
    at = at + 1 < steps.length ? at + 1 : 'review';
  }
  function back() {
    if (at === 'review') at = steps.length ? steps.length - 1 : 'intro';
    else if (typeof at === 'number') at = at > 0 ? at - 1 : 'intro';
  }
  function markRead() {
    if (current) state = acknowledgeStep(state, current);
    advance();
  }
  function toggleAgree(e: Event) {
    if (!current) return;
    state = (e.currentTarget as HTMLInputElement).checked ? acknowledgeStep(state, current) : unacknowledgeStep(state, current);
  }
  function start() {
    const i = steps.findIndex((s) => !done(s));
    at = i === -1 ? 'review' : i;
  }

  async function submit() {
    if (!canSend) return;
    busy = true;
    error = '';
    try {
      await send({ acknowledged: progress.hash, reason: name.trim() });
      at = 'done';
    } catch (err) {
      const e = err as { name?: string; message?: string };
      error = e?.name === 'DnaChanged' ? t(lang, 'walk.changed') : t(lang, 'walk.failed', { reason: e?.message || String(err) });
      if (e?.name === 'DnaChanged') at = 'review';
    } finally {
      busy = false;
    }
  }
</script>

<div class="walk" style={front.color ? `--band:${front.color}` : undefined}>
  <header class="top">
    <a class="holon" href={dnaHref(front.holon)}>
      <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> {front.name}
    </a>
  </header>

  {#if at === 'done'}
    <section class="card">
      <h1>{front.after.length ? t(lang, 'walk.sent') : t(lang, 'walk.sentNone')}</h1>
      {#if front.after.length}
        <ol class="after">
          {#each front.after as s (s.id)}<li>{s.title}</li>{/each}
        </ol>
      {/if}
      <a class="btn btn--primary go" href={holonHref(front.holon)}>{t(lang, 'walk.sentOpen', { holon: front.name })}</a>
    </section>
  {:else if cta === 'linked'}
    <section class="card">
      <h1>{t(lang, 'dna.linked')}</h1>
      <p>{t(lang, 'walk.linkedDetail', { holon: front.name })}</p>
      <a class="btn btn--primary go" href={holonHref(front.holon)}>{t(lang, 'walk.sentOpen', { holon: front.name })}</a>
    </section>
  {:else if cta === 'continue'}
    <section class="card">
      <h1>{t(lang, 'walk.pendingTitle')}</h1>
      <p>{t(lang, 'walk.pendingDetail', { holon: front.name })}</p>
      <a class="btn btn--primary go" href={holonHref(front.holon)}>{t(lang, 'walk.sentOpen', { holon: front.name })}</a>
    </section>
  {:else if cta === 'none'}
    <section class="card">
      <h1>{front.name}</h1>
      <p>{t(lang, 'dna.noAdmins', { holon: front.name })}</p>
    </section>
  {:else}
    {#if cta === 'review'}
      <p class="banner banner--warn" role="status">{t(lang, 'walk.blockedDetail')}</p>
    {/if}
    {#if handoffNote === 'ok' && at === 'review'}
      <p class="banner" role="status">{t(lang, 'walk.handoff', { short: front.dna.short ?? '' })}</p>
    {:else if handoffNote === 'stale' && at === 'intro'}
      <p class="banner banner--warn" role="status">{t(lang, 'walk.handoffStale')}</p>
    {/if}

    {#if steps.length}
      <ol class="bar" aria-label={t(lang, 'dna.steps')}>
        {#each steps as s, i (s.gene)}
          <li class:bar--done={done(s)} class:bar--now={at === i} class:bar--stale={isStale(s)}></li>
        {/each}
        <li class:bar--now={at === 'review'} class:bar--done={progress.complete && at === 'review'}></li>
      </ol>
    {/if}

    {#if at === 'intro'}
      <section class="card">
        <h1>{t(lang, 'walk.intro', { holon: front.name })}</h1>
        <p>{t(lang, 'walk.introDetail', { k: front.counts.parts, m: front.counts.minutes })}</p>
        <ul class="parts">
          {#each steps as s (s.gene)}
            <li class:done={done(s)}>
              <i class={done(s) ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'} aria-hidden="true"></i>
              {s.title}
              {#if isStale(s)}<span class="stale">{t(lang, 'walk.stale', { gene: s.title })}</span>{/if}
            </li>
          {/each}
        </ul>
        <button type="button" class="btn btn--primary go" on:click={start}>
          {Object.keys(state.acks).length ? t(lang, 'walk.resume') : t(lang, 'walk.start')}
        </button>
      </section>
    {:else if current && currentGene}
      <section class="card card--gene" style={currentGene.color ? `--gene:${currentGene.color}` : undefined}>
        <p class="step">
          {t(lang, 'walk.part', { i: (at as number) + 1, k: steps.length })} · {kindLabel(lang, current.kind)}
        </p>
        {#if currentStale}
          <p class="banner banner--warn" role="status">{t(lang, 'walk.stale', { gene: current.title })}</p>
        {/if}
        <GeneSection gene={currentGene} {lang} badges={false} anchor={false} />
        <div class="ack">
          {#if current.ack === 'agree'}
            <label class="check">
              <input type="checkbox" checked={currentDone} on:change={toggleAgree} />
              <span>{t(lang, 'walk.agree', { gene: current.title })}</span>
            </label>
          {/if}
          <div class="nav">
            <button type="button" class="btn btn--ghost" on:click={back}>{t(lang, 'walk.back')}</button>
            {#if current.ack === 'read' && !currentDone}
              <button type="button" class="btn btn--primary go" on:click={markRead}>{t(lang, 'walk.read')}</button>
            {:else}
              <button type="button" class="btn btn--primary go" disabled={!currentDone} on:click={advance}>{t(lang, 'walk.continue')}</button>
            {/if}
          </div>
        </div>
      </section>
    {:else if at === 'review'}
      <section class="card">
        <h1>{steps.length ? t(lang, 'walk.review') : t(lang, 'walk.reviewNone')}</h1>
        {#if steps.length}
          <p>{t(lang, 'walk.reviewDetail')}</p>
          <ul class="parts">
            {#each steps as s, i (s.gene)}
              <li class:done={done(s)}>
                <i class={done(s) ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'} aria-hidden="true"></i>
                {#if done(s)}
                  {s.title}
                {:else}
                  <button type="button" class="linkish" on:click={() => (at = i)}>{s.title}</button>
                  {#if isStale(s)}<span class="stale">{t(lang, 'walk.stale', { gene: s.title })}</span>{/if}
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        <label class="field">
          <span>{t(lang, 'walk.name')}</span>
          <input class="input" type="text" bind:value={name} autocomplete="name" maxlength="120" />
          <small>{t(lang, 'walk.nameHint')}</small>
        </label>

        {#if front.dna.hash && progress.complete}
          <label class="check check--consent">
            <input type="checkbox" bind:checked={consent} />
            <span>{t(lang, 'walk.consent', { holon: front.name, short: front.dna.short ?? '' })}</span>
          </label>
        {/if}

        {#if error}<p class="banner banner--bad" role="alert">{error}</p>{/if}
        {#if !canSign}<p class="banner" role="status">{t(lang, 'walk.signIn')}</p>{/if}

        <div class="nav">
          <button type="button" class="btn btn--ghost" on:click={back}>{t(lang, 'walk.back')}</button>
          {#if progress.complete}
            <button type="button" class="btn btn--primary go" disabled={!canSend} on:click={submit}>
              {busy ? t(lang, 'walk.sending') : t(lang, 'walk.send')}
            </button>
          {:else}
            <button type="button" class="btn btn--primary go" on:click={start}>{t(lang, 'walk.reviewMore')}</button>
          {/if}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .walk {
    max-width: 44rem;
    margin: 0 auto;
    padding: 0.9rem 1rem calc(4rem + env(safe-area-inset-bottom));
    color: var(--color-text-primary);
  }

  .top {
    margin-bottom: 0.8rem;
  }

  .holon {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    font-size: 0.85rem;
    color: var(--color-text-muted);
    text-decoration: none;
  }

  .holon:hover {
    color: var(--color-text-primary);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding: 1.3rem 1.2rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-top: 5px solid var(--gene, var(--band, var(--color-accent)));
    border-radius: 18px;
  }

  h1 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.25;
  }

  p {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--color-text-secondary);
  }

  .step {
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .bar {
    display: flex;
    gap: 0.3rem;
    margin: 0 0 0.9rem;
    padding: 0;
    list-style: none;
  }

  .bar li {
    flex: 1;
    height: 0.3rem;
    border-radius: 999px;
    background: var(--color-bg-tertiary);
  }

  .bar li.bar--done {
    background: var(--color-success);
  }

  .bar li.bar--stale {
    background: var(--color-warning);
  }

  .bar li.bar--now {
    background: var(--band, var(--color-accent));
  }

  .parts {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.92rem;
    color: var(--color-text-secondary);
  }

  .parts li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .parts li.done i {
    color: var(--color-success);
  }

  .stale {
    font-size: 0.75rem;
    color: var(--color-warning);
  }

  .linkish {
    padding: 0;
    background: none;
    border: none;
    color: var(--color-accent-light);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }

  .ack {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--color-border);
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    min-height: 2.75rem;
    font-size: 0.95rem;
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .check input {
    flex: none;
    width: 1.4rem;
    height: 1.4rem;
    margin-top: 0.1rem;
    accent-color: var(--gene, var(--color-accent));
  }

  .check--consent {
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--color-border-light);
    border-radius: 12px;
    background: var(--color-bg-primary);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .field small {
    color: var(--color-text-muted);
  }

  .nav {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .nav :global(.btn),
  .go {
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
  }

  .go {
    align-self: flex-start;
  }

  .nav .go {
    align-self: auto;
  }

  .walk > .banner {
    margin-bottom: 0.8rem;
  }

  .banner {
    padding: 0.6rem 0.8rem;
    border-radius: 10px;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    background: var(--color-info-bg);
    border: 1px solid color-mix(in srgb, var(--color-info) 35%, transparent);
  }

  .banner--warn {
    background: var(--color-warning-bg);
    border-color: color-mix(in srgb, var(--color-warning) 40%, transparent);
  }

  .banner--bad {
    background: var(--color-error-bg);
    border-color: color-mix(in srgb, var(--color-error) 40%, transparent);
  }

  .after {
    margin: 0;
    padding-left: 1.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.95rem;
    color: var(--color-text-secondary);
  }
</style>
