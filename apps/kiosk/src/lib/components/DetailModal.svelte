<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The zoomed-forward detail card for a tapped post-it / library thing. Shows
  // full details and — when logged in with Telegram — edit fields and actions
  // (save, mark complete, borrow / return). Writes go through identity-aware
  // helpers; the meaning of borrowing lives in @holons/core/library.
  import Modal from "./Modal.svelte";
  import Confetti from "./Confetti.svelte";
  import { get } from "svelte/store";
  import {
    selection,
    closeDetail,
    holonId,
    rawQuests,
    completionRequest,
    editOnOpen,
  } from "$lib/stores";
  import { isLoggedIn, telegramUser, loginOpen, borrowActor } from "$lib/auth";
  import { getWriter, getLibraryDb, getHolosphere } from "$lib/holosphere";
  import { reflectMembership } from "$lib/membership";
  import { checkComplete, recordCompletion } from "$lib/complete";
  import { noteColor, toPeople, parseWhen, sourceRef } from "$lib/data";
  import { localFieldsToStored } from "@holons/core/datetime";
  import { linkify } from "$lib/linkify";
  import { resolveImage } from "$lib/image";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";
  import {
    borrowItem,
    returnItem,
    getItemIcon,
    getTypeDisplayName,
  } from "@holons/core/library";
  import {
    toggleParticipant,
    toggleAppreciation,
    type Quest,
    type QuestParticipant,
  } from "@holons/core/tasks";

  // Read the quest fresh from Holosphere before a membership mutation, so the
  // participate-XOR-appreciate toggle is applied to current data (the modal's
  // `sel.quest` is a snapshot, and the local subscription can lag a write).
  async function freshQuest(q: Quest): Promise<Quest> {
    const hid = $holonId;
    if (q.id != null && hid) {
      try {
        const hs = await getHolosphere();
        const fresh = (await hs.get(hid, "quests", String(q.id))) as
          | Quest
          | null
          | undefined;
        if (fresh) return fresh;
      } catch {
        /* fall through to the local copy */
      }
    }
    const id = String(q.id ?? q.title);
    return get(rawQuests).find((x) => String(x.id ?? x.title) === id) ?? q;
  }

  // A participant record from the logged-in user, without undefined fields
  // (Holosphere warns on those).
  function person(u: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): QuestParticipant {
    const p: QuestParticipant = { id: u.id };
    if (u.username) p.username = u.username;
    if (u.first_name) p.first_name = u.first_name;
    if (u.last_name) p.last_name = u.last_name;
    return p;
  }

  $: sel = $selection;
  $: isThing = sel?.kind === "thing";
  $: quest = sel && sel.kind !== "thing" ? sel.quest : null;
  // A locally-built draft (e.g. long-press on the calendar) not yet written to
  // Holosphere: Cancel discards it and Save needs a title before it can land.
  $: isNew = !!(sel && sel.kind !== "thing" && sel.isNew);
  $: item = sel && sel.kind === "thing" ? sel.item : null;
  $: tint = isThing ? "var(--card)" : noteColor(quest?.category);

  // Existing categories across all quests, for the edit-form dropdown. Sorted
  // and de-duped; the field stays a free-text input so a new one can be typed.
  $: categoryOptions = [
    ...new Set(
      $rawQuests
        .map((q) => (q.category ?? "").trim())
        .filter((c) => c.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b));

  // Edit mode lives only while its card is on screen: closing the modal or
  // switching to another record discards the form (runs before the
  // edit-on-open hook below, which may then re-enter editing for the new card).
  let selKey: string | null = null;
  $: {
    const k = !sel
      ? null
      : sel.kind === "thing"
        ? `thing:${sel.item.id}`
        : `quest:${sel.quest.id ?? sel.quest.title}`;
    if (k !== selKey) {
      selKey = k;
      editing = false;
      message = "";
    }
  }

  // Opened via a pen button → jump straight into edit mode.
  $: if ($selection && $selection.kind !== "thing" && $editOnOpen) {
    editOnOpen.set(false);
    startEdit();
  }

  // Whether the logged-in user is already a participant of this quest.
  $: amParticipant =
    quest != null &&
    $telegramUser != null &&
    Array.isArray(quest.participants) &&
    quest.participants.some(
      (p: any) => String(p?.id) === String($telegramUser?.id),
    );

  // Participants as display people (id + friendly name) for the chips below.
  $: people = toPeople(quest?.participants);

  // Whether the logged-in user has already appreciated this quest.
  $: appreciationCount = Array.isArray(quest?.appreciation)
    ? quest!.appreciation.length
    : 0;
  $: amAppreciating =
    quest != null &&
    $telegramUser != null &&
    Array.isArray(quest.appreciation) &&
    quest.appreciation.some(
      (a: any) => String(a?.id) === String($telegramUser?.id),
    );

  let editing = false;
  let saving = false;
  let message = "";
  let celebrate = false;
  let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

  function party() {
    if (celebrateTimer) clearTimeout(celebrateTimer);
    celebrate = true;
    celebrateTimer = setTimeout(() => (celebrate = false), 1300);
  }

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
    const d = parseWhen(quest.when);
    if (!d || Number.isNaN(d.getTime())) return "No date";
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
      const d = q.when ? parseWhen(q.when) : null;
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
    // Store is always UTC: a picked local date+time becomes a timezone-qualified
    // ISO instant; a date with no time stays a bare all-day date.
    if (fDate) when = localFieldsToStored(fDate, fTime) ?? when;
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
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    // Permission + status guards up front, on the freshest copy.
    const result = checkComplete(await freshQuest(sel.quest), user.id);
    if (!result.ok) {
      saving = false;
      message =
        result.reason === "already-completed"
          ? "Already completed."
          : result.reason === "stopped"
            ? "This quest was stopped."
            : "Join the task first — only a participant can complete it.";
      return;
    }
    saving = false;
    const hid = $holonId;
    // Confirm participants (for REA), then record + celebrate.
    completionRequest.set({
      task: result.task,
      onConfirm: async (adjusted) => {
        try {
          const { ok } = await recordCompletion(hid, adjusted);
          if (ok) {
            closeDetail(); // close the detail card first, then celebrate
            setTimeout(party, 180);
          } else message = "Could not save.";
        } catch (err) {
          message = (err as Error)?.message || "Could not complete.";
        }
      },
    });
  }

  async function deleteQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Delete "${quest?.title ?? "this task"}"? This can't be undone.`,
      )
    )
      return;
    saving = true;
    message = "";
    // Soft-delete: write a `_deleted: true` tombstone (the bot's convention)
    // rather than a hard `put(null)`. A hard delete leaves a husk node that Gun
    // keeps re-emitting; the live subscription forwards it (it only swallows a
    // clean null), so the board flips between the real card and an empty
    // "Untitled" phantom — re-triggering the FLIP reshuffle indefinitely. A
    // tombstone is a stable object that both `isDone` and the lens aggregator
    // drop cleanly, so the card just leaves.
    const tombstone: Record<string, unknown> = { ...sel.quest, _deleted: true };
    delete tombstone._holon; // UI-only federation tag — never persist it
    const writer = await getWriter($holonId, (m) => (message = m));
    const ok = await writer.put("quests", tombstone);
    saving = false;
    if (ok) closeDetail();
    else if (!message) message = "Could not delete — try again.";
  }

  async function joinQuest() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    try {
      // Core owns membership and the participate-XOR-appreciate invariant:
      // joining clears any appreciation. Mutate the freshest copy.
      const updated = toggleParticipant(
        await freshQuest(sel.quest),
        person(user),
      );
      const writer = await getWriter($holonId, (m) => (message = m));
      const ok = await writer.put("quests", updated);
      if (ok) {
        // Mirror into the joiner's personal holon + (re)send the linked DM.
        // Post-toggle participant state decides join vs leave. Fire-and-forget:
        // the membership write already succeeded; the mirror/DM are best-effort.
        const joined = (updated.participants ?? []).some(
          (p: any) => String(p?.id) === String(user.id),
        );
        void reflectMembership($holonId, updated, user, joined);
        closeDetail();
      } else if (!message) message = "Could not join.";
    } catch (err) {
      message = (err as Error)?.message || "Could not join.";
    } finally {
      saving = false;
    }
  }

  async function appreciate() {
    if (!sel || sel.kind === "thing" || !$holonId) return;
    const user = $telegramUser;
    if (!user) {
      loginOpen.set(true);
      return;
    }
    saving = true;
    message = "";
    try {
      // Appreciating removes you from participants (participate XOR appreciate);
      // it feeds the REA appreciation-exchange on completion. Mutate the freshest.
      const updated = toggleAppreciation(
        await freshQuest(sel.quest),
        person(user),
      );
      const writer = await getWriter($holonId, (m) => (message = m));
      const ok = await writer.put("quests", updated);
      if (ok) closeDetail();
      else if (!message) message = "Could not save.";
    } catch (err) {
      message = (err as Error)?.message || "Could not save.";
    } finally {
      saving = false;
    }
  }

  async function saveThing() {
    if (!sel || sel.kind !== "thing" || !$holonId) return;
    saving = true;
    message = "";
    // A federated/hologram item is owned by another holon — edit it there, not
    // in our own lens, or we fork a stray local copy that shadows (and unlinks)
    // the federated original. Also drop read-side provenance tags so the kiosk's
    // `_holon` marker (or a resolved `_hologram`/`_federation` envelope) is never
    // persisted onto the stored item.
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const clean: Record<string, unknown> = { ...sel.item };
    delete clean._holon;
    delete clean._hologram;
    delete clean._federation;
    const updated = {
      ...clean,
      id: ref?.key ?? sel.item.id,
      type: fType,
      description: fDescription.trim(),
      value: Number(fValue) || 0,
    };
    const writer = await getWriter(holon, (m) => (message = m));
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
    // A federated/hologram item lives in its owner's graph, not ours — borrow
    // against the source holon + key so the write lands on the real item, not a
    // fresh local copy.
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const key = ref?.key ?? String(sel.item.id);
    const due = new Date(Date.now() + 7 * 86_400_000);
    const res = await borrowItem(db, holon, key, actor, due);
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
    const ref = sourceRef(sel.item, String(sel.item.id));
    const holon = ref?.holon ?? $holonId;
    const key = ref?.key ?? String(sel.item.id);
    const res = await returnItem(db, holon, key, actor);
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
        {#if item.description}<p class="desc">
            {@html linkify(item.description)}
          </p>{/if}
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
        {#if quest.picture}
          <img
            class="hero"
            src={resolveImage(quest.picture)}
            alt={quest.title}
            loading="lazy"
            on:error={hideImg}
          />
        {/if}
        {#if quest.category}<span class="kind">{quest.category}</span>{/if}
        <h2>{@html linkify(quest.title)}</h2>
        <p class="when">{whenText()}</p>
        {#if quest.location}<p class="where">📍 {quest.location}</p>{/if}
        {#if quest.description}<p class="desc">
            {@html linkify(quest.description)}
          </p>{/if}
        {#if people.length || appreciationCount}
          <div class="facts-line">
            {#if people.length}
              <span class="people-label"
                >{people.length} participant{people.length === 1
                  ? ""
                  : "s"}</span
              >
            {/if}
            {#if appreciationCount}
              <span>♥ {appreciationCount}</span>
            {/if}
          </div>
        {/if}
        {#if people.length}
          <ul class="people">
            {#each people as p (p.id)}
              <li class="person">
                <span class="pav">
                  <span class="pini">{avatarInitial(p.name)}</span>
                  <img
                    src={avatarUrl(p.id)}
                    alt=""
                    loading="lazy"
                    on:error={hideImg}
                    on:load={showImg}
                  />
                </span>
                <span class="pname">{p.name}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if $isLoggedIn}
          <div class="actions">
            {#if amParticipant}
              <button
                class="ghost joined"
                on:click={joinQuest}
                disabled={saving}
                title="Leave this task">✓ Joined · leave</button
              >
            {:else}
              <button class="primary" on:click={joinQuest} disabled={saving}
                >Join</button
              >
            {/if}
            <button
              class="ghost appreciate"
              class:on={amAppreciating}
              on:click={appreciate}
              disabled={saving}
              >{amAppreciating
                ? "♥ Appreciated"
                : "♡ Appreciate"}{appreciationCount
                ? ` · ${appreciationCount}`
                : ""}</button
            >
            <button
              class={amParticipant ? "primary" : "ghost"}
              on:click={completeQuest}
              disabled={saving}>Mark complete</button
            >
            <button class="ghost" on:click={startEdit} disabled={saving}
              >Edit</button
            >
            <button
              class="ghost danger"
              on:click={deleteQuest}
              disabled={saving}>Delete</button
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
          <input
            type="text"
            list="category-options"
            bind:value={fCategory}
            placeholder="Pick or type a category"
          />
          <datalist id="category-options">
            {#each categoryOptions as opt}
              <option value={opt}></option>
            {/each}
          </datalist>
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
          <button
            class="primary"
            on:click={saveQuest}
            disabled={saving || (isNew && !fTitle.trim())}
            >{saving ? "Saving…" : isNew ? "Create" : "Save"}</button
          >
          <button
            class="ghost"
            on:click={() => (isNew ? closeDetail() : (editing = false))}
            >Cancel</button
          >
        </div>
      {/if}
    {/if}

    {#if message}<p class="msg">{message}</p>{/if}
  </Modal>
{/if}

{#if celebrate}
  <Confetti />
{/if}

<style>
  h2 {
    margin: 0.2rem 0 0.4rem;
    font-size: 1.55rem;
    line-height: 1.18;
    color: var(--ink);
    word-break: break-word;
  }
  h2 :global(a) {
    color: var(--teal-deep);
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .hero {
    display: block;
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    border-radius: 14px;
    margin: 0 0 0.7rem;
    background: rgba(0, 0, 0, 0.05);
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
  .where {
    color: var(--ink-soft);
    margin: 0 0 0.5rem;
  }
  .facts-line {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    color: var(--ink-soft);
    font-weight: 600;
    margin: 0 0 0.5rem;
  }

  /* Participant chips: photo (initials fallback) + name. */
  .people {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin: 0 0 0.6rem;
    padding: 0;
  }
  .person {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.25rem 0.7rem 0.25rem 0.3rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    font-weight: 700;
    color: var(--ink);
    font-size: 0.92rem;
  }
  .pav {
    position: relative;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .pini {
    font-size: 0.72rem;
    font-weight: 800;
    color: #fff;
  }
  .pav img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .pname {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc {
    color: var(--ink-soft);
    line-height: 1.55;
    margin: 0.6rem 0 0.4rem;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .desc :global(a) {
    color: var(--teal-deep);
    text-decoration: underline;
    overflow-wrap: anywhere;
  }
  .desc :global(a:active) {
    opacity: 0.7;
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
  .joined {
    background: #e7f3f1;
    color: var(--teal-deep);
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
  /* Date + time share a row, but each can shrink (min-width:0 — native date/time
     controls otherwise keep an intrinsic width and overflow) and wrap to stack
     when the dialog is too narrow on mobile. */
  .row2 {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
  }
  .row2 label {
    flex: 1 1 8rem;
    min-width: 0;
  }
  .row2 input {
    box-sizing: border-box;
    max-width: 100%;
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
  .danger {
    color: #c0392b;
    background: rgba(192, 57, 43, 0.1);
  }
  .danger:active {
    transform: scale(0.97);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .appreciate.on {
    background: var(--note-coral);
    color: #9a3b2f;
  }
  .msg {
    margin-top: 0.9rem;
    color: #9a3b2f;
    font-weight: 600;
    text-align: center;
  }
</style>
