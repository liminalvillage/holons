<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Graph mode for the Tasks view: the backlog as its dependency DAG, arranged
  // automatically — predecessors above, the tasks that wait on them below, one
  // arrow per still-open dependency. Same data and open handler as the wall
  // (TasksView owns those); this component only arranges and renders.
  //
  // Nothing here decides what an edge MEANS: edges are the quests' stored
  // `dependencies` lists, verbatim; ones that lead nowhere (a settled quest,
  // an id not on the board, a self reference) are dropped by `layoutDag`'s
  // normalization and never rendered. The layering/crossing-reduction is
  // lib/graphlayout's `layoutDag`, and the pixel boxes are its `placeDag`.
  // What's left — and all this file adds — is the canvas: fit-to-screen for
  // an unattended display, plus drag to pan and pinch/wheel to zoom for
  // someone standing at it.
  import Avatars from "$lib/components/Avatars.svelte";
  import type { BacklogTask } from "$lib/data";
  import { holoSeed } from "$lib/data";
  import { layoutDag, placeDag, type NodeBox } from "$lib/graphlayout";
  import { t } from "$lib/i18n";

  export let tasks: BacklogTask[];
  export let colorFor: (category: string | undefined) => string;
  export let dueLabel: (t: BacklogTask) => string | null;
  /** Task ids mid-completion (fading out on the wall) — dim their nodes too. */
  export let completing: Record<string, unknown> = {};
  export let onOpen: (id: string) => void;
  /**
   * Wire a new dependency: `task` comes to wait on `dep`. The gesture reads
   * the other way round — the card you DRAG becomes the dependency of the card
   * you drop it on ("this has to happen first") — so the drop calls this with
   * the target as `task`. TasksView owns the write, and the cycle rule, which
   * is core's.
   */
  export let onLink: (task: BacklogTask, dep: BacklogTask) => void = () => {};
  /**
   * Would that edge be accepted? Asked live during a drag so an impossible
   * drop — a duplicate, or one that would close a loop — never highlights as
   * a target. Defaults to permissive; TasksView answers with core's rule.
   */
  export let canLink: (taskId: string, depId: string) => boolean = () => true;
  /**
   * Cut a card loose: dropping it in the drawer drops the dependencies it
   * waits on AND the ones that wait on it, so it lands among the unlinked.
   */
  export let onDetach: (task: BacklogTask) => void = () => {};
  /**
   * Live size of the drawer, bindable so the board's floating buttons can ride
   * clear of it (same contract as the calendar's `--tray-h`). Both are 0 while
   * the drawer isn't showing; the caller reads the height in portrait, where
   * the drawer is a bottom bar, and the width in landscape, where it's a
   * sidebar.
   */
  export let trayHeight = 0;
  export let trayWidth = 0;

  // Node box and gaps, in canvas px. The canvas is then scaled as a whole, so
  // these are a fixed drawing unit, not a screen size — a wall display shows
  // the same arrangement a phone does, just larger.
  const NODE_W = 168;
  const NODE_H = 92;
  const COL_GAP = 26;
  const ROW_GAP = 74; // the band the arrows are drawn through
  /** Breathing room between the canvas and the viewport edges when fitted. */
  const PAD = 26;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.5;
  /** Below this fitted scale the labels stop being readable — pan instead. */
  const MIN_FIT = 0.4;
  /**
   * How far the fit is allowed to ENLARGE a small graph. A wall display with
   * three tasks on it should fill, not leave a postage stamp in the middle;
   * past this the nodes just look inflated.
   */
  const MAX_FIT = 1.5;
  /** Pointer travel (px) that turns a tap into a pan, so a drag never opens. */
  const TAP_SLOP = 6;

  // ── Arrangement ────────────────────────────────────────────────────────────
  $: edges = tasks.flatMap((task) =>
    task.dependencies.map((dep) => ({ from: dep, to: task.id })),
  );
  $: dag = layoutDag(
    tasks.map((task) => task.id),
    edges,
  );
  $: placed = placeDag(dag, {
    nodeW: NODE_W,
    nodeH: NODE_H,
    colGap: COL_GAP,
    rowGap: ROW_GAP,
  });
  $: byId = new Map(tasks.map((task) => [task.id, task] as const));
  // Canvas order = the layout's own (layers top→bottom), so the DOM order
  // matches what the eye follows — and so does tab order.
  $: nodes = dag.layers
    .flat()
    .map((id) => ({ task: byId.get(id)!, box: placed.nodes.get(id)! }))
    .filter((n) => n.task && n.box);
  /** The unlinked tasks — the drawer's contents, off the canvas. */
  $: loose = dag.free
    .map((id) => byId.get(id)!)
    .filter((task): task is BacklogTask => task != null);
  /** Nothing waits on anything — say so rather than showing a bare tray. */
  $: noEdges = dag.edges.length === 0;
  /**
   * Whichever drag is live — a card lifted off the board, or a chip carried
   * out of the drawer. Both aim at the same thing (a card that will come to
   * wait), so the target highlight and the hint read from this.
   */
  $: held = link ?? chip;

  /** A dependency arrow: out of the predecessor's foot, into its successor's head. */
  function edgePath(from: NodeBox, to: NodeBox): string {
    const x1 = from.x + NODE_W / 2;
    const y1 = from.y + NODE_H;
    const x2 = to.x + NODE_W / 2;
    const y2 = to.y;
    // Vertical control offset: a gentle S that leaves and arrives straight
    // down, so parallel edges stay distinguishable where they bunch up.
    const bend = Math.max(22, (y2 - y1) * 0.42);
    return `M ${x1} ${y1} C ${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
  }

  // ── Fit, pan and zoom ──────────────────────────────────────────────────────
  // The view is FITTED until someone moves it: `userView` null means "follow
  // the fit", so a kiosk left alone re-fits itself as tasks arrive and leave.
  // Panning or zooming pins it; the ⤢ chip (or a double-tap) hands it back.
  let vpW = 0;
  let vpH = 0;
  let userView: { s: number; tx: number; ty: number } | null = null;

  $: fitScale = fitFor(placed.width, placed.height, vpW, vpH);
  function fitFor(w: number, h: number, vw: number, vh: number): number {
    if (!w || !h || !vw || !vh) return 1;
    const s = Math.min(MAX_FIT, (vw - 2 * PAD) / w, (vh - 2 * PAD) / h);
    return Math.max(MIN_FIT, s);
  }
  $: fitted = {
    s: fitScale,
    tx: (vpW - placed.width * fitScale) / 2,
    ty: (vpH - placed.height * fitScale) / 2,
  };
  $: view = userView ?? fitted;

  function refit() {
    userView = null;
  }

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  /** Zoom by `factor` keeping the canvas point under (cx, cy) where it is. */
  function zoomAt(cx: number, cy: number, factor: number) {
    const v = userView ?? fitted;
    const s = clamp(v.s * factor, MIN_SCALE, MAX_SCALE);
    const k = s / v.s;
    userView = { s, tx: cx - k * (cx - v.tx), ty: cy - k * (cy - v.ty) };
  }

  // Live pointers on the canvas, so one finger pans and two pinch. Keyed by
  // pointerId; the map is also what tells a tap from a drag (see `moved`).
  let vp: HTMLElement | undefined;
  const points = new Map<number, { x: number; y: number }>();
  /** Pointers we've taken capture of — see `capture` below. */
  const captured = new Set<number>();
  let panFrom: { x: number; y: number; tx: number; ty: number } | null = null;
  let pinchFrom: { dist: number; s: number } | null = null;
  let moved = 0;

  // ── Drag a card onto another to wire a dependency ──────────────────────────
  // A press that starts ON a node lifts that card instead of panning; dropping
  // it on another card makes the LIFTED one a dependency of the card
  // underneath — "this has to happen before that" — so the dragged card ends
  // up drawn above its new dependent.
  // `grab` is the press before it has travelled far enough to count as a drag.
  let grab: { task: BacklogTask; x: number; y: number } | null = null;
  let link: {
    task: BacklogTask;
    /** Live offset from the node's laid-out box, in CANVAS px. */
    dx: number;
    dy: number;
    /** The card under the pointer, and whether that edge would be accepted. */
    over: BacklogTask | null;
    ok: boolean;
    /** Over the drawer instead — dropping there cuts the card loose. */
    overDrawer: boolean;
  } | null = null;

  function local(e: PointerEvent): { x: number; y: number } {
    const r = vp?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  }

  /** The card under a screen point, ignoring the lifted one (pointer-events: none). */
  function cardAt(clientX: number, clientY: number): BacklogTask | null {
    const el = document.elementFromPoint(
      clientX,
      clientY,
    ) as HTMLElement | null;
    const id = el?.closest<HTMLElement>("[data-node]")?.dataset.node;
    return (id && byId.get(id)) || null;
  }

  /** Is a screen point over the drawer (the unlink target)? */
  function overDrawerAt(clientX: number, clientY: number): boolean {
    const el = document.elementFromPoint(
      clientX,
      clientY,
    ) as HTMLElement | null;
    return el?.closest(".tray") != null;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button != null && e.button > 0) return;
    const p = local(e);
    points.set(e.pointerId, p);
    // NOT captured here: while a pointer is captured the browser retargets the
    // compatibility `click` at the capturing element, so capturing on the way
    // down would swallow every tap on a node. Capture starts once the gesture
    // proves itself a drag (see onPointerMove) — which is also the moment the
    // pointer needs to keep tracking outside the viewport.
    if (points.size === 1) {
      moved = 0;
      const hit = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "[data-node]",
      )?.dataset.node;
      const task = hit ? byId.get(hit) : undefined;
      if (task) {
        // Started on a card: this gesture is a link-drag (or a tap), never a pan.
        grab = { task, x: p.x, y: p.y };
        panFrom = null;
      } else {
        grab = null;
        const v = userView ?? fitted;
        panFrom = { x: p.x, y: p.y, tx: v.tx, ty: v.ty };
      }
      pinchFrom = null;
    } else if (points.size === 2) {
      // A second finger converts the gesture in flight: stop panning, start
      // pinching from the current spread.
      panFrom = null;
      const [a, b] = [...points.values()];
      pinchFrom = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s };
      capture(e.pointerId); // a two-finger gesture is never a tap
      grab = null; // ...nor a link-drag
      link = null;
    }
  }

  /** Take the pointer once the gesture is a pan/pinch rather than a tap. */
  function capture(id: number) {
    if (captured.has(id)) return;
    captured.add(id);
    vp?.setPointerCapture?.(id);
  }

  function onPointerMove(e: PointerEvent) {
    if (!points.has(e.pointerId)) return;
    const p = local(e);
    const prev = points.get(e.pointerId)!;
    moved += Math.hypot(p.x - prev.x, p.y - prev.y);
    points.set(e.pointerId, p);

    if (points.size >= 2 && pinchFrom) {
      const [a, b] = [...points.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Rebase each frame so the pinch tracks the fingers exactly.
      const want = clamp(
        (pinchFrom.s * dist) / pinchFrom.dist,
        MIN_SCALE,
        MAX_SCALE,
      );
      zoomAt(mid.x, mid.y, want / view.s);
      return;
    }
    if (grab && moved > TAP_SLOP) {
      capture(e.pointerId);
      const over = cardAt(e.clientX, e.clientY);
      link = {
        task: grab.task,
        // Screen travel → canvas travel: the card must keep up with the finger
        // at whatever zoom the board is at.
        dx: (p.x - grab.x) / view.s,
        dy: (p.y - grab.y) / view.s,
        over: over && over.id !== grab.task.id ? over : null,
        // The card underneath is the one that would come to wait.
        ok:
          !!over && over.id !== grab.task.id && canLink(over.id, grab.task.id),
        overDrawer: overDrawerAt(e.clientX, e.clientY),
      };
      return;
    }
    if (panFrom && moved > TAP_SLOP) {
      capture(e.pointerId);
      userView = {
        s: view.s,
        tx: panFrom.tx + (p.x - panFrom.x),
        ty: panFrom.ty + (p.y - panFrom.y),
      };
    }
  }

  function onPointerUp(e: PointerEvent) {
    points.delete(e.pointerId);
    if (captured.delete(e.pointerId)) vp?.releasePointerCapture?.(e.pointerId);
    // Drop: over an acceptable partner it wires the dependency (the card
    // underneath comes to wait on the dragged one); over the drawer it cuts
    // the card loose. Anything else puts it back where the layout wants it.
    if (link?.overDrawer) onDetach(link.task);
    else if (link?.over && link.ok) onLink(link.over, link.task);
    link = null;
    grab = null;
    if (points.size < 2) pinchFrom = null;
    if (points.size === 0) panFrom = null;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = vp?.getBoundingClientRect();
    // Trackpad pinch arrives as ctrl+wheel; both zoom, the gesture just scales
    // faster than a mouse notch.
    const step = e.ctrlKey ? 0.012 : 0.0022;
    zoomAt(
      e.clientX - (r?.left ?? 0),
      e.clientY - (r?.top ?? 0),
      Math.exp(-e.deltaY * step),
    );
  }

  /**
   * Open on a real tap only — the whole canvas pans, so a drag that happens to
   * end over a node must not open it. Keyboard activation reports no travel
   * (`moved` is reset on pointerdown), so Enter/Space always opens.
   */
  function onNodeClick(id: string) {
    if (moved > TAP_SLOP) return;
    onOpen(id);
  }
  function onNodeKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  }

  // ── Drawer chips: drag one onto a card to make it that card's dependency ───
  // The mirror of dropping a card into the drawer. The chip stays put and a
  // ghost follows the pointer (the drawer scrolls, so the chip can't travel).
  let chip: {
    task: BacklogTask;
    /** Ghost position, in viewport-independent page coordinates. */
    x: number;
    y: number;
    travelled: number;
    over: BacklogTask | null;
    ok: boolean;
  } | null = null;

  function onChipDown(e: PointerEvent, task: BacklogTask) {
    if (e.button != null && e.button > 0) return;
    chip = {
      task,
      x: e.clientX,
      y: e.clientY,
      travelled: 0,
      over: null,
      ok: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onChipMove(e: PointerEvent) {
    if (!chip) return;
    const travelled =
      chip.travelled + Math.hypot(e.clientX - chip.x, e.clientY - chip.y);
    const over = travelled > TAP_SLOP ? cardAt(e.clientX, e.clientY) : null;
    chip = {
      ...chip,
      x: e.clientX,
      y: e.clientY,
      travelled,
      over,
      ok: !!over && canLink(over.id, chip.task.id),
    };
  }

  function onChipUp(e: PointerEvent) {
    if (!chip) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const dropped = chip;
    chip = null;
    if (dropped.travelled <= TAP_SLOP)
      onOpen(dropped.task.id); // a tap opens
    else if (dropped.over && dropped.ok) onLink(dropped.over, dropped.task);
  }
</script>

<!-- Board + drawer. Portrait stacks them (drawer along the bottom); landscape
     puts the drawer down the right-hand side — the same arrangement, and the
     same chips, as the calendar's unscheduled drawer. -->
<div class="graph" class:has-tray={loose.length || link != null}>
  <div
    class="viewport"
    bind:this={vp}
    bind:clientWidth={vpW}
    bind:clientHeight={vpH}
    role="group"
    aria-label={$t("tasks.graphAria")}
    on:pointerdown={onPointerDown}
    on:pointermove={onPointerMove}
    on:pointerup={onPointerUp}
    on:pointercancel={onPointerUp}
    on:wheel={onWheel}
    on:dblclick={refit}
  >
    <div
      class="canvas"
      style="width: {placed.width}px; height: {placed.height}px; transform: translate({view.tx}px, {view.ty}px) scale({view.s});"
    >
      <svg
        class="wires"
        width={placed.width}
        height={placed.height}
        viewBox="0 0 {placed.width} {placed.height}"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="kiosk-dep-arrow"
            markerWidth="9"
            markerHeight="9"
            refX="7.5"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,1 L8,4.5 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        {#each dag.edges as edge (edge.from + ">" + edge.to)}
          {@const a = placed.nodes.get(edge.from)}
          {@const b = placed.nodes.get(edge.to)}
          {#if a && b}
            <path
              class="wire"
              d={edgePath(a, b)}
              marker-end="url(#kiosk-dep-arrow)"
            />
          {/if}
        {/each}
        <!-- Preview of the edge a drop would create, drawn the way it will look
           once written: out of the lifted card (the new dependency), into the
           card underneath that will wait for it. -->
        {#if link?.over && link.ok}
          {@const from = placed.nodes.get(link.task.id)}
          {@const to = placed.nodes.get(link.over.id)}
          {#if from && to}
            <path
              class="wire preview"
              d={edgePath(
                { ...from, x: from.x + link.dx, y: from.y + link.dy },
                to,
              )}
              marker-end="url(#kiosk-dep-arrow)"
            />
          {/if}
        {/if}
      </svg>

      {#each nodes as { task, box } (task.id)}
        <!-- A real <button>: a node carries no nested controls, so it gets
           keyboard and AT semantics for free. -->
        <button
          class="node"
          class:blocked={task.unmetDeps > 0}
          class:done={!!completing[task.id]}
          class:is-foreign={!!task.sourceColor}
          class:holo={!!task.hologram}
          class:lifted={link?.task.id === task.id}
          class:target={held?.ok && held.over?.id === task.id}
          class:reject={held != null && !held.ok && held.over?.id === task.id}
          data-node={task.id}
          style:--holo-seed={holoSeed(task.id)}
          style="left: {box.x}px; top: {box.y}px; width: {NODE_W}px; height: {NODE_H}px; background: {colorFor(
            task.category,
          )}; --glow: {task.sourceColor ?? 'transparent'}; {link?.task.id ===
          task.id
            ? `transform: translate(${link.dx}px, ${link.dy}px);`
            : ''}"
          title={task.title}
          on:click={() => onNodeClick(task.id)}
        >
          <h3>{task.title}</h3>
          <!-- Rendered only when it has something to say: an empty foot would
             still claim its row and hang the title from the top edge. -->
          {#if task.unmetDeps > 0 || dueLabel(task) || task.appreciation || task.people.length}
            <div class="foot">
              {#if task.unmetDeps > 0}
                <span
                  class="waits"
                  title={$t("tasks.waitsTitle", {
                    n: task.unmetDeps,
                  })}>⛓ {task.unmetDeps}</span
                >
              {/if}
              {#if dueLabel(task)}<span class="due">{dueLabel(task)}</span>{/if}
              {#if task.appreciation}
                <span class="heart" aria-hidden="true"
                  >♥ {task.appreciation}</span
                >
              {/if}
              {#if task.people.length}
                <span class="who"
                  ><Avatars people={task.people} size="1.2rem" /></span
                >
              {/if}
            </div>
          {/if}
        </button>
      {/each}
    </div>

    {#if held}
      <!-- Says which way the drop reads, so the gesture needs no guessing. -->
      <p class="hint drag" class:armed={held.ok || !!link?.overDrawer}>
        {link?.overDrawer
          ? $t("tasks.dropUnlink", { title: held.task.title })
          : held.over && !held.ok
            ? $t("tasks.linkRefused")
            : $t("tasks.linkHint", { title: held.task.title })}
      </p>
    {:else if noEdges}
      <!-- Outside the canvas: a banner about the board shouldn't be zoomed
           with it, nor clipped when the fit pushes the canvas off the top. -->
      <p class="hint">{$t("tasks.graphEmpty")}</p>
    {/if}

    {#if userView}
      <button
        class="refit"
        on:click={refit}
        on:pointerdown|stopPropagation
        aria-label={$t("tasks.graphFit")}
        title={$t("tasks.graphFit")}
      >
        ⤢
      </button>
    {/if}
  </div>

  <!-- The drawer of unlinked tasks — drag one onto a card to make it that
       card's dependency, or drop a linked card in here to cut it loose. It
       stays mounted through a drag so there's always somewhere to drop. -->
  {#if loose.length || link}
    <div
      class="tray"
      class:drop={!!link?.overDrawer}
      bind:clientHeight={trayHeight}
      bind:clientWidth={trayWidth}
    >
      <span class="tray-label"
        >{link ? $t("tasks.dropUnlinkShort") : $t("tasks.graphFree")}</span
      >
      <div class="tray-items scroll">
        {#each loose as task (task.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <span
            class="tray-chip"
            class:is-foreign={!!task.sourceColor}
            class:holo={!!task.hologram}
            class:dragging={chip?.task.id === task.id}
            style:--holo-seed={holoSeed(task.id)}
            style="background: {colorFor(
              task.category,
            )}; --glow: {task.sourceColor ?? 'transparent'};"
            role="button"
            tabindex="0"
            title={task.title}
            on:pointerdown={(e) => onChipDown(e, task)}
            on:pointermove={onChipMove}
            on:pointerup={onChipUp}
            on:pointercancel={onChipUp}
            on:keydown={(e) => e.key === "Enter" && onOpen(task.id)}
            >{task.title}</span
          >
        {/each}
        {#if !loose.length}
          <span class="tray-empty">{$t("tasks.dropUnlinkShort")}</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if chip && chip.travelled > TAP_SLOP}
  <!-- The chip can't leave the scrolling drawer, so a ghost carries it. -->
  <div
    class="drag-ghost"
    class:armed={chip.ok}
    style="left: {chip.x}px; top: {chip.y}px;"
    aria-hidden="true"
  >
    {chip.task.title}
  </div>
{/if}

<style>
  /* Board above, drawer below — and in landscape, board beside drawer. Same
     shape (and the same --tray-w clamp) as the calendar's unscheduled drawer,
     so the two views read as one app. */
  .graph {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    --tray-w: clamp(13rem, 22vw, 19rem);
  }
  .graph.has-tray {
    grid-template-rows: minmax(0, 1fr) auto;
  }
  @media (min-aspect-ratio: 1/1) {
    .graph.has-tray {
      grid-template-rows: minmax(0, 1fr);
      grid-template-columns: minmax(0, 1fr) var(--tray-w);
    }
    .graph.has-tray .tray {
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border-top: none;
      border-left: 1px solid var(--line);
    }
    /* Chips stack down the sidebar; `flex: 1` bounds the list to the drawer so
       overflow scrolls instead of being clipped. */
    .graph.has-tray .tray-items {
      flex: 1 1 0;
      flex-direction: column;
      flex-wrap: nowrap;
      overflow-x: hidden;
      overflow-y: auto;
      min-height: 0;
      padding: 0.4rem 0.7rem;
      gap: 0.85rem;
    }
    .graph.has-tray .tray-chip {
      max-width: none;
    }
  }

  /* The graph pans and zooms itself, so it never scrolls: it claims the whole
     board area and clips its canvas (mirrors the swipe deck's wrapper). */
  .viewport {
    position: relative;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    /* The gestures are ours — never hand one to the browser's pan/zoom. */
    touch-action: none;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
  }
  .viewport:active {
    cursor: grabbing;
  }
  .canvas {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    animation: kiosk-rise 0.42s ease both;
  }
  .wires {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
    /* `currentColor` reaches the arrow marker through this. */
    color: color-mix(in srgb, var(--teal) 62%, transparent);
  }
  .wire {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    /* Every edge drawn is a dependency still OPEN (settled ones stop
       blocking), so the flow reads as work waiting to move down the graph. */
    stroke-dasharray: 7 6;
    animation: kiosk-wire 1.4s linear infinite;
  }
  @keyframes kiosk-wire {
    to {
      stroke-dashoffset: -13;
    }
  }
  /* The edge a drop would create: brighter and solid, so it reads as a promise
     rather than as one of the links already in the graph. */
  .wire.preview {
    stroke-dasharray: none;
    stroke-width: 3;
    animation: none;
    color: var(--teal);
  }

  .node {
    position: absolute;
    display: flex;
    flex-direction: column;
    /* Centred, with `.foot`'s auto top margin pushing any meta to the floor —
       so a bare title sits in the middle of the note instead of hanging from
       the ceiling of an empty box. */
    justify-content: center;
    padding: 0.5rem 0.55rem 0.45rem;
    border-radius: 4px 14px 14px 14px;
    box-shadow: 1.5px 5px 7px rgba(28, 48, 46, 0.16);
    text-align: center;
    cursor: pointer;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }
  .node:hover,
  .node:focus-visible {
    transform: translateY(-2px);
    box-shadow: 1.5px 9px 14px rgba(28, 48, 46, 0.24);
  }
  /* Waiting on something: it reads as further back than the actionable
     leaves above it, the same rank the wall gives it by sorting it last. */
  .node.blocked {
    opacity: 0.86;
  }
  .node.done {
    opacity: 0.35;
    pointer-events: none;
    transition: opacity 0.4s ease;
  }
  /* The card being dragged: lifted, and transparent to hit-testing so
     `cardAt` finds what's UNDER it rather than the card itself. */
  .node.lifted {
    z-index: 4;
    pointer-events: none;
    box-shadow: 0 18px 30px rgba(28, 48, 46, 0.3);
    transition: none;
  }
  /* Drop here and the link is made… */
  .node.target {
    box-shadow:
      0 0 0 3px var(--teal),
      0 10px 20px rgba(28, 48, 46, 0.2);
  }
  /* …or it can't be: already linked, itself, or it would close a loop. */
  .node.reject {
    box-shadow:
      0 0 0 3px #d4493a,
      0 10px 20px rgba(28, 48, 46, 0.2);
    opacity: 0.7;
  }
  .node h3 {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.22;
    font-weight: 700;
    color: var(--ink);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    margin-top: 0.35rem;
    font-size: 0.66rem;
    font-weight: 700;
  }
  .foot .waits,
  .foot .due {
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 999px;
    padding: 0.05rem 0.4rem;
    white-space: nowrap;
  }
  .foot .heart {
    color: #d4493a;
  }
  .foot .who {
    display: inline-flex;
  }

  /* Label over the rule that separates the graph from the unlinked tray. */
  /* Drawer of unlinked tasks (drag source AND unlink target) — the calendar's
     unscheduled tray, chip for chip. */
  .tray {
    min-width: 0;
    padding: 0.6rem 1.4rem 0.9rem;
    background: var(--card);
    border-top: 1px solid var(--line);
    transition:
      background 0.15s ease,
      box-shadow 0.15s ease;
  }
  /* Armed: a linked card is hovering over it and will be cut loose on drop. */
  .tray.drop {
    background: color-mix(in srgb, var(--teal) 12%, var(--card));
    box-shadow: inset 0 0 0 2px var(--teal);
  }
  .tray-label {
    display: block;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin-bottom: 0.45rem;
  }
  .tray-items {
    display: flex;
    min-width: 0;
    gap: 0.7rem;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    /* Inset the chips so a foreign chip's glow edge can bloom instead of being
       clipped by the overflow boundary. */
    padding: 0.5rem 0.4rem 0.7rem;
  }
  .tray-chip {
    flex: 0 0 auto;
    max-width: 12rem;
    padding: 0.5rem 0.8rem;
    border-radius: 4px 12px 12px 12px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* Swipes scroll the drawer; a drag lifts a chip out onto the board. */
    touch-action: pan-x;
    cursor: grab;
  }
  .tray-chip.dragging {
    opacity: 0.4;
  }
  .tray-empty {
    font-size: 0.85rem;
    color: var(--muted);
  }
  /* The chip's stand-in while it's being carried to the board. */
  .drag-ghost {
    position: fixed;
    z-index: 60;
    transform: translate(-50%, -50%) rotate(-2deg);
    pointer-events: none;
    max-width: 13rem;
    padding: 0.5rem 0.8rem;
    border-radius: 4px 12px 12px 12px;
    background: var(--note-sun);
    color: var(--ink);
    font-size: 0.9rem;
    font-weight: 700;
    box-shadow: var(--shadow-note);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .drag-ghost.armed {
    box-shadow:
      0 0 0 3px var(--teal),
      var(--shadow-note);
  }
  /* No dependencies anywhere in the backlog — the tray is the whole board. */
  .hint {
    position: absolute;
    left: 50%;
    top: 0.6rem;
    transform: translateX(-50%);
    max-width: min(90%, 34rem);
    margin: 0;
    text-align: center;
    font-size: 0.95rem;
    color: var(--muted);
    pointer-events: none;
  }
  /* Same slot, but it's now instruction rather than commentary: a solid chip
     that turns teal the moment the card under the finger would accept. */
  .hint.drag {
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--card);
    border: 1.5px solid var(--line);
    box-shadow: var(--shadow-soft);
  }
  .hint.drag.armed {
    color: #fff;
    background: var(--teal);
    border-color: var(--teal);
  }

  /* Re-fit chip — only while the view is pinned by a pan or zoom. */
  .refit {
    position: absolute;
    top: 0.8rem;
    right: 0.9rem;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.2rem;
    color: var(--teal-deep);
    background: var(--card);
    border: 1.5px solid var(--line);
    box-shadow: var(--shadow-soft);
    z-index: 3;
  }
  .refit:active {
    transform: scale(0.92);
  }

  @media (prefers-reduced-motion: reduce) {
    .canvas {
      animation: none;
    }
    .wire {
      animation: none;
    }
    .node {
      transition: none;
    }
  }

  /* Federated / hologram nodes carry the same source-coloured edge the wall
     and list give them (see `sourceGlow` in lib/data.ts). */
  .is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 14px 1px color-mix(in srgb, var(--glow) 55%, transparent);
  }
</style>
