<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Swipe mode for the Tasks view: one big card at a time, Tinder-style.
  // Swipe right to JOIN (participate), up to LIKE (appreciate), left to SKIP.
  // Geometry/ordering is pure logic in lib/deck.ts; the writes come in through
  // TasksView's handlers (which route federated cards to their owner holon).
  // A swipe never *undoes* anything — already-joined/liked cards no-op through.
  import Avatars from "$lib/components/Avatars.svelte";
  import Confetti from "$lib/components/Confetti.svelte";
  import { telegramUser, loginOpen } from "$lib/auth";
  import { swipeDismissed, showNotice, taskViewMode, scope } from "$lib/stores";
  import { setScope, setTaskView } from "$lib/config";
  import { sameId } from "$lib/personal";
  import { resolveImage } from "$lib/image";
  import { hideImg } from "$lib/components/Avatars.svelte";
  import {
    badgeOpacity,
    cardTransform,
    deckTasks,
    swipeDecision,
    type SwipeDirection,
  } from "$lib/deck";
  import type { BacklogTask } from "$lib/data";

  export let tasks: BacklogTask[];
  export let colorFor: (category: string | undefined) => string;
  export let dueLabel: (t: BacklogTask) => string | null;
  export let onOpen: (id: string) => void;
  export let onJoin: (
    t: BacklogTask,
  ) => Promise<"joined" | "already" | "failed">;
  export let onLike: (
    t: BacklogTask,
  ) => Promise<"liked" | "already" | "failed">;
  /** Revert a committed swipe (the Undo chip) — toggles the write back off. */
  export let onRevert: (t: BacklogTask, kind: "join" | "like") => Promise<void>;

  $: uid = $telegramUser?.id;
  function participating(t: BacklogTask): boolean {
    return t.people.some((p) => sameId(p.id, uid));
  }
  function appreciating(t: BacklogTask): boolean {
    return t.appreciatedBy.some((id) => sameId(id, uid));
  }

  // ── Deck state ─────────────────────────────────────────────────────────────
  $: deck = deckTasks(tasks, $swipeDismissed);
  $: topTask = deck[0] ?? null;
  // Up to three cards render as a stack; the top one is interactive.
  $: stack = deck.slice(0, 3);

  let deckW = 0;
  $: threshold = Math.min(110, (deckW || 320) * 0.35);

  function dismiss(id: string) {
    swipeDismissed.update((s) => new Set(s).add(id));
  }
  function unDismiss(id: string) {
    swipeDismissed.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  // ── Drag ───────────────────────────────────────────────────────────────────
  let dragging = false;
  let dx = 0;
  let dy = 0;
  let startX = 0;
  let startY = 0;

  $: badges = badgeOpacity(dx, dy, threshold);

  function onPointerDown(e: PointerEvent) {
    if (leaving || !topTask) return;
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
  }
  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const tap = Math.hypot(dx, dy) < 6;
    const dir = swipeDecision(dx, dy, threshold);
    const id = topTask?.id;
    if (dir) {
      void commit(dir);
    } else {
      // Under the threshold the card springs back (CSS transition); a near-zero
      // move is a tap — zoom the card forward instead.
      dx = 0;
      dy = 0;
      if (tap && id) onOpen(id);
    }
  }
  function onPointerCancel() {
    dragging = false;
    dx = 0;
    dy = 0;
  }

  function onDeckKey(e: KeyboardEvent) {
    if (!topTask || leaving) return;
    if (e.key === "ArrowRight") void commit("right");
    else if (e.key === "ArrowLeft") void commit("left");
    else if (e.key === "ArrowUp") void commit("up");
    else if (e.key === "Enter" || e.key === " ") onOpen(topTask.id);
    else return;
    e.preventDefault();
  }

  // ── Commit ─────────────────────────────────────────────────────────────────
  // The card flying off screen after a committed swipe; `from` freezes the
  // drag offset it departs from so the fly-off continues the gesture.
  let leaving: { task: BacklogTask; dir: SwipeDirection; from: string } | null =
    null;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  let celebrate = false;
  let celebrateTimer: ReturnType<typeof setTimeout> | null = null;
  let heartPop = false;
  let heartTimer: ReturnType<typeof setTimeout> | null = null;

  let sessionJoins = 0;
  let sessionLikes = 0;

  let undo: { task: BacklogTask; kind: "skip" | "join" | "like" } | null = null;
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  function offerUndo(task: BacklogTask, kind: "skip" | "join" | "like") {
    if (undoTimer) clearTimeout(undoTimer);
    undo = { task, kind };
    undoTimer = setTimeout(() => (undo = null), 4000);
  }

  async function doUndo() {
    const u = undo;
    undo = null;
    if (undoTimer) clearTimeout(undoTimer);
    if (!u) return;
    unDismiss(u.task.id); // the card returns to the front of the deck
    if (u.kind === "join") {
      sessionJoins = Math.max(0, sessionJoins - 1);
      await onRevert(u.task, "join");
    } else if (u.kind === "like") {
      sessionLikes = Math.max(0, sessionLikes - 1);
      await onRevert(u.task, "like");
    }
  }

  function flyOff(task: BacklogTask, dir: SwipeDirection) {
    leaving = { task, dir, from: cardTransform(dx, dy) };
    dx = 0;
    dy = 0;
    if (leaveTimer) clearTimeout(leaveTimer);
    // animationend clears it; this is the safety net (and the reduced-motion path).
    leaveTimer = setTimeout(clearLeaving, 500);
  }
  function clearLeaving() {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = null;
    leaving = null;
  }

  function springBack(message?: string) {
    dx = 0;
    dy = 0;
    if (message) showNotice(message);
  }

  async function commit(dir: SwipeDirection) {
    const task = topTask;
    if (!task || leaving) return;
    // Joining and liking are writes — they need a logged-in user. Skipping is
    // local and always allowed.
    if (dir !== "left" && !$telegramUser) {
      springBack();
      loginOpen.set(true);
      return;
    }
    // Liking while participating would silently drop you from the doers (core's
    // participate-XOR-appreciate rule) — a swipe never un-does, so refuse it.
    if (dir === "up" && participating(task)) {
      springBack("You're participating — that outranks a like ♥");
      return;
    }

    flyOff(task, dir);
    dismiss(task.id); // optimistic — a failed write un-dismisses below

    if (dir === "left") {
      offerUndo(task, "skip");
    } else if (dir === "right") {
      if (participating(task)) {
        showNotice("Already in ✓");
      } else {
        const res = await onJoin(task);
        if (res === "joined") {
          sessionJoins += 1;
          party();
          offerUndo(task, "join");
        } else if (res === "already") {
          showNotice("Already in ✓");
        } else {
          unDismiss(task.id);
          showNotice("Couldn't join — try again.");
        }
      }
    } else {
      if (appreciating(task)) {
        showNotice("Already appreciated ♥");
      } else {
        const res = await onLike(task);
        if (res === "liked") {
          sessionLikes += 1;
          pop();
          offerUndo(task, "like");
        } else if (res === "already") {
          showNotice("Already appreciated ♥");
        } else {
          unDismiss(task.id);
          showNotice("Couldn't save that ♥ — try again.");
        }
      }
    }
  }

  function party() {
    if (celebrateTimer) clearTimeout(celebrateTimer);
    celebrate = true;
    celebrateTimer = setTimeout(() => (celebrate = false), 1300);
  }
  function pop() {
    if (heartTimer) clearTimeout(heartTimer);
    heartPop = true;
    heartTimer = setTimeout(() => (heartPop = false), 900);
  }

  function startOver() {
    swipeDismissed.set(new Set());
    sessionJoins = 0;
    sessionLikes = 0;
  }
  function backToWall() {
    taskViewMode.set("cards");
    setTaskView("cards");
  }
  // Post-triage landing: an explicit tap (unlike the old silent hop) that
  // flips the Show pill to Mine and the layout to the list, both persisted.
  function seeMine() {
    scope.set("personal");
    setScope("personal");
    taskViewMode.set("list");
    setTaskView("list");
  }
