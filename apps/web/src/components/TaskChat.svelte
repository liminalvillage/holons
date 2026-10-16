<script lang="ts">
    // SPDX-License-Identifier: AGPL-3.0-or-later
    // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
    //
    // A task's chat. Messages live in the task's home holon (core
    // @holons/core/tasks chat.ts); this follows them while it is open — one
    // lens subscription, released on close — and posts as the signed-in key.
    import { onDestroy, onMount, tick } from "svelte";
    import type { HoloSphere } from "holosphere";
    import { may, writeAcceptance } from "@holons/core/holosphere";
    import {
        sendTaskChatMessage,
        taskChatAvailable,
        watchTaskChat,
        type TaskChatMessage,
        type TaskRef,
    } from "@holons/core/tasks";
    import { nostrPublicKey } from "../lib/stores/nostr";
    import { nameMap, resolvedName, resolveNames } from "$lib/stores/nameResolver";

    export let holosphere: HoloSphere;
    export let ref: TaskRef;

    let messages: TaskChatMessage[] = [];
    let loaded = false;
    let available = true;
    let canPost = false;
    let draft = "";
    let sending = false;
    let error = "";
    let log: HTMLElement | null = null;
    let stop: (() => void) | null = null;

    onMount(() => {
        available = taskChatAvailable(holosphere, ref);
        if (!available) return;
        stop = watchTaskChat(holosphere, ref, async (m) => {
            messages = m;
            loaded = true;
            resolveNames(m.map((x) => x.author).filter((a): a is string => !!a));
            await tick();
            if (log) log.scrollTop = log.scrollHeight;
        });
        writeAcceptance(holosphere, ref.holon)
            .then((s) => (canPost = may(s, "content")))
            .catch(() => (canPost = false));
    });
    onDestroy(() => stop?.());

    async function send() {
        const text = draft.trim();
        if (!text || sending) return;
        sending = true;
        error = "";
        try {
            await sendTaskChatMessage(holosphere, ref, text);
            draft = "";
        } catch (e: any) {
            error = e?.message || "Could not send";
        } finally {
            sending = false;
        }
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            send();
        }
    }

    const time = (at: number) =>
        new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
</script>

<div class="mt-1 rounded bg-gray-800/60 p-2 text-xs text-gray-200">
    {#if !available}
        <p class="text-gray-400">Private tasks have no chat yet.</p>
    {:else}
        <div class="max-h-60 overflow-y-auto space-y-1" role="log" aria-live="polite" bind:this={log}>
            {#if loaded && messages.length === 0}
                <p class="text-gray-400">No messages yet.</p>
            {/if}
            {#each messages as m (m.id)}
                {@const mine = !!$nostrPublicKey && m.author === $nostrPublicKey}
                <div class="flex flex-col {mine ? 'items-end' : 'items-start'}">
                    <div class="max-w-[90%] rounded px-2 py-1 whitespace-pre-wrap break-words {mine ? 'bg-teal-600/40' : 'bg-gray-700'}">
                        {#if !mine}
                            <span class="block font-semibold text-gray-300">{resolvedName(m.author, $nameMap)}</span>
                        {/if}
                        {m.text}
                    </div>
                    <span class="text-[10px] text-gray-500">{time(m.at)}</span>
                </div>
            {/each}
        </div>
        {#if canPost}
            <form class="mt-2 flex gap-1" on:submit|preventDefault={send}>
                <textarea
                    rows="1"
                    class="flex-1 resize-y rounded bg-gray-700 px-2 py-1 text-gray-100"
                    placeholder="Write a message"
                    aria-label="Write a message"
                    maxlength="4000"
                    bind:value={draft}
                    on:keydown={onKey}
                ></textarea>
                <button
                    type="submit"
                    class="rounded bg-teal-600 px-2 text-white disabled:opacity-50"
                    disabled={sending || !draft.trim()}
                >Send</button>
            </form>
            {#if error}<p class="mt-1 text-red-300">{error}</p>{/if}
        {:else}
            <p class="mt-2 text-gray-400">Only members of this holon can write here.</p>
        {/if}
    {/if}
</div>
