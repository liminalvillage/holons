<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Voice overlay: owns the WS session lifecycle (via the controller) and
  // renders the transcript bubble + paste-a-transcript panel above the views'
  // fab row. The buttons themselves live inline in each view (VoiceButtons),
  // in the same row as the ＋ fab.
  import { onDestroy, onMount } from "svelte";
  import { holonId, idle } from "$lib/stores";
  import {
    initVoice,
    available,
    status,
    recording,
    youSaid,
    holonsSaid,
    activeTool,
    bubbleOpen,
    typeOpen,
    sendTyped,
  } from "$lib/voice/controller";

  let typed = "";
  let teardown: (() => void) | null = null;

  function submitTyped() {
    if (sendTyped(typed)) typed = "";
  }

  onMount(() => {
    teardown = initVoice();
  });
  onDestroy(() => {
    teardown?.();
  });
</script>

{#if $available && $holonId}
  <div class="voice-overlay" class:idle={$idle && !$recording && $status === "ready"}>
    {#if $bubbleOpen && ($youSaid || $holonsSaid || $activeTool || $status === "thinking" || $recording)}
      <div class="bubble" role="status">
        {#if $youSaid}<p class="you">“{$youSaid}”</p>{/if}
        {#if $recording}
          <p class="tool">listening…</p>
        {:else if $status === "thinking"}
          <p class="tool">
            {$activeTool ? `⚙ ${$activeTool}` : $youSaid ? "thinking" : "transcribing"}
            <span class="dots"><i></i><i></i><i></i></span>
          </p>
        {:else if $status === "speaking" && !$holonsSaid}
          <p class="tool">speaking…</p>
        {/if}
        {#if $holonsSaid}<p class="holons">{$holonsSaid}</p>{/if}
      </div>
    {/if}
    {#if $typeOpen}
      <div class="typepanel">
        <textarea
          bind:value={typed}
          rows="4"
          placeholder="Paste or type a transcript…"
        ></textarea>
        <div class="typeactions">
          <button class="send" on:click={submitTyped} disabled={!typed.trim()}>Send</button>
          <button class="cancel" on:click={() => typeOpen.set(false)}>Cancel</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Anchored above the views' fab row (fab is 3.4rem at bottom 1.3rem). */
  .voice-overlay {
    position: fixed;
    right: calc(1.3rem + env(safe-area-inset-right));
    bottom: calc(1.3rem + 3.4rem + 0.8rem + env(safe-area-inset-bottom));
    z-index: 70; /* above modals (50) so it works while editing a record */
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.6rem;
    transition: opacity 0.4s ease;
  }
  /* Fade with the rest of the chrome when the kiosk sits idle. */
  .voice-overlay.idle {
    opacity: 0.35;
  }

  .bubble {
    max-width: min(22rem, calc(100vw - 3rem));
    background: var(--paper, #fff);
    color: var(--ink, #222);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    padding: 0.7rem 0.95rem;
    font-size: 0.95rem;
    line-height: 1.45;
  }
  .bubble p {
    margin: 0;
  }
  .bubble p + p {
    margin-top: 0.35rem;
  }
  .bubble .you {
    color: var(--ink-soft, #666);
    font-style: italic;
  }
  .bubble .tool {
    color: var(--ink-soft, #666);
    font-size: 0.85rem;
  }
  .bubble .holons {
    font-weight: 600;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    margin-left: 4px;
    vertical-align: baseline;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ink-soft, #666);
    animation: voice-dot 1.1s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.18s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.36s;
  }
  @keyframes voice-dot {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }

  .typepanel {
    width: min(22rem, calc(100vw - 3rem));
    background: var(--paper, #fff);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .typepanel textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--paper-deep, #ddd);
    border-radius: 10px;
    padding: 0.6rem 0.7rem;
    font: inherit;
    font-size: 0.95rem;
    color: var(--ink, #222);
    background: var(--paper, #fff);
  }
  .typeactions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .typeactions button {
    min-height: 40px;
    padding: 0 1.1rem;
    border-radius: 10px;
    border: 0;
    font-weight: 700;
    cursor: pointer;
  }
  .typeactions .send {
    background: var(--teal);
    color: #fff;
  }
  .typeactions .send:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .typeactions .cancel {
    background: var(--paper-deep, #eee);
    color: var(--ink, #222);
  }
</style>
