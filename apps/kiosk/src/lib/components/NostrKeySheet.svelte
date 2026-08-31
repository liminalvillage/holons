<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Bring-your-own Nostr key: paste an nsec (or hex), or create a fresh one
  // with a one-time backup step. Emits `login` with a ProviderLogin.
  // (Kiosk-styled port of the web app's NostrKeySheet.)
  import { createEventDispatcher } from "svelte";
  import {
    importNostrKey,
    generateNostrKey,
    previewNostrKey,
  } from "$lib/login/nostrKey";
  import type { ProviderLogin } from "$lib/login/types";
  import { t } from "$lib/i18n";

  const dispatch = createEventDispatcher<{
    login: ProviderLogin;
    back: void;
  }>();

  type Tab = "import" | "create";
  let tab: Tab = "import";

  // Import
  let input = "";
  let showInput = false;
  $: preview = input.trim() ? previewNostrKey(input) : null;
  $: importInvalid = input.trim().length > 0 && !preview;

  function submitImport() {
    try {
      dispatch("login", importNostrKey(input));
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Create
  let fresh: ReturnType<typeof generateNostrKey> | null = null;
  let saved = false;
  let copied = false;
  let error = "";

  function selectCreate() {
    tab = "create";
    error = "";
    if (!fresh) fresh = generateNostrKey();
  }
  async function copyNsec() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.nsec);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      error = $t("login.copyFailed");
    }
  }
  function submitCreate() {
    if (fresh && saved) dispatch("login", fresh);
  }
</script>

<div class="sheet">
  <div class="head">
    <button
      class="back"
      on:click={() => dispatch("back")}
      aria-label={$t("common.close")}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        aria-hidden="true"><path d="M12 4l-6 6 6 6" /></svg
      >
    </button>
    <div class="tabs" role="tablist">
      <button
        role="tab"
        aria-selected={tab === "import"}
        class:active={tab === "import"}
        on:click={() => {
          tab = "import";
          error = "";
        }}>{$t("login.importTab")}</button
      >
      <button
        role="tab"
        aria-selected={tab === "create"}
        class:active={tab === "create"}
        on:click={selectCreate}>{$t("login.createTab")}</button
      >
    </div>
  </div>

  {#if tab === "import"}
    <label class="field">
      <span class="field__label">{$t("login.keyField")}</span>
      <span class="field__row">
        {#if showInput}
          <input
            type="text"
            bind:value={input}
            placeholder="nsec1…"
            autocomplete="off"
            spellcheck="false"
          />
        {:else}
          <input
            type="password"
            bind:value={input}
            placeholder="nsec1…"
            autocomplete="off"
          />
        {/if}
        <button class="eye" on:click={() => (showInput = !showInput)}>
          {showInput ? $t("login.hide") : $t("login.show")}
        </button>
      </span>
    </label>
    {#if preview}
      <p class="preview">
        {$t("login.signsInAs", {
          npub: `${preview.npub.slice(0, 12)}…${preview.npub.slice(-6)}`,
        })}
      </p>
    {:else if importInvalid}
      <p class="preview bad">{$t("login.invalidKey")}</p>
    {/if}
    <p class="note">{$t("login.keyStays")}</p>
    <button class="primary" disabled={!preview} on:click={submitImport}
      >{$t("login.continue")}</button
    >
  {:else if fresh}
    <p class="warn">{$t("login.saveWarn")}</p>
    <div class="keybox">
      <code>{fresh.nsec}</code>
      <button class="copy" on:click={copyNsec}
        >{copied ? $t("login.copied") : $t("login.copy")}</button
      >
    </div>
    <label class="check">
      <input type="checkbox" bind:checked={saved} />
      <span>{$t("login.savedCheck")}</span>
    </label>
    <button class="primary" disabled={!saved} on:click={submitCreate}
      >{$t("login.continue")}</button
    >
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
</div>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    text-align: left;
    max-width: 24rem;
    margin: 0 auto;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .back {
    display: inline-flex;
    width: 2.4rem;
    height: 2.4rem;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: var(--paper-deep);
    color: var(--ink);
  }
  .back svg {
    width: 1rem;
    height: 1rem;
  }
  .tabs {
    display: flex;
    gap: 0.35rem;
  }
  .tabs button {
    min-height: 2.4rem;
    padding: 0 0.9rem;
    border-radius: 12px;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--ink-soft);
    background: transparent;
  }
  .tabs button.active {
    background: var(--paper-deep);
    color: var(--ink);
  }
  .field__label {
    display: block;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 0.3rem;
  }
  .field__row {
    display: flex;
    gap: 0.4rem;
  }
  .field input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0 0.8rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font-size: 0.95rem;
  }
  .eye {
    min-height: 48px;
    padding: 0 0.8rem;
    border-radius: 12px;
    background: var(--paper-deep);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .preview {
    margin: 0;
    font-size: 0.85rem;
    color: var(--teal-deep);
  }
  .preview.bad {
    color: #9a3b2f;
  }
  .note {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .warn {
    margin: 0;
    font-size: 0.9rem;
    color: #9a3b2f;
    font-weight: 600;
  }
  .keybox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    border: 1px dashed var(--line);
    background: var(--paper);
  }
  .keybox code {
    flex: 1;
    font-size: 0.78rem;
    word-break: break-all;
    color: var(--ink);
  }
  .copy {
    min-height: 40px;
    padding: 0 0.8rem;
    border-radius: 10px;
    background: var(--paper-deep);
    color: var(--ink);
    font-weight: 700;
    font-size: 0.85rem;
    flex: 0 0 auto;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--ink);
  }
  .check input {
    width: 1.2rem;
    height: 1.2rem;
  }
  .primary {
    min-height: 48px;
    border-radius: 14px;
    font-weight: 700;
    color: #fff;
    background: var(--teal);
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .primary:active {
    transform: scale(0.98);
  }
  .error {
    margin: 0;
    font-size: 0.85rem;
    color: #9a3b2f;
  }
</style>
