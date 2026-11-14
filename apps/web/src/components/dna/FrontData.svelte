<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // Reads a holon's front (core `readHolonFront`: genes and settings as the
  // holon's admins wrote them, member count, and where the person looking
  // stands) and keeps it current while the DNA changes, then hands it to its
  // slot. Handles the states around it: a skeleton while it loads, "Couldn't
  // reach {holon}" with a retry when the relays do not answer.
  import { getContext, onDestroy } from 'svelte';
  import type { HoloSphere } from 'holosphere';
  import { readHolonFront, subscribeGenes, type HolonFront } from '@holons/core/dna';
  import { nostrPublicKey } from '$lib/stores/nostr';
  import { pickLang, t, type Lang } from '$lib/dna/copy';

  export let holon: string;

  const holosphere = getContext('holosphere') as HoloSphere | undefined;

  const lang: Lang = pickLang(typeof navigator !== 'undefined' ? navigator.languages : undefined);

  let front: HolonFront | null = null;
  let failed = false;
  let loading = true;
  let seq = 0;
  let stop: (() => void) | null = null;
  let watched = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  $: viewer = $nostrPublicKey || String(holosphere?.currentPubkey ?? '');

  async function load(id: string, who: string, quiet = false) {
    if (!holosphere || !id) return;
    const mine = ++seq;
    if (!quiet) loading = true;
    try {
      const next = await readHolonFront(holosphere, id, { viewer: who || null });
      if (mine !== seq) return;
      front = next;
      failed = false;
    } catch (err) {
      if (mine !== seq) return;
      console.warn('[dna] could not read the front:', err);
      if (!quiet || !front) failed = true;
    } finally {
      if (mine === seq) loading = false;
    }
  }

  /** Re-read the front now (after the DNA moved under the person, or a retry). */
  export function reload() {
    return load(holon, viewer, true);
  }

  /** Watch the holon's genes: a change re-reads, a moment later. */
  function watch(id: string) {
    if (!holosphere || watched === id) return;
    stop?.();
    watched = id;
    let first = true;
    stop = subscribeGenes(holosphere, id, () => {
      // The subscription's first emission is what load() already read.
      if (first) {
        first = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => load(id, viewer, true), 400);
    });
  }

  // One read per holon (and per viewer), then a watch on its genes. Two
  // statements, each naming only what should re-run it: the watch's own
  // timer and stop handle must never trigger another read.
  $: if (holosphere && holon) load(holon, viewer);
  $: if (holosphere && holon) watch(holon);

  onDestroy(() => {
    seq++;
    clearTimeout(timer);
    stop?.();
  });
</script>

{#if front}
  <slot front={front as HolonFront} {lang} />
{:else if failed}
  <div class="state" role="alert">
    <p>{t(lang, 'dna.unreachable', { holon })}</p>
    <button type="button" class="btn btn--primary" on:click={() => load(holon, viewer)}>{t(lang, 'dna.retry')}</button>
  </div>
{:else}
  <div class="skeleton" aria-busy="true" aria-label={t(lang, 'dna.loading')}>
    <div class="bar bar--hero"></div>
    <div class="bar"></div>
    <div class="bar bar--short"></div>
    <div class="bar bar--card"></div>
  </div>
{/if}

<style>
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.8rem;
    padding: 3rem 1rem;
    text-align: center;
    color: var(--color-text-secondary);
  }

  .state p {
    margin: 0;
  }

  .skeleton {
    max-width: 66rem;
    margin: 0 auto;
    padding: 1.4rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .bar {
    height: 1rem;
    border-radius: 8px;
    background: var(--color-bg-secondary);
    animation: dna-pulse 1.3s ease-in-out infinite;
  }

  .bar--hero {
    height: 7rem;
    border-radius: 18px;
  }

  .bar--short {
    width: 55%;
  }

  .bar--card {
    height: 9rem;
    border-radius: 14px;
  }

  @keyframes dna-pulse {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
    }
  }
</style>
