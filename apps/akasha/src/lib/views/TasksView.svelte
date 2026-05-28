<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { backlog, now, openQuest } from "$lib/stores";
  import { noteColor, noteTilt, type BacklogTask } from "$lib/data";

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openQuest(id, "task");
    }
  }

  function dueLabel(t: BacklogTask): string | null {
    if (!t.due) return null;
    const today = new Date($now);
    today.setHours(0, 0, 0, 0);
    const due = new Date(t.due);
    due.setHours(0, 0, 0, 0);
    const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "yesterday";
    if (days < 0) return `${-days}d ago`;
    if (days < 7) return `in ${days}d`;
    return t.due.toLocaleDateString([], { day: "numeric", month: "short" });
  }
</script>

<div class="tasks scroll">
  <h2 class="title">Backlog</h2>

  {#if $backlog.length}
    <div class="wall">
      {#each $backlog as task (task.id)}
        <span class="lift note-wrap">
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article
            class="note tilt"
            style="--tilt: {noteTilt(task.id)}deg; background: {noteColor(
              task.category,
            )};"
            role="button"
            tabindex="0"
            on:click={() => openQuest(task.id, "task")}
            on:keydown={(e) => onKey(e, task.id)}
          >
            <h3>{task.title}</h3>
            <div class="meta">
              {#if task.category}<span class="tag">{task.category}</span>{/if}
              {#if dueLabel(task)}<span class="due">{dueLabel(task)}</span>{/if}
              {#if task.participants > 0}
                <span class="people">●&thinsp;{task.participants}</span>
              {/if}
            </div>
          </article>
        </span>
      {/each}
    </div>
  {:else}
    <p class="empty">The backlog is clear. ✶</p>
  {/if}
</div>

<style>
  .tasks {
    flex: 1;
    min-height: 0;
    padding: 1.3rem 1.4rem 1.6rem;
  }
  .title {
    margin: 0 0 1.1rem;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--ink);
    text-align: center;
  }

  /* CSS masonry-ish: balanced columns of post-its. */
  .wall {
    columns: 2;
    column-gap: 0.9rem;
  }
  @media (min-width: 560px) {
    .wall {
      columns: 3;
    }
  }
  .note-wrap {
    break-inside: avoid;
    display: inline-block;
    width: 100%;
    margin: 0 0 0.9rem;
  }
  .note {
    display: block;
    padding: 0.95rem 1rem 1.05rem;
    border-radius: 4px 14px 14px 14px;
    animation: akasha-rise 0.4s ease both;
    cursor: pointer;
  }
  .note:active {
    filter: brightness(0.97);
  }
  .note h3 {
    margin: 0;
    font-size: 1.1rem;
    line-height: 1.25;
    color: var(--ink);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.65rem;
  }
  .tag {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(32, 48, 47, 0.55);
  }
  .due {
    font-size: 0.74rem;
    font-weight: 700;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
  }
  .people {
    margin-left: auto;
    font-size: 0.74rem;
    color: rgba(32, 48, 47, 0.6);
    font-weight: 700;
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }
</style>
