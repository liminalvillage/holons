<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Choose deck: the backlog as a possibility chooser — "so much to do,
  // which do I take?". Full screen over the board, opened from the Choose
  // button beside the ＋ or straight from `/<holon>/choose`. It deals a small
  // circle of cards (CIRCLE, never the whole backlog), frozen when dealt so
  // nothing reshuffles under the finger; each card still shows live data.
  // One answer per card:
  //   drag right / → / "Join"  — it flies up and lights its star in the sky
  //   drag up    / ↑ / "Like"  — it lifts away glowing (an appreciation)
  //   drag left  / ← / "Skip"  — it turns edge-on and passes out sideways
  // The three buttons under the card always do the same (no gesture is the
  // only way); each answer can be undone for 5 s; a tap opens the card. When
  // a circle is answered the end offers the next one.
  //
  // In 3D: the deck irises open out of the button that opened it; the stack
  // fans back into depth; the top card tilts toward the finger and catches
  // the light; the sky behind travels a step forward with every answer.
  //
  // Gesture/pose geometry and dealing are pure (lib/deck.ts); the writes come
  // in through TasksView's handlers (which route federated cards to their
  // owner holon). A swipe never *undoes* anything — already-joined cards
  // pass through.
  import { onDestroy, onMount, tick as nextTick } from "svelte";
  import { get } from "svelte/store";
  import Icon from "./Icon.svelte";
  import Avatars, { hideImg } from "./Avatars.svelte";
  import Confetti from "./Confetti.svelte";
  import { currentUser, loginOpen } from "$lib/auth";
  import {
    chooseOpen,
    chooseOrigin,
    holonId,
    questsPulled,
    selection,
    showNotice,
    swipeDecks,
  } from "$lib/stores";
  import { requestSwitch } from "$lib/dock";
  import { sameId } from "$lib/ids";
  import { pictureUrl } from "@holons/core/media";
  import {
    dealOrder,
    decide,
    deckKey,
    decksFor,
    deckTasks,
    dragPose,
    EMPTY_DECK,
    hydrate,
    intentOf,
    isTap,
    nextCircle,
    poseCss,
    progress,
    stackPose,
    throwMs,
    throwPath,
    type DeckState,
    type Keyframe,
    type Pose,
    type SwipeDirection,
  } from "$lib/deck";
  import type { BacklogTask } from "$lib/data";
  import { holoSeed } from "$lib/data";
  import { t } from "$lib/i18n";

  export let tasks: BacklogTask[];
  /** Cards sealed on the relays (the lock glyph). */
  export let lockedIds: Set<string> = new Set();
  export let colorFor: (category: string | undefined) => string;
  export let dueLabel: (t: BacklogTask) => string | null;
  export let onOpen: (id: string) => void;
  export let onJoin: (
    t: BacklogTask,
  ) => Promise<"joined" | "already" | "failed">;
  export let onLike: (
    t: BacklogTask,
  ) => Promise<"liked" | "already" | "failed">;
  /** Revert a committed swipe (the Undo pill) — toggles the write back off. */
  export let onRevert: (t: BacklogTask, kind: "join" | "like") => Promise<void>;

  $: uid = $currentUser?.id;
  function participating(t: BacklogTask): boolean {
    return t.people.some((p) => sameId(p.id, uid));
  }
  function appreciating(t: BacklogTask): boolean {
    return t.appreciatedBy.some((id) => sameId(id, uid));
  }

  // ── The person's deck (one per hub and person, see $lib/deck) ────────────
  $: key = deckKey($holonId, uid);
  $: swipeDecks.update((all) => decksFor(all, uid));
  $: mine = $swipeDecks.get(key) ?? EMPTY_DECK;
  $: deal(key, tasks);
  $: live = deckTasks(tasks, mine.dismissed, mine.order);

  function patchDeck(k: string, fn: (d: DeckState) => DeckState) {
    swipeDecks.update((all) =>
      new Map(all).set(k, fn(all.get(k) ?? EMPTY_DECK)),
    );
  }
  function deal(k: string, dealt: BacklogTask[]) {
    const prev = get(swipeDecks).get(k) ?? EMPTY_DECK;
    const order = dealOrder(prev.order, dealt);
    if (order !== prev.order) patchDeck(k, (d) => ({ ...d, order }));
  }
  // `k` is the deck the answer began in: a write can land after the person
  // logged out, and must not touch whoever's deck is on screen by then.
  function dismiss(k: string, id: string) {
    patchDeck(k, (d) => ({ ...d, dismissed: new Set(d.dismissed).add(id) }));
  }
  function unDismiss(k: string, id: string) {
    patchDeck(k, (d) => {
      const dismissed = new Set(d.dismissed);
      dismissed.delete(id);
      return { ...d, dismissed };
    });
  }

  // ── The circle ────────────────────────────────────────────────────────────
  let snapshot: BacklogTask[] = [];
  let pos = 0;
  let answered: { id: string; dir: SwipeDirection }[] = [];
  /** Circles dealt this session (1: the first). */
  let circle = 1;
  /** Every card dealt this session — no circle deals one twice. */
  let seen = new Set<string>();
  let joins = 0;
  let likes = 0;

  function dealCircle(next: BacklogTask[]) {
    snapshot = next;
    for (const m of next) seen.add(m.id);
    seen = seen;
    pos = 0;
    answered = [];
    dealing = true;
    later(1000, () => (dealing = false));
  }
  // Opened before the backlog arrived (a cold `/choose` link): deal as soon
  // as there is something.
  $: if (!snapshot.length && !answered.length && circle === 1 && live.length)
    dealCircle(nextCircle(live, seen));

  $: cards = hydrate(snapshot, tasks);
  $: top = cards[pos] ?? null;
  $: stack = cards.slice(pos, pos + 3);
  $: ended = pos >= cards.length;
  $: answers = cards.map((c) => answered.find((a) => a.id === c.id)?.dir);
  // What waits behind this circle: the next one, if any.
  $: more = ended ? nextCircle(live, seen).length : 0;

  // ── Motion ────────────────────────────────────────────────────────────────
  let reduced = false;
  let width = 320;
  let height = 480;
  let dealing = true;
  let slotEl: HTMLElement | null = null;
  let cardEl: HTMLElement | null = null;

  let dragging = false;
  let pointer: number | null = null;
  let x0 = 0;
  let y0 = 0;
  let dx = 0;
  let dy = 0;
  let samples: { x: number; y: number; t: number }[] = [];
  let tappedId: string | null = null;

  $: intent = intentOf(dx, dy);
  $: strength = progress({ dx, dy, width });
  $: topPose = reduced
    ? { ...dragPose(dx, dy, width), rx: 0, ry: 0, rz: 0, z: 0 }
    : dragPose(dx, dy, width);
  // The light on the card follows the tilt.
  $: gx = Math.max(0, Math.min(1, 0.5 - dx / Math.max(1, width)));
  $: gy = Math.max(0, Math.min(1, 0.22 - (dy / Math.max(1, width)) * 0.6));
  // The sky travels a step forward with each answer, and dives per circle.
  $: travel = 1.05 ** (pos + (circle - 1) * 4);

  type Flight = {
    key: number;
    task: BacklogTask;
    dir: SwipeDirection;
    kf: Keyframe[];
    ms: number;
  };
  let flying: Flight[] = [];
  let flightN = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function later(ms: number, fn: () => void) {
    const h = setTimeout(() => {
      timers.delete(h);
      fn();
    }, ms);
    timers.add(h);
  }

  function measure() {
    const r = cardEl?.getBoundingClientRect();
    if (r && r.width) {
      width = r.width;
      height = r.height;
    }
  }

  function onDown(e: PointerEvent) {
    if (!top || pointer != null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointer = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    x0 = e.clientX;
    y0 = e.clientY;
    dx = dy = 0;
    samples = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
    dragging = true;
    tappedId = null;
    measure();
  }
  function onMove(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    dx = e.clientX - x0;
    dy = e.clientY - y0;
    samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
  }
  function velocity(): { vx: number; vy: number } {
    const a = samples[0];
    const b = samples[samples.length - 1];
    const dt = a && b ? b.t - a.t : 0;
    if (!a || !b || dt <= 0 || dt > 200) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }
  function onUp(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    dragging = false;
    if (isTap(dx, dy)) {
      dx = dy = 0;
      tappedId = top?.id ?? null;
      return;
    }
    const v = velocity();
    const dir = decide({ dx, dy, ...v, width });
    if (dir) void answer(dir, v);
    else dx = dy = 0; // spring back
  }
  // Open on the CLICK, not on pointerup: a finger's click is hit-tested after
  // pointerup, and opening the card first put its buttons under the finger
  // (the same trap as Modal's backdrop — see kiosk-touch-tap-fallthrough).
  function onCardClick() {
    const id = tappedId;
    tappedId = null;
    if (id) onOpen(id);
  }
  function onCancel(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    dragging = false;
    dx = dy = 0;
  }

  /** Where card `i`'s star is, relative to the slot's centre (px). */
  function starAt(i: number): { x: number; y: number } | null {
    const star = root?.querySelector(`[data-star="${i}"]`);
    if (!star || !slotEl) return null;
    const a = star.getBoundingClientRect();
    const b = slotEl.getBoundingClientRect();
    return {
      x: a.left + a.width / 2 - (b.left + b.width / 2),
      y: a.top + a.height / 2 - (b.top + b.height / 2),
    };
  }

  /** Throw the top card off in the answer's direction, and advance. */
  function flyOff(
    task: BacklogTask,
    dir: SwipeDirection,
    v = { vx: 0, vy: 0 },
  ) {
    measure();
    const target = dir === "right" ? starAt(pos) : null;
    const kf = throwPath(dir, {
      dx,
      dy,
      ...v,
      width,
      height,
      target: target ?? undefined,
    });
    const ms = reduced ? 160 : throwMs(dir, v.vx, v.vy);
    const k = ++flightN;
    flying = [...flying, { key: k, task, dir, kf, ms }];
    later(ms + 4000, () => land(k)); // backstop; the animation's end lands it
    dx = dy = 0;
    pos += 1;
  }
  function land(k: number) {
    flying = flying.filter((f) => f.key !== k);
  }
  /** The card's flight, with the Web Animations API (transform/opacity). */
  function throwCard(node: HTMLElement, f: Flight) {
    if (typeof node.animate !== "function") return {};
    const frames = reduced
      ? [
          { transform: poseCss(f.kf[0]), opacity: 1 },
          { transform: poseCss(f.kf[0]), opacity: 0 },
        ]
      : f.kf.map((k) => ({
          transform: poseCss(k),
          opacity: k.o,
          offset: k.offset,
        }));
    const a = node.animate(frames, {
      duration: f.ms,
      easing: reduced ? "linear" : "cubic-bezier(0.35, 0.1, 0.45, 1)",
      fill: "forwards",
    });
    a.onfinish = () => land(f.key);
    return { destroy: () => a.cancel() };
  }

  /** The card comes back on top (a refused write, or an undo). */
  function putBack(id: string) {
    const at = snapshot.findIndex((x) => x.id === id);
    if (at < 0) return;
    answered = answered.filter((a) => a.id !== id);
    pos = Math.min(pos, at);
    flying = flying.filter((f) => f.task.id !== id);
  }

  let celebrate = false;
  let heartPop = false;

  async function answer(dir: SwipeDirection, v = { vx: 0, vy: 0 }) {
    const task = top;
    if (!task) return;
    // Joining and liking are writes — they need a logged-in person. Skipping
    // is local and always allowed.
    if (dir !== "left" && !$currentUser) {
      dx = dy = 0;
      loginOpen.set(true);
      return;
    }
    // Liking while participating would drop you from the doers (core's
    // participate-XOR-appreciate rule) — an answer never un-does, so refuse.
    if (dir === "up" && participating(task)) {
      dx = dy = 0;
      showNotice($t("swipe.participating"));
      return;
    }
    const k = key;
    flyOff(task, dir, v);
    answered = [...answered, { id: task.id, dir }];
    dismiss(k, task.id); // optimistic — a refused write un-dismisses below

    if (dir === "left") return offerUndo(task, "skip", k);
    if (dir === "right") {
      if (participating(task)) return showNotice($t("swipe.alreadyIn"));
      const res = await onJoin(task);
      if (res === "joined") {
        joins += 1;
        burst("celebrate");
        offerUndo(task, "join", k);
      } else if (res === "already") showNotice($t("swipe.alreadyIn"));
      else refused(k, task, "swipe.joinFailed");
      return;
    }
    if (appreciating(task)) return showNotice($t("swipe.alreadyAppreciated"));
    const res = await onLike(task);
    if (res === "liked") {
      likes += 1;
      burst("heart");
      offerUndo(task, "like", k);
    } else if (res === "already") showNotice($t("swipe.alreadyAppreciated"));
    else refused(k, task, "swipe.appreciateFailed");
  }

  function refused(
    k: string,
    task: BacklogTask,
    msg: "swipe.joinFailed" | "swipe.appreciateFailed",
  ) {
    unDismiss(k, task.id);
    putBack(task.id);
    showNotice($t(msg));
  }

  function burst(kind: "celebrate" | "heart") {
    if (reduced) return;
    if (kind === "celebrate") {
      celebrate = true;
      later(1300, () => (celebrate = false));
    } else {
      heartPop = true;
      later(900, () => (heartPop = false));
    }
  }

  // ── Undo ──────────────────────────────────────────────────────────────────
  type Undo = {
    task: BacklogTask;
    kind: "skip" | "join" | "like";
    deck: string;
  };
  let undoable: Undo | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  const SAID = {
    skip: "choose.saidSkip",
    join: "choose.saidJoin",
    like: "choose.saidLike",
  } as const;

  function offerUndo(task: BacklogTask, kind: Undo["kind"], deck: string) {
    undoable = { task, kind, deck };
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undoable = null), 5000);
  }

  async function undo() {
    const u = undoable;
    if (!u || busy) return;
    undoable = null;
    if (undoTimer) clearTimeout(undoTimer);
    busy = true;
    unDismiss(u.deck, u.task.id);
    putBack(u.task.id);
    try {
      if (u.kind === "join") {
        joins = Math.max(0, joins - 1);
        await onRevert(u.task, "join");
      } else if (u.kind === "like") {
        likes = Math.max(0, likes - 1);
        await onRevert(u.task, "like");
      }
    } finally {
      busy = false;
    }
  }

  // ── Next circle / start over ──────────────────────────────────────────────
  function deeper() {
    const next = nextCircle(live, seen);
    if (!next.length) return;
    undoable = null;
    circle += 1;
    dealCircle(next);
  }
  function startOver() {
    // A fresh round: every card back, dealt in the backlog's current order.
    patchDeck(key, () => ({
      dismissed: new Set(),
      order: tasks.map((x) => x.id),
    }));
    seen = new Set();
    circle = 1;
    joins = likes = 0;
    undoable = null;
    void nextTick().then(() => dealCircle(nextCircle(live, seen)));
  }

  function close() {
    chooseOpen.set(false);
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  // Anything raised over the deck (the card's sheet, the login) owns the keys.
  $: covered = !!$selection || $loginOpen;
  function onKey(e: KeyboardEvent) {
    if (covered || e.defaultPrevented) return;
    const el = e.target as HTMLElement | null;
    if (
      el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.isContentEditable)
    )
      return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && undoable) {
      e.preventDefault();
      void undo();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || ended || !top) return;
    const dir: SwipeDirection | null =
      e.key === "ArrowRight"
        ? "right"
        : e.key === "ArrowLeft"
          ? "left"
          : e.key === "ArrowUp"
            ? "up"
            : null;
    if (dir) {
      e.preventDefault();
      void answer(dir);
    }
  }
  function onCardKey(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === " ") && top) {
      e.preventDefault();
      onOpen(top.id);
    }
  }

  // ── Pull the grip down to close ───────────────────────────────────────────
  let pull = 0;
  let pullId: number | null = null;
  let pullY0 = 0;
  let pullT0 = 0;
  function gripDown(e: PointerEvent) {
    pullId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pullY0 = e.clientY;
    pullT0 = e.timeStamp;
    pull = 0;
  }
  function gripMove(e: PointerEvent) {
    if (e.pointerId !== pullId) return;
    pull = Math.max(0, e.clientY - pullY0);
  }
  function gripUp(e: PointerEvent) {
    if (e.pointerId !== pullId) return;
    pullId = null;
    const v = pull / Math.max(1, e.timeStamp - pullT0);
    if (pull > 110 || (pull > 40 && v > 0.6)) close();
    else pull = 0;
  }

  /** A provenance badge tap travels to the holon the card came from. */
  function jumpToSource(id: string | undefined, name?: string): void {
    if (!id) return;
    close();
    requestSwitch(id, { name, from: $holonId });
  }

  /**
   * Mount at the end of <body>: the board window is its own stacking context
   * (z-index 10), so a fixed child of it can't rise over the header — and the
   * card sheet and login (Modal, DetailModal) must still rise over the deck.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // ── Mount: open out of the Choose button, like a portal ──────────────────
  let root: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  onMount(() => {
    reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    returnFocus = document.activeElement as HTMLElement | null;
    root?.focus();
    measure();
    if (!snapshot.length && live.length) dealCircle(nextCircle(live, seen));
    const o = get(chooseOrigin);
    chooseOrigin.set(null);
    if (o && !reduced && typeof root?.animate === "function") {
      const cx = o.x + o.width / 2;
      const cy = o.y + o.height / 2;
      const r0 = Math.max(o.width, o.height) / 2;
      const r1 = Math.hypot(
        Math.max(cx, innerWidth - cx),
        Math.max(cy, innerHeight - cy),
      );
      root.animate(
        [
          { clipPath: `circle(${r0}px at ${cx}px ${cy}px)` },
          { clipPath: `circle(${r1}px at ${cx}px ${cy}px)` },
        ],
        { duration: 620, easing: "cubic-bezier(0.7, 0, 0.2, 1)" },
      );
    }
  });
  onDestroy(() => {
    if (undoTimer) clearTimeout(undoTimer);
    for (const h of timers) clearTimeout(h);
    returnFocus?.focus?.();
  });

  // Takes its inputs as arguments so the template re-renders on each drag.
  function cardStyle(i: number, topP: Pose, p: number): string {
    if (i === 0) return `transform: ${poseCss(topP)}`;
    return `transform: ${poseCss(stackPose(i, reduced ? 0 : p))}`;
  }
  function stamp(dir: SwipeDirection): number {
    return intent === dir ? strength : 0;
  }
</script>

<svelte:window on:keydown={onKey} />

<div
  class="choose"
  class:reduced
  class:receded={!!$selection && !reduced}
  role="dialog"
  aria-modal="true"
  aria-labelledby="choose-title"
  tabindex="-1"
  use:portal
  bind:this={root}
  style={pull ? `transform: translateY(${pull}px); transition: none` : ""}
>
  <div class="sky" aria-hidden="true" style="--travel: {travel}">
    <span class="stars a"></span>
    <span class="stars b"></span>
  </div>

  <header>
    <div
      class="grip"
      role="presentation"
      title={$t("choose.grip")}
      on:pointerdown={gripDown}
      on:pointermove={gripMove}
      on:pointerup={gripUp}
      on:pointercancel={gripUp}
    >
      <span></span>
    </div>
    <div class="bar">
      <button
        type="button"
        class="close"
        aria-label={$t("choose.close")}
        title={$t("choose.close")}
        on:click={close}
      >
        <Icon name="close" />
      </button>
      <h1 id="choose-title">{$t("choose.title")}</h1>
      <span class="count">
        {#if !ended}{$t("choose.count", {
            n: pos + 1,
            total: cards.length,
          })}{/if}
      </span>
    </div>
    {#if circle > 1}
      <p class="circle-n">
        <Icon name="orbit" />
        {$t("choose.circle", { n: circle })}
      </p>
    {/if}
  </header>

  <!-- The circle as a little constellation: one star per card, lit by the
       answer it got. A joined card flies into its own star. -->
  <ol class="constellation" class:gone={ended} aria-hidden="true">
    {#each cards as c, i (c.id)}
      <li
        data-star={i}
        class="star {answers[i] ?? ''}"
        class:now={i === pos && !ended}
      >
        {#if answers[i] === "up"}<Icon name="heart" />{:else}<Icon
            name={answers[i] === "right" ? "star" : "star-outline"}
          />{/if}
      </li>
    {/each}
  </ol>

  <div class="stage">
    <p class="sr-only" aria-live="polite">
      {#if top}{$t("choose.position", {
          n: pos + 1,
          total: cards.length,
          title: top.title,
        })}{/if}
    </p>
    <div class="slot" bind:this={slotEl}>
      {#if ended}
        {#key circle}
          <div class="end">
            <div class="end-glyph" aria-hidden="true">
              <Icon name="sparkles" />
            </div>
            {#if !snapshot.length}
              <h2>
                {$t(
                  $questsPulled
                    ? live.length || tasks.length
                      ? "swipe.allCaughtUp"
                      : "choose.empty"
                    : "tasks.loadingBacklog",
                )}
              </h2>
            {:else}
              <h2>{$t(more ? "choose.circleDone" : "swipe.allCaughtUp")}</h2>
              <p>{$t("swipe.roundSummary", { joins, likes })}</p>
            {/if}
            <div class="end-actions">
              {#if more}
                <button type="button" class="primary" on:click={deeper}>
                  <Icon name="orbit" />
                  {$t("choose.next", { n: more })}
                </button>
              {:else if tasks.length && $questsPulled}
                <button type="button" class="primary" on:click={startOver}>
                  <Icon name="repeat" />
                  {$t("swipe.startOver")}
                </button>
              {/if}
              <button type="button" class="ghost" on:click={close}>
                {$t("choose.back")}
              </button>
            </div>
          </div>
        {/key}
      {:else}
        {#each [...stack].reverse() as task, ri (task.id)}
          {@const i = stack.length - 1 - ri}
          <div
            class="card-pos"
            class:top={i === 0}
            class:dragging={i === 0 && dragging}
            class:deal={dealing}
            style="{cardStyle(i, topPose, strength)}; z-index:{10 -
              i}; animation-delay:{dealing ? i * 110 + 180 : 0}ms"
          >
            {#if i === 0}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="hit"
                bind:this={cardEl}
                role="button"
                tabindex="0"
                aria-keyshortcuts="ArrowRight ArrowUp ArrowLeft"
                aria-label={$t("choose.openCard", { title: task.title })}
                on:pointerdown={onDown}
                on:pointermove={onMove}
                on:pointerup={onUp}
                on:pointercancel={onCancel}
                on:click={onCardClick}
                on:keydown={onCardKey}
              >
                <div class="float" class:still={dragging}>
                  {@render face(task, true)}
                </div>
              </div>
            {:else}
              {@render face(task, false)}
              <span
                class="shade"
                style="opacity:{(i - (reduced ? 0 : strength)) * 0.22}"
              ></span>
            {/if}
          </div>
        {/each}
      {/if}
      {#each flying as f (f.key)}
        <div
          class="card-pos leaving {f.dir}"
          aria-hidden="true"
          use:throwCard={f}
        >
          {@render face(f.task, false, f.dir)}
        </div>
      {/each}
      {#if heartPop}
        <div class="heartpop" aria-hidden="true"><Icon name="heart" /></div>
      {/if}
    </div>
  </div>

  <div class="undo-row" aria-live="polite">
    {#if undoable}
      <div class="undo">
        {#key undoable}
          <i class="count-bar" aria-hidden="true"></i>
        {/key}
        <span>{$t(SAID[undoable.kind], { title: undoable.task.title })}</span>
        <button type="button" on:click={undo} disabled={busy}>
          <Icon name="undo" />
          {$t("choose.undo")}
        </button>
      </div>
    {:else if !ended && pos === 0 && circle === 1}
      <p class="hint">{$t("choose.hint")}</p>
    {/if}
  </div>

  {#if !ended}
    <div class="answers" role="group" aria-label={$t("choose.answers")}>
      <button
        type="button"
        class="ghost skip"
        class:armed={intent === "left"}
        style="--k:{stamp('left')}"
        disabled={!top}
        aria-label={$t("swipe.skipAria")}
        on:click={() => answer("left")}
      >
        <Icon name="arrow-left" />
        {$t("swipe.skipTitle")}
      </button>
      <button
        type="button"
        class="ghost like"
        class:armed={intent === "up"}
        style="--k:{stamp('up')}"
        disabled={!top}
        aria-label={$t("swipe.appreciateAria")}
        on:click={() => answer("up")}
      >
        <Icon name="heart" />
        {$t("choose.like")}
      </button>
      <button
        type="button"
        class="primary"
        class:armed={intent === "right"}
        style="--k:{stamp('right')}"
        disabled={!top}
        aria-label={$t("swipe.joinAria")}
        on:click={() => answer("right")}
      >
        <Icon name="check" />
        {$t("swipe.joinTitle")}
      </button>
    </div>
  {:else}
    <div class="answers-gap"></div>
  {/if}

  {#if celebrate}
    <Confetti originY={40} />
  {/if}
</div>

{#snippet face(task: BacklogTask, lit: boolean, left?: SwipeDirection)}
  <article
    class="card"
    class:lit
    class:is-foreign={!!task.sourceColor}
    class:holo={!!task.hologram}
    class:joined-out={left === "right"}
    style:--holo-seed={holoSeed(task.id)}
    style="background: {colorFor(task.category)}; --glow: {task.sourceColor ??
      'transparent'}; --gx:{gx * 100}%; --gy:{gy * 100}%"
  >
    {#if lit}
      <div class="stamp join" style="opacity: {stamp('right')}">
        {$t("swipe.join")}
      </div>
      <div class="stamp skip" style="opacity: {stamp('left')}">
        {$t("swipe.skip")}
      </div>
      <div class="stamp like" style="opacity: {stamp('up')}">
        <Icon name="heart" />
      </div>
    {/if}
    {#if participating(task)}
      <div class="ribbon" aria-label={$t("swipe.joinedRibbonAria")}>
        {$t("swipe.joined")}
        <Icon name="check" />
      </div>
    {/if}
    <h2>{task.title}</h2>
    {#if task.initiator}
      <div
        class="initiator"
        title={$t("tasks.proposedBy", { name: task.initiator.name })}
      >
        <span aria-hidden="true"><Icon name="bulb" /></span>
        <span class="iname">{task.initiator.name}</span>
      </div>
    {/if}
    {#if task.picture}
      <img
        class="thumb"
        src={pictureUrl(task.picture)}
        alt=""
        loading="lazy"
        draggable="false"
        on:error={hideImg}
      />
    {/if}
    {#if task.description}
      <p class="desc">{task.description}</p>
    {/if}
    <div class="meta">
      {#if lockedIds.has(String(task.id))}<span
          class="locked"
          title={$t("tasks.locked")}><Icon name="lock" /></span
        >{/if}
      {#if task.category}<span class="tag">{task.category}</span>{/if}
      {#if task.source}<button
          type="button"
          class="src"
          tabindex={lit ? 0 : -1}
          title={$t("source.open", { name: task.source })}
          on:pointerdown|stopPropagation
          on:click|stopPropagation={() =>
            jumpToSource(task.sourceId, task.source)}
          ><Icon name="swap" /> {task.source}</button
        >{/if}
      {#if dueLabel(task)}<span class="due"
          >{#if task.frequency}<Icon name="repeat" />
          {/if}{dueLabel(task)}</span
        >{/if}
    </div>
    <div class="cardfoot">
      <span class="heart" class:on={appreciating(task)}>
        <span class="glyph" aria-hidden="true"><Icon name="heart" /></span>
        {#if task.appreciation}
          <span class="count">{task.appreciation}</span>
        {/if}
      </span>
      {#if task.people.length}
        <Avatars people={task.people} size="1.6rem" />
      {/if}
    </div>
    {#if lit}
      <div class="glare" aria-hidden="true"></div>
    {/if}
  </article>
{/snippet}

<style>
  /* The deck's own sky, from the board's palette: a dawn wash over paper by
     day, the deep night by dark — the same space the dock floats in. */
  .choose {
    --sky-top: color-mix(in srgb, var(--teal) 16%, var(--paper-deep));
    --sky-low: var(--paper);
    --star: color-mix(in srgb, var(--teal) 55%, var(--ink));
    --gold: #e0a526;
    position: fixed;
    inset: 0;
    z-index: 45; /* over the board (10) and its header (40), under Modal (50) */
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
    background: linear-gradient(180deg, var(--sky-top), var(--sky-low));
    color: var(--ink);
    overflow: hidden;
    overscroll-behavior: contain;
    transition:
      transform 0.45s cubic-bezier(0.2, 0.7, 0.3, 1),
      border-radius 0.45s;
    outline: none;
  }
  :global(:root[data-theme="dark"]) .choose {
    --sky-top: color-mix(in srgb, var(--teal) 22%, #05080a);
    --sky-low: var(--paper-deep);
    --star: #f3efe2;
    --gold: #ffd36e;
  }
  /* A card opened in its sheet: the deck steps back, a part of the whole. */
  .choose.receded {
    transform: scale(0.94);
    border-radius: 26px;
  }

  .sky {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .stars {
    position: absolute;
    inset: -20%;
    opacity: 0.55;
    transform: scale(var(--travel, 1));
    transition: transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
    background-image:
      radial-gradient(1.5px 1.5px at 12% 18%, var(--star), transparent),
      radial-gradient(1px 1px at 32% 72%, var(--star), transparent),
      radial-gradient(1.5px 1.5px at 58% 34%, var(--star), transparent),
      radial-gradient(1px 1px at 76% 82%, var(--star), transparent),
      radial-gradient(2px 2px at 88% 26%, var(--star), transparent),
      radial-gradient(1px 1px at 46% 52%, var(--star), transparent),
      radial-gradient(1px 1px at 6% 62%, var(--star), transparent),
      radial-gradient(1.5px 1.5px at 66% 8%, var(--star), transparent);
    background-size: 340px 340px;
  }
  .stars.b {
    opacity: 0.35;
    background-size: 210px 210px;
    background-position: 60px 90px;
    transform: scale(calc(var(--travel, 1) * var(--travel, 1)));
    animation: twinkle 6s ease-in-out infinite alternate;
  }
  @keyframes twinkle {
    to {
      opacity: 0.15;
    }
  }

  header,
  .constellation,
  .stage,
  .undo-row,
  .answers,
  .answers-gap {
    position: relative;
    z-index: 1;
  }
  header {
    flex: none;
  }
  .grip {
    display: grid;
    place-items: center;
    height: 22px;
    touch-action: none;
    cursor: grab;
  }
  .grip span {
    width: 40px;
    height: 5px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.5rem 0.1rem;
  }
  .close {
    justify-self: start;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 1.25rem;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--card) 60%, transparent);
  }
  h1 {
    margin: 0;
    text-align: center;
    font-size: 1.1rem;
    font-weight: 750;
    white-space: nowrap;
  }
  .count {
    justify-self: end;
    padding-right: 0.5rem;
    white-space: nowrap;
    font-size: 0.82rem;
    font-weight: 650;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .circle-n {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.3rem;
    margin: 0;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--teal-ink);
  }

  .constellation {
    flex: none;
    display: flex;
    justify-content: center;
    gap: 0.9rem;
    margin: 0.4rem 0 0;
    padding: 0 1rem;
    list-style: none;
    transition: opacity 0.4s;
  }
  .constellation.gone {
    opacity: 0;
  }
  .star {
    display: grid;
    place-items: center;
    width: 1.3rem;
    height: 1.3rem;
    font-size: 1.05rem;
    color: color-mix(in srgb, var(--ink) 28%, transparent);
    transition:
      color 0.4s,
      transform 0.4s;
  }
  .star.now {
    color: var(--teal-ink);
    animation: star-breathe 2.2s ease-in-out infinite;
  }
  /* Joined: lights gold once its card has arrived. */
  .star.right {
    color: var(--gold);
    filter: drop-shadow(
      0 0 6px color-mix(in srgb, var(--gold) 70%, transparent)
    );
    transform: scale(1.2);
    transition-delay: 0.55s;
  }
  .star.up {
    color: var(--heart);
  }
  .star.left {
    color: color-mix(in srgb, var(--ink) 14%, transparent);
    transform: scale(0.75);
  }
  @keyframes star-breathe {
    50% {
      transform: scale(1.25);
    }
  }

  .stage {
    flex: 1;
    min-height: 0;
    padding: 2.4rem 1.1rem 0.8rem;
  }
  .slot {
    position: relative;
    width: 100%;
    max-width: 23rem;
    height: 100%;
    max-height: 35rem;
    margin: 0 auto;
    /* One lens for the stack: the cards share its vanishing point. */
    perspective: 1200px;
    perspective-origin: 50% 40%;
  }
  .card-pos {
    position: absolute;
    inset: 0;
    border-radius: 22px;
    transform-origin: 50% 60%;
    transition: transform 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.15);
  }
  .card-pos:not(.top) {
    pointer-events: none;
  }
  .card-pos.dragging {
    transition: none;
  }
  /* Dealt from deep in the sky, one after another. */
  .card-pos.deal {
    animation: deal 0.75s cubic-bezier(0.16, 1, 0.3, 1) backwards;
  }
  @keyframes deal {
    from {
      opacity: 0;
      transform: translate3d(0, -120px, -900px) rotateX(-50deg) rotateZ(-8deg);
    }
  }
  .card-pos.leaving {
    z-index: 30;
    pointer-events: none;
    transition: none;
  }
  .hit {
    position: absolute;
    inset: 0;
    border-radius: 22px;
    touch-action: none;
    cursor: grab;
  }
  .dragging .hit {
    cursor: grabbing;
  }
  .hit:focus-visible {
    outline: 3px solid var(--teal);
    outline-offset: 4px;
  }
  /* The top card breathes a little while it waits. */
  .float {
    width: 100%;
    height: 100%;
    animation: float 5.5s ease-in-out infinite;
  }
  .float.still {
    animation-play-state: paused;
  }
  @keyframes float {
    50% {
      transform: translateY(-6px);
    }
  }
  .shade {
    position: absolute;
    inset: 0;
    border-radius: 22px;
    background: var(--sky-top);
    pointer-events: none;
  }

  .card {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 1.6rem 1.4rem;
    text-align: center;
    border-radius: 8px 22px 22px 22px;
    box-shadow: 0 18px 44px rgba(10, 30, 28, 0.28);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Joining: the card burns gold on its way up to its star. */
  .card.joined-out {
    box-shadow:
      0 0 0 2px var(--gold),
      0 0 50px 8px color-mix(in srgb, var(--gold) 55%, transparent);
  }
  .glare {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(
      circle at var(--gx) var(--gy),
      rgba(255, 255, 255, 0.35),
      transparent 55%
    );
    mix-blend-mode: soft-light;
  }
  .card h2 {
    margin: 0;
    font-size: 1.5rem;
    line-height: 1.2;
    color: var(--ink);
  }
  .desc {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 6;
    line-clamp: 6;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .initiator {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .initiator .iname {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thumb {
    display: block;
    width: 100%;
    max-height: 40%;
    object-fit: cover;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.05);
    pointer-events: none;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }
  .meta .locked {
    display: inline-flex;
    align-items: center;
    color: var(--ink-soft);
  }
  .tag {
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .src {
    font-size: 0.74rem;
    font-weight: 700;
    color: color-mix(in srgb, var(--glow, var(--teal)) 30%, var(--ink));
    background: var(--glass);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .due {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--ink);
    background: var(--glass);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
  }
  .cardfoot {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .heart {
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    line-height: 1;
    color: var(--heart-quiet);
  }
  .heart .glyph {
    grid-area: 1 / 1;
    font-size: 1.9rem;
  }
  .heart .count {
    grid-area: 1 / 1;
    transform: translateY(0.1em);
    font-size: 0.66rem;
    font-weight: 800;
    color: var(--on-heart);
  }
  .heart.on {
    color: var(--heart);
  }
  .is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 16px 1px color-mix(in srgb, var(--glow) 55%, transparent),
      0 18px 44px rgba(10, 30, 28, 0.28);
  }

  /* Direction stamps: they strengthen with the drag toward their answer. */
  .stamp {
    position: absolute;
    top: 1.1rem;
    padding: 0.25rem 0.7rem;
    border: 3.5px solid currentColor;
    border-radius: 10px;
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    pointer-events: none;
    background: var(--glass);
    z-index: 3;
  }
  .stamp.join {
    left: 1rem;
    color: var(--teal-ink);
    transform: rotate(-14deg);
  }
  .stamp.skip {
    right: 1rem;
    color: var(--ink-soft);
    transform: rotate(14deg);
  }
  .stamp.like {
    top: auto;
    bottom: 4.2rem;
    left: 50%;
    color: var(--heart);
    transform: translateX(-50%) rotate(-6deg);
  }
  .ribbon {
    position: absolute;
    top: 1.4rem;
    right: -2.6rem;
    transform: rotate(35deg);
    background: var(--teal);
    color: var(--on-teal);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.25rem 3rem;
    box-shadow: var(--shadow-soft);
    z-index: 2;
  }

  .heartpop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 7rem;
    color: var(--heart);
    pointer-events: none;
    z-index: 40;
    animation: heartpop 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes heartpop {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    30% {
      transform: scale(1.15);
      opacity: 1;
    }
    100% {
      transform: scale(1.6) translateY(-60px);
      opacity: 0;
    }
  }

  /* The end of a circle. */
  .end {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    text-align: center;
    animation: rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.97);
    }
  }
  .end-glyph {
    font-size: 3rem;
    color: var(--gold);
    animation: star-breathe 2.6s ease-in-out infinite;
  }
  .end h2 {
    margin: 0;
    font-size: 1.5rem;
  }
  .end p {
    margin: 0 0 0.8rem;
    color: var(--muted);
  }
  .end-actions {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(100%, 16rem);
  }

  .undo-row {
    flex: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    align-items: center;
    min-height: 48px;
    padding: 0 1rem;
  }
  .hint {
    margin: 0;
    text-align: center;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .undo {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: min(100%, calc(100vw - 32px));
    min-width: 0;
    padding: 0.2rem 0.25rem 0.2rem 1rem;
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    font-size: 0.88rem;
  }
  /* The 5 s window, shrinking toward the end (matches the undo timer). */
  .count-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: var(--teal);
    transform-origin: left center;
    animation: undo-run 5s linear forwards;
  }
  @keyframes undo-run {
    to {
      transform: scaleX(0);
    }
  }
  .undo span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .undo button {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    color: inherit;
    background: color-mix(in srgb, var(--paper) 18%, transparent);
    font-weight: 650;
  }

  .answers {
    flex: none;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.5rem;
    width: 100%;
    max-width: 30rem;
    margin: 0 auto;
    padding: 0.35rem 1rem 1rem;
  }
  .answers-gap {
    flex: none;
    height: 1rem;
  }
  .answers button,
  .end-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 0;
    min-height: 54px;
    padding: 0.4rem 0.6rem;
    border-radius: 16px;
    font-weight: 700;
    font-size: 0.98rem;
    line-height: 1.15;
  }
  .answers button {
    transform: scale(calc(1 + var(--k, 0) * 0.06));
    transition: transform 0.15s ease-out;
  }
  .ghost {
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--ink-soft);
  }
  .ghost.armed {
    border-color: color-mix(in srgb, var(--ink) 40%, var(--line));
    color: var(--ink);
  }
  .like :global(svg) {
    color: var(--heart);
  }
  .like.armed {
    border-color: var(--heart);
  }
  .primary {
    background: var(--teal);
    color: var(--on-teal);
    box-shadow: 0 8px 22px -10px
      color-mix(in srgb, var(--teal) 80%, transparent);
  }
  .primary.armed {
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent),
      0 10px 28px -8px var(--teal);
  }
  button:disabled {
    opacity: 0.5;
  }
  .answers button:active:not(:disabled) {
    transform: scale(0.96);
  }
  @media (max-width: 360px) {
    .answers button :global(svg) {
      display: none;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .reduced .card-pos {
    transition: none;
    animation: none;
  }
  .reduced .float,
  .reduced .stars,
  .reduced .star,
  .reduced .end,
  .reduced .end-glyph {
    animation: none;
    transition: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .answers button {
      transform: none;
    }
    .count-bar {
      animation: none;
    }
  }
</style>
