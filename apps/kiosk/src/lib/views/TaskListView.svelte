<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Compact list mode for the Tasks view: one row per backlog task, same data
  // and action handlers as the post-it wall (TasksView owns those — this
  // component only renders). Rows share the wall's drag-to-reorder machinery:
  // TasksView's pointer handlers key off the rows' data-task attributes, and
  // the resulting order persists as each quest's orderIndex.
  import { glide } from "$lib/glide";
  import Avatars, { hideImg } from "$lib/components/Avatars.svelte";
  import { resolveImage } from "$lib/image";
  import { telegramUser } from "$lib/auth";
  import { sameId } from "$lib/personal";
  import type { BacklogTask } from "$lib/data";
  import { holoSeed } from "$lib/data";
  import { t } from "$lib/i18n";

  export let tasks: BacklogTask[];
  export let colorFor: (category: string | undefined) => string;
  export let dueLabel: (t: BacklogTask) => string | null;
  /** Task ids mid-completion (fading out on the wall) — dim their rows too. */
  export let completing: Record<string, unknown> = {};
  export let onOpen: (id: string) => void;
  export let onComplete: (t: BacklogTask) => void;
  export let onDelete: (t: BacklogTask) => void;
  export let onToggleAppreciate: (t: BacklogTask) => void;
  /** The wall's shared drag-to-reorder entry point (long-press arms on touch). */
  export let onRowPointerDown: (e: PointerEvent, t: BacklogTask) => void;
  /** Id of the row currently lifted as a drag clone; it holds its gap. */
  export let dragId: string | null = null;

  $: uid = $telegramUser?.id;
  function amAppreciating(t: BacklogTask): boolean {
    return t.appreciatedBy.some((id) => sameId(id, uid));
  }
  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen(id);
    }
  }
</script>

