<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  import { personName } from "$lib/data";
  // Confirm who took part before a completion is recorded — the participant set
  // drives the REA accounting, so this keeps credit honest. Toggle people off
  // who didn't actually participate, and add anyone not already listed through
  // the people selector (PersonSelect: the holon's members, or a partner
  // holon's people on a search). This dialog IS the participation gate: you never
  // have to join a task before you can complete it (see complete.ts), so the
  // current user is always one of the rows.
  // Avatars come from the kiosk's /api/avatar route.
  import { get } from "svelte/store";
  import Modal from "./Modal.svelte";
  import PersonSelect from "./PersonSelect.svelte";
  import { avatarUrl } from "./Avatars.svelte";
  import { completionRequest } from "$lib/stores";
  import { currentUser } from "$lib/auth";
  import type { Member } from "$lib/members";
  import { t } from "$lib/i18n";
  import { hostsOf, type Quest } from "@holons/core/tasks";

  type Row = { key: string; name: string; on: boolean; user: Member };

  let task: Quest | null = null;
  let rows: Row[] = [];
  // The task is an event that names hosts: they are who gets credited.
  let hosted = false;

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
    // An event that names hosts credits THEM (core's creditedMembers), so the
    // dialog confirms the hosts instead of the participants.
    const hostList = hostsOf(task) as Member[];
    hosted = hostList.length > 0;
    const list = hosted
      ? hostList
      : ((Array.isArray(task.participants)
          ? task.participants
          : []) as Member[]);
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
    const me = get(currentUser);
    if (
      !hosted &&
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
  }

  function partName(p: Member): string {
    return personName(p);
  }
  function initial(p: Member): string {
    return (p?.first_name?.[0] ?? p?.username?.[0] ?? "·").toUpperCase();
  }
  function avatar(id: string | number | undefined): string {
    return id != null ? avatarUrl(id) : "";
  }

  function toggle(i: number) {
    rows[i].on = !rows[i].on;
    rows = rows;
  }
  function addRow(m: Member) {
    if (rows.some((r) => String(r.user?.id) === String(m.id))) return;
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
    const adjusted: Quest = hosted
      ? { ...req.task, hosts: participants }
      : { ...req.task, participants };
    completionRequest.set(null);
    req.onConfirm(adjusted);
  }
</script>

{#if $completionRequest}
  <Modal on:close={cancel}>
    <div class="confirm">
      <div class="glyph" aria-hidden="true"><Icon name="party" /></div>
      <h3>{$t("complete.title")}</h3>
      <p class="lead">
        {hosted ? $t("complete.leadHosts") : $t("complete.lead")}
      </p>

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
              <span class="box"
                >{#if r.on}<Icon name="check" />{/if}</span
              >
            </button>
          </li>
        {/each}
      </ul>

      <PersonSelect
        block
        label={$t("complete.addMemberAria")}
        exclude={rows.map((r) => r.user?.id)}
        federation
        on:pick={(e) => addRow(e.detail as Member)}
      >
        <button
          slot="trigger"
          let:toggle
          let:open
          type="button"
          class="add"
          aria-haspopup="listbox"
          aria-expanded={open}
          on:click={toggle}
          ><span class="add-ico">＋</span>
          {$t("complete.addMember")}</button
        >
      </PersonSelect>

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
    background: var(--teal-wash);
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
    min-height: 48px;
    background: transparent;
    font: inherit;
    font-size: 1rem;
    color: var(--ink-soft);
    text-align: left;
    cursor: pointer;
  }
  .add-ico {
    flex: 0 0 auto;
    font-size: 1.2rem;
    font-weight: 800;
    color: var(--teal-ink);
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
    color: var(--on-teal);
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: var(--ghost);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
</style>
