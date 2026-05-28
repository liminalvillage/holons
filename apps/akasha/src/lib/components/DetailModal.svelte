<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The zoomed-forward detail card for a tapped post-it / library thing. Shows
  // full details and — when logged in with Telegram — edit fields and actions
  // (save, mark complete, borrow / return). Writes go through identity-aware
  // helpers; the meaning of borrowing lives in @holons/core/library.
  import Modal from "./Modal.svelte";
  import { selection, closeDetail, holonId } from "$lib/stores";
  import { isLoggedIn, telegramUser, loginOpen, borrowActor } from "$lib/auth";
  import { getWriter, getLibraryDb } from "$lib/holosphere";
  import { noteColor } from "$lib/data";
  import {
    borrowItem,
    returnItem,
    getItemIcon,
    getTypeDisplayName,
  } from "@holons/core/library";

  $: sel = $selection;
  $: isThing = sel?.kind === "thing";
  $: quest = sel && sel.kind !== "thing" ? sel.quest : null;
  $: item = sel && sel.kind === "thing" ? sel.item : null;
  $: tint = isThing ? "var(--card)" : noteColor(quest?.category);

  let editing = false;
  let saving = false;
  let message = "";

  // Edit form fields
  let fTitle = "";
  let fDate = "";
  let fTime = "";
  let fLocation = "";
  let fCategory = "";
  let fDescription = "";
  let fType = "other";
  let fValue = 0;

  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }
  function toDateInput(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function toTimeInput(d: Date): string {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function whenText(): string {
    if (!quest?.when) return "No date";
    const d = new Date(quest.when);
    if (Number.isNaN(d.getTime())) return "No date";
    const hasTime = /T\d\d:/.test(String(quest.when));
    return d.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric",
      ...(hasTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }

  function startEdit() {
    if (!sel) return;
    message = "";
    if (sel.kind === "thing") {
      fType = String(sel.item.type ?? "other");
      fDescription = String(sel.item.description ?? "");
      fValue = Number(sel.item.value ?? 0);
    } else {
      const q = sel.quest;
      fTitle = q.title ?? "";
      fLocation = String(q.location ?? "");
      fCategory = String(q.category ?? "");
      fDescription = String(q.description ?? "");
      const d = q.when ? new Date(q.when) : null;
      if (d && !Number.isNaN(d.getTime())) {
        fDate = toDateInput(d);
        fTime = /T\d\d:/.test(String(q.when)) ? toTimeInput(d) : "";
      } else {
        fDate = "";
        fTime = "";
      }
    }
    editing = true;
  }

  function requestLogin() {
    loginOpen.set(true);
  }

  async function saveQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    saving = true;
    message = "";
    let when: string | undefined = sel.quest.when;
    if (fDate)
      when = fTime ? new Date(`${fDate}T${fTime}`).toISOString() : fDate;
    const updated = {
      ...sel.quest,
      title: fTitle.trim() || sel.quest.title,
      location: fLocation.trim() || undefined,
      category: fCategory.trim() || undefined,
      description: fDescription.trim() || undefined,
      when,
    };
    const writer = await getWriter($holonId, (m) => (message = m));
    const ok = await writer.put("quests", updated);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = "Could not save — try again.";
  }

  async function completeQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    saving = true;
    message = "";
    const updated = { ...sel.quest, status: "completed", completed: true };
    const writer = await getWriter($holonId, (m) => (message = m));
    const ok = await writer.put("quests", updated);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = "Could not update.";
  }

  async function saveThing() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    saving = true;
    message = "";
    const updated = {
      ...sel.item,
      type: fType,
      description: fDescription.trim(),
      value: Number(fValue) || 0,
    };
    const writer = await getWriter($holonId, (m) => (message = m));
    const ok = await writer.put("library", updated);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = "Could not save.";
  }

  async function borrow() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    const actor = borrowActor();
    if (!actor) return requestLogin();
    saving = true;
    message = "";
    const db = await getLibraryDb();
    const due = new Date(Date.now() + 7 * 86_400_000);
    const res = await borrowItem(db, $holonId, String(sel.item.id), actor, due);
    saving = false;
    if (res.ok) closeDetail();
    else
      message =
        res.reason === "already_borrowed"
          ? "Already borrowed."
          : "Could not borrow.";
  }

  async function returnThing() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    const actor = borrowActor();
    if (!actor) return requestLogin();
    saving = true;
    message = "";
    const db = await getLibraryDb();
    const res = await returnItem(db, $holonId, String(sel.item.id), actor);
    saving = false;
    if (res.ok) closeDetail();
    else
      message =
        res.reason === "forbidden"
          ? "Only the borrower can return it."
          : "Could not return.";
  }

  $: borrowedByMe =
    item?.borrowed &&
    ($telegramUser?.id === item?.borrowerId ||
      ($telegramUser?.username && item?.borrower === $telegramUser.username));
</script>

