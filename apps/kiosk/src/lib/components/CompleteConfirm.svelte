<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Confirm who took part before a completion is recorded — the participant set
  // drives the REA accounting, so this keeps credit honest. Toggle people off
  // who didn't actually participate, and add anyone from the holon's members
  // who isn't already listed. This dialog IS the participation gate: you never
  // have to join a task before you can complete it (see complete.ts), so the
  // current user is always one of the rows.
  // Avatars come from the kiosk's /api/avatar route.
  import { get } from "svelte/store";
  import Modal from "./Modal.svelte";
  import { avatarUrl } from "./Avatars.svelte";
  import { completionRequest, holonId } from "$lib/stores";
  import { telegramUser } from "$lib/auth";
  import { getHolosphere } from "$lib/holosphere";
  import { t } from "$lib/i18n";
  import type { Quest } from "@holons/core/tasks";

  type Member = {
    id: string | number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  type Row = { key: string; name: string; on: boolean; user: Member };

  let task: Quest | null = null;
  let rows: Row[] = [];
  let members: Member[] = []; // the holon's `users` lens

  // Rebuild whenever a new request arrives.
  $: sync($completionRequest);
  function sync(req: { task: Quest } | null) {
    if (!req) {
      task = null;
      rows = [];
      return;
    }
    if (req.task === task) return;
    task = req.task;
    const list = (
      Array.isArray(task.participants) ? task.participants : []
    ) as Member[];
    rows = list.map((p, i) => ({
      key: String(p?.id ?? p?.username ?? `p${i}`),
      name: partName(p),
      on: true,
      user: p,
    }));
    // The person completing is always offered as a row, so crediting yourself
    // never means joining the task first. Pre-ticked only when nobody else is
    // on the task — with a team already listed, tapping ✓ for them shouldn't
    // quietly hand you a share of the credit.
    const me = get(telegramUser);
    if (
      me?.id != null &&
      !rows.some((r) => String(r.user?.id) === String(me.id))
    )
      rows = [
        ...rows,
        {
          key: String(me.id),
          name: partName(me as Member),
          on: rows.length === 0,
          user: me as Member,
        },
      ];
    void loadMembers();
  }

  async function loadMembers() {
    const hid = get(holonId);
    if (!hid) return;
    try {
      const hs = await getHolosphere();
      const all = await hs.getAll(hid, "users");
      members = (
        Array.isArray(all) ? all : Object.values(all ?? {})
      ) as Member[];
    } catch {
      members = [];
    }
  }

  function partName(p: Member): string {
    const full = [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim();
    return full || (p?.username ? `@${p.username}` : `#${p?.id ?? "?"}`);
  }
  function initial(p: Member): string {
    return (p?.first_name?.[0] ?? p?.username?.[0] ?? "·").toUpperCase();
  }
  function avatar(id: string | number | undefined): string {
    return id != null ? avatarUrl(id) : "";
  }

  // Members not already in the list, for the "add" dropdown.
  $: available = members.filter(
    (m) =>
      m?.id != null && !rows.some((r) => String(r.user?.id) === String(m.id)),
  );

  function toggle(i: number) {
    rows[i].on = !rows[i].on;
    rows = rows;
  }
  function addMember(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    (e.target as HTMLSelectElement).value = "";
    if (!id) return;
    const m = members.find((x) => String(x.id) === id);
    if (!m) return;
    rows = [
      ...rows,
      { key: String(m.id), name: partName(m), on: true, user: m },
    ];
  }

  function cancel() {
    completionRequest.set(null);
  }
  function confirm() {
    const req = get(completionRequest);
    if (!req) return;
    const participants = rows
      .filter((r) => r.on)
      .map((r) => ({
        id: r.user?.id,
        username: r.user?.username,
        first_name: r.user?.first_name,
        last_name: r.user?.last_name,
      }));
    const adjusted: Quest = { ...req.task, participants };
    completionRequest.set(null);
    req.onConfirm(adjusted);
  }
</script>

{#if $completionRequest}
  <Modal on:close={cancel}>
    <div class="confirm">
      <div class="glyph" aria-hidden="true">🎉</div>
      <h3>{$t("complete.title")}</h3>
      <p class="lead">{$t("complete.lead")}</p>

      <ul class="people">
        {#each rows as r, i (r.key)}
          <li>
            <button
              class="row"
              class:on={r.on}
              role="switch"
              aria-checked={r.on}
              on:click={() => toggle(i)}
            >
              <span class="av">
                <span class="ini">{initial(r.user)}</span>
                {#if r.user?.id != null}
                  <img
                    src={avatar(r.user.id)}
                    alt=""
                    loading="lazy"
                    on:error={(e) =>
                      ((e.currentTarget as HTMLImageElement).style.visibility =
                        "hidden")}
                  />
                {/if}
              </span>
              <span class="nm">{r.name}</span>
              <span class="box">{r.on ? "✓" : ""}</span>
            </button>
          </li>
        {/each}
      </ul>

      {#if available.length}
        <label class="add">
          <span class="add-ico">＋</span>
          <select
            on:change={addMember}
            aria-label={$t("complete.addMemberAria")}
          >
            <option value="">{$t("complete.addMember")}</option>
            {#each available as m (m.id)}
              <option value={String(m.id)}>{partName(m)}</option>
            {/each}
          </select>
        </label>
      {/if}

      <div class="actions">
        <button class="primary" on:click={confirm}
          >{$t("complete.confirm")}</button
        >
        <button class="ghost" on:click={cancel}>{$t("common.cancel")}</button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .confirm {
    text-align: center;
    padding: 0.4rem 0.25rem;
  }
  .glyph {
    font-size: 2rem;
  }
  h3 {
    margin: 0.3rem 0 0.5rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  .lead {
    color: var(--ink-soft);
    line-height: 1.5;
    margin: 0 auto 1rem;
    max-width: 22rem;
  }
  .people {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    max-height: 38vh;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    padding: 0.45rem 0.7rem;
    border-radius: 14px;
    background: var(--paper);
    color: var(--muted);
    text-align: left;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .row.on {
    background: #e7f3f1;
    color: var(--ink);
  }
  .av {
    flex: 0 0 auto;
    position: relative;
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
  }
  .av .ini {
    font-size: 0.85rem;
    font-weight: 800;
    color: #fff;
  }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .nm {
    flex: 1;
    font-weight: 700;
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .box {
    flex: 0 0 auto;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 7px;
    display: grid;
    place-items: center;
    font-weight: 800;
    color: #fff;
    background: var(--line);
  }
  .row.on .box {
    background: var(--teal);
  }

  .add {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.2rem 0.4rem 0.2rem 0.7rem;
    border: 1.5px dashed var(--line);
    border-radius: 14px;
    margin-bottom: 0.2rem;
  }
  .add-ico {
    flex: 0 0 auto;
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--teal-deep);
  }
  .add select {
    flex: 1;
    min-height: 44px;
    border: none;
    background: transparent;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
  }
  .add select:focus {
    outline: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.1rem;
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
</style>
