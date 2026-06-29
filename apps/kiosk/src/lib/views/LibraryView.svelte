<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { get } from "svelte/store";
  import { things, openThing, holonId, showNotice } from "$lib/stores";
  import { telegramUser, loginOpen } from "$lib/auth";
  import { getLibraryDb } from "$lib/holosphere";
  import Modal from "$lib/components/Modal.svelte";
  import {
    addItem,
    getItemIcon,
    getTypeDisplayName,
    LIBRARY_TYPES,
    type LibraryItemType,
  } from "@holons/core/library";

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openThing(id);
    }
  }

  // ── Add an item ─────────────────────────────────────────────────────────────
  // Types offered in the picker; the icon/label come from core so the add sheet
  // and the cards always agree.
  const TYPE_OPTIONS: LibraryItemType[] = [
    LIBRARY_TYPES.TOOL,
    LIBRARY_TYPES.BOOK,
    LIBRARY_TYPES.EQUIPMENT,
    LIBRARY_TYPES.OTHER,
  ];

  let addOpen = false;
  let addName = "";
  let addType: LibraryItemType = LIBRARY_TYPES.OTHER;
  let addDesc = "";
  let adding = false;

  function openAdd() {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    addName = "";
    addType = LIBRARY_TYPES.OTHER;
    addDesc = "";
    addOpen = true;
  }

  async function addThing() {
    const user = get(telegramUser);
    const hid = get(holonId);
    if (!user) {
      loginOpen.set(true);
      return;
    }
    if (!hid) return;
    const name = addName.trim();
    if (!name) {
      addOpen = false;
      return;
    }
    adding = true;
    try {
      const db = await getLibraryDb();
      const res = await addItem(db, hid, name, {
        type: addType,
        description: addDesc.trim(),
        createdBy: user.id,
        createdByUsername: user.username ?? undefined,
      });
      if (res.ok) {
        addOpen = false;
        addName = "";
        addDesc = "";
      } else if (res.reason === "already_exists") {
        showNotice("Something with that name is already shared.");
      } else {
        showNotice("Could not add item.");
      }
    } catch (err) {
      console.error("[kiosk] add library item failed", err);
      showNotice("Could not add item.");
    } finally {
      adding = false;
    }
  }
</script>

<div class="board">
  <div class="lib scroll">
    <h2 class="title">Library of Things</h2>

    {#if $things.length}
      <div class="grid">
        {#each $things as thing (thing.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article
            class="card"
            class:out={!thing.available}
            class:is-foreign={!!thing.sourceColor}
            style="--glow: {thing.sourceColor ?? 'transparent'};"
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

  <button
    class="fab"
    on:click={openAdd}
    aria-label="Share an item"
    title="Share an item"
  >
    ＋
  </button>
</div>

{#if addOpen}
  <Modal on:close={() => (addOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">＋</div>
      <h3>Share an item</h3>
      <p class="lead">Something the community can borrow.</p>
      <input
        class="line"
        bind:value={addName}
        placeholder="What is it? (e.g. Cordless drill)"
        maxlength="60"
        on:keydown={(e) => e.key === "Enter" && addThing()}
      />
      <div class="types" role="radiogroup" aria-label="Item type">
        {#each TYPE_OPTIONS as t (t)}
          <button
            type="button"
            class="typechip"
            class:on={addType === t}
            role="radio"
            aria-checked={addType === t}
            on:click={() => (addType = t)}
          >
            <span class="ti">{getItemIcon({ type: t })}</span>
            <span class="tl">{getTypeDisplayName(t)}</span>
          </button>
        {/each}
      </div>
      <textarea
        bind:value={addDesc}
        rows="3"
        placeholder="Notes about it (optional)"
      ></textarea>
      <div class="actions">
        <button
          class="primary"
          on:click={addThing}
          disabled={adding || !addName.trim()}
          >{adding ? "Sharing…" : "Share item"}</button
        >
        <button class="ghost" on:click={() => (addOpen = false)}>Cancel</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .board {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
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
    /* Tinted with the source holon's own colour (same hue as its glow edge). */
    color: var(--glow, var(--teal-deep));
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

  /* Federated / hologram things — a coloured edge keyed by their source holon
     (see `sourceGlow` in lib/data.ts, supplied as `--glow`); the soft lift is
     kept so the card still sits off the board. */
  .card.is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 14px 1px color-mix(in srgb, var(--glow) 55%, transparent),
      var(--shadow-soft);
  }

  /* Share-item floating button (mirrors the Roles/Tasks add FAB). */
  .fab {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
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
    z-index: 6;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }
  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }

  /* Add dialog */
  .form {
    text-align: center;
    padding: 0.4rem 0.25rem;
  }
  .form .glyph {
    font-size: 1.8rem;
    color: var(--teal);
    font-weight: 800;
  }
  .form h3 {
    margin: 0.2rem 0 0.3rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  .form .lead {
    color: var(--muted);
    margin: 0 0 0.8rem;
    font-size: 0.9rem;
  }
  .form .line,
  .form textarea {
    width: 100%;
    padding: 0.8rem 0.9rem;
    font-size: 1rem;
    font-family: inherit;
    line-height: 1.5;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
  }
  .form .line {
    margin-bottom: 0.6rem;
  }
  .form textarea {
    resize: vertical;
  }
  .form .line:focus,
  .form textarea:focus {
    outline: none;
    border-color: var(--teal);
  }

  .types {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
    margin-bottom: 0.6rem;
  }
  .typechip {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.55rem 0.2rem;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
    transition:
      transform 0.1s ease,
      border-color 0.12s ease,
      background 0.12s ease;
  }
  .typechip .ti {
    font-size: 1.3rem;
    line-height: 1;
  }
  .typechip .tl {
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .typechip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 12%, var(--card));
  }
  .typechip.on .tl {
    color: var(--teal-deep);
  }
  .typechip:active {
    transform: scale(0.95);
  }

  .form .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .form .primary,
  .form .ghost {
    flex: 1;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .form .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .form .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .form .primary:active,
  .form .ghost:active {
    transform: scale(0.97);
  }
  .form .primary:disabled,
  .form .ghost:disabled {
    opacity: 0.6;
  }
</style>
