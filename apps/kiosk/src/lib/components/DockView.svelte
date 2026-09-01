<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dock: the space the board's card floats in. Each board this device
  // has opened is a circle in a little gravity field (see orbLayout): every
  // orb repels every other, federation links pull their orbs together, so
  // federated boards gather into constellations — each wrapped in a soft
  // hull, its holographic bound. Tap a circle to expand it back into the
  // window, long-press for edit mode (every circle grows a ✕), and the "+"
  // in the tray adds a board from an id, a registered label, or a pasted
  // link (parseHolonPaste accepts anything people actually copy).
  import { onMount, tick } from "svelte";
  import {
    boundsPath,
    dockEntries,
    forgetBoard,
    hueFor,
    labelFor,
    linksAmong,
    orbClusters,
    orbLayout,
    orbPositions,
    rememberBoard,
    requestOpen,
    stepOrbs,
    syncOrbs,
    type OrbSim,
    type Vec,
  } from "$lib/dock";
  import { getHolosphere } from "$lib/holosphere";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { parseHolonPaste } from "$lib/holons";
  import { t } from "$lib/i18n";

  const ORB = 104; // px diameter — keep in sync with the 6.5rem circle below
  const BOUND_PAD = 30; // air between an orb and its holographic bound

  // Long-press toggles edit mode, mirroring the tab-pin gesture: a press that
  // crosses the threshold arms the ✕ badges and swallows the click after it.
  const LONG_PRESS_MS = 480;
  let editing = false;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  function onOrbDown(e: PointerEvent) {
    if (e.button != null && e.button !== 0) return;
    longPressed = false;
    cancelPress();
    pressTimer = setTimeout(() => {
      longPressed = true;
      editing = !editing;
      try {
        navigator.vibrate?.(15);
      } catch {
        /* haptics are best-effort */
      }
    }, LONG_PRESS_MS);
  }
  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }
  function onOrbClick(id: string) {
    if (longPressed) {
      longPressed = false; // this click closes out the long-press
      return;
    }
    if (editing) return; // in edit mode a tap is not an open
    requestOpen(id);
  }

  // ── Federation ties ─────────────────────────────────────────────────────--
  // Each docked board's partner list, fetched once and cached for the dock's
  // lifetime. Until (or unless) it arrives, the orbs float unlinked.
  let partnerMap = new Map<string, readonly string[]>();
  const fetching = new Set<string>();

  $: ids = $dockEntries.map((e) => e.id);
  $: void loadPartners(ids);

  async function loadPartners(list: string[]) {
    const missing = list.filter(
      (id) => !partnerMap.has(id) && !fetching.has(id),
    );
    if (!missing.length) return;
    for (const id of missing) fetching.add(id);
    try {
      const hs = await getHolosphere();
      await Promise.all(
        missing.map(async (id) => {
          try {
            const snap = await getFederationSnapshot(hs, id);
            partnerMap.set(id, snap.federated);
          } catch {
            partnerMap.set(id, []);
          }
        }),
      );
      partnerMap = partnerMap; // reassign → recompute links below
    } catch {
      /* can't connect — the constellation just shows no ties */
    }
  }

  // ── The gravity field ───────────────────────────────────────────────────--
  //
  // The physics runs LIVE: a rAF loop steps the simulation every frame, so
  // the orbs visibly glide from the seed ring into their constellations and
  // keep a gentle wander afterwards — the sky breathes. Someone who prefers
  // reduced motion gets the same layout settled in one deterministic go.
  let fieldW = 0;
  let fieldH = 0;
  let positions: ReadonlyMap<string, Vec> = new Map();
  let sim: OrbSim | null = null;
  let simKey = "";

  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  $: links = linksAmong(ids, partnerMap);
  $: if (reducedMotion)
    positions = orbLayout(ids, links, fieldW, fieldH, ORB / 2);

  onMount(() => {
    if (reducedMotion) return;
    let raf = requestAnimationFrame(function frame(t) {
      if (fieldW && fieldH && ids.length) {
        // Re-seat the sim when the cast or the field changes; retained orbs
        // keep their place and momentum, newcomers glide in from the ring.
        const key = `${ids.join("\n")}|${fieldW}x${fieldH}`;
        if (!sim || key !== simKey) {
          sim = syncOrbs(sim, ids, fieldW, fieldH);
          simKey = key;
        }
        stepOrbs(sim, links, fieldW, fieldH, ORB / 2, t);
        positions = orbPositions(sim);
      }
      raf = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(raf);
  });
  $: bounds = orbClusters(ids, links)
    .filter((c) => c.length > 1)
    .map((c) => ({
      key: c.join("|"),
      d: boundsPath(
        c.map((id) => positions.get(id)).filter((p): p is Vec => !!p),
        ORB / 2 + BOUND_PAD,
      ),
    }))
    .filter((b) => b.d);

  // A board named by a raw id starts with "-" — no initial to show there, so
  // take the first letter or digit anywhere in the name.
  const initialOf = (name: string) =>
    /[\p{L}\p{N}]/u.exec(name)?.[0]?.toUpperCase() ?? "·";

  // The "+" flips into a small add form in place.
  let adding = false;
  let draft = "";
  let addError = "";
  let addInput: HTMLInputElement;

  async function startAdd() {
    adding = true;
    addError = "";
    await tick();
    addInput?.focus();
  }
  async function submitAdd() {
    const id = parseHolonPaste(draft);
    if (!id) {
      addError = $t("dock.addInvalid");
      return;
    }
    adding = false;
    draft = "";
    addError = "";
    // The circle must exist before the open morph can animate from it.
    rememberBoard(id, labelFor(id));
    await tick();
    requestOpen(id);
  }
  function cancelAdd() {
    adding = false;
    draft = "";
    addError = "";
  }

  // A tap on empty space stands down edit mode and the add form.
  function onBackdrop(e: Event) {
    if (e.target !== e.currentTarget) return;
    editing = false;
    cancelAdd();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="dock" on:click={onBackdrop}>
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="field"
    role="list"
    aria-label={$t("dock.boards")}
    bind:clientWidth={fieldW}
    bind:clientHeight={fieldH}
    on:click={onBackdrop}
  >
    {#if fieldW && fieldH}
      <!-- Ties + holographic bounds, drawn beneath the orbs. -->
      <svg class="web" viewBox="0 0 {fieldW} {fieldH}" aria-hidden="true">
        {#each bounds as b (b.key)}
          <path class="bound" d={b.d} />
        {/each}
        {#each links as l (l[0] + "|" + l[1])}
          <!-- Read `positions` directly: a helper closure would hide the
               dependency from the compiler and freeze the orbs in place. -->
          {@const pa = positions.get(l[0])}
          {@const pb = positions.get(l[1])}
          {#if pa && pb}
            <line class="tie" x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />
          {/if}
        {/each}
      </svg>

      {#each $dockEntries as e, i (e.id)}
        {@const p = positions.get(e.id)}
        {#if p}
          <div
            class="slot"
            role="listitem"
            style="--h: {hueFor(e.id)}; --i: {i}; left: {p.x}px; top: {p.y}px"
          >
            <button
              class="orb"
              data-dock-circle={e.id}
              aria-label={$t("dock.open", { name: e.name })}
              on:click={() => onOrbClick(e.id)}
              on:pointerdown={onOrbDown}
              on:pointerup={cancelPress}
              on:pointerleave={cancelPress}
              on:pointercancel={cancelPress}
            >
              <span class="initial">{initialOf(e.name)}</span>
            </button>
            {#if editing}
              <button
                class="forget"
                aria-label={$t("dock.delete", { name: e.name })}
                title={$t("dock.delete", { name: e.name })}
                on:click|stopPropagation={() => forgetBoard(e.id)}
                >&times;</button
              >
            {/if}
            <span class="name">{e.name}</span>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <div class="tray">
    {#if adding}
      <form class="add" on:submit|preventDefault={submitAdd}>
        <input
          type="text"
          bind:value={draft}
          bind:this={addInput}
          placeholder={$t("dock.addPlaceholder")}
          aria-label={$t("dock.add")}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
          on:keydown={(e) => e.key === "Escape" && cancelAdd()}
        />
        <button type="submit" class="go" aria-label={$t("dock.add")}>→</button>
        {#if addError}
          <span class="err" role="alert">{addError}</span>
        {/if}
      </form>
    {:else}
      <button class="plus" on:click={startAdd}>
        <span class="plus__sign">+</span>{$t("dock.add")}
      </button>
    {/if}
    <p class="hint">{$t("dock.hint")}</p>
  </div>
</div>

<style>
  .dock {
    position: fixed;
    inset: 0;
    z-index: 5; /* beneath the board window (z 10), which morphs over it */
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
    /* The space — deeper than the card, shared with the window layer so the
       card visibly floats in the same sky it shrinks into. */
    background:
      radial-gradient(
        90% 70% at 72% 12%,
        color-mix(in srgb, var(--teal) 8%, transparent),
        transparent 62%
      ),
      radial-gradient(120% 90% at 50% 115%, var(--paper) 0%, transparent 70%),
      var(--paper-deep);
  }

  .field {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .web {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  /* The holographic bound: a soft dashed hull slowly drifting around its
     constellation, with the faintest interior glow. */
  .bound {
    fill: color-mix(in srgb, var(--teal) 6%, transparent);
    stroke: color-mix(in srgb, var(--teal) 45%, transparent);
    stroke-width: 1.5;
    stroke-dasharray: 8 8;
    animation: bound-drift 40s linear infinite;
  }
  @keyframes bound-drift {
    to {
      stroke-dashoffset: -320;
    }
  }
  .tie {
    stroke: color-mix(in srgb, var(--teal) 35%, var(--line));
    stroke-width: 1.5;
    stroke-dasharray: 2 7;
    stroke-linecap: round;
  }

  .slot {
    position: absolute;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 8rem;
    /* No left/top transition: the live simulation moves the orbs itself,
       frame by frame — easing on top would just smear it. */
  }

  .orb {
    width: 6.5rem;
    height: 6.5rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, hsl(var(--h, 200) 60% 50%) 20%, var(--card));
    border: 2px solid
      color-mix(in srgb, hsl(var(--h, 200) 60% 50%) 45%, var(--line));
    box-shadow: var(--shadow-soft);
    animation: dock-pop 0.35s ease both;
    animation-delay: calc(var(--i, 0) * 40ms);
    transition: transform 0.15s ease;
  }
  .orb:active {
    transform: scale(0.93);
  }
  @keyframes dock-pop {
    from {
      opacity: 0;
      transform: scale(0.7);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  .orb .initial {
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 1;
    color: color-mix(in srgb, hsl(var(--h, 200) 70% 42%) 72%, var(--ink));
  }

  .name {
    max-width: 100%;
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--ink-soft);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Edit mode ✕ — oversized for kiosk fingers, riding the circle's shoulder. */
  .forget {
    position: absolute;
    top: -0.35rem;
    right: 0.55rem;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    line-height: 1;
    background: var(--ink);
    color: var(--paper);
    box-shadow: var(--shadow-soft);
    animation: dock-pop 0.15s ease both;
  }
  .forget:active {
    transform: scale(0.9);
  }

  /* Bottom tray: add a board + the one-line hint, out of the gravity field. */
  .tray {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1.4rem 1.2rem;
  }
  .plus {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1.1rem 0.5rem 0.6rem;
    border-radius: 999px;
    border: 1.5px dashed var(--line);
    color: var(--muted);
    font-size: 0.95rem;
    font-weight: 600;
    background: transparent;
  }
  .plus:active {
    transform: scale(0.96);
  }
  .plus__sign {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1.5px dashed var(--line);
    font-size: 1.1rem;
    line-height: 1;
  }

  .add {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .add input {
    width: 15rem;
    height: 2.6rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    border: 1.5px solid var(--teal);
    background: var(--card);
    color: var(--ink);
    font-size: 0.95rem;
    font-family: inherit;
  }
  .add input:focus {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 20%, transparent);
  }
  .add .go {
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.2rem;
    background: var(--teal);
    color: #fff;
  }
  .add .go:active {
    transform: scale(0.92);
  }
  .add .err {
    position: absolute;
    bottom: calc(100% + 0.45rem);
    left: 0;
    right: 0;
    text-align: center;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--note-coral);
    white-space: nowrap;
  }

  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-align: center;
  }
</style>
