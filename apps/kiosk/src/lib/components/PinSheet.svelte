<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The PIN step of "stay signed in on this device": choose one when the key
  // is being remembered (`set`), or type it to unlock the remembered key on
  // a later visit (`enter`). The PIN only guards the sealed key on THIS
  // device (see lib/rememberKey.ts) — it is not an account password.
  import { createEventDispatcher } from "svelte";
  import { isPin } from "@holons/core/auth";
  import { t } from "$lib/i18n";

  export let mode: "set" | "enter";
  /** Who the remembered key belongs to, for the greeting. */
  export let label = "";
  /** An error from the caller (a wrong PIN). */
  export let error = "";
  export let busy = false;
  /** After repeated wrong PINs: offer to forget the key instead. */
  export let canForget = false;

  const dispatch = createEventDispatcher<{
    pin: string;
    back: void;
    forget: void;
  }>();

  let pin = "";
  let again = "";
  let local = "";

  function submit() {
    local = "";
    if (!isPin(pin)) {
      local = $t("login.pinShort");
      return;
    }
    if (mode === "set" && pin !== again) {
      local = $t("login.pinMismatch");
      return;
    }
    dispatch("pin", pin);
  }
</script>

<form class="sheet" on:submit|preventDefault={submit}>
  <h3>
    {mode === "set" ? $t("login.pinSetTitle") : $t("login.pinEnterTitle")}
  </h3>
  <p>
    {mode === "set"
      ? $t("login.pinSetBody")
      : $t("login.pinEnterBody", { label })}
  </p>
  <label class="field">
    <span class="field__label">{$t("login.pinField")}</span>
    <input
      type="password"
      inputmode="numeric"
      autocomplete={mode === "set" ? "new-password" : "current-password"}
      bind:value={pin}
      disabled={busy}
    />
  </label>
  {#if mode === "set"}
    <label class="field">
      <span class="field__label">{$t("login.pinConfirmField")}</span>
      <input
        type="password"
        inputmode="numeric"
        autocomplete="new-password"
        bind:value={again}
        disabled={busy}
      />
    </label>
  {/if}
  {#if local || error}
    <p class="error" role="alert">{local || error}</p>
  {/if}
  <button class="primary" type="submit" disabled={busy}>
    {mode === "set" ? $t("login.pinSave") : $t("login.pinUnlock")}
  </button>
  <div class="links">
    <button type="button" class="link" on:click={() => dispatch("back")}>
      {$t("login.otherWay")}
    </button>
    {#if mode === "enter" && canForget}
      <button
        type="button"
        class="link danger"
        on:click={() => dispatch("forget")}
      >
        {$t("login.pinForget")}
      </button>
    {/if}
  </div>
</form>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
    max-width: 22rem;
    margin: 0 auto;
  }
  h3 {
    margin: 0;
    font-size: 1.3rem;
    color: var(--ink);
    text-align: center;
  }
  p {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.5;
    text-align: center;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .field__label {
    font-size: 0.8rem;
    color: var(--muted);
  }
  input {
    min-height: 48px;
    padding: 0 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--paper-deep);
    color: var(--ink);
    font-size: 1.3rem;
    letter-spacing: 0.3em;
  }
  .primary {
    min-height: 48px;
    border-radius: 14px;
    font-weight: 700;
    color: #fff;
    background: var(--teal);
  }
  .primary:disabled {
    opacity: 0.6;
  }
  .links {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .link {
    min-height: 44px;
    padding: 0 0.5rem;
    background: transparent;
    color: var(--ink-soft);
    font-size: 0.85rem;
    text-decoration: underline;
  }
  .link.danger {
    color: #9a3b2f;
  }
  .error {
    font-size: 0.85rem;
    color: #9a3b2f;
  }
</style>
