<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dock read as people. Everyone is an orb in a gravity field of their
  // own; each hub is a territory — a soft hull in the hub's colour around
  // its members — and nobody else stands on it. So where a person stands
  // says which hubs they are in: someone in two hubs comes to rest where
  // the two territories overlap, and that overlap IS the relation between
  // the groups, with the people who make it standing in it. There are no
  // lines between people: the ground they stand on says what they share.
  //
  // The field runs live (lib/dockpeople `stepPeopleSim`; who counts and who
  // is tied is core's rule): the orbs breathe, and one can be dragged about
  // and let go. Tapping a person puts them in focus — everyone they share a
  // hub with gathers round, the most shared nearest — and opens a card with
  // their hubs. The whole picture is kept in the pane: it shrinks to fit
  // rather than scrolls. The row of hubs along the foot is the key to the
  // colours, and picks one hub out of the picture.
  import { onDestroy, onMount } from "svelte";
  import type { PersonAcross } from "@holons/core/holons";
  import type { Vec } from "$lib/dock";
  import { holonColor, holonColors } from "$lib/palette";
  import {
    dockPeople,
    dockPeopleLoading,
    initialsOf,
    peopleField,
    settlePeople,
    simBounds,
    spanTree,
    stepPeopleSim,
    syncPeopleSim,
    type PeopleField,
    type PeopleSim,
  } from "$lib/dockpeople";
  import { names, nameOf, profileFor } from "$lib/names";
  import { avatarUrl, hideImg, showImg } from "./Avatars.svelte";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  /** The hubs that count — the dock's, or the ones its search has left. */
  export let hubs: readonly { id: string; name: string }[] = [];
  export let onopen: (hub: string) => void;

  /** People drawn at most: the field is stepped and redrawn every frame. */
  const CAP = 150;
  const PERSON_REM = 4.5;
  let paneW = 0;
  let paneH = 0;
  function rootPx(): number {
    if (typeof document === "undefined") return 16;
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px : 16;
  }
  $: root = paneW ? rootPx() : 16; // the root size is viewport-driven
  $: r = (PERSON_REM * root) / 2; // the physics' radius, before any shrink
  $: hubName = new Map(hubs.map((h) => [h.id, h.name]));

  // Only the hubs in hand count, for who is drawn and for where they stand.
  $: everyone = $dockPeople.people
    .map((p) => ({ ...p, holons: p.holons.filter((h) => hubName.has(h)) }))
    .filter((p) => p.holons.length > 0)
    .sort((a, b) => b.holons.length - a.holons.length);
  $: people = everyone.slice(0, CAP);
  $: byId = new Map(people.map((p) => [p.id, p]));

  // ── The field ───────────────────────────────────────────────────────────--
  //
  // The sim lives around its own origin; what is drawn is that, shrunk if
  // need be and centred in the pane (`view`), so nobody is ever off screen.
  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sim: PeopleSim | null = null;
  let field: PeopleField | null = null;
  let pos: ReadonlyMap<string, Vec> = new Map();
  let view = { x: 0, y: 0, s: 1 };
  let awake = 0; // frames left to redraw once the field has come to rest

  $: reseat(people, r);
  function reseat(cast: readonly PersonAcross[], radius: number) {
    const ids = cast.map((p) => p.id);
    sim = reducedMotion
      ? settlePeople(cast, radius)
      : syncPeopleSim(sim, ids, radius);
    field = peopleField(sim, cast);
    awake = 240;
    if (reducedMotion) paint(true);
  }
  $: if (reducedMotion && paneW && paneH) paint(true);

  /** Fit the field to the pane and publish where everyone is on screen. */
  function paint(snap = false) {
    if (!sim || !paneW || !paneH) return;
    const box = simBounds(sim, r);
    const pad = 1.6 * r; // the names under the orbs, and air
    const fit = Math.min(
      1,
      paneW / (box.w + 2 * pad || 1),
      paneH / (box.h + 2 * pad || 1),
    );
    // Small orbs beat people off screen: a full dock on a phone needs ~0.25.
    const s = Math.max(0.2, fit);
    // Ease toward the fit: a field that snapped its size every frame would
    // shimmer as the orbs breathe. And not at all while someone is carried:
    // the frame moving under the finger would take the orb out from under it.
    const k = snap ? 1 : dragId ? 0 : 0.04;
    view = {
      x: view.x + (box.x - view.x) * k,
      y: view.y + (box.y - view.y) * k,
      s: view.s + (s - view.s) * k,
    };
    const out = new Map<string, Vec>();
    for (let i = 0; i < sim.ids.length; i++)
      out.set(sim.ids[i], {
        x: paneW / 2 + (sim.px[i] - view.x) * view.s,
        y: paneH / 2 + (sim.py[i] - view.y) * view.s,
      });
    pos = out;
  }

  let raf = 0;
  onMount(() => {
    if (reducedMotion) return;
    let first = true;
    raf = requestAnimationFrame(function frame(now) {
      if (sim && sim.ids.length && paneW && paneH) {
        const held = dragId ? sim.ids.indexOf(dragId) : -1;
        const fastest = stepPeopleSim(sim, r, {
          wobbleT: now,
          held,
          field: field ?? undefined,
          focus: pick?.kind === "person" ? sim.ids.indexOf(pick.id) : -1,
        });
        if (held >= 0 && dragTo) {
          sim.px[held] = dragTo.x;
          sim.py[held] = dragTo.y;
        }
        if (fastest > 0.05 || held >= 0) awake = 60;
        if (awake > 0) {
          awake--;
          paint(first);
          first = false;
        }
      }
      raf = requestAnimationFrame(frame);
    });
  });
  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
  });

  // The territories. A hub's ground is its members' discs melted into one
  // blob (the `goo` filter in the markup), with a neck along the shortest
  // lines between them so members standing apart are still one ground; its
  // name hangs over the top of it. Read `pos` here, in the statement itself:
  // this is what follows the field frame by frame.
  $: reach = r * view.s * 1.6; // a member's disc of ground
  $: grounds = hubs.flatMap((hub) => {
    const pts = people
      .filter((p) => p.holons.includes(hub.id))
      .map((p) => pos.get(p.id))
      .filter((p): p is Vec => !!p);
    if (pts.length === 0) return [];
    return [
      {
        id: hub.id,
        name: hub.name,
        n: pts.length,
        pts,
        necks: spanTree(pts).map(([i, j]) => [pts[i], pts[j]] as const),
        x: pts.reduce((sum, p) => sum + p.x, 0) / pts.length,
        y: Math.min(...pts.map((p) => p.y)) - reach,
      },
    ];
  });
  function groundLit(id: string, sel: Picked | null): boolean {
    if (!sel) return true;
    if (sel.kind === "hub") return sel.id === id;
    return !!byId.get(sel.id)?.holons.includes(id);
  }

  // ── Dragging ────────────────────────────────────────────────────────────--
  //
  // A person can be picked up and carried: the field follows, pulled along
  // by the ground they share. A press that never moves is a tap (the card).
  const DRAG_START_PX = 8;
  let paneEl: HTMLElement;
  let dragId: string | null = null;
  let dragTo: Vec | null = null; // in the sim's own coordinates
  let pressAt: Vec | null = null;
  let dragged = false;
  function panePoint(e: PointerEvent): Vec {
    const box = paneEl.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
  function onDown(e: PointerEvent, id: string) {
    if (e.button != null && e.button !== 0) return;
    pressAt = panePoint(e);
    dragged = false;
    dragId = null;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressId = id;
  }
  let pressId: string | null = null;
  function onMove(e: PointerEvent) {
    if (!pressId || !pressAt || reducedMotion) return;
    const p = panePoint(e);
    if (!dragId) {
      if (Math.hypot(p.x - pressAt.x, p.y - pressAt.y) < DRAG_START_PX) return;
      dragId = pressId;
      dragged = true; // the click that follows must not open the card
      pick = null;
    }
    dragTo = {
      x: (p.x - paneW / 2) / view.s + view.x,
      y: (p.y - paneH / 2) / view.s + view.y,
    };
  }
  function onUp() {
    pressId = null;
    pressAt = null;
    dragId = null;
    dragTo = null;
  }

  // ── Picking ─────────────────────────────────────────────────────────────--
  //
  // What is picked: a person, or — from its name or the key — one hub.
  // Everything else steps back.
  type Picked = { kind: "person"; id: string } | { kind: "hub"; id: string };
  let pick: Picked | null = null;
  $: (void pick, (awake = 240)); // a focus gathers, or lets go: redraw it
  // The cast changed under the pick (a search, a fresh read): let it go.
  $: if (pick && gone(pick, byId, hubName)) pick = null;
  function gone(
    sel: Picked,
    cast: ReadonlyMap<string, unknown>,
    names: ReadonlyMap<string, string>,
  ): boolean {
    if (sel.kind === "person") return !cast.has(sel.id);
    return !names.has(sel.id);
  }
  // Around a person in focus: everyone they share a hub with — the same
  // people the field gathers round them.
  $: near = neighbours(pick, people);
  function neighbours(sel: Picked | null, cast: readonly PersonAcross[]) {
    if (sel?.kind !== "person") return null;
    const mine = new Set(cast.find((p) => p.id === sel.id)?.holons);
    return new Set(
      cast.filter((p) => p.holons.some((h) => mine.has(h))).map((p) => p.id),
    );
  }

  function personLit(
    p: PersonAcross,
    sel: Picked | null,
    around: ReadonlySet<string> | null,
  ): boolean {
    if (!sel) return true;
    if (sel.kind === "person") return !!around?.has(p.id);
    return p.holons.includes(sel.id);
  }
  /** Stand the pick down; true when there was one (the tap is spent). */
  export function close(): boolean {
    const had = pick !== null;
    pick = null;
    return had;
  }
  function pickPerson(id: string) {
    if (dragged) {
      dragged = false;
      return;
    }
    pick =
      pick?.kind === "person" && pick.id === id ? null : { kind: "person", id };
  }
  function pickHub(id: string) {
    pick = pick?.kind === "hub" && pick.id === id ? null : { kind: "hub", id };
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
  function openHub(id: string) {
    close();
    onopen(id);
  }

  // The card of the person in focus: their hubs.
  $: cardHubs =
    pick?.kind === "person" ? (byId.get(pick.id)?.holons ?? []) : [];

  /**
   * A person's picture: their Telegram photo (the kiosk's own /api/avatar),
   * or for someone known only by a key the picture on their Nostr profile.
   * None is fine — the initials beneath stay.
   */
  function pictureOf(p: PersonAcross): string | null {
    const telegram = p.ids.find((id) => /^\d+$/.test(id));
    if (telegram) return avatarUrl(telegram);
    for (const id of p.ids) {
      const picture = profileFor(id)?.picture;
      if (picture && /^https:\/\//.test(picture)) return picture;
    }
    return null;
  }

  // Worked out once per cast, not per frame — and again when a name lands,
  // since a profile learned later brings its picture with it.
  $: pictures = (void $names, new Map(people.map((p) => [p.id, pictureOf(p)])));

  /** A ring cut into equal arcs, one per hub, each in that hub's colour. */
  function ringOf(ids: readonly string[], colors: typeof $holonColors) {
    const arc = 100 / ids.length;
    return `conic-gradient(${ids
      .map((h, i) => `${holonColor(h, colors)} ${i * arc}% ${(i + 1) * arc}%`)
      .join(", ")})`;
  }
  const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
</script>

<svelte:window on:keydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
<section
  class="people"
  aria-label={$t("dock.people")}
  bind:this={paneEl}
  bind:clientWidth={paneW}
  bind:clientHeight={paneH}
  on:click={close}
>
  {#if paneW && paneH}
    <div
      class="canvas"
      style="--person: {PERSON_REM * view.s}rem; --s: {view.s}"
    >
      <!-- The territories, beneath everything: per hub, a disc of ground
           under each member and a neck between neighbours, blurred and then
           cut back to a hard edge — which melts them into one blob, the way
           drops run together. The filter then paints that blob as a wash of
           the hub's colour inside a firm rim of it, so a ground is one even
           tone with a clear edge, and two that overlap deepen. -->
      <svg class="grounds" viewBox="0 0 {paneW} {paneH}" aria-hidden="true">
        <defs>
          <filter
            id="people-goo"
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
            color-interpolation-filters="sRGB"
          >
            <feGaussianBlur stdDeviation={reach * 0.42} result="soft" />
            <feColorMatrix
              in="soft"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="blob"
            />
            <!-- The rim: the blob less itself drawn a little smaller. -->
            <feMorphology
              in="blob"
              operator="erode"
              radius="2.5"
              result="inner"
            />
            <feComposite in="blob" in2="inner" operator="out" result="rim" />
            <!-- The ground inside it: the same colour, as a wash. -->
            <feColorMatrix
              in="blob"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.42 0"
              result="wash"
            />
            <feMerge>
              <feMergeNode in="wash" />
              <feMergeNode in="rim" />
            </feMerge>
          </filter>
        </defs>
        {#each grounds as g (g.id)}
          <g
            class="ground"
            class:dim={!groundLit(g.id, pick)}
            filter="url(#people-goo)"
            style="--c: {holonColor(g.id, $holonColors)}"
          >
            {#each g.necks as [a, b], i (i)}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke-width={reach * 1.1}
              />
            {/each}
            {#each g.pts as p, i (i)}
              <circle cx={p.x} cy={p.y} r={reach} />
            {/each}
          </g>
        {/each}
      </svg>

      <!-- Each territory's name, over the top of it; a tap picks the hub. -->
      {#each grounds as g (g.id)}
        <button
          type="button"
          class="gname"
          class:on={pick?.kind === "hub" && pick.id === g.id}
          class:dim={!groundLit(g.id, pick)}
          style="left: {g.x}px; top: {g.y}px"
          aria-pressed={pick?.kind === "hub" && pick.id === g.id}
          on:click|stopPropagation={() => pickHub(g.id)}
        >
          <span
            class="dot"
            style:--c={holonColor(g.id, $holonColors)}
            aria-hidden="true"
          ></span>{g.name}<span class="gcount">{g.n}</span>
        </button>
      {/each}

      {#each people as p (p.id)}
        {@const at = pos.get(p.id)}
        {#if at}
          {@const name = $nameOf(p.id)}
          {@const letters = initialsOf(name)}
          <button
            type="button"
            class="person"
            class:open={pick?.kind === "person" && pick.id === p.id}
            class:dim={!personLit(p, pick, near)}
            style="left: {at.x}px; top: {at.y}px; --ring: {ringOf(
              p.holons,
              $holonColors,
            )}"
            aria-label={$t("dock.personOpen", { name, n: p.holons.length })}
            aria-expanded={pick?.kind === "person" && pick.id === p.id}
            title={name}
            on:click|stopPropagation={() => pickPerson(p.id)}
            on:pointerdown={(e) => onDown(e, p.id)}
            on:pointermove={onMove}
            on:pointerup={onUp}
            on:pointercancel={onUp}
          >
            <span class="face">
              {#if letters}{letters}{:else}<Icon name="person" />{/if}
              <!-- Over the initials, which show until (and unless) it
                   loads. -->
              {#if pictures.get(p.id)}
                <img
                  src={pictures.get(p.id)}
                  alt=""
                  loading="lazy"
                  draggable="false"
                  on:error={hideImg}
                  on:load={showImg}
                />
              {/if}
            </span>
          </button>
          {#if letters}
            <span
              class="pname"
              class:dim={!personLit(p, pick, near)}
              aria-hidden="true"
              style="left: {at.x}px; top: {at.y}px">{firstName(name)}</span
            >
          {/if}
        {/if}
      {/each}

      {#if pick?.kind === "person"}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
        <div class="card" role="group" on:click|stopPropagation>
          <header>
            <strong>{$nameOf(pick.id)}</strong>
            <button
              type="button"
              class="x"
              aria-label={$t("map.closePanel")}
              on:click={close}
            >
              <Icon name="close" />
            </button>
          </header>
          <p>{$t("dock.personHubs", { n: cardHubs.length })}</p>
          <ul>
            {#each cardHubs as h (h)}
              <li>
                <button type="button" class="row" on:click={() => openHub(h)}>
                  <span
                    class="dot"
                    style:--c={holonColor(h, $holonColors)}
                    aria-hidden="true"
                  ></span>
                  <span class="label">{hubName.get(h) ?? $nameOf(h)}</span>
                  <span class="chev" aria-hidden="true"
                    ><Icon name="chevron-right" /></span
                  >
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
</section>

<!-- The key: which colour is which hub. A tap picks that hub's people and
     ground out of the picture; again lets them go. -->
<div class="key">
  <div class="keyhubs" role="group" aria-label={$t("dock.boards")}>
    {#each hubs as hub (hub.id)}
      <button
        type="button"
        class="keychip"
        class:on={pick?.kind === "hub" && pick.id === hub.id}
        aria-pressed={pick?.kind === "hub" && pick.id === hub.id}
        on:click|stopPropagation={() => pickHub(hub.id)}
      >
        <span
          class="dot"
          style:--c={holonColor(hub.id, $holonColors)}
          aria-hidden="true"
        ></span>{hub.name}
      </button>
    {/each}
  </div>
</div>

{#if hubs.length > 0 && (people.length === 0 || everyone.length > CAP)}
  <p class="note" role="status">
    {#if people.length > 0}
      {$t("dock.peopleCapped", { n: CAP, total: everyone.length })}
    {:else if $dockPeopleLoading}
      {$t("dock.peopleLoading")}
    {:else}
      {$t("dock.peopleEmpty")}
    {/if}
  </p>
{/if}

<style>
  /* The view fills the sky between the bar and the key, on the dock's own
     paper, and scrolls both ways when the picture is bigger than the pane.
     Above the gravity field (z 2), under the bar and the tray (z 6). */
  .people {
    position: absolute;
    /* Below the bar that floats over the sky (two lines of it on a narrow
       screen, see DockView .topbar), so nobody stands under it. */
    inset: calc(env(safe-area-inset-top) + 4.4rem) 0
      calc(var(--dock-tray) + 3.2rem) 0;
    z-index: 4;
    overflow: hidden;
    text-transform: none;
    letter-spacing: 0;
  }
  @media (max-width: 40rem) {
    .people {
      top: calc(env(safe-area-inset-top) + 7.6rem);
    }
  }
  .canvas {
    position: absolute;
    inset: 0;
  }
  .grounds {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  /* A territory: the hub's colour as a wash inside a rim of the same (both
     painted by the filter), so two that overlap deepen where they do and
     each keeps its own edge. */
  .ground {
    transition: opacity 0.3s ease;
  }
  .ground circle {
    fill: var(--c);
  }
  .ground line {
    stroke: var(--c);
    stroke-linecap: round;
  }
  .ground.dim {
    opacity: 0.18;
  }
  /* A territory's name, riding its top edge. */
  .gname {
    position: absolute;
    z-index: 1;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 11rem;
    min-height: 1.7rem;
    padding: 0 0.6rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 92%, transparent);
    box-shadow: var(--shadow-soft);
    font-family: inherit;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.2s ease;
  }
  /* The label is small on purpose; its target is not. */
  .gname::after {
    content: "";
    position: absolute;
    inset: -0.55rem -0.3rem;
  }
  .gname.on {
    border-color: var(--teal);
  }
  .gname.dim {
    opacity: 0.3;
  }
  .gcount {
    color: var(--ink-soft);
    font-weight: 600;
  }
  /* A person: an orb like a hub's, smaller — a disc on the theme's card
     inside a ring cut into their hubs' colours. */
  .person {
    position: absolute;
    z-index: 1;
    width: var(--person);
    height: var(--person);
    padding: calc(4px * var(--s, 1));
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--ring);
    /* Carried by the finger: the browser must not scroll or zoom instead. */
    touch-action: none;
    box-shadow: var(--shadow-soft);
    transition:
      opacity 0.2s ease,
      transform 0.15s ease;
  }
  .person:active {
    transform: translate(-50%, -50%) scale(0.93);
  }
  .person.open {
    z-index: 2;
    transform: translate(-50%, -50%) scale(1.12);
  }
  .face {
    position: relative;
    overflow: hidden;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--card);
    color: var(--ink);
    font-size: calc(1.2rem * var(--s, 1));
    font-weight: 700;
    letter-spacing: 0.01em;
    line-height: 1;
  }
  .face img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    /* A ground of its own: a picture with transparent parts must not let
       the initials beneath show through it. */
    background: var(--card);
    /* The orb is what is pressed and carried, never the picture in it. */
    pointer-events: none;
  }
  /* The first name, hung under the orb on a ground of its own. */
  .pname {
    position: absolute;
    z-index: 1;
    transform: translate(-50%, calc(var(--person) / 2 - 0.15rem));
    max-width: 5.4rem;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--card) 90%, transparent);
    font-size: 0.8rem;
    font-weight: 700;
    line-height: 1.4;
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .person.dim,
  .pname.dim {
    opacity: 0.25;
  }

  /* The card of the person in focus stands aside, in the pane's corner:
     the people they share hubs with are gathering round them. */
  .card {
    position: absolute;
    left: 0.9rem;
    top: 0.6rem;
    z-index: 5;
    width: min(17rem, calc(100% - 1.8rem));
    padding: 0.6rem 0.8rem 0.4rem;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    box-shadow: var(--shadow-soft);
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
  .row {
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
  .row:active {
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

  /* The foot: the key to the colours — one swipeable row of hubs — just
     above the tray. */
  .key {
    position: absolute;
    left: 0.9rem;
    right: 0.9rem;
    bottom: calc(var(--dock-tray) + 0.2rem);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .keyhubs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding: 0.15rem 0.1rem;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .keyhubs::-webkit-scrollbar {
    display: none;
  }
  .keychip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    padding: 0 0.85rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--ink);
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
    box-shadow: var(--shadow-soft);
  }
  .keychip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 22%, var(--card));
  }

  /* Nobody to draw, or not everybody drawn: say which. */
  .note {
    position: absolute;
    left: 50%;
    bottom: calc(var(--dock-tray) + 3.6rem);
    z-index: 5;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.4rem 0.9rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--card) 92%, transparent);
    box-shadow: var(--shadow-soft);
    font-size: 0.82rem;
    color: var(--ink-soft);
    white-space: nowrap;
    pointer-events: none;
  }
</style>
