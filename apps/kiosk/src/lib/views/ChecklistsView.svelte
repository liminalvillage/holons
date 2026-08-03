<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Lists tab — the holon's shared checklists (agenda, shopping, ad-hoc
  // lists), mirroring the harvest dashboard's Checklists feature. Core owns
  // every mutation (@holons/core/checklists); this view only renders cards and
  // an open-list panel. Writes on a federated list are routed to its owner
  // holon via `sourceRef` so ticking a partner's list never forks a local copy.
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    checklistCards,
    rawChecklists,
    holonId,
    showNotice,
    scope,
    rotationHold,
    pillsSuppressed,
  } from "$lib/stores";
  import { telegramUser, loginOpen } from "$lib/auth";
  import { getChecklistStore } from "$lib/holosphere";
  import { personalChecklists } from "$lib/personal";
  import { sourceRef } from "$lib/data";
  import Modal from "$lib/components/Modal.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";
  import {
    CHECKLIST_TYPES,
    appendItems,
    clearChecklist,
    createChecklist,
    deleteChecklist,
    parseItemsText,
    removeItemAt,
    toggleItem,
    type Checklist,
  } from "@holons/core/checklists";

  $: shownLists =
    $scope === "personal"
      ? personalChecklists($checklistCards, $telegramUser?.id)
      : $checklistCards;

  // ── Open list ─────────────────────────────────────────────────────────────
  // The tapped list "opens" in place of the grid (like the dashboard). The
  // panel renders the RAW record looked up live, so remote ticks stream in.
  let openId: string | null = null;
  $: openRaw = openId
    ? ($rawChecklists.find((c) => String(c.id) === openId) ?? null)
    : null;
  $: openCard = openId
    ? ($checklistCards.find((c) => c.id === openId) ?? null)
    : null;
  $: openItems = Array.isArray(openRaw?.items) ? openRaw.items : [];
  $: openDone = openItems.filter((i) => i?.checked).length;

  // Suspend auto-rotation while a list is open so the screen can't flip away
  // from under whoever is ticking it (same pattern as the Status breakdown).
  // The shell's pills band hides too — the Show filter is meaningless while
  // a single list fills the board.
  $: rotationHold.set(openId != null);
  $: pillsSuppressed.set(openId != null);

  function openList(id: string) {
    openId = id;
    confirmDelete = false;
    addItemText = "";
  }
  function closeList() {
    openId = null;
  }

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openList(id);
    }
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  // Every mutation goes through core over the identity-aware store; a list
  // mirrored from a partner holon is written where it actually lives.
  function requireUser(): boolean {
    if (get(telegramUser)) return true;
    loginOpen.set(true);
    return false;
  }

  /** Where a write on this list must land: `{holon, key}` of the owner. */
  function writeRef(raw: Checklist | null, id: string) {
    const hid = get(holonId);
    if (!hid) return null;
    return sourceRef(raw, id) ?? { holon: hid, key: id };
  }

  let busy = false;

  async function mutate(fn: () => Promise<void>, failMsg: string) {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error("[kiosk] checklist write failed", err);
      showNotice(failMsg);
    } finally {
      busy = false;
    }
  }

  function toggle(index: number) {
    if (!requireUser() || !openRaw || !openId) return;
    const ref = writeRef(openRaw, openId);
    if (!ref) return;
    void mutate(async () => {
      const store = await getChecklistStore();
      await toggleItem(store, ref.holon, ref.key, index);
    }, "Could not update the list.");
  }

  function removeItem(index: number) {
    if (!requireUser() || !openRaw || !openId) return;
    const ref = writeRef(openRaw, openId);
    if (!ref) return;
    void mutate(async () => {
      const store = await getChecklistStore();
      await removeItemAt(store, ref.holon, ref.key, index);
    }, "Could not remove the item.");
  }

  let addItemText = "";
  function addItem() {
    const text = addItemText.trim();
    if (!text || !requireUser() || !openRaw || !openId) return;
    const ref = writeRef(openRaw, openId);
    if (!ref) return;
    void mutate(async () => {
      const store = await getChecklistStore();
      await appendItems(store, ref.holon, ref.key, [{ text, checked: false }]);
      addItemText = "";
    }, "Could not add the item.");
  }

  function clearDone() {
    if (!requireUser() || !openRaw || !openId) return;
    const ref = writeRef(openRaw, openId);
    if (!ref) return;
    void mutate(async () => {
      const store = await getChecklistStore();
      const res = await clearChecklist(store, ref.holon, ref.key);
      if (!res.ok && res.reason === "nothing_to_remove") {
        showNotice("Nothing ticked yet.");
      }
    }, "Could not clear the list.");
  }

  // Deleting is a two-tap confirm — the first tap arms the button.
  let confirmDelete = false;
  function removeList() {
    if (!requireUser() || !openId) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    const ref = writeRef(openRaw, openId);
    if (!ref) return;
    void mutate(async () => {
      const store = await getChecklistStore();
      const res = await deleteChecklist(store, ref.holon, ref.key);
      if (!res.ok) {
        showNotice("The agenda and shopping lists can't be deleted.");
        return;
      }
      openId = null;
    }, "Could not delete the list.");
  }

  // ── Create a list ─────────────────────────────────────────────────────────
  let addOpen = false;
  let addName = "";
  let addItems = "";
  let adding = false;

  function openAdd() {
    if (!requireUser()) return;
    addName = "";
    addItems = "";
    addOpen = true;
  }

  async function addList() {
    const user = get(telegramUser);
    const hid = get(holonId);
    if (!user || !hid) return;
    const name = addName.trim();
    if (!name) {
      addOpen = false;
      return;
    }
    adding = true;
    try {
      const store = await getChecklistStore();
      const res = await createChecklist(store, hid, name, {
        creator: user.id,
        type: CHECKLIST_TYPES.CHECKLIST,
      });
      if (!res.ok) {
        showNotice(
          res.reason === "exists"
            ? "A list with that name already exists."
            : "List names can't contain underscores.",
        );
        return;
      }
      const first = parseItemsText(addItems);
      if (first.length) await appendItems(store, hid, name, first);
      addOpen = false;
      openList(name);
    } catch (err) {
      console.error("[kiosk] create checklist failed", err);
      showNotice("Could not create the list.");
    } finally {
      adding = false;
    }
  }

  onMount(() => {
    return () => {
      // Release the holds if we unmount with a list still open.
      rotationHold.set(false);
      pillsSuppressed.set(false);
    };
  });
