<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The sheet behind the dock's "+": which way in?
  //
  //   existing  paste a hub you already have — its id, its link, its name.
  //   new       start one through Telegram: a chat with the bot (a hub for
  //             you) or the bot in a group (a hub for the group). Telegram
  //             cannot hand the new chat's id back to this tab, so the deep
  //             links carry a one-time claim token out and this sheet watches
  //             the relay for the bot to redeem it — the hub then docks by
  //             itself (see lib/hubclaim.ts). A paste line stays underneath
  //             for the day the loop doesn't close on its own.
  //
  // The parent owns what "add" means (dock, home it on a cell, open it); this
  // sheet only names the hub.
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import { newClaimToken } from "@holons/core/onboarding";
  import { t } from "$lib/i18n";
  import { parseHolonAdd } from "$lib/holons";
  import { getHolosphere } from "$lib/holosphere";
  import {
    beginHubClaim,
    hubClaimUrls,
    pendingClaim,
    watchHubClaim,
  } from "$lib/hubclaim";

  /** Where to open: the chooser, the paste line, or the Telegram step. */
  export let step: "choose" | "existing" | "new" = "choose";
  /** The map cell the hub would be homed on, when one is selected. */
  export let cell: string | null = null;

  const dispatch = createEventDispatcher<{
    add: { id: string; name?: string };
    close: void;
  }>();

  // ── Paste line ───────────────────────────────────────────────────────────
  let draft = "";
  let error = "";
  let input: HTMLInputElement | undefined;

  function submit() {
    const id = parseHolonAdd(draft);
    if (!id) {
      error = $t("dock.addInvalid");
      return;
    }
    dispatch("add", { id });
  }

  async function focusInput() {
    await tick();
    input?.focus();
  }

  // ── The claim ────────────────────────────────────────────────────────────
  // One token for both links, minted when the Telegram step first shows so
  // the anchors are real hrefs; persisted (with the hand-off note) only when
  // one is actually tapped. A wait already pending on this device — they
  // left for Telegram and came back, or reloaded — is picked up instead.
  let token = "";
  let urls: { personal: string; group: string } | null = null;
  let away = false;
  let stopWatch: (() => void) | null = null;

  function armClaim() {
    if (token) return;
    const pending = pendingClaim();
    token = pending?.token ?? newClaimToken();
    // Set here, not as a `$:` off `token`: a sheet that mounts straight onto
    // this step (a resumed wait) must have its hrefs in the same pass.
    urls = hubClaimUrls(token);
    away = !!pending;
    stopWatch = watchHubClaim(getHolosphere(), token, (claim) =>
      dispatch("add", { id: claim.holon, name: claim.name }),
    );
  }

  function handOff() {
    beginHubClaim(token);
    away = true;
  }

  $: if (step === "new") armClaim();
  $: if (step === "existing") void focusInput();

  onDestroy(() => stopWatch?.());
</script>

