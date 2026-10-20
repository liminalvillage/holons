<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The project claims waiting on a holon that seats projects, for its
  // stewards — the onboarding team's master keys. Each shows who asks, for
  // which project, and the link to check. Approving seats the asker's key
  // as the project's steward; declining says why. Shown to nobody else, and
  // to them only when this holon seats something claimable.
  import type { ProjectClaim } from "@holons/core/flows";
  import { createEventDispatcher, onMount } from "svelte";
  import {
    approveClaim,
    declineClaim,
    projectClaims,
  } from "$lib/projectClaims";
  import { labelOf } from "$lib/graph";
  import { locale, t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  /** The seating holon. */
  export let holder: string;

  const dispatch = createEventDispatcher<{ changed: void }>();

  let pending: ProjectClaim[] = [];
  let claimable = false;
  let loaded = false;
  let busy = "";
  let declining = "";
  let reason = "";

  async function read() {
    const ctx = await projectClaims(holder);
    pending = ctx.pending;
    claimable = Object.values(ctx.seats).some((s) => s === "open");
    loaded = true;
  }
  onMount(() => void read());

  const nameOf = (c: ProjectClaim) => {
    const known = labelOf(c.party);
    return known !== c.party ? known : (c.name ?? c.party);
  };

  async function run(id: string, work: () => Promise<unknown>, done: string) {
    busy = id;
    try {
      await work();
      showNotice(done);
      declining = "";
      reason = "";
      await read();
      dispatch("changed");
    } catch (e) {
      showNotice(
        /admin of the project/.test(String((e as Error)?.message))
          ? $t("projectClaim.notProjectAdmin")
          : $t("projectClaim.failed"),
      );
    } finally {
      busy = "";
    }
  }
</script>

{#if loaded && (pending.length || claimable)}
  <h2 class="section-title">
    {$t("projectClaim.inbox")}{#if pending.length}
      · {pending.length}{/if}
  </h2>
  <div class="card inbox">
    {#if !pending.length}
      <p class="muted">{$t("projectClaim.inboxNone")}</p>
    {/if}
    {#each pending as c (c.id)}
      <article>
        <header>
          <b
            >{nameOf(c)}{#if c.role}<span class="role">
                · {c.role}</span
              >{/if}</b
          >
          <span class="for"
            >{$t("projectClaim.for", { project: labelOf(c.project) })}</span
          >
          <i
            >{new Date(c.createdAt * 1000).toLocaleDateString($locale)}
            {#if !c.verified}· {$t("inbox.unverified")}{/if}</i
          >
        </header>
        {#if c.evidence}
          <a
            class="evidence"
            href={c.evidence}
            target="_blank"
            rel="noopener noreferrer nofollow">{$t("projectClaim.open")} ↗</a
          >
          <code class="url">{c.evidence}</code>
        {/if}
        {#if c.note}<p class="note">{c.note}</p>{/if}
        {#if declining === c.id}
          <form
            on:submit|preventDefault={() =>
              run(
                c.id,
                () => declineClaim(holder, c.id, reason.trim()),
                $t("projectClaim.declined"),
              )}
          >
            <label class="sr-only" for="why-{c.id}"
              >{$t("projectClaim.reason")}</label
            >
            <input
              id="why-{c.id}"
              bind:value={reason}
              placeholder={$t("projectClaim.reason")}
              maxlength="200"
              required
            />
            <div class="acts">
              <button
                class="btn small"
                type="submit"
                disabled={!!busy || !reason.trim()}
                >{$t("claim.decline")}</button
              >
              <button
                class="btn quiet small"
                type="button"
                on:click={() => (declining = "")}>{$t("nav.back")}</button
              >
            </div>
          </form>
        {:else}
          <div class="acts">
            <button
              class="btn small"
              disabled={!!busy}
              on:click={() =>
                run(
                  c.id,
                  () => approveClaim(holder, c.id),
                  $t("projectClaim.approved", {
                    name: nameOf(c),
                    project: labelOf(c.project),
                  }),
                )}>{$t("projectClaim.approve")}</button
            >
            <button
              class="btn quiet small"
              disabled={!!busy}
              on:click={() => {
                declining = c.id;
                reason = "";
              }}>{$t("claim.decline")}</button
            >
          </div>
        {/if}
      </article>
    {/each}
  </div>
{/if}

<style>
  .inbox {
    display: grid;
    gap: 14px;
  }
  article {
    display: grid;
    gap: 6px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  article:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  header b {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .role {
    font-weight: 500;
    color: var(--ink-soft);
  }
  .for {
    font-size: 0.9rem;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  header i {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
  }
  .evidence {
    font-weight: 700;
    color: var(--teal-ink);
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }
  .url {
    font-size: 0.78rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .note {
    font-size: 0.94rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.86rem;
  }
  input {
    width: 100%;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
</style>
