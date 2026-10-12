<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The people in the sky: everyone who is in two or more of the hubs on the
  // dock, standing between those hubs with a tie out to each — so the person
  // holding two groups together is the thing one sees between them. Who they
  // are comes from the dock's people store (lib/dockpeople, core's rule);
  // where they stand is worked out from the orbs' own positions every frame,
  // so they ride along with the gravity field without being part of it.
  // A tap opens a small card naming the person and their hubs.
  import { holonColor, holonColors } from "$lib/palette";
  import type { Vec } from "$lib/dock";
  import {
    dockPeople,
    initialsOf,
    personSpots,
    rimPoint,
    type PersonSpot,
  } from "$lib/dockpeople";
  import { nameOf } from "$lib/names";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  /** Where the orbs are this frame (field px). */
  export let positions: ReadonlyMap<string, Vec>;
  export let fieldW = 0;
  export let fieldH = 0;
  /** An orb's diameter in px, and in rem — a person is sized from both. */
  export let orb = 0;
  export let orbRem = 6.5;
  /** The hubs the search has left on screen; null when it is not narrowing. */
  export let visible: ReadonlySet<string> | null = null;
  /** Each docked hub's name. */
  export let hubNames: ReadonlyMap<string, string> = new Map();
  export let onopen: (hub: string) => void;
  /** The "+N" was tapped: the list has everyone. */
  export let onmore: () => void;

  const PERSON_REM = 2.75; // a 44px target at the base root size
  $: pr = ((orb / orbRem) * PERSON_REM) / 2;
  $: spots = personSpots($dockPeople.connectors, positions, orb / 2, pr, {
    visible,
  });

  let openId: string | null = null;
  $: openSpot = openId
    ? (spots.find((s) => s.person?.id === openId) ?? null)
    : null;

  /** Stand the card down; true when there was one (the tap is spent). */
  export function close(): boolean {
    const had = openId !== null;
    openId = null;
    return had;
  }

  function tap(spot: PersonSpot) {
    if (spot.person) openId = openId === spot.person.id ? null : spot.person.id;
    else onmore();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  /** A ring cut into equal arcs, one per hub, each in that hub's colour. */
  function ringOf(hubs: readonly string[], colors: typeof $holonColors) {
    const arc = 100 / hubs.length;
    return `conic-gradient(${hubs
      .map((h, i) => `${holonColor(h, colors)} ${i * arc}% ${(i + 1) * arc}%`)
      .join(", ")})`;
  }
</script>

<svelte:window on:keydown={onKey} />

{#if fieldW && fieldH && spots.length}
  <svg class="reach" viewBox="0 0 {fieldW} {fieldH}" aria-hidden="true">
    {#each spots as s (s.key)}
      {#each s.hubs as h (h)}
        {@const hp = positions.get(h)}
        {#if hp}
          {@const end = rimPoint(hp, s, orb / 2)}
          <line
            class:lit={openId !== null && s.person?.id === openId}
            class:dim={openId !== null && s.person?.id !== openId}
            style="--c: {holonColor(h, $holonColors)}"
            x1={s.x}
            y1={s.y}
            x2={end.x}
            y2={end.y}
          />
        {/if}
      {/each}
    {/each}
  </svg>

  {#each spots as s (s.key)}
    {#if s.person}
      {@const name = $nameOf(s.person.id)}
      {@const letters = initialsOf(name)}
      <button
        type="button"
        class="person"
        class:open={openId === s.person.id}
        class:dim={openId !== null && openId !== s.person.id}
        style="left: {s.x}px; top: {s.y}px; --ring: {ringOf(
          s.hubs,
          $holonColors,
        )}"
        aria-label={$t("dock.personOpen", { name, n: s.person.holons.length })}
        aria-expanded={openId === s.person.id}
        title={name}
        on:click|stopPropagation={() => tap(s)}
      >
        <span class="face">
          {#if letters}{letters}{:else}<Icon name="person" />{/if}
        </span>
      </button>
    {:else}
      <button
        type="button"
        class="person more"
        class:dim={openId !== null}
        style="left: {s.x}px; top: {s.y}px; --ring: {ringOf(
          s.hubs,
          $holonColors,
        )}"
        aria-label={$t("dock.peopleMore", { n: s.more ?? 0 })}
        title={$t("dock.peopleMore", { n: s.more ?? 0 })}
        on:click|stopPropagation={() => tap(s)}
      >
        <span class="face">+{s.more}</span>
      </button>
    {/if}
  {/each}

  {#if openSpot?.person}
    {@const p = openSpot.person}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div
      class="card"
      class:below={openSpot.y < fieldH * 0.4}
      role="group"
      aria-label={$nameOf(p.id)}
      style="left: {Math.min(
        Math.max(openSpot.x, 150),
        Math.max(fieldW - 150, 150),
      )}px; top: {openSpot.y}px"
      on:click|stopPropagation
    >
      <header>
        <strong>{$nameOf(p.id)}</strong>
        <button
          type="button"
          class="x"
          aria-label={$t("map.closePanel")}
          on:click={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <p>{$t("dock.personIn", { n: p.holons.length })}</p>
      <ul>
        {#each p.holons as h (h)}
          <li>
            <button
              type="button"
              class="hub"
              on:click={() => {
                close();
                onopen(h);
              }}
            >
              <span
                class="dot"
                style:--c={holonColor(h, $holonColors)}
                aria-hidden="true"
              ></span>
              <span class="label">{hubNames.get(h) ?? $nameOf(h)}</span>
              <span class="chev" aria-hidden="true"
                ><Icon name="chevron-right" /></span
              >
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}

<style>
  /* The ties: from a person out to the rim of each of their hubs, in that
     hub's colour. Beneath the people, above the orbs and their names. */
  .reach {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 2;
    pointer-events: none;
    overflow: visible;
  }
  .reach line {
    stroke: color-mix(in srgb, var(--c) 75%, var(--ink));
    stroke-width: 1.75;
    stroke-linecap: round;
    opacity: 0.7;
    transition: opacity 0.2s ease;
  }
  .reach line.lit {
    stroke-width: 3;
    opacity: 1;
  }
  .reach line.dim {
    opacity: 0.18;
  }

  /* A person: a small disc on the theme's card, inside a ring cut into their
     hubs' colours. The ring says which hubs before any tie is followed. */
  .person {
    position: absolute;
    z-index: 3;
    width: 2.75rem;
    height: 2.75rem;
    padding: 3px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--ring);
    box-shadow: var(--shadow-soft);
    pointer-events: auto;
    transition:
      opacity 0.2s ease,
      transform 0.15s ease;
  }
  .person:active {
    transform: translate(-50%, -50%) scale(0.93);
  }
  .person.open {
    transform: translate(-50%, -50%) scale(1.12);
  }
  .person.dim {
    opacity: 0.45;
  }
  .face {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--card);
    color: var(--ink);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
  }
  .person.more .face {
    color: var(--ink-soft);
    font-size: 0.78rem;
  }

  /* The card hangs above the person it is about — below, when they stand
     near the top of the sky, so it never runs under the bar. */
  .card {
    position: absolute;
    z-index: 5;
    width: min(17rem, calc(100% - 1.6rem));
    transform: translate(-50%, calc(-100% - 2rem));
    padding: 0.6rem 0.8rem 0.4rem;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    box-shadow: var(--shadow-soft);
    pointer-events: auto;
    text-transform: none;
    letter-spacing: 0;
  }
  .card.below {
    transform: translate(-50%, 2rem);
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .card strong {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.98rem;
    color: var(--ink);
  }
  .x {
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    margin: -0.5rem -0.6rem -0.5rem 0;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-size: 1.05rem;
    color: var(--ink-soft);
  }
  .card p {
    margin: 0.1rem 0 0.35rem;
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .card ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card li {
    border-top: 1px solid var(--line);
  }
  .hub {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    min-height: 44px;
    padding: 0.4rem 0;
    text-align: left;
    font-family: inherit;
    font-size: 0.92rem;
    color: var(--ink);
  }
  .hub:active {
    opacity: 0.7;
  }
  .dot {
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--c);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    flex: none;
    font-size: 1rem;
    color: var(--ink-soft);
  }
</style>