{#if tasks.length}
  <ul class="rows">
    {#each tasks as task (task.id)}
      <li
        animate:glide={{ duration: 220 }}
        class:done={!!completing[task.id]}
        class:ghost={dragId === task.id}
        data-task={task.id}
      >
        <div
          class="row"
          class:is-foreign={!!task.sourceColor}
          class:holo={!!task.hologram}
          style:--holo-seed={holoSeed(task.id)}
          style="--dot: {colorFor(task.category)}; --glow: {task.sourceColor ??
            'transparent'};"
          role="button"
          tabindex="0"
          on:pointerdown={(e) => onRowPointerDown(e, task)}
          on:click={() => onOpen(task.id)}
          on:keydown={(e) => onKey(e, task.id)}
        >
          <span class="dot" aria-hidden="true"></span>
          {#if task.picture}
            <img
              class="row-thumb"
              src={resolveImage(task.picture)}
              alt=""
              loading="lazy"
              on:error={hideImg}
            />
          {/if}
          <div class="text">
            <h3>{task.title}</h3>
            <div class="meta">
              {#if task.category}<span class="tag">{task.category}</span>{/if}
              {#if task.source}<span class="src">⇄ {task.source}</span>{/if}
              {#if dueLabel(task)}<span class="due">{dueLabel(task)}</span>{/if}
              {#if task.unmetDeps > 0}<span
                  class="waits"
                  title={$t("tasks.waitsTitle", { n: task.unmetDeps })}
                  >⛓ {$t("tasks.waitsOn", { n: task.unmetDeps })}</span
                >{/if}
            </div>
          </div>
          <button
            class="heart"
            class:on={amAppreciating(task)}
            on:pointerdown|stopPropagation
            on:click|stopPropagation={() => onToggleAppreciate(task)}
            aria-label={$t("tasks.appreciate")}
            aria-pressed={amAppreciating(task)}
            title={$t("tasks.appreciate")}
          >
            <span class="glyph" aria-hidden="true">♥</span>
            {#if task.appreciation}
              <span class="count">{task.appreciation}</span>
            {/if}
          </button>
          {#if task.people.length}
            <span class="who"
              ><Avatars people={task.people} size="1.4rem" /></span
            >
          {/if}
          <button
            class="tool check"
            on:pointerdown|stopPropagation
            on:click|stopPropagation={() => onComplete(task)}
            aria-label={$t("tasks.markComplete")}
            title={$t("tasks.markComplete")}
          >
            ✓
          </button>
          <button
            class="tool del"
            on:pointerdown|stopPropagation
            on:click|stopPropagation={() => onDelete(task)}
            aria-label={$t("tasks.deleteTask")}
            title={$t("tasks.deleteTask")}
          >
            ✕
          </button>
        </div>
      </li>
    {/each}
  </ul>
{:else}
  <p class="empty">{$t("tasks.emptyBacklog")}</p>
{/if}

<style>
  .rows {
    list-style: none;
    margin: 0 auto;
    padding: 0;
    max-width: 52rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    animation: kiosk-rise 0.42s ease both;
  }
  li.done {
    pointer-events: none;
    opacity: 0.35;
    transition: opacity 0.4s ease;
  }
  li.ghost {
    visibility: hidden; /* holds the gap while its clone follows the finger */
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    cursor: grab;
    /* Vertical pan scrolls the list; a long-press arms drag-to-reorder. */
    touch-action: pan-y;
    /* No selection callout while the long-press hold arms a drag. */
    user-select: none;
    -webkit-user-select: none;
  }
  .row:active {
    filter: brightness(0.97);
  }
  .row.is-foreign {
    border-left: 4px solid var(--glow);
  }
  .dot {
    flex: 0 0 auto;
    width: 0.9rem;
    height: 0.9rem;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  }
  /* Same shape as the web dashboard's list rows: a small square between the
     category dot and the title. */
  .row-thumb {
    flex: 0 0 auto;
    width: 2rem;
    height: 2rem;
    border-radius: 6px;
    object-fit: cover;
    background: rgba(0, 0, 0, 0.08);
  }
  .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .text h3 {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.3;
    color: var(--ink);
    /* Wrap to two clamped lines rather than nowrap-ellipsis: a nowrap title's
       full width counts as min-content and propagates up the flex ancestors,
       overflowing a phone viewport; wrapped text only contributes its longest
       word. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.15rem;
  }
  .tag {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .src {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--glow, var(--teal-deep));
    background: color-mix(in srgb, var(--glow) 12%, transparent);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .due {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  /* Blocked by open dependencies — the row sorts after the current leaves. */
  .waits {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--muted);
    background: color-mix(in srgb, var(--line) 40%, transparent);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    white-space: nowrap;
  }
  .who {
    flex: 0 0 auto;
  }
  .heart {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    line-height: 1;
    color: rgba(154, 59, 47, 0.55);
    touch-action: manipulation;
    transition:
      transform 0.1s ease,
      color 0.15s ease;
  }
  .heart .glyph {
    grid-area: 1 / 1;
    font-size: 1.6rem;
  }
  .heart .count {
    grid-area: 1 / 1;
    transform: translateY(0.1em);
    font-size: 0.6rem;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  }
  .heart.on {
    color: #d4493a;
  }
  .heart:active {
    transform: scale(0.88);
  }
  .tool {
    flex: 0 0 auto;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1rem;
    font-weight: 800;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--line) 40%, transparent);
    touch-action: manipulation;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease;
  }
  .tool.check {
    color: var(--teal-deep);
  }
  .tool.check:active {
    transform: scale(0.88);
    background: var(--teal);
    color: #fff;
  }
  .tool.del {
    color: rgba(154, 59, 47, 0.75);
  }
  .tool.del:active {
    transform: scale(0.88);
    background: #d4493a;
    color: #fff;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  /* Phone widths: a slimmer row — heart + avatars only. The due chip and the
     complete/delete tools live in the detail card (tap the row); hiding them
     here keeps titles readable on a narrow screen. */
  @media (max-width: 560px) {
    .due,
    .tool.check,
    .tool.del {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .rows {
      animation: none;
    }
  }
</style>
