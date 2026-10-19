<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Asking a fund for a seat. Who asks — me, or a project I steward — and a
  // few words on why. Asking moves nothing: the fund's stewards read it and
  // decide, and the answer shows on the account that asked.
  import type { Application, FlowGraphNode } from "@holons/core/flows";
  import { createEventDispatcher, onMount } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import { apply, fundApplications, withdraw } from "$lib/applications";
  import { t, type MessageKey } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  /** The fund being asked. */
  export let fund: FlowGraphNode;
  /** The accounts the signed-in person may ask for: themselves first. */
  export let applicants: { id: string; label: string }[] = [];

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  const STATUS: Record<Application["status"], MessageKey> = {
    pending: "apply.status.pending",
    approved: "apply.status.approved",
    declined: "apply.status.declined",
    withdrawn: "apply.status.withdrawn",
  };

  let who = applicants[0]?.id ?? "";
  let note = "";
  let open = true;
  let standing: Record<string, Application> = {};
  let loading = true;
  let busy = false;
  let error = "";

  async function read() {
    const ctx = await fundApplications(fund.id);
    open = ctx.open;
    standing = ctx.byParty;
    loading = false;
  }
  onMount(() => void read());

  $: mine = standing[who] ?? null;
  $: waiting = mine?.status === "pending";

  async function send() {
    busy = true;
    error = "";
    try {
      await apply(fund.id, {
        party: who,
        name: applicants.find((a) => a.id === who)?.label,
        note: note.trim() || undefined,
      });
      showNotice($t("apply.sent"));
      dispatch("changed");
      dispatch("close");
    } catch {
      error = $t("apply.failed");
    } finally {
      busy = false;
    }
  }

  async function takeBack() {
    busy = true;
    error = "";
    try {
      await withdraw(fund.id, who);
      showNotice($t("apply.withdrawn"));
      await read();
      dispatch("changed");
    } catch {
      error = $t("apply.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={$t("apply.title", { fund: fund.label })}
  on:close={() => dispatch("close")}
>
  {#if loading}
    <p class="muted">{$t("fund.reading")}</p>
  {:else if !open}
    <p class="notice warn">{$t("apply.closed", { fund: fund.label })}</p>
  {:else}
    <p class="muted lead">{$t("apply.lead", { fund: fund.label })}</p>

    {#if applicants.length > 1}
      <fieldset>
        <legend>{$t("apply.who")}</legend>
        {#each applicants as a (a.id)}
          <label class="pick">
            <input type="radio" bind:group={who} value={a.id} />
            <span>{a.label}</span>
          </label>
        {/each}
      </fieldset>
    {/if}

    {#if mine}
      <p class="notice" class:warn={mine.status === "declined"}>
        {$t(STATUS[mine.status])}
        {#if mine.reason}— {mine.reason}{/if}
      </p>
    {/if}

    {#if waiting}
      <button class="btn quiet wide" on:click={takeBack} disabled={busy}
        >{$t("apply.withdraw")}</button
      >
    {:else if mine?.status !== "approved"}
      <form on:submit|preventDefault={send}>
        <label class="field">
          <span>{$t("apply.note")}</span>
          <textarea bind:value={note} rows="4" maxlength="500"></textarea>
        </label>
        {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
        <button class="btn wide" type="submit" disabled={busy || !who}
          >{busy ? $t("claim.sending") : $t("apply.send")}</button
        >
      </form>
    {/if}
    {#if error && waiting}<p class="notice warn" role="alert">{error}</p>{/if}
  {/if}
</BottomSheet>

<style>
  .lead {
    margin-bottom: 12px;
  }
  fieldset {
    border: 0;
    margin: 0 0 12px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  legend {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 6px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--tap);
    padding: 0 12px;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    font-weight: 600;
  }
  .pick input {
    width: 20px;
    height: 20px;
    accent-color: var(--teal);
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 12px 0;
  }
  .field span {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  textarea {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    resize: vertical;
  }
  .wide {
    width: 100%;
  }
  .notice {
    margin-bottom: 12px;
  }
</style>
