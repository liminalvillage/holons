<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Segmented pill control shared by every view. Deliberately quiet — a flat
  // paper track with only the active segment raised, matching the calendar's
  // Day/Week/Month switcher. Each pill leads with an identity icon saying
  // what it DOES (funnel = filter/scope, eye = layout, ordered list = sort);
  // on big screens the category title accompanies the icon, and on small
  // screens the whole control collapses into a single cycling toggle — tap it
  // to step through the options. Positioning is the parent's job (see
  // PillBar); this renders in flow.
  import { tick } from "svelte";

  export let options: {
    id: string;
    label: string;
    glyph?: string;
    /** Named SVG segment icon (crisper than a text glyph): person / globe. */
    svgIcon?: "person" | "globe";
  }[];
  export let value: string;
  export let onChange: (id: string) => void;
  /** Radiogroup aria-label, e.g. "Whose items to show" / "Tasks layout". */
  export let label: string;
  /** Identity icon naming what the pill does; empty renders none. */
  export let icon: "filter" | "eye" | "sort" | "" = "";
  /** Category title next to the icon, shown on big screens only. */
  export let title = "";
  /** Render glyph + label text in each segment instead of the glyph alone. */
  export let showText = false;

  // Stroke paths (24×24) for the identity icons.
  const ICONS: Record<string, string[]> = {
    filter: ["M4 5h16l-6 7v5l-4 2v-7L4 5Z"],
    eye: [
      "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12Z",
      "M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z",
    ],
    sort: [
      "M4 6h12",
      "M4 12h9",
      "M4 18h6",
      "M19 7v10",
      "M16.5 14.5 19 17l2.5-2.5",
    ],
  };
  $: iconPaths = icon ? (ICONS[icon] ?? []) : [];

  // Per-segment SVG icons; person is a filled silhouette, globe is stroked.
  const SEGMENT_ICONS: Record<string, { paths: string[]; stroke?: boolean }> = {
    person: {
      paths: [
        "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.9 0-7.5 2-7.5 4.75V21h15v-2c0-2.75-3.6-4.75-7.5-4.75Z",
      ],
    },
    globe: {
      stroke: true,
      paths: [
        "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z",
        "M3.6 9h16.8M3.6 15h16.8",
        "M12 3c2.7 2.3 4.2 5.5 4.2 9s-1.5 6.7-4.2 9c-2.7-2.3-4.2-5.5-4.2-9s1.5-6.7 4.2-9Z",
      ],
    },
  };

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

<div class="pill">
  <!-- Full segmented control — big and medium screens. -->
  <div
    class="viewswitch"
    role="radiogroup"
    aria-label={label}
    bind:this={switchEl}
  >
    {#if iconPaths.length}
      <span class="ident" aria-hidden="true">
        <svg class="isvg" viewBox="0 0 24 24">
          {#each iconPaths as d (d)}<path {d} />{/each}
        </svg>
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
        {#if m.svgIcon && SEGMENT_ICONS[m.svgIcon]}
          <svg
            class="picon"
            class:stroked={SEGMENT_ICONS[m.svgIcon].stroke}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {#each SEGMENT_ICONS[m.svgIcon].paths as d (d)}<path {d} />{/each}
          </svg>
        {:else if m.glyph}
          <span class="glyph" aria-hidden="true">{m.glyph}</span>
        {/if}
        {#if showText}<span class="txt">{m.label}</span>{/if}
      </button>
    {/each}
  </div>

  <!-- Cycling toggle — small screens. One tap steps to the next option; the
       identity icon says what the toggle controls, the glyph what's current
       (no names — the full state lives in the accessible label). -->
  <button
    class="cycler"
    on:click={cycle}
    aria-label="{label}: {current?.label} — tap for next"
    title="{title || label}: {current?.label}"
  >
    {#if iconPaths.length}
      <svg class="isvg" viewBox="0 0 24 24" aria-hidden="true">
        {#each iconPaths as d (d)}<path {d} />{/each}
      </svg>
    {/if}
    {#if current?.svgIcon && SEGMENT_ICONS[current.svgIcon]}
      <svg
        class="picon"
        class:stroked={SEGMENT_ICONS[current.svgIcon].stroke}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {#each SEGMENT_ICONS[current.svgIcon].paths as d (d)}<path {d} />{/each}
      </svg>
    {:else if current?.glyph}
      <span class="glyph" aria-hidden="true">{current.glyph}</span>
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
  .isvg {
    width: 1.05rem;
    height: 1.05rem;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  .picon {
    width: 1.1rem;
    height: 1.1rem;
    fill: currentColor;
  }
  .picon.stroked {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
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
  .cycler .glyph {
    font-size: 1.05rem;
    color: var(--ink);
  }
  .cycler .picon {
    fill: var(--ink);
  }
  @media (max-width: 560px) {
    .viewswitch {
      display: none;
    }
    .cycler {
      display: inline-flex;
    }
  }
</style>