</script>

<div class="board">
  <div class="lists scroll">
    {#if openId}
      <!-- One open list: items with big tap-to-tick rows. -->
      <div class="panel">
        <header class="panelhead">
          <button class="back" on:click={closeList} aria-label="Back to lists">
            ‹
          </button>
          <span class="picon" aria-hidden="true">{openCard?.icon ?? "📋"}</span>
          <div class="ptext">
            <h2>{openCard?.title ?? openId}</h2>
            <span class="count">
              {openDone}/{openItems.length} done
              {#if openCard?.source}· ⇄ {openCard.source}{/if}
            </span>
          </div>
          <button
            class="tool"
            on:click={clearDone}
            disabled={!openItems.length}
            title="Clear ticked items"
          >
            ↺ Clear
          </button>
          {#if openCard && !openCard.special}
            <button
              class="tool danger"
              class:armed={confirmDelete}
              on:click={removeList}
              on:blur={() => (confirmDelete = false)}
              title="Delete this list"
            >
              {confirmDelete ? "Tap to confirm" : "🗑"}
            </button>
          {/if}
        </header>

        {#if openRaw == null}
          <p class="empty">This list is gone.</p>
        {:else if !openItems.length}
          <p class="empty">Nothing on this list yet — add the first item ↓</p>
        {:else}
          <ul class="items">
            {#each openItems as item, index (index)}
              <li>
                <div
                  class="item"
                  class:done={item.checked}
                  role="checkbox"
                  aria-checked={item.checked}
                  tabindex="0"
                  on:click={() => toggle(index)}
                  on:keydown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    (e.preventDefault(), toggle(index))}
                >
                  <span class="tick" aria-hidden="true">
                    {item.checked ? "✓" : ""}
                  </span>
                  <span class="itext">{item.text}</span>
                  <button
                    class="x"
                    on:click|stopPropagation={() => removeItem(index)}
                    aria-label="Remove {item.text}"
                  >
                    ✕
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <form class="addrow" on:submit|preventDefault={addItem}>
          <input
            bind:value={addItemText}
            placeholder="Add an item…"
            maxlength="120"
            aria-label="New item"
          />
          <button type="submit" disabled={!addItemText.trim()}>＋</button>
        </form>
      </div>
    {:else if $scope === "personal" && !$telegramUser}
      <p class="empty">Log in to see your lists ✶</p>
    {:else if shownLists.length}
      <!-- The grid of list cards. -->
      <div class="grid">
        {#each shownLists as list (list.id)}
          <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
          <article
            class="card"
            class:is-foreign={!!list.sourceColor}
            class:holo={!!list.hologram}
            style="--glow: {list.sourceColor ?? 'transparent'};"
            role="button"
            tabindex="0"
            on:click={() => openList(list.id)}
            on:keydown={(e) => onKey(e, list.id)}
          >
            <div class="icon">{list.icon}</div>
            <h3>{list.title}</h3>
            {#if list.source}<span class="src">⇄ {list.source}</span>{/if}
            <span
              class="status"
              class:cleared={list.total > 0 && list.done === list.total}
            >
              {list.total ? `${list.done}/${list.total} done` : "empty"}
            </span>
          </article>
        {/each}
      </div>
    {:else}
      <p class="empty">No lists yet — start one with ＋</p>
    {/if}
  </div>

  {#if !openId}
    <div class="fabrow">
      <VoiceButtons />
      <button
        class="fab"
        on:click={openAdd}
        aria-label="Start a list"
        title="Start a list"
      >
        ＋
      </button>
    </div>
  {/if}
</div>

{#if addOpen}
  <Modal on:close={() => (addOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">☑</div>
      <h3>Start a list</h3>
      <p class="lead">A shared checklist anyone here can tick off.</p>
      <input
        class="line"
        bind:value={addName}
        placeholder="Name (e.g. cleaning day)"
        maxlength="60"
        on:keydown={(e) => e.key === "Enter" && addList()}
      />
      <textarea
        bind:value={addItems}
        rows="3"
        placeholder="First items, comma-separated (optional)"
      ></textarea>
      <div class="actions">
        <button
          class="primary"
          on:click={addList}
          disabled={adding || !addName.trim()}
          >{adding ? "Starting…" : "Start list"}</button
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
  .lists {
    flex: 1;
    min-height: 0;
    padding: 0.5rem 1.4rem 1.6rem;
  }

  /* Grid of list cards (matches the Library wall). */
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
  .src {
    font-size: 0.68rem;
    font-weight: 700;
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
    background: var(--note-sun);
    border-radius: 999px;
    padding: 0.15rem 0.7rem;
    font-variant-numeric: tabular-nums;
  }
  .status.cleared {
    background: var(--note-mint);
    color: var(--teal-deep);
  }
  .card.is-foreign {
    box-shadow:
      0 0 0 2px var(--glow),
      0 0 14px 1px color-mix(in srgb, var(--glow) 55%, transparent),
      var(--shadow-soft);
  }
  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  /* The open-list panel. */
  .panel {
    max-width: 40rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    animation: kiosk-rise 0.35s ease both;
  }
  .panelhead {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0;
  }
  .back {
    flex: 0 0 auto;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    font-size: 1.6rem;
    line-height: 1;
    color: var(--teal-deep);
    background: var(--paper);
    display: grid;
    place-items: center;
  }
  .back:active {
    transform: scale(0.92);
  }
  .picon {
    font-size: 1.6rem;
    line-height: 1;
  }
  .ptext {
    flex: 1;
    min-width: 0;
  }
  .ptext h2 {
    margin: 0;
    font-size: 1.25rem;
    line-height: 1.2;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .tool {
    flex: 0 0 auto;
    min-height: 2.6rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--teal-deep);
    background: var(--paper);
    white-space: nowrap;
  }
  .tool:active {
    transform: scale(0.95);
  }
  .tool:disabled {
    opacity: 0.4;
  }
  .tool.danger {
    color: #9a3b2f;
  }
  .tool.danger.armed {
    background: #9a3b2f;
    color: #fff;
  }

  .items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.7rem 0.8rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    cursor: pointer;
  }
  .item:active {
    filter: brightness(0.97);
  }
  .tick {
    flex: 0 0 auto;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 8px;
    border: 2px solid var(--line);
    background: var(--paper);
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    font-weight: 800;
    color: #fff;
  }
  .item.done .tick {
    background: var(--teal);
    border-color: var(--teal);
  }
  .itext {
    flex: 1;
    min-width: 0;
    font-size: 1.02rem;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .item.done .itext {
    color: var(--muted);
    text-decoration: line-through;
  }
  .x {
    flex: 0 0 auto;
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    font-size: 0.95rem;
    color: var(--muted);
    display: grid;
    place-items: center;
  }
  .x:active {
    background: var(--paper-deep);
    transform: scale(0.9);
  }

  .addrow {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .addrow input {
    flex: 1;
    min-width: 0;
    padding: 0.75rem 0.9rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
  }
  .addrow input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .addrow button {
    flex: 0 0 auto;
    width: 3.1rem;
    border-radius: 14px;
    font-size: 1.4rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: var(--shadow-soft);
  }
  .addrow button:active {
    transform: scale(0.95);
  }
  .addrow button:disabled {
    opacity: 0.5;
  }

  /* Start-a-list floating button (mirrors the other views' add FAB). */
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

  /* Start-a-list dialog (mirrors the Library add form). */
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
