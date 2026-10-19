<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A fund's waiting applications, for its stewards. Approving seats the
  // applicant on the outermost ring — where it can then be moved from the
  // split editor; declining says why. Nothing here is shown to anyone else.
  import type { Application } from "@holons/core/flows";
  import { createEventDispatcher, onMount } from "svelte";
  import {
    approve,
    decline,
    fundApplications,
    setOpen,
  } from "$lib/applications";
  import { labelOf } from "$lib/graph";
  import { locale, t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  export let fund: string;

  const dispatch = createEventDispatcher<{ changed: void }>();

  let pending: Application[] = [];
  let open = true;
  let loaded = false;
  let busy = "";
  let declining = "";
  let reason = "";

  async function read() {
    const ctx = await fundApplications(fund);
    pending = ctx.pending;
    open = ctx.open;
    loaded = true;
  }
  onMount(() => void read());

  const nameOf = (a: Application) => {
    const known = labelOf(a.party);
    return known !== a.party ? known : (a.name ?? a.party);
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
    } catch {
      showNotice($t("apply.failed"));
    } finally {
      busy = "";
    }
  }
</script>

{#if loaded}
  <h2 class="section-title">
    {$t("inbox.title")}{#if pending.length}
      · {pending.length}{/if}
  </h2>
  <div class="card inbox">
    {#if !pending.length}
      <p class="muted">{open ? $t("inbox.none") : $t("inbox.closed")}</p>
    {/if}
    {#each pending as a (a.id)}
      <article>
        <header>
          <b>{nameOf(a)}</b>
          <i
            >{new Date(a.createdAt * 1000).toLocaleDateString($locale)}
            {#if !a.verified}· {$t("inbox.unverified")}{/if}</i
          >
        </header>
        {#if a.note}<p class="note">{a.note}</p>{/if}
        {#if declining === a.id}
          <form
            on:submit|preventDefault={() =>
              run(
                a.id,
                () => decline(fund, a.id, reason.trim() || undefined),
                $t("inbox.declined"),
              )}
          >
            <label class="sr-only" for="why-{a.id}">{$t("inbox.reason")}</label>
            <input
              id="why-{a.id}"
              bind:value={reason}
              placeholder={$t("inbox.reason")}
              maxlength="200"
            />
            <div class="acts">
              <button class="btn small" type="submit" disabled={!!busy}
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
                  a.id,
                  () => approve(fund, a.id),
                  $t("inbox.approved", { name: nameOf(a) }),
                )}>{$t("inbox.approve")}</button
            >
            <button
              class="btn quiet small"
              disabled={!!busy}
              on:click={() => {
                declining = a.id;
                reason = "";
              }}>{$t("claim.decline")}</button
            >
          </div>
        {/if}
      </article>
    {/each}
    <label class="toggle">
      <input
        type="checkbox"
        checked={open}
        disabled={!!busy}
        on:change={(e) => {
          const next = e.currentTarget.checked;
          void run(
            "open",
            () => setOpen(fund, next),
            next ? $t("inbox.opened") : $t("inbox.closedNow"),
          );
        }}
      />
      <span>{$t("inbox.takeApplications")}</span>
    </label>
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
  header {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  header b {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  header i {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
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
  input:not([type]) {
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
  .toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-weight: 600;
    font-size: 0.92rem;
  }
  .toggle input {
    width: 22px;
    height: 22px;
    accent-color: var(--teal);
  }
</style>
