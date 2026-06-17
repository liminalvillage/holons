<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The optional Roles board. Two views, switched like the dashboard:
  //   • Cards — one card per role, featuring TODAY's holder (the kiosk shows the
  //     current day); take it for today, or release a fixed role.
  //   • Week  — a Mon→Sun strip per role; tap a day to take it just for that day.
  // A role can also have a *fixed* holder (set from a card's edit sheet) who holds
  // it every day. All scheduling meaning lives in @holons/core/roles (wire-shapes
  // shared with the dashboard); this view only reads and writes.
  import { get } from "svelte/store";
  import { roleCards, rawRoles, holonId, now, showNotice } from "$lib/stores";
  import { isLoggedIn, loginOpen, telegramUser } from "$lib/auth";
  import { getWriter, getHolosphere } from "$lib/holosphere";
  import { noteColor, noteTilt, noteRiseDelay, type RoleCard } from "$lib/data";
  import {
    avatarUrl,
    avatarInitial,
    hideImg,
    showImg,
  } from "$lib/components/Avatars.svelte";
  import {
    createRole,
    weekKeyOf,
    weekDaysOf,
    isoDateOf,
    holdersForDate,
    todayHolder,
    hasPermanent,
    permanentHolders,
    isPermanentHolder,
    isHolderOnDate,
    toggleDayUser,
    setPermanent,
    clearPermanent,
    type Role,
    type RoleParticipant,
    type ScheduledUser,
  } from "@holons/core/roles";
  import Modal from "$lib/components/Modal.svelte";

  type ViewMode = "cards" | "week";
  let viewMode: ViewMode = "cards";

  // Source records keyed for writes; the cards list is display-only.
  $: byId = new Map($rawRoles.map((r) => [String(r.id ?? r.title), r]));
  $: myId = $telegramUser?.id ?? null;

  // "Today" as the week-day cell matching the local date, so the card and the
  // week grid always agree on which day (and key) "today" is. Updates only when
  // the day rolls over, not every clock tick.
  function pickToday(at: Date): Date {
    const ts = at.toDateString();
    return weekDaysOf(weekKeyOf(at)).find((d) => d.toDateString() === ts) ?? at;
  }
  let todayCell = pickToday(new Date());
  $: {
    const n = new Date($now);
    if (n.toDateString() !== todayCell.toDateString()) todayCell = pickToday(n);
  }

  // ── Week navigation (week view) ─────────────────────────────────────────────
  let weekKey = weekKeyOf(new Date());
  $: days = weekDaysOf(weekKey);
  $: isCurrentWeek = weekKey === weekKeyOf(todayCell);
  $: rangeLabel = weekRangeLabel(days);

  function weekRangeLabel(ds: Date[]): string {
    const a = ds[0];
    const b = ds[6];
    const mo = (d: Date) => d.toLocaleDateString([], { month: "short" });
    return a.getMonth() === b.getMonth()
      ? `${mo(a)} ${a.getDate()}–${b.getDate()}`
      : `${mo(a)} ${a.getDate()} – ${mo(b)} ${b.getDate()}`;
  }
  function shiftWeek(delta: number) {
    const base = new Date(days[0]);
    base.setDate(base.getDate() + delta * 7);
    weekKey = weekKeyOf(base);
  }
  function goToday() {
    weekKey = weekKeyOf(todayCell);
  }
  const isCellToday = (d: Date) =>
    d.toDateString() === todayCell.toDateString();

  // ── Identity helpers ────────────────────────────────────────────────────────
  function holderName(p: RoleParticipant | ScheduledUser | null): string {
    if (!p) return "";
    const full = [
      (p as RoleParticipant).first_name,
      (p as RoleParticipant).last_name,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    return full || (p.username ? String(p.username) : `#${p.id}`);
  }
  function meScheduled(): ScheduledUser {
    const u = get(telegramUser)!;
    const name =
      [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
      (u.username ?? String(u.id));
    return {
      id: u.id,
      username: name,
      assignedAt: new Date().toISOString(),
      assignedVia: "kiosk",
    };
  }
  function meParticipant(): RoleParticipant {
    const u = get(telegramUser)!;
    return {
      id: u.id,
      username: u.username ?? null,
      first_name: u.first_name ?? null,
      last_name: u.last_name ?? null,
    };
  }

  // ── Writes ──────────────────────────────────────────────────────────────────
  let busy: string | null = null;

  async function persist(updated: Role) {
    const hid = get(holonId);
    if (!hid) return;
    const writer = await getWriter(hid, (m) => showNotice(m));
    await writer.put("roles", updated);
  }

  async function takeDay(card: RoleCard, raw: Role, day: Date, token: string) {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    if (hasPermanent(raw)) {
      showNotice("Fixed role — release it from the card first.");
      return;
    }
    busy = token;
    try {
      const { role } = toggleDayUser(raw, day, meScheduled());
      await persist(role);
    } catch (err) {
      console.error("[kiosk] role day toggle failed", err);
    } finally {
      busy = null;
    }
  }

  async function releaseFixed(card: RoleCard, raw: Role) {
    busy = `fix:${card.id}`;
    try {
      await persist(clearPermanent(raw));
    } catch (err) {
      console.error("[kiosk] release fixed failed", err);
    } finally {
      busy = null;
    }
  }

  // ── Add a role ──────────────────────────────────────────────────────────────
  let addOpen = false;
  let addTitle = "";
  let addDesc = "";
  let adding = false;

  function openAdd() {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    addTitle = "";
    addDesc = "";
    addOpen = true;
  }

  async function addRole() {
    const user = get(telegramUser);
    if (!user) {
      loginOpen.set(true);
      return;
    }
    const title = addTitle.trim();
    if (!title) {
      addOpen = false;
      return;
    }
    adding = true;
    try {
      await persist(createRole(title, addDesc.trim()));
      addOpen = false;
      addTitle = "";
      addDesc = "";
    } catch (err) {
      console.error("[kiosk] add role failed", err);
    } finally {
      adding = false;
    }
  }

  // ── Edit / delete / fixed ─────────────────────────────────────────────────--
  let editCard: RoleCard | null = null;
  let editTitle = "";
  let editDesc = "";
  let savingEdit = false;
  let deleting = false;
  let fixedBusy = false;
  $: editRaw = editCard ? (byId.get(editCard.id) ?? null) : null;

  function openEdit(card: RoleCard) {
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    editCard = card;
    editTitle = card.title;
    editDesc = card.description ?? "";
  }

  async function saveEdit() {
    if (!editCard || !editRaw) return;
    const title = editTitle.trim();
    if (!title) return;
    savingEdit = true;
    try {
      // Keep the role's id/key stable on rename; only display fields change.
      await persist({ ...editRaw, title, description: editDesc.trim() });
      editCard = null;
    } catch (err) {
      console.error("[kiosk] edit role failed", err);
    } finally {
      savingEdit = false;
    }
  }

  async function makeFixed() {
    if (!editRaw) return;
    if (!get(telegramUser)) {
      loginOpen.set(true);
      return;
    }
    fixedBusy = true;
    try {
      await persist(setPermanent(editRaw, meParticipant()));
      editCard = null;
    } catch (err) {
      console.error("[kiosk] make fixed failed", err);
    } finally {
      fixedBusy = false;
    }
  }

  async function clearFixed() {
    if (!editRaw) return;
    fixedBusy = true;
    try {
      await persist(clearPermanent(editRaw));
      editCard = null;
    } catch (err) {
      console.error("[kiosk] clear fixed failed", err);
    } finally {
      fixedBusy = false;
    }
  }

  async function deleteRole() {
    const hid = get(holonId);
    if (!hid || !editCard) return;
    const raw = editRaw;
    deleting = true;
    try {
      const hs = await getHolosphere();
      // Cascade like core's deleteRoleWithChecklist: drop the linked checklist
      // too so it isn't orphaned (the kiosk has no checklist UI of its own).
      if (raw?.checklistId) {
        await hs
          .delete(hid, "checklists", String(raw.checklistId))
          .catch(() => {});
      }
      await hs.delete(hid, "roles", editCard.id);
      editCard = null;
    } catch (err) {
      console.error("[kiosk] delete role failed", err);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="board">
  <div class="topbar">
    <div class="seg" role="tablist" aria-label="Roles view">
      <button
        class:on={viewMode === "cards"}
        role="tab"
        aria-selected={viewMode === "cards"}
        on:click={() => (viewMode = "cards")}>Cards</button
      >
      <button
        class:on={viewMode === "week"}
        role="tab"
        aria-selected={viewMode === "week"}
        on:click={() => (viewMode = "week")}>Week</button
      >
    </div>

    {#if viewMode === "week"}
      <div class="weeknav">
        <button
          class="navbtn"
          on:click={() => shiftWeek(-1)}
          aria-label="Previous week">‹</button
        >
        <span class="range">{rangeLabel}</span>
        <button
          class="navbtn"
          on:click={() => shiftWeek(1)}
          aria-label="Next week">›</button
        >
        {#if !isCurrentWeek}
          <button class="todaybtn" on:click={goToday}>Today</button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="scrollarea scroll">
    {#if !$roleCards.length}
      <p class="empty">No roles yet. ✪</p>
    {:else if viewMode === "cards"}
      <!-- ── Cards: today's holder per role ─────────────────────────────── -->
      <div class="wall">
        {#each $roleCards as card (card.id)}
          {@const raw = byId.get(card.id)}
          {#if raw}
            {@const fixed = hasPermanent(raw)}
            {@const holder = todayHolder(raw, todayCell)}
            {@const mineToday =
              myId != null && isHolderOnDate(raw, todayCell, myId)}
            {@const iFixed = myId != null && isPermanentHolder(raw, myId)}
            <span class="lift">
              <article
                class="note tilt"
                style="--tilt: {noteTilt(
                  card.id,
                )}deg; --rise-delay: {noteRiseDelay(
                  card.id,
                )}s; background: {noteColor(card.title)};"
              >
                {#if $isLoggedIn}
                  <button
                    class="tool"
                    on:click={() => openEdit(card)}
                    aria-label="Edit role"
                    title="Edit">✎</button
                  >
                {/if}
                <h3>{card.title}</h3>
                {#if card.description}
                  <p class="desc">{card.description}</p>
                {/if}

                <div class="today">
                  <span class="tlabel">{fixed ? "Fixed" : "Today"}</span>
                  {#if holder}
                    <span class="holder">
                      <span class="hav">
                        <span class="hini"
                          >{avatarInitial(holderName(holder))}</span
                        >
                        <img
                          src={avatarUrl(holder.id ?? "")}
                          alt=""
                          loading="lazy"
                          on:error={hideImg}
                          on:load={showImg}
                        />
                      </span>
                      <span class="hname"
                        >{holderName(holder).split(" ")[0]}</span
                      >
                      {#if fixed}<span class="lock" title="Fixed role">🔒</span
                        >{/if}
                    </span>
                  {:else}
                    <span class="open">Open</span>
                  {/if}
                </div>

                <div class="cardfoot">
                  {#if fixed}
                    {#if iFixed}
                      <button
                        class="take in"
                        on:click={() => releaseFixed(card, raw)}
                        disabled={busy === `fix:${card.id}`}
                        title="Release this fixed role">🔒 Release</button
                      >
                    {:else}
                      <span class="fixednote">Fixed role</span>
                    {/if}
                  {:else}
                    <button
                      class="take"
                      class:in={mineToday}
                      on:click={() => takeDay(card, raw, todayCell, card.id)}
                      disabled={busy === card.id}
                      aria-pressed={mineToday}
                      >{mineToday ? "✓ Today · drop" : "Take today"}</button
                    >
                  {/if}
                </div>
              </article>
            </span>
          {/if}
        {/each}
      </div>
    {:else}
      <!-- ── Week: a Mon→Sun strip per role ─────────────────────────────── -->
      <div class="legend">
        <span class="leg-role"></span>
        {#each days as d (isoDateOf(d))}
          <span class="leg-cell" class:today={isCellToday(d)}>
            <span class="dow"
              >{d.toLocaleDateString([], { weekday: "narrow" })}</span
            >
            <span class="dnum">{d.getDate()}</span>
          </span>
        {/each}
      </div>

      {#each $roleCards as card (card.id)}
        {@const raw = byId.get(card.id)}
        {#if raw}
          {@const fixed = hasPermanent(raw)}
          <div class="wrow">
            <div class="wtitle" title={card.title}>
              <span class="wtitle-text">{card.title}</span>
              {#if fixed}<span class="lock" title="Fixed role">🔒</span>{/if}
            </div>
            {#each days as d (isoDateOf(d))}
              {@const holder = holdersForDate(raw, d)[0] ?? null}
              {@const mine = myId != null && isHolderOnDate(raw, d, myId)}
              {@const token = `${card.id}|${isoDateOf(d)}`}
              <button
                class="wcell"
                class:today={isCellToday(d)}
                class:filled={!!holder}
                class:mine
                class:fixed
                on:click={() => takeDay(card, raw, d, token)}
                disabled={busy === token}
                title={holder ? holderName(holder) : "Take this day"}
              >
                {#if holder}
                  <span class="wav">
                    <span class="wini">{avatarInitial(holderName(holder))}</span
                    >
                    <img
                      src={avatarUrl(holder.id ?? "")}
                      alt=""
                      loading="lazy"
                      on:error={hideImg}
                      on:load={showImg}
                    />
                  </span>
                {:else}
                  <span class="wdot">+</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <button class="fab" on:click={openAdd} aria-label="Add role" title="Add role">
    ＋
  </button>
</div>

{#if addOpen}
  <Modal on:close={() => (addOpen = false)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">＋</div>
      <h3>Add a role</h3>
      <p class="lead">A standing responsibility people can take on.</p>
      <input
        class="line"
        bind:value={addTitle}
        placeholder="Role title"
        maxlength="60"
        on:keydown={(e) => e.key === "Enter" && addRole()}
      />
      <textarea
        bind:value={addDesc}
        rows="3"
        placeholder="What does it involve? (optional)"
      ></textarea>
      <div class="actions">
        <button
          class="primary"
          on:click={addRole}
          disabled={adding || !addTitle.trim()}
          >{adding ? "Adding…" : "Add role"}</button
        >
        <button class="ghost" on:click={() => (addOpen = false)}>Cancel</button>
      </div>
    </div>
  </Modal>
{/if}

{#if editCard}
  <Modal on:close={() => (editCard = null)}>
    <div class="form">
      <div class="glyph" aria-hidden="true">✎</div>
      <h3>Edit role</h3>
      <input
        class="line"
        bind:value={editTitle}
        placeholder="Role title"
        maxlength="60"
        on:keydown={(e) => e.key === "Enter" && saveEdit()}
      />
      <textarea
        bind:value={editDesc}
        rows="3"
        placeholder="What does it involve? (optional)"
      ></textarea>

      <div class="fixed-section">
        <span class="seclabel">Fixed holder · holds it every day</span>
        {#if editRaw && hasPermanent(editRaw)}
          <div class="fixrow">
            <span class="fxname"
              >🔒 {holderName(permanentHolders(editRaw)[0])}</span
            >
            <button class="linkbtn" on:click={clearFixed} disabled={fixedBusy}
              >Clear</button
            >
          </div>
        {:else}
          <button class="ghost wide" on:click={makeFixed} disabled={fixedBusy}
            >Make me the fixed holder</button
          >
        {/if}
      </div>

      <div class="actions">
        <button
          class="primary"
          on:click={saveEdit}
          disabled={savingEdit || !editTitle.trim()}
          >{savingEdit ? "Saving…" : "Save"}</button
        >
        <button class="ghost" on:click={() => (editCard = null)}>Cancel</button>
      </div>
      <button class="danger" on:click={deleteRole} disabled={deleting}
        >{deleting ? "Deleting…" : "Delete role"}</button
      >
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

  /* View switcher + week nav */
  .topbar {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.7rem 1rem;
    padding: 1rem 1.4rem 0.2rem;
  }
  .seg {
    display: inline-flex;
    background: var(--paper-deep);
    border-radius: 999px;
    padding: 0.2rem;
    gap: 0.15rem;
  }
  .seg button {
    min-height: 2.2rem;
    padding: 0 1.1rem;
    border-radius: 999px;
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--ink-soft);
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .seg button.on {
    background: var(--card);
    color: var(--teal-deep);
    box-shadow: var(--shadow-soft);
  }
  .weeknav {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .navbtn {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    font-size: 1.3rem;
    line-height: 1;
    color: var(--teal-deep);
    background: var(--paper);
    display: grid;
    place-items: center;
  }
  .navbtn:active {
    transform: scale(0.92);
  }
  .range {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--ink);
    min-width: 7.5rem;
    text-align: center;
  }
  .todaybtn {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--teal-deep);
    text-decoration: underline;
  }

  .scrollarea {
    flex: 1;
    min-height: 0;
    padding: 0.9rem 1.4rem 1.6rem;
  }

  /* ── Cards ─────────────────────────────────────────────────────────────── */
  .wall {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
    align-content: start;
    gap: 0.9rem;
  }
  .lift {
    display: block;
    min-width: 0;
  }
  .note {
    position: relative;
    display: block;
    padding: 0.95rem 1rem 1.05rem;
    border-radius: 4px 14px 14px 14px;
    animation: kiosk-rise 0.42s ease var(--rise-delay, 0s) both;
  }
  .note h3 {
    margin: 0;
    padding-right: 2.2rem;
    font-size: 1.1rem;
    line-height: 1.25;
    color: var(--ink);
  }
  .desc {
    margin: 0.4rem 0 0;
    font-size: 0.9rem;
    line-height: 1.4;
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tool {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
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
    transition: transform 0.1s ease;
  }
  .tool:active {
    transform: scale(0.88);
    background: var(--teal);
    color: #fff;
  }

  /* Today's holder hero */
  .today {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.8rem;
  }
  .tlabel {
    font-size: 0.66rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(32, 48, 47, 0.5);
  }
  .holder {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .hav {
    position: relative;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    box-shadow: 0 0 0 2px var(--card);
    flex: 0 0 auto;
  }
  .hini {
    font-size: 0.85rem;
    font-weight: 800;
    color: #fff;
  }
  .hav img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .hname {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lock {
    font-size: 0.8rem;
  }
  .open {
    font-size: 0.85rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.4);
  }

  .cardfoot {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.8rem;
  }
  .fixednote {
    font-size: 0.78rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.5);
  }
  .take {
    flex: 0 0 auto;
    min-height: 2rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 800;
    color: #fff;
    background: var(--teal);
    box-shadow: var(--shadow-soft);
    transition:
      transform 0.1s ease,
      background 0.15s ease;
  }
  .take:active {
    transform: scale(0.94);
  }
  .take:disabled {
    opacity: 0.6;
  }
  .take.in {
    color: var(--teal-deep);
    background: rgba(255, 255, 255, 0.7);
  }

  /* ── Week ──────────────────────────────────────────────────────────────── */
  /* Legend and every role row share one template, so the seven day columns
     line up exactly: a fixed role label + 7 equal day cells. */
  .legend,
  .wrow {
    display: grid;
    grid-template-columns: 6.5rem repeat(7, 1fr);
    gap: 0.35rem;
  }
  .legend {
    align-items: end;
    margin-bottom: 0.5rem;
    padding-bottom: 0.4rem;
    position: sticky;
    top: 0;
    background: var(--card);
    z-index: 1;
  }
  .leg-role {
    display: block;
  }
  .leg-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.05rem;
    padding: 0.2rem 0;
    border-radius: 8px;
  }
  .leg-cell.today {
    background: color-mix(in srgb, var(--teal) 14%, transparent);
  }
  .dow {
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    color: var(--muted);
  }
  .leg-cell.today .dow {
    color: var(--teal-deep);
  }
  .dnum {
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--ink);
  }

  .wrow {
    align-items: center;
    padding: 0.4rem 0;
    border-bottom: 1px solid var(--line);
  }
  .wtitle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--ink);
  }
  .wtitle-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wcell {
    height: 2.6rem;
    border-radius: 10px;
    background: var(--paper);
    display: grid;
    place-items: center;
    transition:
      transform 0.1s ease,
      background 0.12s ease;
  }
  .wcell:active {
    transform: scale(0.92);
  }
  .wcell:disabled {
    opacity: 0.6;
  }
  .wcell.today {
    outline: 2px solid color-mix(in srgb, var(--teal) 45%, transparent);
    outline-offset: -2px;
  }
  .wcell.mine {
    background: color-mix(in srgb, var(--teal) 16%, var(--paper));
  }
  .wcell.fixed {
    background: var(--note-sun);
  }
  .wdot {
    font-size: 1.1rem;
    font-weight: 700;
    color: rgba(32, 48, 47, 0.28);
  }
  .wav {
    position: relative;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
  }
  .wini {
    font-size: 0.78rem;
    font-weight: 800;
    color: #fff;
  }
  .wav img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 3rem 1rem;
    font-size: 1.1rem;
  }

  /* Add-role floating button */
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

  /* Add / edit dialog */
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

  .fixed-section {
    text-align: left;
    margin-top: 1rem;
    padding: 0.8rem;
    border: 1.5px solid var(--line);
    border-radius: 14px;
  }
  .seclabel {
    display: block;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-bottom: 0.5rem;
  }
  .fixrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .fxname {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--ink);
  }
  .linkbtn {
    font-size: 0.85rem;
    font-weight: 700;
    color: #9a3b2f;
    text-decoration: underline;
  }

  .form .actions {
    display: flex;
    gap: 0.6rem;
    margin-top: 1rem;
  }
  .form .primary,
  .form .ghost {
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .form .actions .primary,
  .form .actions .ghost {
    flex: 1;
  }
  .form .ghost.wide {
    width: 100%;
    min-height: 46px;
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
  .form .danger {
    margin-top: 0.9rem;
    width: 100%;
    min-height: 46px;
    border-radius: 12px;
    font-size: 0.9rem;
    font-weight: 700;
    color: #9a3b2f;
    background: rgba(154, 59, 47, 0.08);
    transition: transform 0.1s ease;
  }
  .form .danger:active {
    transform: scale(0.98);
  }
  .form .danger:disabled {
    opacity: 0.6;
  }
</style>
