<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // A task's chat, inline in its detail card. Messages live in the task's
  // home holon (core @holons/core/tasks chat.ts); this panel follows them
  // while it is open — one lens subscription, released on close — and posts
  // as the session key. Who may write is the holon's membership.
  import Icon from "$lib/components/Icon.svelte";
  import { onDestroy, onMount, tick } from "svelte";
  import { may } from "@holons/core/holosphere";
  import { isLoggedIn, loginOpen } from "$lib/auth";
  import { showNotice } from "$lib/stores";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { nameOf } from "$lib/names";
  import { linkify } from "$lib/linkify";
  import { lang, t } from "$lib/i18n";
  import {
    chatAccess,
    chatRows,
    sendChat,
    watchChat,
    type TaskChatMessage,
    type TaskRef,
  } from "$lib/taskchat";

  export let ref: TaskRef;
  export let id = "task-chat";

  let messages: TaskChatMessage[] = [];
  let loaded = false;
  let available = true;
  let canPost = false;
  let draft = "";
  let sending = false;
  let log: HTMLElement | null = null;
  let stop: (() => void) | null = null;

  $: rows = chatRows(messages, $sessionKeyPub);

  async function scrollToEnd(): Promise<void> {
    await tick();
    if (log) log.scrollTop = log.scrollHeight;
  }

  onMount(() => {
    stop = watchChat(ref, (m) => {
      messages = m;
      loaded = true;
      void scrollToEnd();
    });
    void chatAccess(ref).then((a) => {
      available = a.available;
      canPost = a.available && !!a.standing && may(a.standing, "content");
    });
  });
  onDestroy(() => stop?.());

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    try {
      await sendChat(ref, text);
      draft = "";
    } catch {
      // Keep the draft: nothing was lost, it can be sent again.
      showNotice($t("detail.chatFailed"));
    } finally {
      sending = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const time = (at: number) =>
    new Date(at).toLocaleTimeString($lang, {
      hour: "2-digit",
      minute: "2-digit",
    });
  const day = (at: number) =>
    new Date(at).toLocaleDateString($lang, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
</script>

<section class="chat" {id} aria-label={$t("detail.chatTitle")}>
  {#if !available}
    <p class="note">{$t("detail.chatPrivate")}</p>
  {:else}
    <div class="log" role="log" aria-live="polite" bind:this={log}>
      {#if loaded && rows.length === 0}
        <p class="note">{$t("detail.chatEmpty")}</p>
      {/if}
      {#each rows as row (row.key)}
        {#if row.kind === "day"}
          <p class="day">{day(row.at)}</p>
        {:else}
          <div class="msg" class:mine={row.mine}>
            {#if row.first && !row.mine}
              <span class="who">{$nameOf(row.message.author)}</span>
            {/if}
            <div class="bubble">
              <span class="text">{@html linkify(row.message.text)}</span>
              <time class="at">{time(row.message.at)}</time>
            </div>
          </div>
        {/if}
      {/each}
    </div>

    {#if !$isLoggedIn}
      <button class="ghost login" on:click={() => loginOpen.set(true)}>
        {$t("detail.chatLogin")}
      </button>
    {:else if !canPost}
      <p class="note">{$t("detail.chatMembersOnly")}</p>
    {:else}
      <form class="composer" on:submit|preventDefault={send}>
        <textarea
          rows="1"
          bind:value={draft}
          on:keydown={onKey}
          placeholder={$t("detail.chatPlaceholder")}
          aria-label={$t("detail.chatPlaceholder")}
          maxlength="4000"
        ></textarea>
        <button
          type="submit"
          class="send"
          disabled={sending || !draft.trim()}
          aria-label={$t("detail.chatSend")}
          title={$t("detail.chatSend")}
        >
          <Icon name="send" />
        </button>
      </form>
    {/if}
  {/if}
</section>

<style>
  .chat {
    margin-top: 0.8rem;
    padding: 0.7rem;
    border-radius: 14px;
    background: var(--glass);
    color: var(--ink);
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 18rem;
    overflow-y: auto;
    padding: 0.2rem;
  }
  .note {
    margin: 0.4rem 0;
    font-size: 0.9rem;
    text-align: center;
  }
  .day {
    margin: 0.5rem 0 0.2rem;
    font-size: 0.75rem;
    font-weight: 700;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .msg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: 85%;
  }
  .msg.mine {
    align-self: flex-end;
    align-items: flex-end;
  }
  .who {
    margin: 0.3rem 0 0.1rem 0.5rem;
    font-size: 0.78rem;
    font-weight: 700;
  }
  .bubble {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.6rem;
    padding: 0.45rem 0.75rem;
    border-radius: 14px;
    background: var(--card);
    color: var(--ink);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
  .mine .bubble {
    background: var(--teal);
    color: var(--on-teal);
  }
  .at {
    margin-left: auto;
    font-size: 0.7rem;
    opacity: 0.85;
  }
  .composer {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
  }
  textarea {
    flex: 1;
    min-height: 44px;
    max-height: 8rem;
    padding: 0.6rem 0.75rem;
    border-radius: 12px;
    border: 1px solid var(--ghost);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    resize: vertical;
  }
  .send {
    flex: 0 0 auto;
    width: 48px;
    min-height: 44px;
    border-radius: 12px;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 1.2rem;
  }
  .send:disabled {
    opacity: 0.5;
  }
  .login {
    width: 100%;
    margin-top: 0.6rem;
    min-height: 44px;
    border-radius: 12px;
    background: var(--ghost);
    color: var(--ink);
    font-weight: 700;
  }
</style>
