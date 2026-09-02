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
  import { holonColor, holonColors, learnHolonColor } from "$lib/palette";
  import {
    boundsPath,
    dockEntries,
    dockView,
    forgetBoard,
    labelFor,
    lensPath,
    linksAmong,
    orbClusters,
    orbLayout,
    orbPositions,
    rememberBoard,
    requestOpen,
    setDockView,
    stepOrbs,
    syncOrbs,
    type OrbSim,
    type Vec,
  } from "$lib/dock";
  import { getHolosphere } from "$lib/holosphere";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { parseHolonAdd } from "$lib/holons";
  import { t } from "$lib/i18n";
  import Modal from "./Modal.svelte";
  import FederationLens from "./FederationLens.svelte";
  import DockMap from "./DockMap.svelte";
  import PlaceSearch from "./PlaceSearch.svelte";

  // The map, when it's showing — the top bar's place search flies it, and
  // its My-location button asks it to locate.
  let dockMap: DockMap | undefined;
  let locating = false;

  // The orb is sized in rem so it scales with the kiosk's fluid root font
  // (app.css clamps it 14–22px by viewport width). The physics, the vesica,
  // the hit math, and the bounds all run in px, so measure the diameter
  // from the live root size rather than assuming 16px — a fixed 104 drew
  // the lens for a circle the screen never showed. Re-read on every field
  // resize: the root size is viewport-driven, so it moves with the window.
  const ORB_REM = 6.5;
  let ORB = ORB_REM * 16; // px diameter — remeasured below once the field mounts
  function orbPx(): number {
    if (typeof document === "undefined") return ORB_REM * 16;
    const root = parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    return ORB_REM * (Number.isFinite(root) && root > 0 ? root : 16);
  }
  const BOUND_PAD = 30; // air between an orb and its holographic bound

  // One pointer, three gestures: a TAP opens the board, a stationary
  // LONG-PRESS toggles edit mode (mirroring the tab-pin gesture), and a DRAG
  // lifts the orb — carried by the finger through the gravity field — so
  // dropping it onto another orb federates the two boards. Long-press and
  // drag both swallow the click that follows them.
  const LONG_PRESS_MS = 480;
  const DRAG_START_PX = 10; // movement past this turns the press into a drag
  let editing = false;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;

  let dragId: string | null = null; // orb under the finger (pressed)
  let dragging = false; // moved past the threshold
  let dragMoved = false; // swallow the click after a drag
  let dragPos: Vec | null = null; // pointer in field coordinates
  let dropTarget: string | null = null;
  let pressAt: Vec = { x: 0, y: 0 };
  let fieldEl: HTMLDivElement;

  /** The two boards being federated by a drop — drives the config popup. */
  let fedPair: { home: string; partner: string } | null = null;

  function fieldPoint(e: PointerEvent): Vec {
    const r = fieldEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onOrbDown(e: PointerEvent, id: string) {
    if (e.button != null && e.button !== 0) return;
    longPressed = false;
    dragMoved = false;
    cancelPress();
    dragId = id;
    dragging = false;
    pressAt = fieldPoint(e);
    // Capture so the whole drag reaches this orb, even off its own pixels.
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
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
  function onOrbMove(e: PointerEvent) {
    if (!dragId || longPressed) return;
    const p = fieldPoint(e);
    if (!dragging) {
      if (Math.hypot(p.x - pressAt.x, p.y - pressAt.y) < DRAG_START_PX) return;
      dragging = true;
      cancelPress(); // a drag is not a long-press
    }
    dragPos = p;
    dropTarget = findDropTarget(p, dragId);
  }
  function onOrbUp() {
    cancelPress();
    if (dragging && dragId) {
      dragMoved = true; // the click that follows must not open the board
      if (dropTarget && dropTarget !== dragId)
        fedPair = { home: dragId, partner: dropTarget };
    }
    dragId = null;
    dragging = false;
    dragPos = null;
    dropTarget = null;
  }
  function onOrbLeave() {
    if (!dragging) cancelPress(); // capture keeps a real drag alive
  }
  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }
  function onOrbClick(e: MouseEvent, id: string) {
    if (longPressed || dragMoved) {
      longPressed = false; // this click closes out the long-press or drag
      dragMoved = false;
      return;
    }
    if (editing) return; // in edit mode a tap is not an open
    // A tap INSIDE the overlap of two federated circles is a tap on their
    // intersection lens: it configures the pair instead of opening a board.
    const other = intersectionAt(fieldPoint(e as PointerEvent), id);
    if (other) {
      fedPair = { home: id, partner: other };
      return;
    }
    requestOpen(id);
  }

  /** The linked partner whose circle also covers `p`, if any. */
  function intersectionAt(p: Vec, id: string): string | null {
    for (const [a, b] of links) {
      const other = a === id ? b : b === id ? a : null;
      if (!other) continue;
      const q = positions.get(other);
      if (q && Math.hypot(p.x - q.x, p.y - q.y) <= ORB / 2) return other;
    }
    return null;
  }

  /** The orb the pointer is over — centres closer than one diameter touch. */
  function findDropTarget(p: Vec, self: string): string | null {
    let best: string | null = null;
    let bestD = ORB;
    for (const [id, q] of positions) {
      if (id === self) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  const nameOf = (id: string) =>
    $dockEntries.find((e) => e.id === id)?.name ?? id;

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
  $: ORB = fieldW ? orbPx() : ORB; // the root size is viewport-driven
  let positions: ReadonlyMap<string, Vec> = new Map();
  let sim: OrbSim | null = null;
  let simKey = "";

  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  $: links = linksAmong(ids, partnerMap);
  $: if (reducedMotion) {
    const settled = orbLayout(ids, links, fieldW, fieldH, ORB / 2);
    // Even a parked sky lets a dragged orb follow the finger.
    if (dragging && dragId && dragPos) settled.set(dragId, dragPos);
    positions = settled;
  }

  // Each docked board's caretaker colour (settings `color`), so an orb wears
  // the same colour as the board behind it. Best-effort and de-duplicated.
  $: void learnDockColors($dockEntries);
  async function learnDockColors(entries: { id: string }[]) {
    if (typeof window === "undefined" || entries.length === 0) return;
    try {
      const hs = await getHolosphere();
      for (const e of entries) void learnHolonColor(hs, e.id);
    } catch {
      /* the hash applies */
    }
  }

  onMount(() => {
    // A federation change (this popup's writes included) redraws the ties:
    // flush the partner cache and refetch, and the orbs pull together live.
    const onFedChanged = () => {
      partnerMap = new Map();
      fetching.clear();
      void loadPartners(ids);
    };
    window.addEventListener("kiosk:federation-changed", onFedChanged);

    let raf = 0;
    if (!reducedMotion)
      raf = requestAnimationFrame(function frame(t) {
        // fieldEl is null while the map view is showing — the physics idles.
        if (fieldEl && fieldW && fieldH && ids.length) {
          // Re-seat the sim when the cast or the field changes; retained orbs
          // keep their place and momentum, newcomers glide in from the ring.
          const key = `${ids.join("\n")}|${fieldW}x${fieldH}`;
          if (!sim || key !== simKey) {
            sim = syncOrbs(sim, ids, fieldW, fieldH);
            simKey = key;
          }
          const lifted = dragging && dragId ? dragId : undefined;
          stepOrbs(sim, links, fieldW, fieldH, ORB / 2, t, lifted);
          // A dragged orb is kinematic: lifted out of the physics (see
          // stepOrbs) and pinned under the finger.
          if (dragging && dragId && dragPos) {
            const i = sim.ids.indexOf(dragId);
            if (i >= 0) {
              sim.px[i] = Math.min(fieldW, Math.max(0, dragPos.x));
              sim.py[i] = Math.min(fieldH, Math.max(0, dragPos.y));
              sim.vx[i] = 0;
              sim.vy[i] = 0;
            }
          }
          positions = orbPositions(sim);
        }
        raf = requestAnimationFrame(frame);
      });
    return () => {
      window.removeEventListener("kiosk:federation-changed", onFedChanged);
      if (raf) cancelAnimationFrame(raf);
    };
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
  {#if $dockView === "map"}
    <!-- The same boards, placed where they live: each claimed cell is a
         hexagon, and its badge opens the board through the same morph. -->
    <DockMap bind:this={dockMap} bind:locating />
  {:else}
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="field"
      role="list"
      aria-label={$t("dock.boards")}
      bind:this={fieldEl}
      bind:clientWidth={fieldW}
      bind:clientHeight={fieldH}
      style="--orb: {ORB_REM}rem"
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

        <!-- The intersection lenses, drawn ABOVE the orbs (they are opaque):
           each federated pair's vesica, tinted and marked ⇅ — tap it to
           configure the pair's flow. Hit detection lives in onOrbClick. -->
        <svg
          class="overlaps"
          viewBox="0 0 {fieldW} {fieldH}"
          aria-hidden="true"
        >
          {#each links as l (l[0] + "|" + l[1])}
            {@const pa = positions.get(l[0])}
            {@const pb = positions.get(l[1])}
            {#if pa && pb}
              {@const vesica = lensPath(pa, pb, ORB / 2)}
              {#if vesica}
                <path class="vesica" d={vesica} />
                <text
                  class="vesica-glyph"
                  x={(pa.x + pb.x) / 2}
                  y={(pa.y + pb.y) / 2}
                  dominant-baseline="central">⇅</text
                >
              {/if}
            {/if}
          {/each}
        </svg>

        {#each $dockEntries as e, i (e.id)}
          {@const p = positions.get(e.id)}
          {#if p}
            <div
              class="slot"
              class:front={dragId === e.id}
              role="listitem"
              style="--c: {holonColor(
                e.id,
                $holonColors,
              )}; --i: {i}; left: {p.x}px; top: {p.y}px"
            >
              <button
                class="orb"
                class:lifted={dragging && dragId === e.id}
                class:target={dropTarget === e.id}
                data-dock-circle={e.id}
                aria-label={$t("dock.open", { name: e.name })}
                on:click={(ev) => onOrbClick(ev, e.id)}
                on:pointerdown={(ev) => onOrbDown(ev, e.id)}
                on:pointermove={onOrbMove}
                on:pointerup={onOrbUp}
                on:pointerleave={onOrbLeave}
                on:pointercancel={onOrbUp}
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
  {/if}

  <!-- The top bar hovers over whichever surface is showing, in three slots:
       the view switch always in the middle; on the map, the place search to
       its left and the My-location button at the right edge. -->
  <div class="topbar" class:onmap={$dockView === "map"}>
    <div class="topbar__left">
      {#if $dockView === "map"}
        <PlaceSearch onpick={(hit) => dockMap?.flyTo(hit.lng, hit.lat)} />
      {/if}
    </div>
    <div class="viewtoggle" role="radiogroup" aria-label={$t("dock.boards")}>
      <button
        type="button"
        class="viewopt"
        class:on={$dockView === "deck"}
        role="radio"
        aria-checked={$dockView === "deck"}
        on:click={() => setDockView("deck")}
      >
        <span aria-hidden="true">◉</span>{$t("dock.deck")}
      </button>
      <button
        type="button"
        class="viewopt"
        class:on={$dockView === "map"}
        role="radio"
        aria-checked={$dockView === "map"}
        on:click={() => setDockView("map")}
      >
        <span aria-hidden="true">⬡</span>{$t("dock.map")}
      </button>
    </div>
    <div class="topbar__right">
      {#if $dockView === "map"}
        <button
          type="button"
          class="locate"
          on:click={() => dockMap?.locate()}
          disabled={locating}
          aria-label={$t("hex.myLocation")}
          title={$t("hex.myLocation")}
        >
          ◎
        </button>
      {/if}
    </div>
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
    <p class="hint">
      {$dockView === "map" ? $t("dock.mapHint") : $t("dock.hint")}
    </p>
  </div>
</div>

<!-- The intersection popup: dropping one circle onto another (or tapping an
     existing overlap) opens just this pair's lens settings. A fresh drop is
     linked on open with the kiosk default (receive-only); unlinking closes
     the popup — the intersection it edited no longer exists. -->
{#if fedPair}
  <Modal on:close={() => (fedPair = null)}>
    <FederationLens
      holon={fedPair.home}
      partner={fedPair.partner}
      holonName={nameOf(fedPair.home)}
      partnerName={nameOf(fedPair.partner)}
      on:unlinked={() => (fedPair = null)}
    />
  </Modal>
{/if}

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

  /* The intersection layer rides above the (opaque) orbs so each federated
     pair's vesica reads as a glassy lens between them — the tap target that
     opens the pair's flow settings. */
  .overlaps {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2; /* over resting orbs, under a carried one (.slot.front, z 3) */
  }
  .vesica {
    fill: color-mix(in srgb, var(--teal) 24%, transparent);
    stroke: color-mix(in srgb, var(--teal) 55%, transparent);
    stroke-width: 1.5;
  }
  .vesica-glyph {
    fill: color-mix(in srgb, var(--teal) 80%, var(--ink));
    font-size: 0.95rem;
    font-weight: 700;
    text-anchor: middle;
  }

  .slot {
    position: absolute;
    /* Anchor the ORB's centre (not the column's) on the physics position:
       shift up by half the orb so the vesica, ties, and hit math all line up
       with the visible circle; the name simply hangs below. */
    transform: translate(-50%, calc(var(--orb) / -2));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    width: 8rem;
    /* No left/top transition: the live simulation moves the orbs itself,
       frame by frame — easing on top would just smear it. */
  }
  .slot.front {
    z-index: 3; /* the carried orb rides above the rest of the sky */
  }

  .orb {
    width: var(--orb);
    height: var(--orb);
    border-radius: 50%;
    display: grid;
    place-items: center;
    /* Translucent tinted glass with a firm rim: overlapping circles stack
       their fills, so the intersection deepens naturally under the vesica.
       `--c` is the holon's colour — the same note its cards and board wear
       (lib/palette) — so the rim is that note pulled toward the ink, which
       reads on both the day and the night palette. */
    background: color-mix(in srgb, var(--c, var(--teal)) 62%, transparent);
    border: 3px solid color-mix(in srgb, var(--c, var(--teal)) 70%, var(--ink));
    box-shadow: var(--shadow-soft);
    animation: dock-pop 0.35s ease both;
    animation-delay: calc(var(--i, 0) * 40ms);
    transition: transform 0.15s ease;
    /* The browser must not turn a touch-drag into a scroll/zoom gesture. */
    touch-action: none;
  }
  .orb:active {
    transform: scale(0.93);
  }
  /* Carried by the finger: bigger, floating shadow (wins over :active). */
  .orb.lifted {
    transform: scale(1.08);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
  }
  /* The orb the carried one hovers: a halo says "drop here to federate". */
  .orb.target {
    border-style: dashed;
    border-color: var(--teal);
    box-shadow: 0 0 0 7px color-mix(in srgb, var(--teal) 22%, transparent);
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
    color: var(--ink);
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

  /* Bottom tray: view toggle, add a board, and the one-line hint. */
  .tray {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1.4rem 1.2rem;
  }

  /* Floating top bar: three slots — search | view switch | my-location —
     hovering over the field / the map, never in-flow. The switch stays
     centred whatever the side slots hold. The bar (and its empty slots) let
     taps through to whatever is beneath; only the controls catch them. */
  .topbar {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 0.8rem);
    left: calc(env(safe-area-inset-left) + 0.8rem);
    right: calc(env(safe-area-inset-right) + 0.8rem);
    z-index: 6; /* above the map (and its overlays) and the gravity field */
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    pointer-events: none;
  }
  /* On the map the bar lives INSIDE the map card: inset to the card's
     margin (DockMap .mapwrap) plus the same breathing room its lens chips
     keep, so neither the search nor the locate button ever hangs past the
     rounded frame. */
  .topbar.onmap {
    left: calc(env(safe-area-inset-left) + 1.2rem + 0.9rem);
    right: calc(env(safe-area-inset-right) + 1.2rem + 0.9rem);
  }
  .topbar__left,
  .topbar__right {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .topbar__right {
    justify-content: flex-end;
  }
  /* Too narrow for three abreast: the switch keeps the top line, and the
     search + locate share a second line beneath it, the search taking the
     width the button leaves. */
  @media (max-width: 40rem) {
    .topbar.onmap {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "toggle toggle"
        "left right";
      row-gap: 0.45rem;
    }
    .topbar.onmap .viewtoggle {
      grid-area: toggle;
      justify-self: center;
    }
    .topbar.onmap .topbar__left {
      grid-area: left;
    }
    .topbar.onmap .topbar__right {
      grid-area: right;
    }
    .topbar.onmap :global(.placesearch) {
      flex: 1 1 auto;
    }
  }
  .topbar :global(.viewtoggle),
  .topbar :global(.placesearch),
  .topbar :global(.locate) {
    pointer-events: auto;
  }
  .topbar :global(.placesearch) {
    flex: 0 1 24rem;
  }
  .locate {
    flex: none;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.3rem;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    border: 1.5px solid var(--line);
    color: var(--ink-soft);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
  }
  .locate:active {
    transform: scale(0.92);
  }
  .locate:disabled {
    opacity: 0.6;
  }
  .viewtoggle {
    flex: 0 0 auto;
    display: inline-flex;
    padding: 0.2rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 82%, transparent);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
  }
  .viewopt {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 1rem;
    border-radius: 999px;
    color: var(--muted);
    font-size: 0.88rem;
    font-weight: 700;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .viewopt.on {
    background: var(--card);
    color: var(--teal-deep);
    box-shadow: var(--shadow-soft);
  }
  .viewopt:active {
    transform: scale(0.96);
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
