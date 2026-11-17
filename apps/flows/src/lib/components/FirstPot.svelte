<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Where everything starts when there is nothing yet: no Pot on this
  // device, or one nobody can read. Two ways in — start a Pot with your own
  // key (it becomes the root, and you its first admin), or open the one
  // somebody sent you a link to. From there, others are invited by link and
  // seated on the split; nothing here is a separate kind of setup.
  import { goto } from "$app/navigation";
  import { seatableParty } from "@holons/core/flows";
  import Icon from "./Icon.svelte";
  import StartSheet from "./StartSheet.svelte";
  import { choosePot } from "$lib/graph";
  import { t } from "$lib/i18n";

  let starting = false;
  let link = "";
  let bad = false;
  let opening = false;

  /** The Pot a pasted link or id names: its `?pot=`, else the holon it opens. */
  function potFrom(raw: string): string | null {
    const s = raw.trim();
    const q = /[?&]pot=([^&#\s]+)/.exec(s);
    if (q) {
      try {
        return decodeURIComponent(q[1]);
      } catch {
        return q[1];
      }
    }
    const party = seatableParty(s);
    return party?.kind === "holon" ? party.id : null;
  }

  async function open() {
    const id = potFrom(link);
    bad = !id;
    if (!id) return;
    opening = true;
    try {
      await choosePot(id);
      await goto("/");
    } finally {
      opening = false;
    }
  }
</script>

<section class="card first">
  <h2>{$t("first.title")}</h2>
  <p>{$t("first.lead")}</p>
  <button class="btn wide" on:click={() => (starting = true)}
    ><Icon name="plus" />{$t("first.start")}</button
  >
  <form on:submit|preventDefault={open}>
    <label class="field">
      <span>{$t("first.open")}</span>
      <input
        bind:value={link}
        on:input={() => (bad = false)}
        placeholder={$t("first.openHint")}
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    {#if bad}<p class="notice warn" role="alert">{$t("first.bad")}</p>{/if}
    <button
      class="btn quiet wide"
      type="submit"
      disabled={opening || !link.trim()}
      ><Icon name="link" />{$t("first.go")}</button
    >
  </form>
</section>

{#if starting}
  <StartSheet
    on:close={() => (starting = false)}
    on:started={() => {
      starting = false;
      void goto("/");
    }}
  />
{/if}

<style>
  .first {
    display: grid;
    gap: 12px;
    max-width: 30rem;
    margin: 0 auto;
    padding: 20px 18px;
    text-align: left;
    color: var(--ink);
  }
  h2 {
    margin: 0;
    font-size: 1.25rem;
    line-height: 1.2;
  }
  p {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.92rem;
  }
  form {
    display: grid;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
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
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .wide {
    width: 100%;
  }
</style>