{#if sel}
  <Modal {tint} on:close={closeDetail}>
    {#if isThing && item}
      <!-- ── Library thing ─────────────────────────────────────────────── -->
      <div class="icon-big">{getItemIcon({ type: item.type })}</div>
      <h2>{item.id}</h2>
      <span class="kind">{getTypeDisplayName(item.type)}</span>

      {#if !editing}
        {#if item.description}<p class="desc">{item.description}</p>{/if}
        <dl class="facts">
          <div>
            <dt>Status</dt>
            <dd>
              {#if item.borrowed}
                Out{item.borrower ? ` · ${item.borrower}` : ""}
              {:else}Available{/if}
            </dd>
          </div>
          {#if item.value}
            <div>
              <dt>Value</dt>
              <dd>{item.value}</dd>
            </div>
          {/if}
        </dl>

        {#if $isLoggedIn}
          <div class="actions">
            {#if !item.borrowed}
              <button class="primary" on:click={borrow} disabled={saving}
                >Borrow</button
              >
            {:else if borrowedByMe}
              <button class="primary" on:click={returnThing} disabled={saving}
                >Return</button
              >
            {:else}
              <span class="note-line"
                >On loan to {item.borrower ?? "someone"}</span
              >
            {/if}
            <button class="ghost" on:click={startEdit} disabled={saving}
              >Edit</button
            >
          </div>
        {:else}
          <button class="primary" on:click={requestLogin}
            >Log in with Telegram to borrow or edit</button
          >
        {/if}
      {:else}
        <!-- edit thing -->
        <label
          >Type
          <select bind:value={fType}>
            <option value="tool">Tool</option>
            <option value="book">Book</option>
            <option value="equipment">Equipment</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label
          >Description
          <textarea bind:value={fDescription} rows="3"></textarea>
        </label>
        <label
          >Value
          <input type="number" bind:value={fValue} min="0" />
        </label>
        <div class="actions">
          <button class="primary" on:click={saveThing} disabled={saving}
            >{saving ? "Saving…" : "Save"}</button
          >
          <button class="ghost" on:click={() => (editing = false)}
            >Cancel</button
          >
        </div>
      {/if}
    {:else if quest}
      <!-- ── Calendar event / task ─────────────────────────────────────── -->
      {#if !editing}
        {#if quest.category}<span class="kind">{quest.category}</span>{/if}
        <h2>{quest.title}</h2>
        <p class="when">{whenText()}</p>
        {#if quest.location}<p class="where">📍 {quest.location}</p>{/if}
        {#if quest.description}<p class="desc">{quest.description}</p>{/if}
        {#if Array.isArray(quest.participants) && quest.participants.length}
          <p class="ppl">
            {quest.participants.length} participant{quest.participants
              .length === 1
              ? ""
              : "s"}
          </p>
        {/if}

        {#if $isLoggedIn}
          <div class="actions">
            <button class="primary" on:click={startEdit} disabled={saving}
              >Edit</button
            >
            <button class="ghost" on:click={completeQuest} disabled={saving}
              >Mark complete</button
            >
          </div>
        {:else}
          <button class="primary" on:click={requestLogin}
            >Log in with Telegram to edit</button
          >
        {/if}
      {:else}
        <!-- edit quest -->
        <label
          >Title
          <input type="text" bind:value={fTitle} />
        </label>
        <div class="row2">
          <label
            >Date
            <input type="date" bind:value={fDate} />
          </label>
          <label
            >Time
            <input type="time" bind:value={fTime} />
          </label>
        </div>
        <label
          >Category
          <input type="text" bind:value={fCategory} />
        </label>
        <label
          >Location
          <input type="text" bind:value={fLocation} />
        </label>
        <label
          >Description
          <textarea bind:value={fDescription} rows="3"></textarea>
        </label>
        <div class="actions">
          <button class="primary" on:click={saveQuest} disabled={saving}
            >{saving ? "Saving…" : "Save"}</button
          >
          <button class="ghost" on:click={() => (editing = false)}
            >Cancel</button
          >
        </div>
      {/if}
    {/if}

    {#if message}<p class="msg">{message}</p>{/if}
  </Modal>
{/if}

<style>
  h2 {
    margin: 0.2rem 0 0.4rem;
    font-size: 1.55rem;
    line-height: 1.18;
    color: var(--ink);
    word-break: break-word;
  }
  .kind {
    display: inline-block;
    font-size: 0.74rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--teal-deep);
  }
  .icon-big {
    font-size: 3rem;
    line-height: 1;
  }
  .when {
    font-weight: 700;
    color: var(--ink);
    margin: 0 0 0.5rem;
  }
  .where,
  .ppl {
    color: var(--ink-soft);
    margin: 0 0 0.5rem;
  }
  .desc {
    color: var(--ink-soft);
    line-height: 1.55;
    margin: 0.6rem 0 0.4rem;
    white-space: pre-wrap;
  }
  .facts {
    display: flex;
    gap: 1.6rem;
    margin: 0.8rem 0 0.2rem;
  }
  .facts dt {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    font-weight: 700;
  }
  .facts dd {
    margin: 0.1rem 0 0;
    font-weight: 700;
    color: var(--ink);
  }
  .note-line {
    color: var(--ink-soft);
    font-weight: 600;
    align-self: center;
  }

  label {
    display: block;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-top: 0.9rem;
  }
  input,
  textarea,
  select {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  input:focus,
  textarea:focus,
  select:focus {
    outline: none;
    border-color: var(--teal);
  }
  textarea {
    resize: vertical;
  }
  .row2 {
    display: flex;
    gap: 0.8rem;
  }
  .row2 label {
    flex: 1;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.3rem;
  }
  .primary,
  .ghost {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .msg {
    margin-top: 0.9rem;
    color: #9a3b2f;
    font-weight: 600;
    text-align: center;
  }
</style>
