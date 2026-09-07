<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Segmented pill, the kiosk's recipe on the dashboard's palette: a flat
  // track with only the active segment raised, every segment a full-height
  // tap target. When the parent asks for `compact` (or the screen is narrow)
  // the whole control collapses into one cycling toggle — tap to step to the
  // next option — so a row of pills still fits a phone.
  import { tick } from "svelte";

  export let options: { id: string; label: string; glyph?: string }[];
  export let value: string;
  export let onChange: (id: string) => void;
  /** Radiogroup aria-label, e.g. "Which unit to show". */
  export let label: string;
  /** Force the cycling toggle at any width. */
  export let compact = false;
  /** Full-width, segments sharing the row equally — the board's top switch. */
  export let stretch = false;

  $: current = options.find((o) => o.id === value) ?? options[0];

  function cycle() {
    const i = options.findIndex((o) => o.id === value);
    onChange(options[(i + 1) % options.length].id);
  }

  let el: HTMLElement | undefined;

  // Roving focus: ←/→ move the selection and keep focus on it.
  async function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : options.length - 1;
    const i = options.findIndex((o) => o.id === value);
    onChange(options[(i + step) % options.length].id);
    await tick();
    el?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }
</script>

<div class="pill" class:compact class:stretch>
  <div class="track" role="radiogroup" aria-label={label} bind:this={el}>
    {#each options as o (o.id)}
      <button
        type="button"
        role="radio"
        aria-checked={value === o.id}
        class:active={value === o.id}
        tabindex={value === o.id ? 0 : -1}
        on:click={() => onChange(o.id)}
        on:keydown={onKey}
        title={o.label}
      >
        {#if o.glyph}<span class="glyph" aria-hidden="true">{o.glyph}</span>{/if}
        <span class="txt">{o.label}</span>
      </button>
    {/each}
  </div>

  <button
    type="button"
    class="cycler"
    on:click={cycle}
    aria-label="{label}: {current?.label} — tap for next"
    title="{label}: {current?.label}"
  >
    {#if current?.glyph}<span class="glyph" aria-hidden="true">{current.glyph}</span>{/if}
    <span class="txt">{current?.label}</span>
    <span class="caret" aria-hidden="true">⇄</span>
  </button>
</div>

<style>
  .pill {
    display: contents;
  }

  .track {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 999px;
  }

  .track button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 2.5rem;
    padding: 0 0.95rem;
    border-radius: 999px;
    font-size: 0.86rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    white-space: nowrap;
    touch-action: manipulation;
    transition:
      background 0.2s ease,
      color 0.2s ease,
      transform 0.1s ease;
  }

  .track button.active {
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  .track button:active {
    transform: scale(0.94);
  }

  .glyph {
    font-size: 1rem;
  }

  .stretch .track {
    display: flex;
    width: 100%;
  }

  .stretch .track button {
    flex: 1 1 0;
    padding: 0 0.4rem;
  }

  .cycler {
    display: none;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.75rem;
    padding: 0 0.95rem;
    border-radius: 999px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-size: 0.86rem;
    font-weight: 600;
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .cycler:active {
    transform: scale(0.95);
  }

  .caret {
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }

  /* Narrow screens: the cycling toggle replaces the segments — except for a
     stretched switch, which is the board's own navigation and must stay
     visible in full. */
  @media (max-width: 560px) {
    .pill:not(.stretch) .track {
      display: none;
    }
    .pill:not(.stretch) .cycler {
      display: inline-flex;
    }
  }

  .pill.compact .track {
    display: none;
  }
  .pill.compact .cycler {
    display: inline-flex;
  }
</style>
