<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dock read as people. Everyone is an orb in a gravity field; each hub
  // is a cell — a membrane in the hub's colour round its members — and
  // nobody else stands in it. So where a person stands says which hubs they
  // are in: someone in two hubs comes to rest where the two cells overlap,
  // and that overlap IS the relation between the groups.
  //
  // Built to cost nothing at rest. The physics (lib/dockpeople) runs only
  // while something moves — a new cast, a focus, a drag — and the frame
  // loop stops dead once the field is still. While it runs, nothing goes
  // through Svelte: the orbs and hub names are moved by writing their
  // transforms, and the cells are traced as numbers (lib/peoplecells) and
  // painted as plain paths on one canvas. Svelte renders only what changes
  // with the cast, the search or the pick.
  //
  // Tapping a person puts them in focus — everyone they share a hub with
  // gathers round, the most shared nearest — and opens a card with their
  // hubs. The search box (DockView) narrows the picture to a person or a
  // hub by name. The row along the foot is the key to the colours.
  import { onDestroy } from "svelte";
  import type { PersonAcross } from "@holons/core/holons";
  import type { Vec } from "$lib/dock";
  import {
    holonColor,
    holonColors,
    inkOn,
    resolveCssColor,
  } from "$lib/palette";
  import { activeTheme } from "$lib/theme";
  import {
    COLD,
    coolPeople,
    dockPeople,
    dockPeopleLoading,
    filterPeople,
    initialsOf,
    peopleField,
    simBounds,
    stepPeopleSim,
    syncPeopleSim,
    type PeopleField,
    type PeopleSim,
  } from "$lib/dockpeople";
  import { membrane, traceLoop } from "$lib/peoplecells";
  import { names, nameOf, profileFor } from "$lib/names";
  import {
    cellSpots,
    placeLabels,
    type LabelBox,
    type Rect,
  } from "$lib/labelplace";
  import { avatarUrl, hideImg, showImg } from "./Avatars.svelte";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  /** The hubs that count — the dock's. */
  export let hubs: readonly { id: string; name: string }[] = [];
  /** The search box: narrows the picture to a person or a hub by name. */
  export let query = "";
  export let onopen: (hub: string) => void;

  /** People drawn at most. */
  const CAP = 150;
  const PERSON_REM = 4.5;
  /** Fastest move (px a frame) still worth drawing once the field is cold. */
  const REST = 0.05;
  /** Live, the field cools faster than when settled in one go (`COOL`): it
   *  starts near rest, and a nudge should be over in a few seconds. */
  const LIVE_COOL = 0.98;

  let paneW = 0;
  let paneH = 0;
  function rootPx(): number {
    if (typeof document === "undefined") return 16;
    const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(px) && px > 0 ? px : 16;
  }
  $: root = paneW ? rootPx() : 16; // the root size is viewport-driven
  $: r = (PERSON_REM * root) / 2; // the physics' radius, before any shrink

  // ── Who is drawn ────────────────────────────────────────────────────────--
  $: hubName = new Map(hubs.map((h) => [h.id, h.name]));
  $: docked = $dockPeople.people
    .map((p) => ({ ...p, holons: p.holons.filter((h) => hubName.has(h)) }))
    .filter((p) => p.holons.length > 0);
  // A person by name (with all their hubs) or a hub by name (its members,
  // on that ground only) — lib/dockpeople `filterPeople`.
  $: found = (void $names, filterPeople(docked, hubs, query, $nameOf));
  $: shownHubs = hubs.filter((h) => found.hubs.has(h.id));
  $: everyone = found.people.sort((a, b) => b.holons.length - a.holons.length);
  $: people = everyone.slice(0, CAP);
  $: byId = new Map(people.map((p) => [p.id, p]));

  // ── The field ───────────────────────────────────────────────────────────--
  const reducedMotion =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sim: PeopleSim | null = null;
  let field: PeopleField | null = null;
  /** Per drawn hub, its members' places in the sim. */
  let cells: { id: string; name: string; members: number[] }[] = [];

  $: reseat(people, shownHubs, r);
  /** What the field was last built from: who, in which hubs, at what size. */
  let seatedAs = "";
  function reseat(
    cast: readonly PersonAcross[],
    shown: readonly { id: string; name: string }[],
    radius: number,
  ) {
    // A fresh read that names the same people in the same hubs (the relay
    // catching up behind the remembered picture) changes nothing: it must
    // not stir the field.
    const as = `${radius}|${shown.map((h) => `${h.id}:${h.name}`).join(",")}|${cast
      .map((p) => `${p.id}:${p.holons.join(",")}`)
      .join(";")}`;
    if (as === seatedAs && sim) return;
    seatedAs = as;
    // A first cast (or a still screen) is settled before it is shown, so
    // the picture never opens with everyone flying in from a spiral.
    const fresh = !sim || sim.ids.length === 0 || reducedMotion;
    sim = syncPeopleSim(
      fresh ? null : sim,
      cast.map((p) => p.id),
      radius,
    );
    field = peopleField(sim, cast);
    // A first cast is cooled before it is shown; a changed one is warmed,
    // and glides to its new places.
    if (fresh) heat = Math.min(heat, coolPeople(sim, radius, field, 650));
    else heat = Math.max(heat, 0.6);
    const idx = new Map(sim.ids.map((id, i) => [id, i]));
    cells = shown.flatMap((h) => {
      const members = cast
        .filter((p) => p.holons.includes(h.id))
        .map((p) => idx.get(p.id))
        .filter((i): i is number => i != null);
      return members.length ? [{ id: h.id, name: h.name, members }] : [];
    });
    snap = fresh;
    kick();
  }

  // The hubs' colours as literals the canvas can take, again whenever an
  // override lands or the theme turns.
  $: inks = colorsOf(cells, $holonColors, $activeTheme);
  function colorsOf(
    list: typeof cells,
    colors: typeof $holonColors,
    _theme: string,
  ): Map<string, string> {
    const out = new Map<string, string>();
    for (const c of list)
      out.set(c.id, resolveCssColor(holonColor(c.id, colors)));
    kick();
    return out;
  }

  // ── The frame loop: runs while something moves, then stops ─────────────--
  let raf = 0;
  /** The field's heat (lib/dockpeople `COOL`): raised by a nudge, cooling
   *  every frame; cold and still, the loop stops. */
  let heat = 1;
  let snap = true; // jump the view to its fit, rather than ease there
  let destroyed = false;
  let view = { x: 0, y: 0, s: 1 };

  /** Wake the loop, warming the field to at least `to`. */
  function kick(to = 0) {
    heat = Math.max(heat, to);
    if (!raf && !destroyed && typeof requestAnimationFrame !== "undefined")
      raf = requestAnimationFrame(frame);
  }
  function frame() {
    raf = 0;
    if (!sim || !paneW || !paneH) return;
    let fastest = 0;
    const held = dragId ? sim.ids.indexOf(dragId) : -1;
    if (!reducedMotion) {
      fastest = stepPeopleSim(sim, r, {
        held,
        heat,
        field: field ?? undefined,
        focus: pick?.kind === "person" ? sim.ids.indexOf(pick.id) : -1,
      });
      heat *= LIVE_COOL;
      if (held >= 0 && dragTo) {
        sim.px[held] = dragTo.x;
        sim.py[held] = dragTo.y;
      }
    }
    const easing = paint();
    const warm = !reducedMotion && heat > COLD;
    if (held >= 0 || easing || fastest > REST || (warm && fastest > 0))
      raf = requestAnimationFrame(frame);
  }
  onDestroy(() => {
    destroyed = true;
    if (raf) cancelAnimationFrame(raf);
  });

  // The pane changed size: the canvas follows, and the picture refits.
  $: if (paneW && paneH && canvasEl) sizeCanvas(paneW, paneH);
  let dpr = 1;
  function sizeCanvas(w: number, h: number) {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    kick();
  }

  // ── Painting ────────────────────────────────────────────────────────────--
  let stageEl: HTMLElement;
  let canvasEl: HTMLCanvasElement;
  const personEls = new Map<string, HTMLElement>();
  const labelEls = new Map<string, HTMLElement>();
  /** An action keeping an element in `map` under `id` while it is mounted. */
  function registry(map: Map<string, HTMLElement>) {
    return (node: HTMLElement, id: string) => {
      let key = id;
      map.set(key, node);
      kick(); // a newcomer is placed on the next frame
      return {
        update(next: string) {
          if (map.get(key) === node) map.delete(key);
          key = next;
          map.set(key, node);
        },
        destroy() {
          if (map.get(key) === node) map.delete(key);
        },
      };
    };
  }
  const placePerson = registry(personEls);
  const placeLabel = registry(labelEls);

  /** Fit, move everyone, trace the cells. True while the fit still eases. */
  function paint(): boolean {
    if (!sim || !canvasEl || !stageEl) return false;
    const box = simBounds(sim, r);
    const pad = 1.6 * r; // the names under the orbs, and air
    const fit = Math.min(
      1,
      paneW / (box.w + 2 * pad || 1),
      paneH / (box.h + 2 * pad || 1),
    );
    const s = Math.max(0.2, fit); // small orbs beat people off screen
    // Ease toward the fit — and not at all while someone is carried: the
    // frame moving under the finger would take the orb out from under it.
    const k = snap ? 1 : dragId ? 0 : 0.08;
    snap = false;
    view = {
      x: view.x + (box.x - view.x) * k,
      y: view.y + (box.y - view.y) * k,
      s: view.s + (s - view.s) * k,
    };
    const easing =
      !dragId &&
      (Math.abs(view.x - box.x) > 0.5 ||
        Math.abs(view.y - box.y) > 0.5 ||
        Math.abs(view.s - s) > 0.002);
    stageEl.style.setProperty("--s", String(view.s));

    const n = sim.ids.length;
    const sx = new Float64Array(n);
    const sy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = paneW / 2 + (sim.px[i] - view.x) * view.s;
      sy[i] = paneH / 2 + (sim.py[i] - view.y) * view.s;
      const el = personEls.get(sim.ids[i]);
      if (el) el.style.transform = `translate3d(${sx[i]}px, ${sy[i]}px, 0)`;
    }

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return easing;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, paneW, paneH);
    ctx.lineJoin = "round";
    const reach = r * view.s * 1.6; // a member's own ground
    const shade = $activeTheme === "dark" ? "#ffffff" : "#000000";
    // The cells in the light are drawn last, over the faded rest.
    const lit = cells.filter((c) => groundLit(c.id, lens));
    const tags: LabelBox[] = [];
    const unlit = cells.filter((c) => !groundLit(c.id, lens));
    for (const cell of [...unlit, ...lit]) {
      const pts: Vec[] = cell.members.map((i) => ({ x: sx[i], y: sy[i] }));
      const outline = membrane(pts, reach);
      const color = inks.get(cell.id) ?? "#888888";
      const a = groundLit(cell.id, lens) ? 1 : 0.18;
      // The cytoplasm: a clear wash, thickening toward the membrane.
      ctx.save();
      ctx.beginPath();
      traceLoop(ctx, outline);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.globalAlpha = a * 0.2;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.globalAlpha = a * 0.12;
      for (const w of [0.9, 0.55, 0.25]) {
        ctx.lineWidth = reach * w;
        ctx.stroke();
      }
      ctx.restore();
      // The membrane: one firm line round everyone, drawn deeper than the
      // ground so it holds on pale paper (lighter on the night's).
      ctx.beginPath();
      traceLoop(ctx, outline);
      strokeMembrane(ctx, color, shade, a, 2);
      // The hub's name: where it could go round its cell (placed below).
      const label = labelEls.get(cell.id);
      if (label) {
        const size = labelSize(cell.id, label);
        tags.push({
          id: cell.id,
          ...size,
          spots: cellSpots(pts, reach, size.w, size.h, root * 1.2),
        });
      }
    }
    ctx.globalAlpha = 1;
    // The names, laid down so none covers another: those in the light
    // first, then the biggest cells (lib/labelplace).
    const rank = new Map(lit.map((c, i) => [c.id, i - lit.length]));
    const sizeOf = new Map(cells.map((c) => [c.id, c.members.length]));
    tags.sort(
      (a, b) =>
        (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) ||
        (sizeOf.get(b.id) ?? 0) - (sizeOf.get(a.id) ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
    // The people are in the way too: each orb and the name hung under it.
    const orb = (PERSON_REM * root * view.s) / 2;
    const faces: Rect[] = [];
    for (let i = 0; i < n; i++)
      faces.push({
        x0: sx[i] - orb,
        y0: sy[i] - orb,
        x1: sx[i] + orb,
        y1: sy[i] + orb + root * 1.2,
      });
    const placed = placeLabels(tags, {
      bounds: { w: paneW, h: paneH },
      prev: labelSpot,
      obstacles: faces,
    });
    labelSpot = new Map();
    for (const [id, at] of placed) {
      labelSpot.set(id, at.spot);
      const el = labelEls.get(id);
      if (el) el.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
    }
    return easing;
  }

  // The names' sizes, measured once each (reading layout every frame would
  // stall it) and again when the cells change; where each name sat last.
  let labelSizes = new Map<string, { w: number; h: number }>();
  let labelSpot = new Map<string, number>();
  $: (void cells, (labelSizes = new Map()));
  // A name measured before the web font landed is measured too narrow.
  if (typeof document !== "undefined")
    void document.fonts?.ready.then(() => {
      labelSizes = new Map();
      kick();
    });
  function labelSize(id: string, el: HTMLElement) {
    let size = labelSizes.get(id);
    if (!size || !size.w) {
      size = { w: el.offsetWidth, h: el.offsetHeight };
      labelSizes.set(id, size);
    }
    return size;
  }
  function strokeMembrane(
    ctx: CanvasRenderingContext2D,
    color: string,
    shade: string,
    alpha: number,
    width: number,
  ) {
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.4;
    ctx.strokeStyle = shade;
    ctx.stroke();
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
  let pressId: string | null = null;
  let dragged = false;
  function panePoint(e: PointerEvent): Vec {
    const box = paneEl.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }
  function onDown(e: PointerEvent, id: string) {
    if (e.button != null && e.button !== 0) return;
    pressAt = panePoint(e);
    pressId = id;
    dragged = false;
    dragId = null;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
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
    kick(0.5);
  }
  function onUp() {
    pressId = null;
    pressAt = null;
    dragId = null;
    dragTo = null;
    kick(0.5); // let go: the field settles round where they were left
  }

  // ── Picking ─────────────────────────────────────────────────────────────--
  //
  // What is picked: a person, or — from its name or the key — one hub.
  // Everything else steps back.
  type Picked = { kind: "person"; id: string } | { kind: "hub"; id: string };
  let pick: Picked | null = null;
  $: (void pick, kick(0.7)); // a focus gathers, or lets go
  // A person under the mouse lights the cells they belong to — brought to
  // the front, the rest faded — without the gathering a tap starts. What
  // is picked wins over what is only hovered.
  let hover: string | null = null;
  $: lens = pick ?? (hover ? ({ kind: "person", id: hover } as Picked) : null);
  $: (void lens, kick()); // redraw the cells in the new light
  $: if (hover && !byId.has(hover)) hover = null;
  function onEnter(e: PointerEvent, id: string) {
    if (e.pointerType === "mouse" && !dragId) hover = id;
  }
  function onLeave(id: string) {
    if (hover === id) hover = null;
  }
  // The cast changed under the pick (a search, a fresh read): let it go.
  $: if (pick && gone(pick, byId, hubName)) pick = null;
  function gone(
    sel: Picked,
    cast: ReadonlyMap<string, unknown>,
    known: ReadonlyMap<string, string>,
  ): boolean {
    return sel.kind === "person" ? !cast.has(sel.id) : !known.has(sel.id);
  }
  // Around a person in focus: everyone they share a hub with.
  $: near = neighbours(lens, people);
  function neighbours(sel: Picked | null, cast: readonly PersonAcross[]) {
    if (sel?.kind !== "person") return null;
    const mine = new Set(cast.find((p) => p.id === sel.id)?.holons);
    return new Set(
      cast.filter((p) => p.holons.some((h) => mine.has(h))).map((p) => p.id),
    );
  }
  function groundLit(id: string, sel: Picked | null): boolean {
    if (!sel) return true;
    if (sel.kind === "hub") return sel.id === id;
    return !!byId.get(sel.id)?.holons.includes(id);
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
  <div class="stage" bind:this={stageEl} style="--person-rem: {PERSON_REM}rem">
    <canvas class="cells" bind:this={canvasEl} aria-hidden="true"></canvas>

    <!-- Each cell's name, over the top of it; a tap picks the hub. Placed by
         the frame loop. -->
    {#each cells as c (c.id)}
      {@const color = holonColor(c.id, $holonColors)}
      <button
        type="button"
        class="gname"
        class:on={pick?.kind === "hub" && pick.id === c.id}
        class:dim={!groundLit(c.id, lens)}
        class:lit={!!lens && groundLit(c.id, lens)}
        style="--c: {color}; --on-c: {inkOn(color) ?? 'var(--ink)'}"
        aria-pressed={pick?.kind === "hub" && pick.id === c.id}
        use:placeLabel={c.id}
        on:click|stopPropagation={() => pickHub(c.id)}
      >
        <span class="gtext">{c.name}</span><span class="gcount"
          >{c.members.length}</span
        >
      </button>
    {/each}

    <!-- Everyone: an orb and a first name, moved together by the loop. -->
    {#each people as p (p.id)}
      {@const name = $nameOf(p.id)}
      {@const letters = initialsOf(name)}
      <div
        class="who"
        class:dim={!personLit(p, lens, near)}
        class:open={pick?.kind === "person" && pick.id === p.id}
        use:placePerson={p.id}
      >
        <button
          type="button"
          class="person"
          style="--ring: {ringOf(p.holons, $holonColors)}"
          aria-label={$t("dock.personOpen", { name, n: p.holons.length })}
          aria-expanded={pick?.kind === "person" && pick.id === p.id}
          title={name}
          on:click|stopPropagation={() => pickPerson(p.id)}
          on:pointerdown={(e) => onDown(e, p.id)}
          on:pointerenter={(e) => onEnter(e, p.id)}
          on:pointerleave={() => onLeave(p.id)}
          on:pointermove={onMove}
          on:pointerup={onUp}
          on:pointercancel={onUp}
        >
          <span class="face">
            {#if letters}{letters}{:else}<Icon name="person" />{/if}
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
          <span class="pname" aria-hidden="true">{firstName(name)}</span>
        {/if}
      </div>
    {/each}
  </div>

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
</section>

<!-- The key: which colour is which hub. A tap picks that hub's people and
     cell out of the picture; again lets them go. -->
<div class="key">
  <div class="keyhubs" role="group" aria-label={$t("dock.boards")}>
    {#each shownHubs as hub (hub.id)}
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
    {:else if query.trim() && docked.length > 0}
      {$t("dock.peopleNoMatch")}
    {:else if $dockPeopleLoading}
      {$t("dock.peopleLoading")}
    {:else}
      {$t("dock.peopleEmpty")}
    {/if}
  </p>
{/if}

<style>
  /* The view fills the sky between the bar and the key, on the dock's own
     paper. Above the gravity field (z 2), under the bar and the tray (z 6). */
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
  .stage {
    position: absolute;
    inset: 0;
    --person: calc(var(--person-rem) * var(--s, 1));
  }
  .cells {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* A cell's name, riding its top edge — in the cell's own colour, a filled
     tag, so it never reads as a person's name (those hang under the orbs on
     the card's paper). Placed by transform; parked off screen until then. */
  .gname {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 3; /* over the people: a name is never hidden by a face */
    transform: translate3d(-100vw, 0, 0);
    translate: -50% -50%;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    max-width: 12rem;
    min-height: 1.7rem;
    padding: 0 0.3rem 0 0.7rem;
    border-radius: 0.55rem;
    border: 0;
    background: var(--c);
    box-shadow: var(--shadow-soft);
    font-family: inherit;
    font-size: 0.74rem;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--on-c);
    white-space: nowrap;
    transition: opacity 0.2s ease;
  }
  .gtext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The label is small on purpose; its target is not. */
  .gname::after {
    content: "";
    position: absolute;
    inset: -0.55rem -0.3rem;
  }
  .gname.on {
    outline: 2.5px solid var(--teal);
    outline-offset: 2px;
  }
  .gname.lit {
    z-index: 4;
  }
  .gname.dim {
    opacity: 0.3;
  }
  /* The count, a small chip of the paper inside the tag. */
  .gcount {
    flex: none;
    min-width: 1.2rem;
    padding: 0 0.3rem;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--card) 85%, transparent);
    color: var(--ink);
    font-weight: 700;
    letter-spacing: 0;
    line-height: 1.25rem;
    text-align: center;
  }

  /* A person: an orb and the name under it, one point the loop moves. */
  .who {
    position: absolute;
    left: 0;
    top: 0;
    z-index: 1;
    width: 0;
    height: 0;
    transform: translate3d(-100vw, 0, 0);
    transition: opacity 0.2s ease;
  }
  .who.open {
    z-index: 2;
  }
  .who.dim {
    opacity: 0.25;
  }
  /* The orb: a disc on the theme's card inside a ring cut into their hubs'
     colours. */
  .person {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--person);
    height: var(--person);
    padding: calc(4px * var(--s, 1));
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--ring);
    /* Carried by the finger: the browser must not scroll or zoom instead. */
    touch-action: none;
    box-shadow: var(--shadow-soft);
    transition: scale 0.15s ease;
  }
  .person:active {
    scale: 0.93;
  }
  .who.open .person {
    scale: 1.12;
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
    left: 0;
    top: calc(var(--person) / 2 - 0.15rem);
    translate: -50% 0;
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
