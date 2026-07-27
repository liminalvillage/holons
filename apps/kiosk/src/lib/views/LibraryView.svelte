<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { get } from "svelte/store";
  import { tick } from "svelte";
  import {
    things,
    openThing,
    holonId,
    showNotice,
    libraryViewMode,
    now,
  } from "$lib/stores";
  import { telegramUser, loginOpen } from "$lib/auth";
  import { getLibraryDb } from "$lib/holosphere";
  import { setLibraryView, type LibraryViewMode } from "$lib/config";
  import { sameId } from "$lib/personal";
  import { dueLabelFor, type LibraryThing } from "$lib/data";
  import Modal from "$lib/components/Modal.svelte";
  import VoiceButtons from "$lib/components/VoiceButtons.svelte";
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

  // ── View mode: icon card grid / compact list / my borrowed things ─────────
  // Same segmented pill as the Tasks view.
  const MODES: { id: LibraryViewMode; glyph: string; label: string }[] = [
    { id: "cards", glyph: "▦", label: "Cards" },
    { id: "list", glyph: "☰", label: "List" },
    { id: "personal", glyph: "웃", label: "My things" },
  ];
  // Borrowing is personal; the segment hides logged out. A persisted
  // "personal" mode still renders (with a log-in prompt) rather than
  // clobbering the saved choice before auth has resolved.
  $: modes = $telegramUser ? MODES : MODES.filter((m) => m.id !== "personal");
  let switchEl: HTMLElement | undefined;

  function setMode(m: LibraryViewMode) {
    libraryViewMode.set(m);
    setLibraryView(m);
  }

  // Roving focus for the radiogroup: ←/→ move selection and keep focus on it.
  async function onSwitchKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : modes.length - 1;
    const i = modes.findIndex((m) => m.id === get(libraryViewMode));
    setMode(modes[(i + step) % modes.length].id);
    await tick();
    switchEl
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus();
  }

  // Things the logged-in user currently has out (legacy borrow fields are
  // core-maintained today-mirrors of bookings, so this is "out with me now").
  $: mine = $things.filter(
    (t) => !t.available && sameId(t.borrowerId, $telegramUser?.id),
  );
  $: shownRows = $libraryViewMode === "personal" ? mine : $things;

  /**
   * Status chip text for a row; personal mode leads with the return date.
   * Mode and clock come in as arguments so the template expression re-runs
   * when either store changes.
   */
  function statusLabel(
    t: LibraryThing,
    mode: LibraryViewMode,
    at: Date,
  ): string {
    if (t.available) return "available";
    if (mode === "personal") {
      const back = t.returnBy ? dueLabelFor(t.returnBy, at) : null;
      return back ? `return ${back}` : "with you";
    }
    return t.borrower ? `out · ${t.borrower}` : "out";
  }

  // ── Add an item ─────────────────────────────────────────────────────────────
  // Types offered in the picker; the icon/label come from core so the add sheet
  // and the cards always agree.
  const TYPE_OPTIONS: LibraryItemType[] = [
    LIBRARY_TYPES.TOOL,
    LIBRARY_TYPES.BOOK,
    LIBRARY_TYPES.EQUIPMENT,
    LIBRARY_TYPES.ACCOMMODATION,
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
  <div
    class="viewswitch"
    role="radiogroup"
    aria-label="Library view layout"
    bind:this={switchEl}
  >
    {#each modes as m (m.id)}
      <button
        role="radio"
        aria-checked={$libraryViewMode === m.id}
        class:active={$libraryViewMode === m.id}
        tabindex={$libraryViewMode === m.id ? 0 : -1}
        on:click={() => setMode(m.id)}
        on:keydown={onSwitchKey}
        aria-label="{m.label} view"
        title="{m.label} view"
      >
        {#if m.id === "personal"}
          <svg class="picon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12Zm0 2.25c-3.9 0-7.5 2-7.5 4.75V21h15v-2c0-2.75-3.6-4.75-7.5-4.75Z"
            />
          </svg>
        {:else}
          {m.glyph}
        {/if}
      </button>
    {/each}
  </div>

  <div class="lib scroll">
    {#if $libraryViewMode === "cards"}
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
    {:else if shownRows.length}
      <!-- Compact rows, shared by List (everything) and My things (what the
           logged-in user has out). -->
      <ul class="rows">
        {#each shownRows as thing (thing.id)}
          <li>
            <div
              class="row"
              class:out={!thing.available && $libraryViewMode !== "personal"}
              class:is-foreign={!!thing.sourceColor}
              style="--glow: {thing.sourceColor ?? 'transparent'};"
              role="button"
              tabindex="0"
              on:click={() => openThing(thing.id)}
              on:keydown={(e) => onKey(e, thing.id)}
            >
              <span class="ricon" aria-hidden="true"
                >{getItemIcon({ type: thing.type })}</span
              >
              <div class="text">
                <h3>{thing.title}</h3>
                <div class="meta">
                  <span class="rtype">{getTypeDisplayName(thing.type)}</span>
                  {#if thing.source}<span class="src">⇄ {thing.source}</span
                    >{/if}
                </div>
              </div>
              <span class="status" class:available={thing.available}>
                {statusLabel(thing, $libraryViewMode, $now)}
              </span>
            </div>
          </li>
        {/each}
      </ul>
    {:else if $libraryViewMode === "personal"}
      <p class="empty">
        {$telegramUser
          ? "Nothing borrowed right now — tap a thing to take it out ✶"
          : "Log in to see what you've borrowed ✶"}
      </p>
    {:else}
      <p class="empty">No things shared yet.</p>
    {/if}
  </div>

  <div class="fabrow">
    <VoiceButtons />
    <button
      class="fab"
      on:click={openAdd}
      aria-label="Share an item"
      title="Share an item"
    >
      ＋
    </button>
  </div>
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
    /* Room for the floating mode pill overlaying the top of the board. */
    padding: 4.4rem 1.4rem 1.6rem;
  }

  /* Same segmented pill as the Tasks view's mode switch, floating over the
     content so the list scrolls beneath it. */
  .viewswitch {
    position: absolute;
    top: 0.9rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0.15rem;
    padding: 0.25rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 999px;
    box-shadow: var(--shadow-soft);
    z-index: 5;
  }
  .viewswitch button {
    width: 3rem;
    height: 2.6rem;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 1.1rem;
    color: var(--ink-soft);
    touch-action: manipulation;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      transform 0.1s ease;
  }
  .viewswitch button.active {
    background: var(--teal);
    color: #fff;
  }
  .viewswitch button:active {
    transform: scale(0.94);
  }
  .picon {
    width: 1.15rem;
    height: 1.15rem;
    fill: currentColor;
  }

  /* Compact rows (List / My things modes). */
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
  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.65rem 0.8rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    cursor: pointer;
  }
  .row:active {
    filter: brightness(0.97);
  }
  .row.out {
    opacity: 0.75;
  }
  .row.is-foreign {
    border-left: 4px solid var(--glow);
  }
  .ricon {
    flex: 0 0 auto;
    font-size: 1.5rem;
    line-height: 1;
  }
  .row .text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .row h3 {
    margin: 0;
    font-size: 0.98rem;
    line-height: 1.3;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.15rem;
  }
  .rtype {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .row .status {
    margin-top: 0;
    flex: 0 0 auto;
    white-space: nowrap;
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

  /* Share-item floating button (mirrors the Roles/Tasks add FAB), in one
     row with the voice buttons: [⌨] [🎤] [＋]. */
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
