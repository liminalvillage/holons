<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Start a fund or a project from nothing. Core founds it with the key
  // signed in here — that key is its first admin — and gives it three empty
  // rings; the next step is seating who it passes money to.
  //
  // Only a person's own key may start one: a Telegram sign-in writes with a
  // key this browser holds, and clearing the browser would orphan the holon.
  // So without one, the sheet asks for a key first (paste one, or create
  // one and keep its backup).
  //
  // On a device with no Pot yet, what is started here is the Pot: the root
  // the map opens on, and that others are invited into.
  import { HOLON_DESCRIPTION_MAX, HOLON_NAME_MAX } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import LoginCard from "./LoginCard.svelte";
  import NostrKeySheet from "./NostrKeySheet.svelte";
  import { currentUser, loginWithKey } from "$lib/auth";
  import { failure } from "$lib/format";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { readRememberedKey } from "$lib/rememberKey";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { noPot, start } from "$lib/start";

  const dispatch = createEventDispatcher<{ close: void; started: string }>();

  let name = "";
  let about = "";
  let busy = false;
  let error = "";
  let keying = false;
  /** Nothing on this device yet: what is started here becomes the Pot. */
  const first = noPot();

  /** This person's key, still sealed on this device behind its PIN. */
  $: remembered =
    !$sessionKeyPub && !!$currentUser
      ? readRememberedKey()?.pubkey === String($currentUser.id).toLowerCase()
      : false;

  async function go() {
    if (!name.trim()) return;
    busy = true;
    error = "";
    try {
      const holon = await start({ name, description: about });
      showNotice($t("start.done"));
      dispatch("started", holon);
    } catch (err) {
      error = failure($t("start.failed"), err);
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={first ? $t("start.potTitle") : $t("start.title")}
  on:close={() => dispatch("close")}
>
  {#if !$sessionKeyPub}
    <p class="notice">{$t("start.keyNeeded")}</p>
    {#if remembered}
      <LoginCard />
    {:else if keying}
      <NostrKeySheet
        on:login={(e) => void loginWithKey(e.detail)}
        on:back={() => (keying = false)}
      />
    {:else}
      <button class="btn wide" on:click={() => (keying = true)}
        >{$t("start.signInKey")}</button
      >
    {/if}
  {:else}
    <p class="muted lead">
      {first ? $t("start.potLead") : $t("start.lead")}
    </p>
    <form on:submit|preventDefault={go}>
      <label class="field">
        <span>{$t("start.name")}</span>
        <input
          bind:value={name}
          maxlength={HOLON_NAME_MAX}
          autocomplete="off"
          required
        />
      </label>
      <label class="field">
        <span>{$t("start.about")}</span>
        <textarea bind:value={about} rows="3" maxlength={HOLON_DESCRIPTION_MAX}
        ></textarea>
      </label>
      <p class="muted small">{$t("start.admin")}</p>
      {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
      <button class="btn wide" type="submit" disabled={busy || !name.trim()}
        >{busy ? $t("start.starting") : $t("start.go")}</button
      >
    </form>
  {/if}
</BottomSheet>

<style>
  .lead {
    margin-bottom: 8px;
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
  }
  .small {
    font-size: 0.85rem;
    margin-bottom: 12px;
  }
  .wide {
    width: 100%;
  }
</style>
