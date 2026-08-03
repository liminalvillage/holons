<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { glide } from "$lib/glide";
  import { get } from "svelte/store";
  import { onMount } from "svelte";
  import { autoScrollToEnd } from "$lib/autoscroll";
  import {
    backlog,
    now,
    openQuest,
    holonId,
    rawQuests,
    completionRequest,
    showNotice,
    categoryColors,
    taskViewMode,
    taskSort,
    scope,
  } from "$lib/stores";
  import { setTaskSort } from "$lib/config";
  import type { TaskSort } from "$lib/data";
  import { isLoggedIn, loginOpen, telegramUser } from "$lib/auth";
  import { getHolosphere, getWriter } from "$lib/holosphere";
  import { resolveImage } from "$lib/image";
  import { hideImg } from "$lib/components/Avatars.svelte";
  import { checkComplete, recordCompletion } from "$lib/complete";
  import {
    appreciateOnly,
    joinOnly,
    toggleAppreciate,
    toggleJoin,
  } from "$lib/membership";
  import {
    dueLabelFor,
    noteColor,
    noteTilt,
    noteRiseDelay,
    noteRiseRot,
    sourceRef,
    type BacklogTask,
  } from "$lib/data";
  import { personalTasks, sameId } from "$lib/personal";
  import {
    createTask,
    deleteTaskWithCascade,
    type Quest,
  } from "@holons/core/tasks";
  import Modal from "$lib/components/Modal.svelte";
  import Avatars from "$lib/components/Avatars.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";
  import TaskListView from "./TaskListView.svelte";
  import TaskSwipeView from "./TaskSwipeView.svelte";

  // Kiosk displays are unattended — glide the wall down to the last note once
  // so the whole backlog is shown without anyone dragging. (The scroll
  // container only exists in cards/list mode; the swipe deck doesn't scroll.)
  let scrollEl: HTMLElement | undefined;
  onMount(() => (scrollEl ? autoScrollToEnd(scrollEl) : undefined));

  // Layout and sort are chosen in the shell's global pills band (see
  // GlobalPills); this view only reads the stores. setSort stays for the
  // drag-to-reorder gesture, which flips the ordering to manual.
  function setSort(s: string) {
    taskSort.set(s as TaskSort);
    setTaskSort(s as TaskSort);
  }

  function openTask(id: string) {
    if (justDragged) return;
    openQuest(id, "task");
  }
  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openTask(id);
    }
  }

  // Does the logged-in user currently appreciate this task?
  $: appreciatorId = $telegramUser?.id;
  function amAppreciating(task: BacklogTask): boolean {
    return task.appreciatedBy.some((id) => sameId(id, appreciatorId));
  }

  // Appreciating is exclusive of participating (core's participate-XOR-appreciate
  // invariant), so turning it on while you're a participant silently drops you
  // from the doers — warn before that happens.
  function wouldDropParticipation(task: BacklogTask): boolean {
    return (
      !amAppreciating(task) &&
      task.people.some((p) => sameId(p.id, appreciatorId))
    );
  }

  // Notes whose staggered entrance (kiosk-rise) has finished. Reordering a
  // keyed {#each} MOVES the DOM node, and a moved node restarts its CSS
  // animations — without this flag every drag/live reshuffle replayed the
  // entrance from opacity 0 and cards blinked out for up to ~1s. Once risen,
  // the animation is removed (its end state is the note's natural state).
  let risen: Record<string, true> = {};
  function onNoteAnimEnd(e: AnimationEvent, id: string) {
    // Scoped keyframes keep the original name as a substring.
    if (e.animationName.includes("kiosk-rise") && !risen[id]) {
      risen = { ...risen, [id]: true };
    }
  }

  // The task whose appreciation needs confirming because it'd remove the user
  // as a participant; null when no prompt is pending.
  let confirmDrop: BacklogTask | null = null;

  // Heart tap: toggle the logged-in user's appreciation of the task. If that
  // would remove them as a participant, confirm first; otherwise just do it.
  async function toggleAppr(task: BacklogTask) {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) {
      loginOpen.set(true);
      return;
    }
    if (wouldDropParticipation(task)) {
      confirmDrop = task;
      return;
    }
    await doAppreciate(task);
  }

  async function doAppreciate(task: BacklogTask) {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) return;
    try {
      // A federated card's appreciation belongs to its owner holon (same
      // routing as delete below) — writing locally would fork a stray copy.
      const q = get(rawQuests).find((x) => String(x.id ?? x.title) === task.id);
      await toggleAppreciate(
        hid,
        task.id,
        user,
        q ? sourceRef(q, task.id) : undefined,
      );
    } catch (err) {
      console.error("[kiosk] appreciate failed", err);
    }
  }

  function confirmAppreciate() {
    const task = confirmDrop;
    confirmDrop = null;
    if (task) void doAppreciate(task);
  }

  function dueLabel(t: BacklogTask): string | null {
    return dueLabelFor(t.due, $now);
  }

  // ── Drag-to-reorder ───────────────────────────────────────────────────────-
  // iPhone-style: a lifted clone follows the finger while the other cards part
  // to make room (Svelte's FLIP animates them). `order` is the live display
  // order; it syncs from the backlog except mid-drag, and is persisted back as
  // each quest's `orderIndex` on drop.
  let order: string[] = [];
  $: byId = new Map($backlog.map((t) => [t.id, t] as const));
  // Shared category→colour map (see stores) so a category looks the same here
  // and in the calendar; blank categories fall back to the hash (`noteColor`).
  const noteColorFor = (category: string | undefined): string =>
    (category ? $categoryColors.get(category) : undefined) ??
    noteColor(category);
  // Depends only on $backlog (syncOrder reads `order`/`drag` but isn't tracked),
  // so reassigning `order` inside can't re-trigger this statement.
  $: syncOrder($backlog);
  $: orderedTasks = order
    .map((id) => byId.get(id))
    .filter((t): t is BacklogTask => t != null);
  // The personal slice: same order as the wall/list, narrowed to the user.
  $: mine = personalTasks(orderedTasks, $telegramUser?.id);
  // What every layout renders, after the Show pill's scope. (all/networked
  // differ upstream in the derived stores; here they're both "everything".)
  $: shownTasks = $scope === "personal" ? mine : orderedTasks;

  // Until the user drags this session, follow the backlog's order (which
  // `toBacklog` sorts by the persisted `orderIndex`) — so a reload shows the
  // saved arrangement. Once they reorder, preserve the local order so live data
  // updates don't reshuffle the board under them.
  let touched = false;

  function syncOrder(tasks: BacklogTask[]) {
    if (drag) return; // never reshuffle mid-drag
    const have = new Set(tasks.map((t) => t.id));
    // Drop completion state for quests that have left the backlog.
    for (const id of Object.keys(completing)) {
      if (!have.has(id)) uncomplete(id);
    }
    const next = touched ? reconcile(order, tasks) : tasks.map((t) => t.id); // adopt the persisted order on load
    if (next.length !== order.length || next.some((id, i) => id !== order[i])) {
      order = next;
    }
  }

  function reconcile(prev: string[], tasks: BacklogTask[]): string[] {
    const ids = tasks.map((t) => t.id);
    const have = new Set(ids);
    const kept = prev.filter((id) => have.has(id));
    const keptSet = new Set(kept);
    const added = ids.filter((id) => !keptSet.has(id)); // new tasks → append
    return [...kept, ...added];
  }

  let drag: {
    id: string;
    task: BacklogTask;
    w: number;
    x: number;
    y: number;
    grabX: number;
    grabY: number;
  } | null = null;
  let justDragged = false;
  // How long a displaced card's glide lasts (animate:glide duration plus a
  // frame of slack) — the swap-cooldown window in onMove.
  const FLIP_SETTLE_MS = 260;
  // The card that triggered the last mid-drag reorder and when — see the
  // swap-cooldown note in onMove.
  let lastSwap: { id: string; t: number } | null = null;
  let pendingId: string | null = null;
  let pendingRect: DOMRect | null = null;
  let armed = false; // drag allowed (immediately for mouse, after long-press for touch)
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let grabX = 0;
  let grabY = 0;

  // Pointer events can't stop the browser's pan once `touch-action: pan-y`
  // hands it the gesture — it just fires pointercancel and the drag dies. A
  // NON-PASSIVE touchmove listener can: swallowing the first move after the
  // long-press has armed keeps the browser from ever starting the scroll.
  // Without this, vertical reorders (the only direction list rows move) are
  // stolen by the pan on every touch device.
  function onTouchMove(e: TouchEvent) {
    if (armed || drag) e.preventDefault();
  }

  function clearPending() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    pendingId = null;
    pendingRect = null;
    lastSwap = null;
    armed = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("touchmove", onTouchMove);
  }

  function onPointerDown(e: PointerEvent, task: BacklogTask) {
    if (e.button != null && e.button !== 0) return;
    // No drag-to-reorder under the Mine scope: it's a filtered subset, so a
    // reorder there would scramble the full wall's persisted orderIndex.
    if (get(scope) === "personal") return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>(
      "[data-task]",
    );
    if (!el) return;
    pendingId = task.id;
    pendingRect = el.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    grabX = e.clientX - pendingRect.left;
    grabY = e.clientY - pendingRect.top;
    // Mouse: drag on move. Touch: long-press to arm, so a quick swipe scrolls.
    armed = e.pointerType === "mouse";
    if (!armed) holdTimer = setTimeout(() => (armed = true), 280);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  function onMove(e: PointerEvent) {
    if (!drag) {
      if (pendingId == null) return;
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
      // Not yet armed (touch, before the long-press): a real move means the
      // user is scrolling the wall — let the browser take it.
      if (!armed) {
        if (moved > 10) clearPending();
        return;
      }
      if (moved < 6) return;
      const task = byId.get(pendingId);
      if (!task || !pendingRect) return;
      drag = {
        id: pendingId,
        task,
        w: pendingRect.width,
        x: e.clientX - grabX,
        y: e.clientY - grabY,
        grabX,
        grabY,
      };
    }
    e.preventDefault();
    drag = { ...drag, x: e.clientX - drag.grabX, y: e.clientY - drag.grabY };

    // The card under the finger (the clone has pointer-events: none) is the drop
    // target — move the dragged id to its slot and let FLIP animate the rest.
    const el = document.elementFromPoint(
      e.clientX,
      e.clientY,
    ) as HTMLElement | null;
    const overId = el?.closest<HTMLElement>("[data-task]")?.dataset.task;
    if (overId && overId !== drag.id) {
      // Swap cooldown. elementFromPoint hits cards at their VISUAL, mid-FLIP
      // positions: right after a swap, the displaced card flies back across
      // the pointer's path and re-triggers the swap the other way — an
      // oscillation that reads as jitter, while each interrupted flip
      // re-measures rects mid-transform and deforms the next one. So a re-hit
      // of the SAME partner is ignored until its flip has settled; a card
      // resting under the pointer after that is a genuine target, and
      // crossing onto a different card is always instant.
      const settling =
        lastSwap?.id === overId &&
        performance.now() - lastSwap.t < FLIP_SETTLE_MS;
      if (!settling) {
        const from = order.indexOf(drag.id);
        const to = order.indexOf(overId);
        if (from !== -1 && to !== -1 && from !== to) {
          const next = order.slice();
          next.splice(from, 1);
          next.splice(to, 0, drag.id);
          order = next;
          lastSwap = { id: overId, t: performance.now() };
        }
      }
    }
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    window.removeEventListener("touchmove", onTouchMove);
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    armed = false;
    const moved = drag != null;
    drag = null;
    lastSwap = null;
    pendingId = null;
    pendingRect = null;
    if (moved) {
      touched = true; // keep the local order; don't let live updates reshuffle
      justDragged = true; // swallow the click that follows pointerup
      setTimeout(() => (justDragged = false), 0);
      // A hand-arranged wall IS the manual order — flip the Sort pill so the
      // arrangement is what renders (and survives the reload).
      setSort("manual");
      void persistOrder();
    }
  }

  async function persistOrder() {
    const hid = get(holonId);
    if (!hid) return;
    if (!get(isLoggedIn)) {
      loginOpen.set(true);
      return;
    }
    const quests = get(rawQuests);
    // Surface denied writes on screen — a wall display has no console, so a
    // silent failure reads as "the app is broken" with no way to tell why.
    const writer = await getWriter(hid, (msg) =>
      showNotice(`Couldn't save the new order — ${msg}`),
    );
    try {
      for (let i = 0; i < order.length; i++) {
        const q = quests.find((x) => String(x.id ?? x.title) === order[i]);
        if (!q || Number(q.orderIndex) === i) continue; // only write what changed
        // A federated/hologram card lives in its owner's graph — writing it
        // into THIS holon's quests would fork a stray local copy (same rule as
        // delete/appreciate above). Its dragged position stays view-local.
        if ((q as any)._federation || (q as any)._holon) continue;
        const clean: Record<string, unknown> = { ...q };
        delete clean._holon;
        if (!(await writer.put("quests", { ...clean, orderIndex: i }))) return;
      }
    } catch (err) {
      console.error("[kiosk] reorder failed", err);
      showNotice(
        `Couldn't save the new order — ${err instanceof Error ? err.message : "write failed"}`,
      );
    }
  }

  // ── Completion: confetti + a falling post-it, with proper REA accounting ───-
  type Confetti = {
    x: number;
    rot: number;
    delay: number;
    dur: number;
    hue: number;
    size: number;
  };
  // ids currently playing the completion animation → their confetti pieces.
  let completing: Record<string, Confetti[]> = {};

  function makeConfetti(n = 20): Confetti[] {
    return Array.from({ length: n }, () => ({
      x: (Math.random() * 2 - 1) * 130,
      rot: (Math.random() * 2 - 1) * 600,
      delay: Math.random() * 90,
      dur: 650 + Math.random() * 500,
      hue: Math.floor(Math.random() * 360),
      size: 6 + Math.random() * 7,
    }));
  }

  function uncomplete(id: string) {
    const { [id]: _gone, ...rest } = completing;
    completing = rest;
  }

  function onComplete(task: BacklogTask) {
    if (completing[task.id]) return;
    const user = get(telegramUser);
    if (!user) {
      loginOpen.set(true);
      return;
    }
    const q = get(rawQuests).find((x) => String(x.id ?? x.title) === task.id);
    if (!q) return;
    // Permission + status check up front, so we only prompt for real completions.
    const result = checkComplete(q, user.id);
    if (!result.ok) {
      showNotice(
        result.reason === "already-completed"
          ? "Already completed."
          : result.reason === "stopped"
            ? "This quest was stopped."
            : "Join the task first — only a participant can complete it.",
      );
      return;
    }
    // Confirm participants (for REA) before recording — see CompleteConfirm.
    completionRequest.set({
      task: result.task,
      onConfirm: (adjusted) => startCompletion(task.id, adjusted),
    });
  }

  function startCompletion(id: string, adjusted: Quest) {
    // Burst + drop now; record REA after the animation. The card stays mounted
    // (still in the backlog) until the write lands and the quest drops out.
    completing = { ...completing, [id]: makeConfetti() };
    setTimeout(async () => {
      let saved = false;
      try {
        const hid = get(holonId);
        if (hid) saved = (await recordCompletion(hid, adjusted)).ok;
      } catch (err) {
        console.error("[kiosk] completion failed", err);
      }
      // On failure, bring the card back; on success leave it faded until the
      // completed quest leaves the backlog (pruned in syncOrder).
      if (!saved) uncomplete(id);
    }, 700);
  }

  // ── Delete ──────────────────────────────────────────────────────────────-─
  // The task awaiting delete confirmation; null when no prompt is pending.
  let confirmDelete: BacklogTask | null = null;
  let deleting = false;

  function onDelete(task: BacklogTask) {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    confirmDelete = task;
  }

  async function doDelete() {
    const task = confirmDelete;
    const hid = get(holonId);
    if (!task || !hid) return;
    deleting = true;
    try {
      // A federated/hologram card lives in its owner's graph — delete the
      // source there (cascading over its forwards); deleting the local pointer
      // would only orphan it. Own items delete in place.
      const q = get(rawQuests).find((x) => String(x.id ?? x.title) === task.id);
      const ref = q ? sourceRef(q, task.id) : undefined;
      const hs = await getHolosphere();
      const result = await deleteTaskWithCascade(
        hs as any,
        ref?.holon ?? hid,
        ref?.key ?? task.id,
      );
      if (!result.sourceDeleted) {
        showNotice("Couldn't delete — you may not have permission.");
      }
    } catch (err) {
      console.error("[kiosk] delete failed", err);
      showNotice("Couldn't delete this task.");
    } finally {
      deleting = false;
      confirmDelete = null;
    }
  }

  // ── Swipe-deck actions ─────────────────────────────────────────────────────
  // One-way join/like for TaskSwipeView (a swipe never un-does), routed to a
  // federated card's owner holon like delete above. The view stays
  // holosphere-free; it only sees these handlers.
  function swipeRef(taskId: string) {
    const q = get(rawQuests).find((x) => String(x.id ?? x.title) === taskId);
    return q ? sourceRef(q, taskId) : undefined;
  }

  async function onSwipeJoin(
    task: BacklogTask,
  ): Promise<"joined" | "already" | "failed"> {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) return "failed";
    return joinOnly(hid, task.id, user, swipeRef(task.id));
  }

  async function onSwipeLike(
    task: BacklogTask,
  ): Promise<"liked" | "already" | "failed"> {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) return "failed";
    return appreciateOnly(hid, task.id, user, swipeRef(task.id));
  }

  // Undo chip: the full toggles revert what the swipe just wrote.
  async function onSwipeRevert(
    task: BacklogTask,
    kind: "join" | "like",
  ): Promise<void> {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) return;
    try {
      if (kind === "join") {
        await toggleJoin(hid, task.id, user, swipeRef(task.id));
      } else {
        await toggleAppreciate(hid, task.id, user, swipeRef(task.id));
      }
    } catch (err) {
      console.error("[kiosk] swipe undo failed", err);
    }
  }

  // ── Add task(s) — one per line ────────────────────────────────────────────-
  let addOpen = false;
  let addDraft = "";
  let adding = false;

  function newId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function openAdd() {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    addDraft = "";
    addOpen = true;
  }

  async function addTasks() {
    const hid = get(holonId);
    const user = get(telegramUser);
    if (!hid || !user) {
      loginOpen.set(true);
      return;
    }
    const titles = addDraft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!titles.length) {
      addOpen = false;
      return;
    }
    adding = true;
    const initiator = {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
    };
    try {
      // Route denials to the on-screen notice — a silent false return here
      // looked like "add does nothing" on unattended displays.
      const writer = await getWriter(hid, (msg) =>
        showNotice(`Couldn't add — ${msg}`),
      );
      let allSaved = true;
      for (const title of titles) {
        const task = createTask({ holonId: hid, initiator, title });
        task.id = newId();
        if (!(await writer.put("quests", task))) allSaved = false;
      }
      if (allSaved) {
        addOpen = false;
        addDraft = "";
      }
    } catch (err) {
      console.error("[kiosk] add task failed", err);
      showNotice(
        `Couldn't add — ${err instanceof Error ? err.message : "write failed"}`,
      );
    } finally {
      adding = false;
    }
  }
