<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Linking a Telegram chat to the hub on screen — the screen's three steps
  // (see lib/tglink.ts): the deep links carrying the offer out, the wait for
  // the bot's answer, and the confirmation of the chat by its title before
  // the bot's key is seated here. A wait already pending on this device
  // (they left for Telegram and came back, or reloaded) is picked up.
  import { createEventDispatcher, onDestroy, onMount } from "svelte";
  import type { LinkAccept } from "@holons/core/linking";
  import Icon from "$lib/components/Icon.svelte";
  import { t, tr } from "$lib/i18n";
  import { getHolosphere } from "$lib/holosphere";
  import { clearBotHandoff } from "$lib/config";
  import {
    beginTelegramLink,
    clearTelegramLink,
    confirmTelegramLink,
    handOffTelegramLink,
    pendingLink,
    telegramLinkUrls,
    watchTelegramLink,
    type PendingLink,
  } from "$lib/tglink";

  /** The hub being linked (a key-founded holon whose admin key is adopted). */
  export let hub: string;

  const dispatch = createEventDispatcher<{ linked: LinkAccept; close: void }>();

  let pending: PendingLink | null = null;
  let urls: { personal: string; group: string } | null = null;
  let away = false;
  let accept: LinkAccept | null = null;
  let busy = false;
  let error = "";
  let stopWatch: (() => void) | null = null;

  async function arm() {
    try {
      const hs = await getHolosphere();
      const existing = pendingLink(hub);
      pending = existing ?? (await beginTelegramLink(hs, hub));
      away = !!existing;
      urls = telegramLinkUrls(pending.hub, pending.token);
      stopWatch = watchTelegramLink(hs, pending, (a) => (accept = a));
    } catch (err) {
      error = tr("tglink.failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function handOff() {
    handOffTelegramLink();
    away = true;
  }

  async function confirm() {
    if (!pending || !accept || busy) return;
    busy = true;
    error = "";
    try {
      const hs = await getHolosphere();
      await confirmTelegramLink(hs, pending, accept);
      clearBotHandoff();
      dispatch("linked", accept);
    } catch (err) {
      error = tr("tglink.failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      busy = false;
    }
  }

  function cancel() {
    // Abandoning the wait: the offer on the relay expires by itself.
    clearTelegramLink();
    clearBotHandoff();
    dispatch("close");
  }

  onMount(arm);
  onDestroy(() => stopWatch?.());
</script>

<div class="sheet">
  {#if accept}
    <h3>
      {$t("tglink.confirmTitle", {
        title: accept.record.chat?.title || accept.chat,
      })}
    </h3>
    <p class="lead">{$t("tglink.confirmBody")}</p>
    <div class="actions">
      <button type="button" class="go" disabled={busy} on:click={confirm}>
        <Icon name="check" />
        {$t("tglink.confirm")}
      </button>
      <button type="button" class="back" disabled={busy} on:click={cancel}>
        {$t("tglink.cancel")}
      </button>
    </div>
  {:else}
    <h3>{$t("tglink.title")}</h3>
    <p class="lead">{$t("tglink.lead")}</p>
    <div class="ways">
      <a
        class="way"
        href={urls?.group}
        target="_blank"
        rel="noopener"
        on:click={handOff}
      >
        <span class="way__text">
          <b>{$t("tglink.group")}</b>
          <small>{$t("tglink.groupHint")}</small>
        </span>
      </a>
      <a
        class="way"
        href={urls?.personal}
        target="_blank"
        rel="noopener"
        on:click={handOff}
      >
        <span class="way__text">
          <b>{$t("tglink.personal")}</b>
          <small>{$t("tglink.personalHint")}</small>
        </span>
      </a>
    </div>
    <div class="wait" class:away role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <span class="wait__text">
        <b>{$t("tglink.waiting")}</b>
        <small>{$t("tglink.waitingBody")}</small>
      </span>
    </div>
    <button type="button" class="back" on:click={cancel}>
      <Icon name="arrow-left" />
      {$t("tglink.cancel")}
    </button>
  {/if}
  {#if error}
    <p class="err" role="alert">{error}</p>
  {/if}
</div>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    text-transform: none;
    letter-spacing: 0;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink);
  }
  .lead {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.5;
    color: var(--ink-soft);
  }
  .ways {
    display: grid;
    gap: 0.5rem;
  }
  .way {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 0.9rem;
    border-radius: 12px;
    background: var(--paper-deep);
    color: var(--ink);
    text-decoration: none;
  }
  .way__text b {
    display: block;
    font-size: 0.92rem;
  }
  .way__text small {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .wait {
    display: none;
    align-items: center;
    gap: 0.7rem;
    padding: 0.6rem 0.2rem;
    color: var(--ink-soft);
  }
  .wait.away {
    display: flex;
  }
  .wait__text b {
    display: block;
    font-size: 0.85rem;
  }
  .wait__text small {
    font-size: 0.75rem;
    color: var(--muted);
  }
  .spinner {
    width: 1rem;
    height: 1rem;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line);
    border-top-color: var(--teal);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .go {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 12px;
    font-weight: 700;
    color: #fff;
    background: var(--teal);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    padding: 0 0.8rem;
    border-radius: 12px;
    background: transparent;
    color: var(--ink-soft);
  }
  .err {
    margin: 0;
    font-size: 0.82rem;
    color: #9a3b2f;
  }
</style>