</script>

{#if tasks.length}
  <div class="stage">
    <!-- The deck is genuinely keyboard-operable (←/↑/→ commit, Enter opens) —
         that IS the no-gesture path, so the a11y heuristics are wrong here. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="deck"
      bind:clientWidth={deckW}
      role="group"
      aria-label="Task cards — swipe right to join, up to like, left to skip"
      tabindex="0"
      on:keydown={onDeckKey}
    >
      {#if leaving}
        <div class="slot leaving" style="--depth: 0;">
          <article
            class="card fly-{leaving.dir}"
            class:is-foreign={!!leaving.task.sourceColor}
            class:holo={!!leaving.task.hologram}
            style="--from: {leaving.from}; background: {colorFor(
              leaving.task.category,
            )}; --glow: {leaving.task.sourceColor ?? 'transparent'};"
            on:animationend={clearLeaving}
          >
            {#if leaving.dir === "right"}
              <div class="stamp join" style="opacity: 1;">JOIN</div>
            {:else if leaving.dir === "left"}
              <div class="stamp skip" style="opacity: 1;">SKIP</div>
            {:else}
              <div class="stamp like" style="opacity: 1;">♥ LIKE</div>
            {/if}
            <h3>{leaving.task.title}</h3>
          </article>
        </div>
      {/if}

      {#each stack as task, i (task.id)}
        <div
          class="slot"
          class:front={i === 0}
          style="--depth: {i}; z-index: {8 - i};"
        >
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <article
            class="card"
            class:top={i === 0}
            class:dragging={i === 0 && dragging}
            class:is-foreign={!!task.sourceColor}
            class:holo={!!task.hologram}
            style="background: {colorFor(
              task.category,
            )}; --glow: {task.sourceColor ?? 'transparent'}; {i === 0
              ? `transform: ${cardTransform(dx, dy)};`
              : ''}"
            on:pointerdown={onPointerDown}
            on:pointermove={onPointerMove}
            on:pointerup={onPointerUp}
            on:pointercancel={onPointerCancel}
          >
            {#if i === 0}
              <div class="stamp join" style="opacity: {badges.join};">JOIN</div>
              <div class="stamp skip" style="opacity: {badges.skip};">SKIP</div>
              <div class="stamp like" style="opacity: {badges.like};">
                ♥ LIKE
              </div>
            {/if}
            {#if participating(task)}
              <div class="ribbon" aria-label="You participate in this task">
                JOINED ✓
              </div>
            {/if}
            <h3>{task.title}</h3>
            {#if task.initiator}
              <div class="initiator" title="Proposed by {task.initiator.name}">
                <span aria-hidden="true">💡</span>
                <span class="iname">{task.initiator.name}</span>
              </div>
            {/if}
            {#if task.picture}
              <img
                class="thumb"
                src={resolveImage(task.picture)}
                alt=""
                loading="lazy"
                on:error={hideImg}
              />
            {/if}
            {#if task.description}
              <p class="desc">{task.description}</p>
            {/if}
            <div class="meta">
              {#if task.category}<span class="tag">{task.category}</span>{/if}
              {#if task.source}<span class="src">⇄ {task.source}</span>{/if}
              {#if dueLabel(task)}<span class="due">{dueLabel(task)}</span>{/if}
            </div>
            <div class="cardfoot">
              <span class="heart" class:on={appreciating(task)}>
                <span class="glyph" aria-hidden="true">♥</span>
                {#if task.appreciation}
                  <span class="count">{task.appreciation}</span>
                {/if}
              </span>
              {#if task.people.length}
                <Avatars people={task.people} size="1.6rem" />
              {/if}
            </div>
          </article>
        </div>
      {:else}
        <div class="alldone">
          <div class="star" aria-hidden="true">✶</div>
          <h3>All caught up</h3>
          <p>
            {sessionJoins} joined · {sessionLikes} liked this round
          </p>
          <div class="doneactions">
            <button class="primary" on:click={startOver}>Start over</button>
            {#if $telegramUser}
              <button class="primary" on:click={seeMine}>See my tasks</button>
            {/if}
            <button class="ghost" on:click={backToWall}>
              Back to post-its
            </button>
          </div>
        </div>
      {/each}

      {#if heartPop}
        <div class="heartpop" aria-hidden="true">♥</div>
      {/if}
    </div>

    {#if topTask}
      <div class="actions">
        <button
          class="act skip"
          on:click={() => commit("left")}
          aria-label="Skip this task"
          title="Skip"
        >
          ✕
        </button>
        <button
          class="act like"
          on:click={() => commit("up")}
          aria-label="Appreciate this task"
          title="Appreciate"
        >
          ♥
        </button>
        <button
          class="act join"
          on:click={() => commit("right")}
          aria-label="Join this task"
          title="Join"
        >
          🤝
        </button>
      </div>
      <p class="hint">swipe → join · ↑ like · ← skip</p>
    {/if}

    {#if undo}
      <button class="undo" on:click={doUndo}>
        ↺ Undo {undo.kind === "join"
          ? "join"
          : undo.kind === "like"
            ? "like"
            : "skip"}
      </button>
    {/if}
  </div>

  {#if celebrate}
    <Confetti originY={40} />
  {/if}
{:else}
  <p class="empty">The backlog is clear. ✶</p>
{/if}

<style>
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 0.5rem 1rem 1rem;
    position: relative;
  }
  .deck {
    position: relative;
    /* 100% of the stage's content box, so the view's own padding is respected
       on narrow screens (vw units would ignore it and overflow). */
    width: min(24rem, 100%);
    flex: 1;
    min-height: 14rem;
    max-height: 34rem;
    outline: none;
  }
  .deck:focus-visible {
    outline: 3px solid var(--teal);
    outline-offset: 6px;
    border-radius: 22px;
  }

  /* Stack position by depth; the drag transform lives on the card itself so
     the two compose. Back cards glide forward as the deck advances. */
  .slot {
    position: absolute;
    inset: 0;
    transform: scale(calc(1 - var(--depth) * 0.05))
      translateY(calc(var(--depth) * 14px));
    transition: transform 0.25s ease;
  }
  /* Only the front card takes the finger; the peeking edges behind don't. */
  .slot:not(.front) {
    pointer-events: none;
  }
  .slot.leaving {
    z-index: 20;
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
    box-shadow: 0 16px 40px rgba(28, 48, 46, 0.22);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .card.top {
    cursor: grab;
    touch-action: none;
    transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  .card.top.dragging {
    cursor: grabbing;
    transition: none;
  }

  .card h3 {
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
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }
  .tag {
    font-size: 0.76rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(32, 48, 47, 0.55);
  }
  .src {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--glow, var(--teal-deep));
    background: rgba(255, 255, 255, 0.7);
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
    background: rgba(255, 255, 255, 0.55);
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
    color: rgba(154, 59, 47, 0.55);
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
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  }
  .heart.on {
    color: #d4493a;
  }

  /* Foreign-holon glow, same treatment as the wall. */
  .is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 16px 1px color-mix(in srgb, var(--glow) 55%, transparent),
      0 16px 40px rgba(28, 48, 46, 0.22);
  }

  /* Direction stamps — rotated rubber-stamp badges that strengthen with the
     drag and lock at full opacity on the fly-off. */
  .stamp {
    position: absolute;
    top: 1.1rem;
    padding: 0.25rem 0.7rem;
    border: 3.5px solid currentColor;
    border-radius: 10px;
    font-size: 1.5rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    opacity: 0;
    pointer-events: none;
    background: rgba(255, 255, 255, 0.55);
    z-index: 3;
  }
  .stamp.join {
    left: 1rem;
    color: var(--teal-deep);
    transform: rotate(-14deg);
  }
  .stamp.skip {
    right: 1rem;
    color: #6d7b79;
    transform: rotate(14deg);
  }
  .stamp.like {
    top: auto;
    bottom: 4.2rem;
    left: 50%;
    color: #d4493a;
    transform: translateX(-50%) rotate(-6deg);
  }

  /* JOINED ribbon for tasks the user already participates in. */
  .ribbon {
    position: absolute;
    top: 1.4rem;
    right: -2.6rem;
    transform: rotate(35deg);
    background: var(--teal);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    padding: 0.25rem 3rem;
    box-shadow: var(--shadow-soft);
    z-index: 2;
  }

  /* Fly-offs continue the gesture from where the finger let go (--from). */
  .fly-right {
    animation: swipe-fly-right 0.35s cubic-bezier(0.3, 0.6, 0.6, 1) forwards;
  }
  .fly-left {
    animation: swipe-fly-left 0.35s cubic-bezier(0.3, 0.6, 0.6, 1) forwards;
  }
  .fly-up {
    animation: swipe-fly-up 0.35s cubic-bezier(0.3, 0.6, 0.6, 1) forwards;
  }
  @keyframes swipe-fly-right {
    from {
      transform: var(--from);
      opacity: 1;
    }
    to {
      transform: translate(120vw, -6vh) rotate(24deg);
      opacity: 0;
    }
  }
  @keyframes swipe-fly-left {
    from {
      transform: var(--from);
      opacity: 1;
    }
    to {
      transform: translate(-120vw, -6vh) rotate(-24deg);
      opacity: 0;
    }
  }
  @keyframes swipe-fly-up {
    from {
      transform: var(--from);
      opacity: 1;
    }
    to {
      transform: translate(0, -120vh) rotate(4deg);
      opacity: 0;
    }
  }

  /* A big heart that blooms out of the deck on a successful like. */
  .heartpop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 7rem;
    color: #d4493a;
    pointer-events: none;
    z-index: 30;
    animation: swipe-heartpop 0.9s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
  }
  @keyframes swipe-heartpop {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    30% {
      transform: scale(1.15);
      opacity: 1;
    }
    100% {
      transform: scale(1.6) translateY(-40px);
      opacity: 0;
    }
  }

  /* End of deck. */
  .alldone {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    text-align: center;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 22px;
    box-shadow: var(--shadow-soft);
    padding: 1.5rem;
  }
  .alldone .star {
    font-size: 3rem;
    color: var(--teal);
    animation: swipe-glow 2.4s ease-in-out infinite;
  }
  @keyframes swipe-glow {
    0%,
    100% {
      transform: scale(1);
      text-shadow: 0 0 0 transparent;
    }
    50% {
      transform: scale(1.12);
      text-shadow: 0 0 24px color-mix(in srgb, var(--teal) 65%, transparent);
    }
  }
  .alldone h3 {
    margin: 0;
    font-size: 1.5rem;
    color: var(--ink);
  }
  .alldone p {
    margin: 0 0 0.8rem;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .doneactions {
    display: flex;
    gap: 0.6rem;
  }
  .doneactions .primary,
  .doneactions .ghost {
    min-height: 48px;
    padding: 0 1.2rem;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .doneactions .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .doneactions .ghost {
    background: color-mix(in srgb, var(--line) 40%, transparent);
    color: var(--ink);
  }
  .doneactions .primary:active,
  .doneactions .ghost:active {
    transform: scale(0.96);
  }

  /* The no-gesture path: skip / like / join buttons under the deck. */
  .actions {
    display: flex;
    align-items: center;
    gap: 1.1rem;
  }
  .act {
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    background: var(--card);
    border: 1.5px solid var(--line);
    box-shadow: var(--shadow-soft);
    touch-action: manipulation;
    transition:
      transform 0.1s ease,
      background 0.15s ease,
      color 0.15s ease;
  }
  .act:active {
    transform: scale(0.9);
  }
  .act.skip {
    width: 3.4rem;
    height: 3.4rem;
    font-size: 1.4rem;
    color: #6d7b79;
  }
  .act.like {
    width: 3.4rem;
    height: 3.4rem;
    font-size: 1.5rem;
    color: #d4493a;
  }
  .act.join {
    width: 4.2rem;
    height: 4.2rem;
    font-size: 1.9rem;
    background: var(--teal);
    border-color: var(--teal);
    color: #fff;
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
  }
  .act.join:active {
    background: var(--teal-deep);
  }
  .hint {
    margin: -0.4rem 0 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }

  /* Phone widths: slimmer action buttons so the centred row clears the
     add-task FAB pinned to the board's bottom-right corner. */
  @media (max-width: 560px) {
    .actions {
      gap: 0.85rem;
    }
    .act.skip,
    .act.like {
      width: 3rem;
      height: 3rem;
      font-size: 1.25rem;
    }
    .act.join {
      width: 3.6rem;
      height: 3.6rem;
      font-size: 1.6rem;
    }
  }

  .undo {
    position: absolute;
    bottom: 0.4rem;
    left: 50%;
    transform: translateX(-50%);
    background: var(--ink);
    color: var(--paper, #fff);
    font-size: 0.85rem;
    font-weight: 700;
    padding: 0.45rem 1rem;
    border-radius: 999px;
    box-shadow: var(--shadow-soft);
    z-index: 40;
    animation: kiosk-rise 0.25s ease both;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .slot {
      transition: none;
    }
    .card.top {
      transition: none;
    }
    .fly-right,
    .fly-left,
    .fly-up {
      animation: swipe-fade 0.15s ease forwards;
    }
    @keyframes swipe-fade {
      to {
        opacity: 0;
      }
    }
    .heartpop {
      animation: swipe-fade 0.6s ease forwards;
      opacity: 1;
    }
    .alldone .star {
      animation: none;
    }
    .undo {
      animation: none;
    }
  }
</style>
