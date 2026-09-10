<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The radius, drawn: the home cell and its parents as real H3 outlines
  // nested around the home centre, the chosen scale filled, the wider ones
  // running off the edge, the actual ground underneath (a Mapbox static
  // thumbnail of the same bounds, when the shared VITE_MAPBOX_TOKEN is set).
  // Tap a ring to pick that scale. Geometry lives in $lib/scalering; this
  // only paints and forwards taps.
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/i18n";
  import {
    formatAcross,
    scaleRingMapUrl,
    scaleRingPicture,
  } from "$lib/scalering";

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
  const MAP_CREDIT = "© Mapbox © OpenStreetMap";

  /** The home cell and its parents, nearest first (core `scaleChain`). */
  export let chain: string[] = [];
  /** The active scale option id (`holon`, `partners`, `cell:<n>`). */
  export let activeId = "holon";
  /** Label of the active option, for the caption. */
  export let activeLabel = "";

  const dispatch = createEventDispatcher<{ pick: string }>();

  $: activeLevel = activeId.startsWith("cell:")
    ? Number(activeId.slice(5))
    : -1;
  // Off the map (holon / partners), fit the first parent so the home cell
  // still reads as a cell with context.
  $: picture = scaleRingPicture(chain, activeLevel >= 0 ? activeLevel : 1);
  $: active = picture?.rings.find((r) => r.level === activeLevel) ?? null;
  $: mapUrl = picture ? scaleRingMapUrl(picture, MAPBOX_TOKEN) : "";
  // A tile that fails (offline kiosk, bad token) falls back to the tint.
  let brokenUrl = "";
  $: mapShown = mapUrl && mapUrl !== brokenUrl ? mapUrl : "";
  $: caption =
    activeLevel >= 0 && active
      ? `${activeLabel} · ${formatAcross(active.acrossKm)}`
      : picture
        ? $t("offers.ringHome", {
            d: formatAcross(picture.rings[0].acrossKm),
          })
        : "";
</script>

{#if picture}
  <div
    class="ring"
    class:mapped={!!mapShown}
    title={mapShown ? `${caption} · ${MAP_CREDIT}` : caption}
  >
    <svg
      viewBox="0 0 {picture.side} {picture.side}"
      role="group"
      aria-label={$t("offers.ringAria")}
    >
      {#if mapShown}
        <image
          href={mapShown}
          x="0"
          y="0"
          width={picture.side}
          height={picture.side}
          preserveAspectRatio="none"
          on:error={() => (brokenUrl = mapUrl)}
        />
      {/if}
      {#each [...picture.rings].reverse() as r (r.id)}
        <!-- The scale slider beside the ring is the keyboard path; the
             rings are a touch shortcut onto the same choices. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <polygon
          points={r.points}
          class="cell"
          class:on={r.level === activeLevel}
          class:home={r.level === 0}
          role="presentation"
          on:click={() => dispatch("pick", r.id)}
        />
      {/each}
      <circle cx={picture.centre.x} cy={picture.centre.y} r="2.4" class="dot" />
    </svg>
    <span class="cap">{caption}</span>
  </div>
{/if}

<style>
  .ring {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    flex: 0 0 auto;
  }
  svg {
    width: 5rem;
    height: 5rem;
    border-radius: 18%;
    background: color-mix(in srgb, var(--teal) 8%, var(--card));
    border: 1.5px solid var(--line);
    overflow: hidden;
    display: block;
  }
  .cell {
    fill: transparent;
    stroke: var(--teal-deep);
    stroke-width: 1.2;
    stroke-opacity: 0.55;
    vector-effect: non-scaling-stroke;
    cursor: pointer;
    transition: fill 160ms ease;
  }
  .cell.home {
    stroke-opacity: 0.9;
  }
  .cell.on {
    fill: color-mix(in srgb, var(--teal) 55%, transparent);
    stroke: var(--teal);
    stroke-opacity: 1;
    stroke-width: 2.5;
  }
  /* Over the map the outlines need to stand off the ground: a light halo
     via a thicker, paler stroke on the inactive rings and a lighter fill. */
  .mapped .cell {
    stroke: #fff;
    stroke-opacity: 0.85;
    stroke-width: 1.6;
  }
  .mapped .cell.on {
    fill: color-mix(in srgb, var(--teal) 40%, transparent);
    stroke: var(--teal);
    stroke-opacity: 1;
  }
  .dot {
    fill: var(--teal-deep);
  }
  .mapped .dot {
    stroke: #fff;
    stroke-width: 1;
  }
  .cap {
    font-size: 0.66rem;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