{#snippet tgIcon()}
  <svg class="tg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path
      d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
    />
  </svg>
{/snippet}

{#snippet pasteForm()}
  <form class="paste" on:submit|preventDefault={submit}>
    <input
      type="text"
      bind:value={draft}
      bind:this={input}
      on:input={() => (error = "")}
      placeholder={$t("dock.addPlaceholder")}
      aria-label={$t("dock.addPlaceholder")}
      aria-invalid={!!error}
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <button type="submit" class="go">{$t("hub.open")}</button>
    {#if error}
      <span class="err" role="alert">{error}</span>
    {/if}
  </form>
{/snippet}

<div class="sheet">
  {#if step === "choose"}
    <h3>{cell ? $t("hub.addHereTitle") : $t("hub.addTitle")}</h3>
    <div class="opts">
      <button type="button" class="opt" on:click={() => (step = "existing")}>
        <span class="opt__icon" aria-hidden="true">⬡</span>
        <span class="opt__text">
          <b>{$t("hub.haveTitle")}</b>
          <small>{$t("hub.haveBody")}</small>
        </span>
      </button>
      <button
        type="button"
        class="opt opt--new"
        on:click={() => (step = "new")}
      >
        <span class="opt__icon" aria-hidden="true">+</span>
        <span class="opt__text">
          <b>{$t("hub.newTitle")}</b>
          <small>{$t("hub.newBody")}</small>
        </span>
      </button>
    </div>
  {:else if step === "existing"}
    <h3>{$t("hub.haveTitle")}</h3>
    <p class="hint"><code>/id</code> <span>{$t("hub.pasteHint")}</span></p>
    {@render pasteForm()}
    <button type="button" class="back" on:click={() => (step = "choose")}>
      ← {$t("hub.back")}
    </button>
  {:else}
    <h3>{$t("hub.newTitle")}</h3>
    <p class="lead">{$t("hub.newLead")}</p>
    <div class="ways">
      <a
        class="way"
        href={urls?.personal}
        target="_blank"
        rel="noopener"
        on:click={handOff}
      >
        {@render tgIcon()}
        <span class="way__text">
          <b>{$t("hub.personal")}</b>
          <small>{$t("hub.personalHint")}</small>
        </span>
      </a>
      <a
        class="way"
        href={urls?.group}
        target="_blank"
        rel="noopener"
        on:click={handOff}
      >
        {@render tgIcon()}
        <span class="way__text">
          <b>{$t("hub.group")}</b>
          <small>{$t("hub.groupHint")}</small>
        </span>
      </a>
    </div>
    <div class="wait" class:away role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span class="wait__text">
        <b>{$t("hub.waiting")}</b>
        <small>{$t("hub.waitingBody")}</small>
      </span>
    </div>
    <details class="fallback">
      <summary>{$t("hub.orPaste")}</summary>
      {@render pasteForm()}
    </details>
    <button type="button" class="back" on:click={() => (step = "choose")}>
      ← {$t("hub.back")}
    </button>
  {/if}
</div>

<style>
  .sheet {
    min-width: min(24rem, 82vw);
    text-transform: none;
    letter-spacing: 0;
  }
  h3 {
    margin: 0 0 0.6rem;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--ink);
  }
  .lead,
  .hint {
    margin: 0 0 0.9rem;
    font-size: 0.86rem;
    line-height: 1.5;
    font-weight: 500;
    color: var(--ink-soft);
  }
  .hint code {
    padding: 0.05rem 0.4rem;
    border-radius: 6px;
    background: color-mix(in srgb, var(--ink) 8%, transparent);
    font-size: 0.82rem;
  }

  /* ── The chooser ───────────────────────────────────────────────────────── */
  .opts {
    display: grid;
    gap: 0.6rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    width: 100%;
    padding: 0.9rem 1rem;
    border-radius: 14px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: transform 120ms ease;
  }
  .opt:active {
    transform: scale(0.98);
  }
  .opt__icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.6rem;
    height: 2.6rem;
    border-radius: 50%;
    border: 1.5px solid currentColor;
    font-size: 1.3rem;
    line-height: 1;
  }
  .opt--new {
    border-color: var(--teal-deep);
    background: var(--teal);
    color: var(--paper);
  }
  .opt--new .opt__icon {
    background: color-mix(in srgb, var(--paper) 22%, transparent);
    border-color: color-mix(in srgb, var(--paper) 55%, transparent);
  }
  .opt__text,
  .way__text,
  .wait__text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .opt__text b,
  .way__text b,
  .wait__text b {
    font-size: 0.98rem;
    font-weight: 800;
  }
  .opt__text small,
  .way__text small,
  .wait__text small {
    font-size: 0.8rem;
    font-weight: 500;
    line-height: 1.4;
    opacity: 0.85;
  }

  /* ── The two ways out ──────────────────────────────────────────────────── */
  .ways {
    display: grid;
    gap: 0.6rem;
  }
  .way {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    border-radius: 14px;
    background: var(--teal);
    color: var(--paper);
    text-decoration: none;
    transition: transform 120ms ease;
  }
  .way:active {
    transform: scale(0.98);
  }
  .tg {
    flex: none;
    width: 1.6rem;
    height: 1.6rem;
  }

  /* ── Waiting on the bot ────────────────────────────────────────────────── */
  .wait {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.9rem;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    border: 1px dashed var(--line);
    color: var(--muted);
    opacity: 0.7;
    transition: opacity 200ms ease;
  }
  .wait.away {
    opacity: 1;
    color: var(--ink);
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 10%, transparent);
  }
  .spinner {
    flex: none;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    border: 2.5px solid color-mix(in srgb, currentColor 25%, transparent);
    border-top-color: currentColor;
    animation: hub-spin 1s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
  @keyframes hub-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── The paste line ────────────────────────────────────────────────────── */
  .fallback {
    margin-top: 0.8rem;
  }
  .fallback summary {
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .fallback .paste {
    margin-top: 0.6rem;
  }
  .paste {
    position: relative;
    display: flex;
    gap: 0.4rem;
  }
  .paste input {
    flex: 1;
    min-width: 0;
    height: 2.7rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    border: 1.5px solid var(--teal);
    background: var(--card);
    color: var(--ink);
    font-size: 0.95rem;
    font-family: inherit;
  }
  .paste input:focus {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 20%, transparent);
  }
  .paste .go {
    flex: none;
    height: 2.7rem;
    padding: 0 1rem;
    border-radius: 999px;
    background: var(--teal);
    color: #fff;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .paste .go:active {
    transform: scale(0.96);
  }
  .paste .err {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0.4rem;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--note-coral);
  }
  .paste:has(.err) {
    margin-bottom: 1.3rem;
  }

  .back {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.3rem 0.2rem;
    background: none;
    color: var(--muted);
    font-size: 0.85rem;
    font-weight: 600;
  }
</style>
