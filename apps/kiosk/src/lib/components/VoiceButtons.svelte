<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Inline voice controls, rendered by each view INSIDE its fab row so the
  // cluster reads [⌨] [🎤] [＋]. Renders nothing unless a voice server is
  // reachable — a kiosk without one shows just the ＋ as before. Styling
  // mirrors the views' .fab exactly (size, color, shadow). Mute lives in the
  // chat popup (VoiceWidget), next to its close button.
  import { holonId } from "$lib/stores";
  import { t } from "$lib/i18n";
  import {
    available,
    recording,
    typeOpen,
    startRecording,
    stopRecording,
  } from "$lib/voice/controller";
</script>

{#if $available && $holonId}
  <button
    class="fab-btn"
    class:open={$typeOpen}
    aria-label={$t("voice.typeAria")}
    title={$t("voice.typeAria")}
    on:click={() => typeOpen.update((v) => !v)}
  >
    ⌨
  </button>
  <button
    class="fab-btn mic"
    class:live={$recording}
    aria-label={$t("voice.holdToTalk")}
    title={$t("voice.holdToTalk")}
    on:pointerdown|preventDefault={() => startRecording()}
    on:pointerup={() => stopRecording()}
    on:pointercancel={() => stopRecording()}
    on:pointerleave={() => stopRecording()}
    on:contextmenu|preventDefault
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5.6-3a.9.9 0 1 1 1.8.1A7.5 7.5 0 0 1 13 17.9V20h2.1a.9.9 0 1 1 0 1.8H8.9a.9.9 0 1 1 0-1.8H11v-2.1A7.5 7.5 0 0 1 4.6 11a.9.9 0 1 1 1.8-.1 5.6 5.6 0 0 0 11.2.1Z"
        fill="currentColor"
      />
    </svg>
  </button>
{/if}

<style>
  .fab-btn {
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    border: 0;
    font-size: 1.5rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
    display: grid;
    place-items: center;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }
  .fab-btn:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }
  .fab-btn.open {
    background: var(--teal-deep);
  }
  .fab-btn svg {
    width: 1.6rem;
    height: 1.6rem;
    pointer-events: none;
  }
  .mic {
    touch-action: none;
  }
  .mic.live {
    background: #dc2626;
    animation: voice-pulse 1.2s ease-in-out infinite;
  }
  @keyframes voice-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.45);
    }
    50% {
      box-shadow: 0 0 0 14px rgba(220, 38, 38, 0);
    }
  }
</style>
