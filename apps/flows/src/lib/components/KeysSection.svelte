<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Who holds a holon's keys, for its admins to change. Admins decide its
  // split together — more than half must say yes (core's split proposals) —
  // and answer its applications; members can be seated on its rings. Keys
  // are seated and unseated on the holon's signed members log
  // (`addHolonMember` / `removeHolonMember`); an admin cannot remove
  // themselves, so a holon is never left without one by accident.
  import { seatableParty, splitQuorum } from "@holons/core/flows";
  import type { Role } from "@holons/core/protocol";
  import { shortId } from "@holons/core/identity";
  import Icon from "./Icon.svelte";
  import { failure } from "$lib/format";
  import { labelOf } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { holonKeys, seatKey, unseatKey, type HolonKey } from "$lib/start";

  export let holon: string;

  let keys: HolonKey[] = [];
  let reading = true;
  let input = "";
  let busy = false;
  let error = "";

  async function read() {
    reading = true;
    keys = await holonKeys(holon);
    reading = false;
  }
  let readFor = "";
  $: if (holon !== readFor) {
    readFor = holon;
    void read();
  }

  $: admins = keys.filter((k) => k.role === "admin").length;
  $: party = seatableParty(input);
  $: valid = !!party && /^[0-9a-f]{64}$/.test(party.id);
  $: bad = !!input.trim() && !valid;
  const nameOf = (key: string) => {
    const label = labelOf(key);
    return label && label !== key ? label : shortId(key);
  };

  async function add(role: Role) {
    if (!valid || !party) return;
    busy = true;
    error = "";
    try {
      await seatKey(holon, party.id, role);
      input = "";
      showNotice($t("keys.added"));
      await read();
    } catch (err) {
      error = failure($t("keys.failed"), err);
    } finally {
      busy = false;
    }
  }

  async function remove(k: HolonKey) {
    busy = true;
    error = "";
    try {
      await unseatKey(holon, k.key);
      showNotice($t("keys.removed"));
      await read();
    } catch (err) {
      error = failure($t("keys.failed"), err);
    } finally {
      busy = false;
    }
  }
</script>

<h2 class="section-title">{$t("keys.title")}</h2>
<section class="card keys">
  <p class="muted lead">
    {admins > 1
      ? $t("keys.leadMany", { n: splitQuorum(admins), of: admins })
      : $t("keys.leadOne")}
  </p>
  {#if reading}
    <p class="muted">…</p>
  {:else if keys.length}
    <ul>
      {#each keys as k (k.key)}
        <li>
          <span class="who">
            <b>{nameOf(k.key)}</b>
            {#if k.key === $sessionKeyPub}<i>{$t("keys.you")}</i>{/if}
          </span>
          <span class="role {k.role}"
            >{k.role === "admin" ? $t("keys.admin") : $t("keys.member")}</span
          >
          {#if k.key !== $sessionKeyPub}
            <button
              class="x"
              disabled={busy}
              aria-label={$t("keys.remove", { name: nameOf(k.key) })}
              on:click={() => remove(k)}><Icon name="close" /></button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{$t("keys.none")}</p>
  {/if}

  <form on:submit|preventDefault={() => add("admin")}>
    <label class="field">
      <span>{$t("keys.add")}</span>
      <input
        bind:value={input}
        placeholder="npub1…"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-invalid={bad}
      />
    </label>
    {#if bad}<p class="notice warn">{$t("keys.bad")}</p>{/if}
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <div class="row">
      <button class="btn" type="submit" disabled={busy || !valid}
        >{$t("keys.asAdmin")}</button
      >
      <button
        class="btn quiet"
        type="button"
        disabled={busy || !valid}
        on:click={() => add("member")}>{$t("keys.asMember")}</button
      >
    </div>
  </form>
</section>

<style>
  .keys {
    display: grid;
    gap: 10px;
    padding: 16px;
  }
  .lead {
    font-size: 0.88rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow-wrap: anywhere;
  }
  .who i {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .role {
    flex: 0 0 auto;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .role.member {
    background: var(--paper);
    color: var(--ink-soft);
  }
  .x {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    display: inline-grid;
    place-items: center;
    border: 0;
    background: none;
    color: var(--ink-soft);
  }
  .field {
    display: grid;
    gap: 4px;
  }
  .field span {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  input {
    width: 100%;
    min-height: var(--tap);
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
</style>