</script>

<div class="board">
  {#if $scope === "personal" && !$telegramUser}
    <div class="tasks scroll">
      <p class="empty">Log in to see the tasks you're part of ✶</p>
    </div>
  {:else if $taskViewMode === "swipe"}
    <div class="deckwrap">
      <TaskSwipeView
        tasks={shownTasks}
        colorFor={noteColorFor}
        {dueLabel}
        onOpen={openTask}
        onJoin={onSwipeJoin}
        onLike={onSwipeLike}
        onRevert={onSwipeRevert}
      />
    </div>
  {:else}
    <div class="tasks scroll" bind:this={scrollEl}>
      {#if $scope === "personal" && !shownTasks.length}
        <p class="empty">
          Nothing with your name on it yet — join a task to see it here ✶
        </p>
      {:else if $taskViewMode === "list"}
        <TaskListView
          tasks={shownTasks}
          colorFor={noteColorFor}
          {dueLabel}
          {completing}
          onOpen={openTask}
          {onComplete}
          {onDelete}
          onToggleAppreciate={toggleAppr}
          onRowPointerDown={onPointerDown}
          dragId={drag?.id ?? null}
        />
      {:else if shownTasks.length}
        <div class="wall">
          {#each shownTasks as task (task.id)}
            <div
              class="note-wrap"
              class:ghost={drag?.id === task.id}
              class:done={completing[task.id]}
              data-task={task.id}
              animate:glide={{ duration: 220 }}
            >
              <span class="lift">
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <article
                  class="note tilt"
                  class:risen={!!risen[task.id]}
                  class:is-foreign={!!task.sourceColor}
                  class:holo={!!task.hologram}
                  style="--tilt: {noteTilt(
                    task.id,
                  )}deg; --rise-delay: {noteRiseDelay(
                    task.id,
                  )}s; --rise-rot: {noteRiseRot(
                    task.id,
                  )}deg; background: {noteColorFor(
                    task.category,
                  )}; --glow: {task.sourceColor ?? 'transparent'};"
                  role="button"
                  tabindex="0"
                  on:pointerdown={(e) => onPointerDown(e, task)}
                  on:click={() => openTask(task.id)}
                  on:keydown={(e) => onKey(e, task.id)}
                  on:animationend={(e) => onNoteAnimEnd(e, task.id)}
                >
                  <div class="tools left">
                    <button
                      class="tool del"
                      on:pointerdown|stopPropagation
                      on:click|stopPropagation={() => onDelete(task)}
                      aria-label="Delete task"
                      title="Delete task"
                    >
                      ✕
                    </button>
                  </div>
                  <div class="tools">
                    <button
                      class="tool check"
                      on:pointerdown|stopPropagation
                      on:click|stopPropagation={() => onComplete(task)}
                      aria-label="Mark complete"
                      title="Mark complete"
                    >
                      ✓
                    </button>
                  </div>
                  <h3>{task.title}</h3>
                  {#if task.initiator}
                    <div
                      class="initiator"
                      title="Proposed by {task.initiator.name}"
                    >
                      <span class="bulb" aria-hidden="true">💡</span>
                      <Avatars people={[task.initiator]} size="1.3rem" />
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
                  <div class="meta">
                    {#if task.category}<span class="tag">{task.category}</span
                      >{/if}
                    {#if task.source}<span class="src">⇄ {task.source}</span
                      >{/if}
                    {#if dueLabel(task)}<span class="due">{dueLabel(task)}</span
                      >{/if}
                    {#if task.unmetDeps > 0}<span
                        class="waits"
                        title="{task.unmetDeps} open {task.unmetDeps === 1
                          ? 'dependency'
                          : 'dependencies'} first"
                        >⛓ waits on {task.unmetDeps}</span
                      >{/if}
                  </div>
                  <div class="cardfoot">
                    <button
                      class="heart"
                      class:on={amAppreciating(task)}
                      on:pointerdown|stopPropagation
                      on:click|stopPropagation={() => toggleAppr(task)}
                      aria-label="Appreciate"
                      aria-pressed={amAppreciating(task)}
                      title="Appreciate"
                    >
                      <span class="glyph" aria-hidden="true">♥</span>
                      {#if task.appreciation}
                        <span class="count">{task.appreciation}</span>
                      {/if}
                    </button>
                    {#if task.people.length}
                      <Avatars people={task.people} />
                    {/if}
                  </div>
                </article>
              </span>
              {#if completing[task.id]}
                <div class="confetti" aria-hidden="true">
                  {#each completing[task.id] as c, i (i)}
                    <span
                      style="--x: {c.x}px; --rot: {c.rot}deg; --delay: {c.delay}ms; --dur: {c.dur}ms; --hue: {c.hue}; --size: {c.size}px;"
                    ></span>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="empty">The backlog is clear. ✶</p>
      {/if}
    </div>
  {/if}

  <div class="fabrow">
    <VoiceButtons />
    <button
      class="fab"
      on:click={openAdd}
      aria-label="Add task"
      title="Add task"
    >
      ＋
    </button>
  </div>
</div>

{#if confirmDrop}
  <Modal on:close={() => (confirmDrop = null)}>
    <div class="add">
      <div class="glyph heart-glyph" aria-hidden="true">♥</div>
      <h3>Appreciate instead?</h3>
      <p class="lead">
        You're a participant on “{confirmDrop.title}”. Appreciating it removes
        you from the participants.
      </p>
      <div class="actions">
        <button class="primary" on:click={confirmAppreciate}>Appreciate</button>
        <button class="ghost" on:click={() => (confirmDrop = null)}
          >Cancel</button
        >
      </div>
    </div>
  </Modal>
{/if}

{#if confirmDelete}
  <Modal on:close={() => (confirmDelete = null)}>
    <div class="add">
      <div class="glyph del-glyph" aria-hidden="true">✕</div>
      <h3>Delete task?</h3>
      <p class="lead">
        “{confirmDelete.title}” will be removed for everyone.
      </p>
      <div class="actions">
        <button class="primary danger" on:click={doDelete} disabled={deleting}
          >{deleting ? "Deleting…" : "Delete"}</button
        >
        <button class="ghost" on:click={() => (confirmDelete = null)}
          >Cancel</button
        >
      </div>
    </div>
  </Modal>
{/if}

{#if addOpen}
  <Modal on:close={() => (addOpen = false)}>
    <div class="add">
      <div class="glyph" aria-hidden="true">＋</div>
      <h3>Add tasks</h3>
      <p class="lead">One task per line.</p>
      <textarea
        bind:value={addDraft}
        rows="6"
        placeholder={"Water the plants\nFix the gate\nPlan the potluck"}
      ></textarea>
      <div class="actions">
        <button class="primary" on:click={addTasks} disabled={adding}
          >{adding ? "Adding…" : "Add"}</button
        >
        <button class="ghost" on:click={() => (addOpen = false)}>Cancel</button>
      </div>
    </div>
  </Modal>
{/if}

{#if drag}
  <div
    class="drag-clone"
    style="left: {drag.x}px; top: {drag.y}px; width: {drag.w}px;"
    aria-hidden="true"
  >
    {#if $taskViewMode === "list"}
      <div
        class="rowclone"
        class:is-foreign={!!drag.task.sourceColor}
        class:holo={!!drag.task.hologram}
        style="--dot: {noteColorFor(drag.task.category)}; --glow: {drag.task
          .sourceColor ?? 'transparent'};"
      >
        <span class="rowdot"></span>
        <span class="rowtitle">{drag.task.title}</span>
        <span class="rowside">
          {#if drag.task.appreciation}
            <span class="rowheart" aria-hidden="true"
              >♥ {drag.task.appreciation}</span
            >
          {/if}
          {#if drag.task.people.length}
            <Avatars people={drag.task.people} size="1.4rem" />
          {/if}
        </span>
      </div>
    {:else}
      <article
        class="note"
        class:is-foreign={!!drag.task.sourceColor}
        class:holo={!!drag.task.hologram}
        style="background: {noteColorFor(drag.task.category)}; --glow: {drag
          .task.sourceColor ?? 'transparent'};"
      >
        <h3>{drag.task.title}</h3>
        <div class="meta">
          {#if drag.task.category}<span class="tag">{drag.task.category}</span
            >{/if}
          {#if drag.task.source}<span class="src">⇄ {drag.task.source}</span
            >{/if}
          {#if dueLabel(drag.task)}<span class="due">{dueLabel(drag.task)}</span
            >{/if}
          {#if drag.task.unmetDeps > 0}<span class="waits"
              >⛓ waits on {drag.task.unmetDeps}</span
            >{/if}
        </div>
        <div class="cardfoot">
          <span
            class="heart"
            class:on={amAppreciating(drag.task)}
            aria-hidden="true"
          >
            <span class="glyph">♥</span>
            {#if drag.task.appreciation}
              <span class="count">{drag.task.appreciation}</span>
            {/if}
          </span>
          {#if drag.task.people.length}
            <Avatars people={drag.task.people} />
          {/if}
        </div>
      </article>
    {/if}
  </div>
{/if}

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .tasks {
    flex: 1;
    min-height: 0;
    padding: 0.5rem 1.4rem 1.6rem;
  }

  .deckwrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Phone widths: tighter gutters so the wall/list/deck get the room. */
  @media (max-width: 560px) {
    .tasks {
      padding: 0.3rem 0.7rem 1.2rem;
    }
  }

  /* Add-task floating button — pinned to the corner of the board. */
  /* One control cluster, bottom-right: [⌨] [🎤] [＋] (voice buttons appear
     only while a voice server is reachable). */
  .fabrow {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    z-index: 6;
  }
  .fab {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    font-size: 2rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
    display: grid;
    place-items: center;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }
  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }

  /* Responsive grid of post-its that reflow to fit the width and animate (FLIP)
     into place as they're rearranged. `auto-fill` + `minmax(min(100%, …), 1fr)`
     means: as many ~13rem columns as fit, each stretching to share the row — and
     when only one column fits (narrow screens) that card spans the full width.
     `min(100%, …)` keeps it from overflowing on ultra-narrow viewports. Using
     auto-fill (not auto-fit) keeps a lone card column-sized on wide screens
     instead of ballooning to the whole row. */
  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 10.5rem), 1fr));
    align-content: start;
    gap: 0.7rem;
  }
  .note-wrap {
    position: relative;
    min-width: 0; /* let the grid track shrink the card on narrow screens */
  }
  .note-wrap.ghost {
    visibility: hidden; /* holds the gap while its clone follows the finger */
  }
  .note-wrap.done {
    pointer-events: none;
  }
  .lift {
    display: block;
    filter: drop-shadow(1.5px 7px 8px rgba(28, 48, 46, 0.16));
  }
  .note {
    position: relative;
    display: block;
    padding: 0.75rem 0.8rem 0.85rem;
    text-align: center;
    border-radius: 4px 14px 14px 14px;
    /* Staggered entrance — each card rises in on its OWN delay (--rise-delay,
       hash-derived per card) so they arrive independently at different times
       rather than all at once, while rotating from --rise-rot into the resting
       tilt as they land. Two one-shot animations on separate properties
       (translate/opacity vs the individual `rotate`) so they compose with the
       post-it's `transform: rotate(--tilt)` and the FLIP reorder. */
    animation:
      kiosk-rise 0.42s ease var(--rise-delay, 0s) both,
      kiosk-rise-spin 0.42s cubic-bezier(0.2, 0.7, 0.3, 1) var(--rise-delay, 0s)
        both;
    cursor: grab;
    /* Allow vertical scroll of the wall; a long-press arms drag-to-reorder. */
    touch-action: pan-y;
  }
  /* Registered so the per-card value resolves INSIDE the keyframe below.
     An unregistered custom property used in @keyframes is ignored (every card
     falls back to one fixed angle → they'd all spin the same way). */
  @property --rise-rot {
    syntax: "<angle>";
    inherits: false;
    initial-value: 0deg;
  }
  @keyframes kiosk-rise-spin {
    from {
      rotate: var(--rise-rot, 0deg);
    }
    to {
      rotate: 0deg;
    }
  }
  /* Entrance done: drop the animation entirely so a DOM move (keyed reorder
     during drag or a live reshuffle) can't restart it — a restarted `both`
     fill parks the card at opacity 0 for its whole stagger delay. Must stay
     ABOVE the `.note-wrap.done .note` rule so the completion drop still wins
     by source order. */
  .note.risen {
    animation: none;
  }
  .note:active {
    filter: brightness(0.97);
  }
  .note h3 {
    margin: 0;
    /* Symmetric clearance so the centred title never tucks under the corner
       complete button (top-right). */
    padding: 0 1.7rem;
    font-size: 0.98rem;
    line-height: 1.25;
    color: var(--ink);
  }

  /* Initiator chip — who proposed the idea: a lightbulb, their avatar, name. */
  .initiator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    margin-top: 0.4rem;
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .initiator .bulb {
    font-size: 0.85rem;
    line-height: 1;
  }
  .initiator .iname {
    max-width: 7rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note .thumb {
    display: block;
    width: 100%;
    max-height: 130px;
    object-fit: cover;
    border-radius: 8px;
    margin: 0.55rem 0 0.1rem;
    background: rgba(0, 0, 0, 0.05);
  }

  /* Edit (pen) + complete (tick) buttons, tucked in the top-right corner. */
  .tools {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    gap: 0.3rem;
  }
  .tool {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 0.9rem;
    font-weight: 800;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.65);
    box-shadow: var(--shadow-soft);
    touch-action: manipulation;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease;
  }
  .tools.left {
    right: auto;
    left: 0.5rem;
  }
  .tool.check {
    color: var(--teal-deep);
  }
  .tool:active {
    transform: scale(0.88);
    background: var(--teal);
    color: #fff;
  }
  .tool.del {
    color: rgba(154, 59, 47, 0.75);
  }
  .tool.del:active {
    background: #d4493a;
    color: #fff;
  }

  /* Completion: the post-it drops away while confetti bursts from it. */
  .note-wrap.done .note {
    animation: kiosk-drop 0.7s cubic-bezier(0.45, 0, 0.7, 1) forwards;
  }
  @keyframes kiosk-drop {
    0% {
      transform: rotate(var(--tilt, 0deg)) translateY(0) scale(1);
      opacity: 1;
    }
    18% {
      transform: rotate(var(--tilt, 0deg)) translateY(-10px) scale(1.05);
      opacity: 1;
    }
    100% {
      transform: rotate(calc(var(--tilt, 0deg) + 10deg)) translateY(220px)
        scale(0.85);
      opacity: 0;
    }
  }
  .confetti {
    position: absolute;
    left: 50%;
    top: 28%;
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 5;
  }
  .confetti span {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--size);
    height: var(--size);
    background: hsl(var(--hue) 85% 60%);
    border-radius: 2px;
    opacity: 0;
    animation: kiosk-confetti var(--dur) cubic-bezier(0.2, 0.7, 0.3, 1)
      var(--delay) forwards;
  }
  @keyframes kiosk-confetti {
    0% {
      transform: translate(0, 0) rotate(0);
      opacity: 1;
    }
    100% {
      transform: translate(var(--x), 160px) rotate(var(--rot));
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .note {
      animation: kiosk-rise 0.4s ease both;
    }
    .note-wrap.done .note {
      animation: none;
      opacity: 0;
    }
    .confetti {
      display: none;
    }
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  .tag {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(32, 48, 47, 0.55);
  }
  .src {
    font-size: 0.7rem;
    font-weight: 700;
    /* Tinted with the source holon's own colour (same hue as its glow edge). */
    color: var(--glow, var(--teal-deep));
    background: rgba(255, 255, 255, 0.7);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .due {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
  }
  /* Blocked by open dependencies — the card sorts after the current leaves. */
  .waits {
    font-size: 0.72rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.6);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    white-space: nowrap;
  }
  /* Footer row: appreciation heart on the left, participant avatars on the
     right — each on its own side, matching sizes. */
  .cardfoot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    margin-top: 0.55rem;
  }

  /* Appreciation heart — same footprint as an avatar (1.7rem), with the count
     nested inside it. Tap toggles your own appreciation. */
  .note .heart {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    line-height: 1;
    /* Muted by default; brightens when you've appreciated (see .on). */
    color: rgba(154, 59, 47, 0.55);
    touch-action: manipulation;
    transition:
      transform 0.1s ease,
      color 0.15s ease;
  }
  .note .heart .glyph {
    grid-area: 1 / 1;
    font-size: 1.7rem;
  }
  .note .heart .count {
    grid-area: 1 / 1;
    /* Sit the number inside the heart's body, nudged below its centre. */
    transform: translateY(0.1em);
    font-size: 0.62rem;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  }
  .note .heart.on {
    color: #d4493a;
  }
  .note .heart:active {
    transform: scale(0.88);
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  /* The lifted card that tracks the finger. */
  .drag-clone {
    position: fixed;
    z-index: 60;
    pointer-events: none;
  }
  .drag-clone .note {
    animation: none;
    transform: scale(1.04) rotate(-1.5deg);
    box-shadow: 0 18px 36px rgba(28, 48, 46, 0.28);
  }

  /* List mode's lifted clone: a slim row, not a post-it. */
  .rowclone {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    transform: scale(1.02);
    box-shadow: 0 18px 36px rgba(28, 48, 46, 0.28);
  }
  .rowclone.is-foreign {
    border-left: 4px solid var(--glow);
  }
  .rowclone .rowdot {
    flex: 0 0 auto;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: var(--dot);
  }
  .rowclone .rowtitle {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
    font-size: 0.98rem;
    color: var(--ink);
  }
  .rowclone .rowside {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .rowclone .rowheart {
    font-size: 0.85rem;
    font-weight: 800;
    color: #d4493a;
  }

  /* Add-task dialog */
  .add {
    text-align: center;
    padding: 0.4rem 0.25rem;
  }
  .add .glyph {
    font-size: 1.8rem;
    color: var(--teal);
    font-weight: 800;
  }
  .add .glyph.heart-glyph {
    color: #d4493a;
    font-size: 2.2rem;
  }
  .add .glyph.del-glyph {
    color: #d4493a;
  }
  .add h3 {
    margin: 0.2rem 0 0.3rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  .add .lead {
    color: var(--muted);
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
  }
  .add textarea {
    width: 100%;
    padding: 0.8rem 0.9rem;
    font-size: 1rem;
    font-family: inherit;
    line-height: 1.5;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    resize: vertical;
  }
  .add textarea:focus {
    outline: none;
    border-color: var(--teal);
  }
  .add .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .add .primary,
  .add .ghost {
    flex: 1;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .add .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .add .primary.danger {
    background: #d4493a;
  }
  .add .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .add .primary:active,
  .add .ghost:active {
    transform: scale(0.97);
  }
  .add .primary:disabled {
    opacity: 0.6;
  }

  /* Federated / hologram items — a coloured edge keyed by their source holon
     (see `sourceGlow` in lib/data.ts, supplied as `--glow`) marks them as
     coming from elsewhere. */
  .is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 16px 1px color-mix(in srgb, var(--glow) 55%, transparent);
  }
</style>
