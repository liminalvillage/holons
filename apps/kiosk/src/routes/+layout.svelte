<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import "../app.css";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import {
    getHolosphere,
    createLensAggregator,
    type LensAggregator,
  } from "$lib/holosphere";
  import { getFederationSnapshot } from "@holons/core/federation";
  import type { HoloSphere } from "holosphere";
  import {
    resolveHolonId,
    resolveFederated,
    resolveRolesEnabled,
    resolveBrandName,
    resolveBrandLogo,
    resolveAccent,
  } from "$lib/config";
  import {
    rawQuests,
    rawLibrary,
    rawRoles,
    holonName,
    holonId as holonIdStore,
    brandName,
    brandLogo,
    accent,
    federated,
    rolesEnabled,
    partnerNames,
    settingsOpen,
    userMenuOpen,
    connected,
    notice,
    startClock,
    startRotation,
    noteInteraction,
  } from "$lib/stores";
  import { initAuth, loginOpen } from "$lib/auth";
  import type { Quest } from "@holons/core/tasks";
  import type { LibraryItem } from "@holons/core/library";
  import type { Role } from "@holons/core/roles";
  import TabBar from "$lib/components/TabBar.svelte";
  import DetailModal from "$lib/components/DetailModal.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import TelegramLogin from "$lib/components/TelegramLogin.svelte";
  import UserMenu from "$lib/components/UserMenu.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import CompleteConfirm from "$lib/components/CompleteConfirm.svelte";

  let booting = true;
  let mounted = false;
  // One aggregator per lens, bound to the current holon. The federated toggle
  // only changes which holons each aggregates — the kiosk's own holon is always
  // subscribed first, so toggling never blanks the screen even if the
  // federation lookup is slow or fails.
  let boundHolon: string | null = null;
  let questsAgg: LensAggregator | null = null;
  let libraryAgg: LensAggregator | null = null;
  let rolesAgg: LensAggregator | null = null;

  async function refresh(id: string | null, fed: boolean, rolesOn: boolean) {
    if (!id) {
      questsAgg?.destroy();
      libraryAgg?.destroy();
      rolesAgg?.destroy();
      questsAgg = libraryAgg = rolesAgg = null;
      boundHolon = null;
      rawQuests.set([]);
      rawLibrary.set([]);
      rawRoles.set([]);
      partnerNames.set({});
      holonName.set("");
      booting = false;
      return;
    }

    let hs: HoloSphere;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] failed to connect", err);
      booting = false;
      return;
    }
    connected.set(true);

    // (Re)bind the aggregators when the holon itself changes.
    if (boundHolon !== id) {
      questsAgg?.destroy();
      libraryAgg?.destroy();
      rolesAgg?.destroy();
      rolesAgg = null; // recreated below when the Roles tab is enabled
      questsAgg = createLensAggregator<Quest>(
        hs,
        "quests",
        (items) => rawQuests.set(items),
        id,
      );
      libraryAgg = createLensAggregator<LibraryItem>(
        hs,
        "library",
        (items) => rawLibrary.set(items),
        id,
      );
      boundHolon = id;
      holonName.set("");
      // Holon display name (best-effort; the screen works without it).
      hs.get(id, "settings", id)
        .then((s: any) => {
          if (boundHolon === id && s?.name) holonName.set(String(s.name));
        })
        .catch(() => {});
    }

    // The Roles lens is optional — spin its aggregator up or down to match the
    // toggle, leaving the always-on quests/library subscriptions untouched.
    if (rolesOn && !rolesAgg) {
      rolesAgg = createLensAggregator<Role>(
        hs,
        "roles",
        (items) => rawRoles.set(items),
        id,
      );
    } else if (!rolesOn && rolesAgg) {
      rolesAgg.destroy();
      rolesAgg = null;
      rawRoles.set([]);
    }

    // Always show this holon immediately; partners are folded in afterwards.
    questsAgg?.setHolons([id]);
    libraryAgg?.setHolons([id]);
    rolesAgg?.setHolons([id]);
    partnerNames.set({});
    booting = false;

    if (!fed) return;
    try {
      const snap = await getFederationSnapshot(hs, id);
      // Bail if the holon changed or federation was switched off meanwhile.
      if (boundHolon !== id || !get(federated)) return;
      const holonIds = [id, ...snap.federated.filter((h) => h && h !== id)];
      partnerNames.set(snap.partnerNames ?? {});
      questsAgg?.setHolons(holonIds);
      libraryAgg?.setHolons(holonIds);
      rolesAgg?.setHolons(holonIds);
    } catch (err) {
      console.error("[kiosk] federation snapshot failed", err);
    }
  }

  onMount(() => {
    holonIdStore.set(resolveHolonId());
    federated.set(resolveFederated());
    rolesEnabled.set(resolveRolesEnabled());
    brandName.set(resolveBrandName() ?? "");
    brandLogo.set(resolveBrandLogo() ?? "");
    accent.set(resolveAccent());
    initAuth();
    mounted = true;
    const teardown = [startClock(), startRotation()];
    return () => {
      teardown.forEach((fn) => fn());
      questsAgg?.destroy();
      libraryAgg?.destroy();
      rolesAgg?.destroy();
    };
  });

  // Re-point the live subscriptions when the holon or federated flag changes
  // (CSR-only app, so a reactive statement after mount is safe).
  $: if (mounted) refresh($holonIdStore, $federated, $rolesEnabled);

  // Apply the chosen accent as the `--teal` family on :root so every component
  // (header, views, modals) picks it up. `--teal-deep` is derived a shade darker.
  $: if (typeof document !== "undefined") {
    const s = document.documentElement.style;
    s.setProperty("--teal", $accent);
    s.setProperty("--teal-deep", `color-mix(in srgb, ${$accent} 78%, #000)`);
  }

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
  {#if !$holonIdStore && !booting}
    <div class="setup">
      {#if $brandLogo}
        <img class="logo" src={$brandLogo} alt="Kiosk" />
      {:else}
        <div class="wordmark">{$brandName || "kiosk"}</div>
      {/if}
      <h1>No holon configured</h1>
      <p>
        Point this screen at a holon: open <strong>Settings</strong> and enter a
        holon id, open the kiosk at <code>/&lt;holon id&gt;</code>, open it once
        with a <code>?holon=&lt;id&gt;</code> parameter, or set
        <code>VITE_KIOSK_HOLON</code> in the root <code>.env</code>. Settings
        and <code>?holon=</code> are remembered on this device.
      </p>
      <button class="setup-btn" on:click={() => settingsOpen.set(true)}>
        Open settings
      </button>
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

<!-- User menu: identity, federated toggle, dashboard, settings. -->
{#if $userMenuOpen}
  <Modal on:close={() => userMenuOpen.set(false)}>
    <UserMenu />
  </Modal>
{/if}

<!-- Caretaker settings: holon, name, logo, accent. -->
{#if $settingsOpen}
  <Modal on:close={() => settingsOpen.set(false)}>
    <Settings />
  </Modal>
{/if}

<!-- Participant confirmation before a completion records REA. -->
<CompleteConfirm />

<!-- Transient one-line feedback for taps that can't proceed. -->
{#if $notice}
  <div class="notice" role="status">{$notice}</div>
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
  .setup .logo {
    height: 44px;
    width: auto;
    max-width: 70%;
    object-fit: contain;
    margin: 0 auto 1.5rem;
    display: block;
  }
  .setup .wordmark {
    font-family: var(--font-logo);
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    color: var(--teal-deep);
    margin-bottom: 1.5rem;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
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
  .setup-btn {
    margin-top: 1.5rem;
    min-height: 52px;
    padding: 0 1.8rem;
    border-radius: 14px;
    font-weight: 700;
    font-size: 1rem;
    color: #fff;
    background: var(--teal);
    box-shadow: var(--shadow-soft);
  }
  .setup-btn:active {
    transform: scale(0.97);
  }

  .notice {
    position: fixed;
    left: 50%;
    bottom: calc(1.6rem + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 60; /* above the modal overlay (z-index 50) */
    max-width: min(34rem, calc(100vw - 2.8rem));
    padding: 0.85rem 1.3rem;
    border-radius: 14px;
    background: var(--ink);
    color: var(--paper);
    font-weight: 700;
    font-size: 1rem;
    text-align: center;
    box-shadow: var(--shadow-soft);
    animation: kiosk-notice 0.25s ease both;
    pointer-events: none;
  }
  @keyframes kiosk-notice {
    from {
      opacity: 0;
      transform: translate(-50%, 0.6rem);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
