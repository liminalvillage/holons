<script lang="ts" context="module">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import type { OrbSim } from "$lib/dock";

  // The sky outlives the dock. The layout mounts DockView only while the
  // board's window is closed or morphing, and a sim seeded on every mount
  // had the orbs gliding in from the ring each time the dock opened — under
  // the closing window's iris, and into a different sky each visit. Kept
  // here, a returning orb is already where it was left.
  let keptSim: OrbSim | null = null;
</script>

<script lang="ts">
  // The dock: the space the board's card floats in. Each board this device
  // has opened is a circle in a little gravity field (see orbLayout): every
  // orb repels every other, federation links pull their orbs together, so
  // federated boards gather into constellations — each wrapped in a soft
  // hull, its holographic bound. Tap a circle to expand it back into the
  // window, long-press for edit mode (every circle grows a ✕), and the "+"
  // in the tray adds a hub from an id, a registered label, an identity
  // (npub, Ethereum address), a pasted link, or any bare name
  // (parseHolonAdd accepts anything people actually copy or type).
  import { onMount, tick } from "svelte";
  import { holonColor, holonColors, learnHolonColor } from "$lib/palette";
  import {
    beaconPath,
    beaconTangents,
    boundsPath,
    dockEntries,
    dockView,
    forgetBoard,
    labelFor,
    lensPath,
    linksAmong,
    nameBoard,
    orbClusters,
    orbLayout,
    orbPositions,
    orbUnder,
    rememberBoard,
    requestOpen,
    setDockView,
    stepOrbs,
    syncOrbs,
    type Vec,
  } from "$lib/dock";
  import { getHolonName, getHolosphere, getWriter } from "$lib/holosphere";
  import { showNotice } from "$lib/stores";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { isValidCell } from "h3-js";
  import { parseHolonAdd } from "$lib/holons";
  import { t, tr } from "$lib/i18n";
  import Modal from "./Modal.svelte";
  import FederationLens from "./FederationLens.svelte";
  import DockMap from "./DockMap.svelte";
  import PlaceSearch from "./PlaceSearch.svelte";

  // The earth, when it's showing beneath the sky — the top bar's place
  // search flies it, its My-location button asks it to locate, and every
  // frame the sky asks it where each placed board's hexagon sits.
  let dockMap: DockMap | undefined;
  let locating = false;
  $: mapOn = $dockView === "map";

  // ── Anchors + beacons ───────────────────────────────────────────────────--
  //
  // With the earth on, an orb whose holon has claimed a place hovers HOVER
  // above its hexagon (the anchor the physics pulls it to) and is tied to
  // the hexagon's centre (the ground point) by a beacon cone in its own
  // colour. Both are re-read from the map every frame, so the orbs follow a
  // pan or a fly with a balloon's lag and the cones always land true. With
  // the earth off there are no anchors and the sky is just the sky.
  const HOVER_REM = 8;
  $: HOVER = (HOVER_REM / ORB_REM) * ORB; // scales with the root font like ORB
  let mapTick = 0; // bumped by the earth when it settles (reduced-motion relayout)
  let grounds: ReadonlyMap<string, Vec> = new Map();
  let anchors: ReadonlyMap<string, Vec> = new Map();

  function readAnchors() {
    const g = mapOn ? dockMap?.projectBoards() : null;
    if (!g) {
      if (grounds.size) grounds = anchors = new Map();
      return;
    }
    const a = new Map<string, Vec>();
    for (const [id, pt] of g) a.set(id, { x: pt.x, y: pt.y - HOVER });
    grounds = g;
    anchors = a;
  }

  /** Is this ground point near enough to draw a beacon to? A place far
   *  outside the view would draw as a hair-thin sliver across the sky; the
   *  orb parked at the edge nearest it already says "that way". */
  const nearField = (g: Vec) =>
    g.x > -fieldW && g.x < 2 * fieldW && g.y > -fieldH && g.y < 2 * fieldH;

  /** A gradient id the SVG will accept, unique per holon. */
  const gradId = (id: string) => "beacon-" + id.replace(/[^\w-]/g, "_");

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
  /** A drop on a hexagon, waiting to be confirmed as that board's new home. */
  let homeDrop: { holon: string; hex: string } | null = null;

  /**
   * Take the confirm sheet's answer. The cell and the board come in as
   * ARGUMENTS, read while the sheet is still up: `{@const}` is lazy in Svelte
   * 5, so a handler that closed the sheet first and then reached back into it
   * would find nothing there and quietly move nothing.
   */
  function confirmHome(holon: string, hex: string) {
    homeDrop = null;
    void claimHome(holon, hex);
  }

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
      if (dropTarget && dropTarget !== dragId) {
        // Another ORB: federate the two holons. A hexagon — any hexagon,
        // another board's included: that cell becomes the carried board's
        // HOME. Places never federate; only holons do.
        if ($dockEntries.some((e) => e.id === dropTarget))
          fedPair = { home: dragId, partner: dropTarget };
        else if (isValidCell(dropTarget))
          // Moving a holon's home is not something a slip of the finger
          // should do: ask first, and keep the cell lit while it asks.
          homeDrop = { holon: dragId, hex: dropTarget };
      }
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

  /**
   * What the pointer is over: another board's ORB, when the finger is INSIDE
   * it — the only thing a drop can federate with — else, with the earth on,
   * the bare grid hexagon under the finger, which a drop claims as the
   * carried board's home. Being inside the target is what lets a federated
   * orb reach the ground at all: its partner trails the finger for the whole
   * drag, so anything looser matches the partner and never the hexagon.
   *
   * Hexagons are deliberately NOT boards here. A place is somewhere a holon
   * lives, not someone it federates with, so the map's painted cells and
   * neighbourhoods are just ground to drop on.
   */
  function findDropTarget(p: Vec, self: string): string | null {
    const orb = orbUnder(positions, p, self, ORB / 2);
    if (orb || !mapOn) return orb;
    return dockMap?.cellAt(p.x, p.y) ?? null;
  }

  /** A partner's display name — always another docked board's. */
  const partnerLabel = (id: string) =>
    $dockEntries.find((e) => e.id === id)?.name ?? id;

  /**
   * Make `hex` the board's home — `settings.hex`, exactly what Settings →
   * Set location writes (merged over the existing settings doc, through the
   * identity-aware writer), announced the same way so the beacon moves at
   * once. A drop on the cell it already lives in changes nothing.
   *
   * The move is announced BEFORE the write: reading the settings doc and
   * getting a signed put acknowledged takes a relay round trip, and until it
   * came back the orb sprang home to its old place and only then flew to the
   * new one. The hexagon and the beacon land where the finger let go, and a
   * write that fails puts them back.
   */
  async function claimHome(holon: string, hex: string) {
    const announce = (cell: string | null) =>
      window.dispatchEvent(
        new CustomEvent("kiosk:hex-changed", {
          detail: { holon, hex: cell ?? undefined },
        }),
      );
    const previous = dockMap?.hexOf(holon) ?? null;
    announce(hex); // optimistic: the earth follows the finger
    try {
      const hs = await getHolosphere();
      let existing: any = {};
      try {
        const raw = await (hs as any).get(holon, "settings", holon);
        if (raw && typeof raw === "object" && !Array.isArray(raw))
          existing = raw;
      } catch {
        /* fresh settings */
      }
      if (existing.hex === hex) return; // already home here — nothing to write
      const writer = await getWriter(holon, (msg) => showNotice(msg));
      const ok = await writer.put("settings", { ...existing, id: holon, hex });
      if (ok) showNotice(tr("hex.claimed"));
      else {
        announce(existing.hex ?? previous); // refused — put it back
        showNotice(tr("hex.saveError"));
      }
    } catch (err) {
      console.error("[kiosk] dock: failed to set home", err);
      announce(previous);
      showNotice(tr("hex.saveError"));
    }
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
  let sim: OrbSim | null = keptSim;
  let simKey = "";

  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  $: links = linksAmong(ids, partnerMap);
  $: if (reducedMotion) {
    void mapTick; // the earth settled somewhere new: the places moved
    void mapOn;
    readAnchors();
    const settled = orbLayout(ids, links, fieldW, fieldH, ORB / 2, anchors);
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

  // Each docked board's own name, refreshed while the dock is up — so a board
  // is named by ITS holon or not at all. A holon that resolves no name falls
  // back to its id/label, which also heals circles stamped with another
  // board's name. Once per id per mount: `nameBoard` writes `$dockEntries`,
  // which is this statement's own dependency.
  const namedIds = new Set<string>();
  $: void learnDockNames($dockEntries);
  async function learnDockNames(entries: { id: string }[]) {
    if (typeof window === "undefined" || entries.length === 0) return;
    const pending = entries.filter((e) => !namedIds.has(e.id));
    if (pending.length === 0) return;
    for (const e of pending) namedIds.add(e.id);
    let hs: Awaited<ReturnType<typeof getHolosphere>>;
    try {
      hs = await getHolosphere();
    } catch {
      return; // offline — the stored labels stand
    }
    for (const e of pending)
      void getHolonName(hs, e.id).then(
        (n) => nameBoard(e.id, n),
        () => {},
      );
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
    // Dev/test hook, like window.__dockMap: lets a headless run read where
    // the orbs and their places are without scraping the DOM. DEV only.
    if (import.meta.env.DEV)
      (window as any).__dock = {
        positions: () => positions,
        grounds: () => grounds,
      };

    let raf = 0;
    if (!reducedMotion)
      raf = requestAnimationFrame(function frame(t) {
        if (fieldEl && fieldW && fieldH && ids.length) {
          // Re-seat the sim when the cast or the field changes; retained orbs
          // keep their place and momentum, newcomers glide in from the ring.
          const key = `${ids.join("\n")}|${fieldW}x${fieldH}`;
          if (!sim || key !== simKey) {
            sim = keptSim = syncOrbs(sim, ids, fieldW, fieldH);
            simKey = key;
          }
          const lifted = dragging && dragId ? dragId : undefined;
          // Where the places are THIS frame — the earth may be mid-fly.
          readAnchors();
          stepOrbs(sim, links, fieldW, fieldH, ORB / 2, t, lifted, anchors);
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
    const id = parseHolonAdd(draft);
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

  // A tap on empty space stands down edit mode and the add form. The field
  // lets taps through (the earth beneath pans and selects), so the map
  // asks first via `standDown`; with the earth off the sky itself is tapped.
  function standDown(): boolean {
    const had = editing || adding;
    editing = false;
    cancelAdd();
    return had;
  }
  function onBackdrop(e: Event) {
    if (e.target !== e.currentTarget) return;
    standDown();
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="dock" class:onmap={mapOn} on:click={onBackdrop}>
  <!-- The sky: one box the earth, the beacons and the gravity field all
       fill edge to edge, so a point the map projects is a point in the
       field. Bottom to top: the earth (when on), the beacon cones, the
       orbs. The field lets pointer events through everywhere but its orbs,
       so a drag on bare sky pans the earth beneath. -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="sky" on:click={onBackdrop}>
    {#if mapOn}
      <DockMap
        bind:this={dockMap}
        bind:locating
        onbackdrop={standDown}
        onmove={() => (mapTick += 1)}
        highlight={dragging ? dropTarget : (homeDrop?.hex ?? null)}
        carrying={dragging ? dragId : (homeDrop?.holon ?? null)}
      />
    {/if}

    {#if mapOn && fieldW && fieldH}
      <!-- Each placed orb's beacon: a cone in the orb's colour, orb-wide at
           the orb and converging on its hexagon's centre, fading toward the
           ground where a small pulse marks the landing. Read `positions` and
           `grounds` inline — a helper closure would hide the dependency from
           the compiler and freeze the cones in place. -->
      <svg class="beacons" viewBox="0 0 {fieldW} {fieldH}" aria-hidden="true">
        {#each $dockEntries as e, i (e.id)}
          {@const p = positions.get(e.id)}
          {@const g = grounds.get(e.id)}
          {#if p && g && nearField(g)}
            {@const tan = beaconTangents(p, g, ORB / 2)}
            {#if tan}
              {@const gid = gradId(e.id)}
              <!-- A beam, not a drawn triangle: the fill runs ACROSS the
                   cone (bright on the centre line, nothing at either
                   shoulder) and a mask fades it ALONG the way down, so it
                   has no edge anywhere — it just dissolves. -->
              <g
                class="beacon"
                style="--c: {holonColor(e.id, $holonColors)}; --i: {i}"
              >
                <linearGradient
                  id="{gid}-across"
                  gradientUnits="userSpaceOnUse"
                  x1={tan[0].x}
                  y1={tan[0].y}
                  x2={tan[1].x}
                  y2={tan[1].y}
                >
                  <stop class="beam-stop" offset="0" stop-opacity="0" />
                  <stop class="beam-stop" offset="0.3" stop-opacity="0.85" />
                  <stop class="beam-stop" offset="0.7" stop-opacity="0.85" />
                  <stop class="beam-stop" offset="1" stop-opacity="0" />
                </linearGradient>
                <linearGradient
                  id="{gid}-along"
                  gradientUnits="userSpaceOnUse"
                  x1={p.x}
                  y1={p.y}
                  x2={g.x}
                  y2={g.y}
                >
                  <stop offset="0" stop-color="#fff" />
                  <stop offset="1" stop-color="#fff" stop-opacity="0.2" />
                </linearGradient>
                <mask
                  id="{gid}-mask"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width={fieldW}
                  height={fieldH}
                >
                  <rect
                    x="0"
                    y="0"
                    width={fieldW}
                    height={fieldH}
                    fill="url(#{gid}-along)"
                  />
                </mask>
                <path
                  class="cone"
                  d={beaconPath(p, g, ORB / 2)}
                  fill="url(#{gid}-across)"
                  mask="url(#{gid}-mask)"
                />
                <circle class="landing-pulse" cx={g.x} cy={g.y} r="7" />
                <circle
                  class="landing"
                  class:target={dropTarget === e.id}
                  cx={g.x}
                  cy={g.y}
                  r={dropTarget === e.id ? 9 : 4}
                />
              </g>
            {/if}
          {/if}
        {/each}
      </svg>
    {/if}

    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="field"
      role="list"
      aria-label={$t("dock.boards")}
      bind:this={fieldEl}
      bind:clientWidth={fieldW}
      bind:clientHeight={fieldH}
      style="--orb: {ORB_REM}rem"
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
  </div>

  <!-- The top bar hovers over the sky, in three slots: the sky/earth switch
       always in the middle; with the earth on, the place search to its left
       and the My-location button at the right edge. -->
  <div class="topbar" class:onmap={mapOn}>
    <div class="topbar__left">
      {#if mapOn}
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
      {#if mapOn}
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

  <div class="tray" class:onmap={mapOn}>
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
    {#if !mapOn}
      <p class="hint">{$t("dock.hint")}</p>
    {/if}
  </div>
</div>

<!-- The intersection popup: dropping one circle onto another, or tapping the
     overlap they already share, opens just that pair's flows. Federation is
     between HOLONS — a hexagon is only ever a home, never a partner. Opening
     the popup federates nothing: the pair stays unlinked until an arrow is
     tapped, and unlinking closes it, since the intersection it edited no
     longer exists. -->
{#if fedPair}
  <Modal on:close={() => (fedPair = null)}>
    <FederationLens
      holon={fedPair.home}
      partner={fedPair.partner}
      holonName={nameOf(fedPair.home)}
      partnerName={partnerLabel(fedPair.partner)}
      on:unlinked={() => (fedPair = null)}
    />
  </Modal>
{/if}

<!-- Dropping a circle on a hexagon asks before it moves that holon's home:
     the cell stays lit underneath, so the confirm is read against the place
     it is about to claim. Dismissing the sheet leaves the home where it is. -->
{#if homeDrop}
  {@const drop = homeDrop}
  <Modal on:close={() => (homeDrop = null)}>
    <div class="home-confirm">
      <span
        class="orb-chip"
        style="--c: {holonColor(drop.holon, $holonColors)}"
        aria-hidden="true">⬡</span
      >
      <h3>{$t("hex.moveTitle", { name: nameOf(drop.holon) })}</h3>
      <p>{$t("hex.moveBody")}</p>
      <code>{drop.hex}</code>
      <div class="acts">
        <button type="button" class="ghost" on:click={() => (homeDrop = null)}>
          {$t("common.cancel")}
        </button>
        <button
          type="button"
          class="go"
          on:click={() => confirmHome(drop.holon, drop.hex)}
        >
          {$t("hex.moveConfirm")}
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .dock {
    position: fixed;
    inset: 0;
    z-index: 5; /* beneath the board window (z 10), which morphs over it */
    /* The floating tray's zone — the field, the beacons and the map's cell
       panel all keep clear of it. It carries the bottom safe area itself
       (see .tray) so the sky, and with it the earth, runs to the true
       bottom edge of the screen rather than stopping on a paper margin. */
    --dock-lens: 0rem;
    --dock-tray: calc(6.6rem + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 0
      env(safe-area-inset-left);
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

  /* With the earth up the lens chips take the bottom row and the tray — now
     just the add button — stacks above them. --dock-lens is the room the
     chips occupy: DockMap sits them 0.9rem off the bottom and they stand
     ~2.5rem tall, so the two numbers must move together. Both rows live
     inside --dock-tray, so everything that already cleared the tray (the
     field, the beacons, the cell panel) clears the chips too. */
  .dock.onmap {
    --dock-lens: 3.4rem;
    --dock-tray: calc(4.4rem + var(--dock-lens) + env(safe-area-inset-bottom));
  }

  /* The sky's box: earth, beacons and field all fill it edge to edge. */
  .sky {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  /* The field rides above the earth (and the map's own vignette, z 1) but
     below the map's chips and panel (z 4+). It is transparent to the
     pointer: only its orbs (.slot) catch taps and drags, so a finger on
     bare sky pans the earth beneath. It stops short of the tray floating
     along the bottom, so no orb ever parks under it; the earth carries on
     beneath. The beacons share the field's box exactly — their viewBox is
     the field's size, so any other box would scale them. */
  .field,
  .beacons {
    position: absolute;
    inset: 0 0 var(--dock-tray) 0;
    pointer-events: none;
  }
  .field {
    z-index: 2;
  }
  .beacons {
    width: 100%;
    height: calc(100% - var(--dock-tray));
    z-index: 1;
    overflow: visible;
  }
  /* The cone is not animated at all: it is redrawn every frame from the orb
     and its place, so it simply follows the orb. A pop-in replayed itself
     every time a place panned back into view, which read as the beacon
     twitching rather than pointing. */
  /* The beam is the orb's note lifted toward white: a light beam must read
     over satellite imagery on the night palette too, where the notes are
     deep. Its edges get the same light so the cone keeps its shape where
     the fill has faded. */
  .beam-stop {
    stop-color: color-mix(in srgb, var(--c, var(--teal)) 55%, #fff);
  }
  /* The cross-fade already leaves the beam edgeless; a little blur melts
     the last of the geometry into the light. */
  .cone {
    filter: blur(3px);
  }
  .landing {
    fill: var(--c, var(--teal));
    stroke: #fff;
    stroke-width: 1.5;
    transition: r 0.15s ease;
  }
  /* A federated place's landing opens that federation (change or unlink). */
  /* A carried orb hovering this place: the landing swells and wears the
     same dashed teal halo as an orb about to be federated. */
  .landing.target {
    stroke: var(--teal);
    stroke-width: 2;
    stroke-dasharray: 3 3;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--teal) 70%, #fff));
  }
  /* The landing pulse: a ring in the orb's colour swelling out of the spot
     and fading, phased per orb like the pop. */
  .landing-pulse {
    fill: none;
    stroke: var(--c, var(--teal));
    stroke-width: 2;
    transform-box: fill-box;
    transform-origin: center;
    animation: beacon-pulse 2.2s ease-out infinite;
    animation-delay: calc(var(--i, 0) * 300ms);
  }
  @keyframes beacon-pulse {
    from {
      transform: scale(0.6);
      opacity: 0.9;
    }
    to {
      transform: scale(2.6);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .landing-pulse {
      animation: none;
      opacity: 0.6;
    }
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
    pointer-events: auto; /* the one thing in the field that catches a finger */
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
  /* The move-home confirm: the carried board's colour, the cell it would
     claim, and the two ways out. */
  .home-confirm {
    min-width: min(22rem, 82vw);
    text-transform: none;
    letter-spacing: 0;
    text-align: center;
  }
  .home-confirm .orb-chip {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    margin: 0 auto 0.5rem;
    border-radius: 50%;
    font-size: 1.3rem;
    background: color-mix(in srgb, var(--c, var(--teal)) 55%, transparent);
    border: 3px solid color-mix(in srgb, var(--c, var(--teal)) 70%, var(--ink));
    color: var(--ink);
  }
  .home-confirm h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink);
  }
  .home-confirm p {
    margin: 0.35rem 0 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
  }
  .home-confirm code {
    display: block;
    font-size: 0.72rem;
    color: var(--muted);
    word-break: break-all;
  }
  .home-confirm .acts {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.9rem;
  }
  .home-confirm .acts button {
    flex: 1;
    min-height: 46px;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 700;
    padding: 0 0.8rem;
  }
  .home-confirm .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink-soft);
  }
  .home-confirm .go {
    background: var(--teal);
    color: #fff;
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

  /* Bottom tray — add a board, and the one-line hint — floating over the
     sky's foot (the earth runs on beneath it), on a soft gradient so the
     hint reads over the map. Only its controls catch the pointer. */
  .tray {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 6;
    height: var(--dock-tray);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.4rem 1.4rem
      calc(1.2rem + var(--dock-lens) + env(safe-area-inset-bottom));
    background: linear-gradient(
      to top,
      var(--paper-deep) 45%,
      color-mix(in srgb, var(--paper-deep) 70%, transparent) 80%,
      transparent
    );
    pointer-events: none;
  }
  /* Over the earth the tray never becomes a floor: an opaque foot cut the
     map off well above the screen's edge. It stays a scrim — enough to carry
     the hint, thin enough that the ground reads all the way down. */
  .tray.onmap {
    background: linear-gradient(
      to top,
      color-mix(in srgb, var(--paper-deep) 58%, transparent) 0%,
      color-mix(in srgb, var(--paper-deep) 30%, transparent) 55%,
      transparent
    );
  }
  .tray > * {
    pointer-events: auto;
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
  /* With the earth on, the bar keeps the same breathing room from the edge
     as the map's lens chips (DockMap .lensbar). */
  .topbar.onmap {
    left: calc(env(safe-area-inset-left) + 0.9rem);
    right: calc(env(safe-area-inset-right) + 0.9rem);
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
