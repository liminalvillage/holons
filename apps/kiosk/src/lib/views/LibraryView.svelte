<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { things, openThing } from "$lib/stores";
  import { getItemIcon, getTypeDisplayName } from "@holons/core/library";

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openThing(id);
    }
  }
</script>

<div class="lib scroll">
  <h2 class="title">Library of Things</h2>

  {#if $things.length}
    <div class="grid">
      {#each $things as thing (thing.id)}
        <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
        <article
          class="card"
          class:out={!thing.available}
          role="button"
          tabindex="0"
          on:click={() => openThing(thing.id)}
          on:keydown={(e) => onKey(e, thing.id)}
        >
          <div class="icon">{getItemIcon({ type: thing.type })}</div>
          <h3>{thing.title}</h3>
          <span class="type">{getTypeDisplayName(thing.type)}</span>
          {#if thing.source}<span class="src">⇄ {thing.source}</span>{/if}
          <span class="status" class:available={thing.available}>
            {thing.available
              ? "available"
              : thing.borrower
                ? `out · ${thing.borrower}`
                : "out"}
          </span>
        </article>
      {/each}
    </div>
  {:else}
    <p class="empty">No things shared yet.</p>
  {/if}
</div>

<style>
  .lib {
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
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.9rem;
  }
  @media (min-width: 560px) {
    .grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  .card {
    background: var(--paper);
    border-radius: var(--radius);
    padding: 1.1rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.35rem;
    box-shadow: var(--shadow-soft);
    animation: kiosk-rise 0.4s ease both;
    cursor: pointer;
  }
  .card:active {
    transform: scale(0.98);
  }
  .card.out {
    opacity: 0.66;
  }
  .icon {
    font-size: 2.1rem;
    line-height: 1;
  }
  .card h3 {
    margin: 0.2rem 0 0;
    font-size: 1.02rem;
    line-height: 1.2;
    color: var(--ink);
    word-break: break-word;
  }
  .type {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 700;
  }
  .src {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--teal-deep);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    margin-top: 0.3rem;
    font-size: 0.76rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: var(--note-coral);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
  }
  .status.available {
    background: var(--note-mint);
    color: var(--teal-deep);
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }
</style>
