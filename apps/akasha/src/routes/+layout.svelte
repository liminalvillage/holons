<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import "../app.css";
  import { onMount } from "svelte";
  import { getHolosphere, subscribeLens } from "$lib/holosphere";
  import { resolveHolonId } from "$lib/config";
  import {
    rawQuests,
    rawLibrary,
    holonName,
    holonId as holonIdStore,
    connected,
    startClock,
    startRotation,
    noteInteraction,
  } from "$lib/stores";
  import { initAuth, loginOpen } from "$lib/auth";
  import type { Quest } from "@holons/core/tasks";
  import type { LibraryItem } from "@holons/core/library";
  import TabBar from "$lib/components/TabBar.svelte";
  import DetailModal from "$lib/components/DetailModal.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import TelegramLogin from "$lib/components/TelegramLogin.svelte";

  let holonId: string | null = null;
  let booting = true;

  onMount(() => {
    holonId = resolveHolonId();
    holonIdStore.set(holonId);
    initAuth();
    const teardown: Array<() => void> = [];
    teardown.push(startClock());

    if (!holonId) {
      booting = false;
      return () => teardown.forEach((fn) => fn());
    }

    const id = holonId;
    (async () => {
      try {
        const hs = await getHolosphere();
        connected.set(true);

        // Holon display name (best-effort; the screen works without it).
        hs.get(id, "settings", id)
          .then((s: any) => {
            if (s?.name) holonName.set(String(s.name));
          })
          .catch(() => {});

        teardown.push(
          subscribeLens<Quest>(hs, id, "quests", (items) =>
            rawQuests.set(items),
          ).unsubscribe,
        );
        teardown.push(
          subscribeLens<LibraryItem>(hs, id, "library", (items) =>
            rawLibrary.set(items),
          ).unsubscribe,
        );
      } catch (err) {
        console.error("[akasha] failed to connect", err);
      } finally {
        booting = false;
      }
    })();

    teardown.push(startRotation());
    return () => teardown.forEach((fn) => fn());
  });

  // Any pointer/touch/key/scroll counts as someone using the screen → pause
  // the auto-flip. Capture phase so it fires before view handlers.
  function onActivity() {
    noteInteraction();
  }
</script>

<svelte:window
  on:pointerdown|capture={onActivity}
  on:touchstart|capture={onActivity}
  on:keydown|capture={onActivity}
  on:wheel|capture={onActivity}
/>

<div class="kiosk">
  {#if !holonId && !booting}
    <div class="setup">
      <div class="mark">akasha</div>
      <h1>No holon configured</h1>
      <p>
        Point this screen at a holon by opening it with a
        <code>?holon=&lt;id&gt;</code> parameter, or set
        <code>VITE_AKASHA_HOLON</code> in the root <code>.env</code>. The choice
        is remembered on this device.
      </p>
    </div>
  {:else}
    <TabBar />
    <main class="stage">
      <slot />
    </main>
  {/if}
</div>

<!-- Zoomed detail / edit overlay for the tapped post-it or card. -->
<DetailModal />

<!-- Login overlay, raised from the header chip or an "edit" prompt. -->
{#if $loginOpen}
  <Modal on:close={() => loginOpen.set(false)}>
    <TelegramLogin />
  </Modal>
{/if}

<style>
  .kiosk {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    width: 100vw;
    background: radial-gradient(
      120% 60% at 50% -10%,
      var(--paper) 40%,
      var(--paper-deep) 100%
    );
    padding: env(safe-area-inset-top) env(safe-area-inset-right)
      env(safe-area-inset-bottom) env(safe-area-inset-left);
    overflow: hidden;
  }

  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .setup {
    margin: auto;
    max-width: 30rem;
    padding: 2rem;
    text-align: center;
  }
  .setup .mark {
    font-size: 1.1rem;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--teal);
    margin-bottom: 1.5rem;
  }
  .setup h1 {
    font-size: 1.6rem;
    margin: 0 0 0.75rem;
    color: var(--ink);
  }
  .setup p {
    color: var(--ink-soft);
    line-height: 1.6;
    font-size: 1.02rem;
  }
  .setup code {
    background: var(--paper-deep);
    border-radius: 6px;
    padding: 0.1em 0.4em;
    font-size: 0.9em;
  }
</style>
