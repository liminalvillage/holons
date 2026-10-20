<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Claiming a project the importer seated: who I am in it and a public link
  // that shows it. Asking moves nothing — the onboarding team checks the
  // link and, if it holds, seats the key I am signed in with as the
  // project's steward. The answer shows here.
  import type {
    FlowGraphNode,
    ProjectClaim,
    ProjectSeatState,
  } from "@holons/core/flows";
  import { cleanEvidence } from "@holons/core/flows";
  import { createEventDispatcher, onMount } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import {
    claimProject,
    projectClaims,
    withdrawClaim,
  } from "$lib/projectClaims";
  import { t, type MessageKey } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  /** The project being claimed. */
  export let project: FlowGraphNode;
  /** The holon whose split seats it. */
  export let holder: string;
  /** The signed-in person: who asks. */
  export let party: string;
  export let partyName = "";

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  const STATUS: Record<ProjectClaim["status"], MessageKey> = {
    pending: "projectClaim.status.pending",
    approved: "projectClaim.status.approved",
    declined: "projectClaim.status.declined",
    withdrawn: "projectClaim.status.withdrawn",
  };

  let name = partyName;
  let role = "";
  let evidence = "";
  let note = "";
  let seat: ProjectSeatState | undefined;
  let mine: ProjectClaim | null = null;
  let loading = true;
  let busy = false;
  let error = "";

  async function read() {
    const ctx = await projectClaims(holder);
    seat = ctx.seats[project.id];
    mine =
      ctx.claims.find((c) => c.project === project.id && c.party === party) ??
      null;
    loading = false;
  }
  onMount(() => void read());

  $: waiting = mine?.status === "pending";
  $: badLink = !!evidence.trim() && !cleanEvidence(evidence);

  async function send() {
    if (badLink) {
      error = $t("projectClaim.badLink");
      return;
    }
    busy = true;
    error = "";
    try {
      await claimProject(holder, {
        project: project.id,
        party,
        name: name.trim() || undefined,
        role: role.trim() || undefined,
        evidence: evidence.trim() || undefined,
        note: note.trim() || undefined,
      });
      showNotice($t("projectClaim.sent"));
      dispatch("changed");
      dispatch("close");
    } catch {
      error = $t("projectClaim.failed");
    } finally {
      busy = false;
    }
  }

  async function takeBack() {
    if (!mine) return;
    busy = true;
    error = "";
    try {
      await withdrawClaim(holder, mine.id);
      showNotice($t("projectClaim.withdrawn"));
      await read();
      dispatch("changed");
    } catch {
      error = $t("projectClaim.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={$t("projectClaim.title", { project: project.label })}
  on:close={() => dispatch("close")}
>
  {#if loading}
    <p class="muted">{$t("fund.reading")}</p>
  {:else}
    {#if mine}
      <p class="notice" class:warn={mine.status === "declined"}>
        {$t(STATUS[mine.status])}
        {#if mine.reason}— {mine.reason}{/if}
      </p>
    {/if}

    {#if waiting}
      <button class="btn quiet wide" on:click={takeBack} disabled={busy}
        >{$t("projectClaim.withdraw")}</button
      >
      {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    {:else if mine?.status === "approved"}
      <!-- Nothing to ask: the answer above says it all. -->
    {:else if seat === "claimed"}
      <p class="notice">{$t("projectClaim.claimed")}</p>
    {:else if seat === "closed" || !seat}
      <p class="notice warn">{$t("projectClaim.closed")}</p>
    {:else}
      <p class="muted lead">
        {$t("projectClaim.lead", { project: project.label })}
      </p>
      <p class="notice">{$t("projectClaim.public")}</p>
      <form on:submit|preventDefault={send}>
        <label class="field">
          <span>{$t("projectClaim.name")}</span>
          <input bind:value={name} maxlength="120" autocomplete="name" />
        </label>
        <label class="field">
          <span>{$t("projectClaim.role")}</span>
          <input bind:value={role} maxlength="120" />
        </label>
        <label class="field">
          <span>{$t("projectClaim.evidence")}</span>
          <input
            bind:value={evidence}
            type="url"
            inputmode="url"
            maxlength="300"
            placeholder="https://"
            aria-invalid={badLink}
          />
        </label>
        <label class="field">
          <span>{$t("projectClaim.note")}</span>
          <textarea bind:value={note} rows="3" maxlength="500"></textarea>
        </label>
        {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
        <button
          class="btn wide"
          type="submit"
          disabled={busy || !evidence.trim() || badLink}
          >{busy ? $t("claim.sending") : $t("projectClaim.send")}</button
        >
      </form>
    {/if}
  {/if}
</BottomSheet>

<style>
  .lead {
    margin-bottom: 12px;
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
  input,
  textarea {
    width: 100%;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  input {
    min-height: var(--tap);
    padding: 0 14px;
  }
  input[aria-invalid="true"] {
    border-color: var(--warn);
  }
  textarea {
    resize: vertical;
  }
  .wide {
    width: 100%;
  }
  .notice {
    margin-bottom: 12px;
  }
</style>
