<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Segmented pill control shared by every view. Deliberately quiet — a flat
  // paper track with only the active segment raised, matching the calendar's
  // Day/Week/Month switcher. Each pill leads with an identity icon saying
  // what it DOES (funnel = filter/scope, eye = layout, ordered list = sort);
  // on big screens the category title accompanies the icon. The whole control
  // collapses into a single cycling toggle — tap it to step through the
  // options — on small screens, or whenever the parent forces `compact` (the
  // global band does, to keep every pill on one row). Positioning is the
  // parent's job (see GlobalPills); this renders in flow. Every icon is a
  // catalog name (`$lib/icons`), drawn inline: the same on every device.
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "$lib/icons";

  export let options: {
    id: string;
    label: string;
    /** Segment icon (catalog name); text-only segments leave it out. */
    icon?: IconName;
  }[];
  export let value: string;
  export let onChange: (id: string) => void;
  /** Radiogroup aria-label, e.g. "Whose items to show" / "Tasks layout". */
  export let label: string;
  /** Identity icon naming what the pill does; empty renders none. */
  export let icon: "filter" | "eye" | "sort" | "" = "";
  /** Category title next to the icon, shown on big screens only. */
  export let title = "";
  /** Render icon + label text in each segment instead of the icon alone. */
  export let showText = false;
  /** Force the small cycling toggle regardless of screen width. */
  export let compact = false;
  /** Force the full segmented control regardless of screen width (the
   *  parent measured that it fits — see GlobalPills' unpacked tier). */
  export let expanded = false;

  $: current = options.find((m) => m.id === value) ?? options[0];

  /** Small-screen toggle: step to the next option. */
  function cycle() {
    const i = options.findIndex((m) => m.id === value);
    onChange(options[(i + 1) % options.length].id);
  }

  let switchEl: HTMLElement | undefined;

  // Roving focus for the radiogroup: ←/→ move selection and keep focus on it.
  async function onSwitchKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : options.length - 1;
    const i = options.findIndex((m) => m.id === value);
    onChange(options[(i + step) % options.length].id);
    await tick();
    switchEl
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  }
</script>

<div class="pill" class:compact class:expanded>
  <!-- Full segmented control — big and medium screens. -->
  <div
    class="viewswitch"
    role="radiogroup"
    aria-label={label}
    bind:this={switchEl}
  >
    {#if icon}
      <span class="ident" aria-hidden="true">
        <Icon name={icon} class="isvg" />
        {#if title}<span class="ptitle">{title}</span>{/if}
      </span>
    {/if}
    {#each options as m (m.id)}
      <button
        role="radio"
        aria-checked={value === m.id}
        class:active={value === m.id}
        class:texty={showText}
        tabindex={value === m.id ? 0 : -1}
        on:click={() => onChange(m.id)}
        on:keydown={onSwitchKey}
        aria-label={m.label}
        title={m.label}
      >
        {#if m.icon}<Icon name={m.icon} class="picon" />{/if}
        {#if showText}<span class="txt">{m.label}</span>{/if}
      </button>
    {/each}
  </div>

  <!-- Cycling toggle — small screens. One tap steps to the next option; the
       identity icon says what the toggle controls, the segment icon what's
       current (no names — the full state lives in the accessible label). -->
  <button
    class="cycler"
    on:click={cycle}
    aria-label="{label}: {current?.label} — tap for next"
    title="{title || label}: {current?.label}"
  >
    {#if icon}<Icon name={icon} class="isvg" />{/if}
    {#if current?.icon}<Icon name={current.icon} class="picon" />{/if}
    {#if showText}
      <!-- Text segments (currencies, windows) have no icon to stand in for
           them, so the cycler names the current option outright. -->
      <span class="ctxt">{current?.label}</span>
    {/if}
  </button>
</div>

<style>
  .pill {
    display: contents;
  }

  /* Same recipe as the calendar's Day/Week/Month switcher: a flat paper
     track, no border or shadow — only the active segment stands out. */
  .viewswitch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--paper);
    border-radius: 999px;
  }
  /* The identity label sits in its own darker chip so it clearly reads as a
     label for the pill, not another segment to tap. */
  .ident {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 2.5rem;
    padding: 0 0.7rem;
    margin-right: 2px;
    border-radius: 999px;
    background: var(--paper-deep);
    color: var(--muted);
  }
  .pill :global(.isvg) {
    width: 1.05rem;
    height: 1.05rem;
  }
  /* Category title: big screens only. */
  .ptitle {
    display: none;
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  @media (min-width: 900px) {
    .ptitle {
      display: inline;
    }
  }
  .viewswitch button {
    width: 2.75rem;
    height: 2.5rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 1.05rem;
    color: var(--muted);
    touch-action: manipulation;
    transition:
      background 0.2s ease,
      color 0.2s ease,
      transform 0.1s ease;
  }
  /* Scope segments carry text — let them size to it. */
  .viewswitch button.texty {
    width: auto;
    padding: 0 1.05rem;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .viewswitch button .txt {
    font-size: 0.86rem;
    font-weight: 700;
  }
  .viewswitch button.active {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .viewswitch button:active {
    transform: scale(0.92);
  }
  .pill :global(.picon) {
    width: 1.1rem;
    height: 1.1rem;
  }

  /* Small screens: the single cycling toggle replaces the segments. */
  .cycler {
    display: none;
    align-items: center;
    gap: 0.45rem;
    height: calc(2.5rem + 8px);
    padding: 0 0.85rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--muted);
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }
  .cycler:active {
    transform: scale(0.95);
  }
  .cycler :global(.picon) {
    color: var(--ink);
  }
  .cycler .ctxt {
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--ink);
  }
  @media (max-width: 560px) {
    .viewswitch {
      display: none;
    }
    .cycler {
      display: inline-flex;
    }
  }
  /* Parent-forced compact: same swap at any width. */
  .pill.compact .viewswitch {
    display: none;
  }
  .pill.compact .cycler {
    display: inline-flex;
  }
  /* Parent-forced expanded: the full segments at any width. */
  .pill.expanded .viewswitch {
    display: inline-flex;
  }
  .pill.expanded .cycler {
    display: none;
  }
</style>
