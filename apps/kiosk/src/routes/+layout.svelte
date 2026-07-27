<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import "../app.css";
  import { onMount } from "svelte";
  import { getHolosphere, getHolonName } from "$lib/holosphere";
  import type { HoloSphere } from "holosphere";
  import {
    resolveHolonId,
    resolveFederated,
    resolveLibraryPref,
    resolveRolesPref,
    resolveStatusEnabled,
    resolveBrandName,
    resolveBrandLogo,
    resolveAccent,
    resolveThemeMode,
    resolveTaskView,
    resolveLibraryView,
    resolveRolesView,
  } from "$lib/config";
  import { themeMode, startTheme } from "$lib/theme";
  import { get } from "svelte/store";
  import {
    rawQuests,
    rawLibrary,
    rawRoles,
    lensEmitAt,
    showNotice,
    holonName,
    holonId as holonIdStore,
    brandName,
    brandLogo,
    accent,
    federated,
    libraryPref,
    rolesPref,
    statusEnabled,
    taskViewMode,
    libraryViewMode,
    rolesViewMode,
    boardReady,
    settingsOpen,
    userMenuOpen,
    connected,
    notice,
    startClock,
    startRotation,
    noteInteraction,
  } from "$lib/stores";
  import { initAuth, loginOpen } from "$lib/auth";
  import { startSwAutoReload } from "$lib/swUpdate";
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
  import VoiceWidget from "$lib/components/VoiceWidget.svelte";

  let booting = true;
  let mounted = false;
  // One federation-aware subscription per lens, bound to the current holon.
  // HoloSphere's `subscribeFederated` folds in the partners this holon receives
  // each lens from (tagging partner items `_federation`) and, via `setFederated`,
  // adds/drops them live — so the federated toggle never blanks the local
  // subscription. This replaces the kiosk's old hand-rolled aggregator.
  type FederatedSub = {
    unsubscribe: () => void;
    setFederated: (on: boolean) => void;
  };
  let boundHolon: string | null = null;
  let boundFed = false;
  let questsSub: FederatedSub | null = null;
  let librarySub: FederatedSub | null = null;
  let rolesSub: FederatedSub | null = null;

  // Board reveal: hold the views hidden while a holon's initial data burst
  // streams in, then reveal once it settles so the entrance animation plays on
  // the full set (like a tab switch). `awaitingReady` is true only between a
  // holon (re)bind and that first settle; later live updates fold in via the
  // views' own FLIP transitions and never re-trigger the reveal.
  let awaitingReady = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  const READY_SETTLE_MS = 250;

  function armReady() {
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      readyTimer = null;
      awaitingReady = false;
      boardReady.set(true);
    }, READY_SETTLE_MS);
  }

  async function refresh(
    id: string | null,
    fed: boolean,
    libraryOn: boolean,
    rolesOn: boolean,
  ) {
    if (!id) {
      questsSub?.unsubscribe();
      librarySub?.unsubscribe();
      rolesSub?.unsubscribe();
      questsSub = librarySub = rolesSub = null;
      boundHolon = null;
      rawQuests.set([]);
      rawLibrary.set([]);
      rawRoles.set([]);
      holonName.set("");
      awaitingReady = false;
      if (readyTimer) clearTimeout(readyTimer);
      readyTimer = null;
      boardReady.set(false);
      booting = false;
      return;
    }

    let hs: HoloSphere;
    try {
      hs = await getHolosphere();
    } catch (err) {
      console.error("[kiosk] failed to connect", err);
      booting = false;
      boardReady.set(true); // can't connect — reveal the (empty) board anyway
      return;
    }
    connected.set(true);

    // (Re)bind the lens subscriptions when the holon itself changes. Each
    // `subscribeFederated` folds in the partners this holon receives that lens
    // from (per-lens/directional, handled inside HoloSphere) and tags their
    // items `_federation`; the local holon's own items stream immediately.
    if (boundHolon !== id) {
      // New holon → hide the board and wait for its data to settle before
      // revealing, so the entrance animation plays once on the full set.
      awaitingReady = true;
      boardReady.set(false);
      questsSub?.unsubscribe();
      librarySub?.unsubscribe();
      rolesSub?.unsubscribe();
      librarySub = null; // recreated below when the Library tab is enabled
      rolesSub = null; // recreated below when the Roles tab is enabled
      questsSub = hs.subscribeFederated(
        id,
        "quests",
        (items) => {
          lensEmitAt.quests = Date.now();
          rawQuests.set(items as Quest[]);
        },
        { includeFederated: fed },
      );
      boundHolon = id;
      boundFed = fed;
      holonName.set("");
      // Holon display name (best-effort; the screen works without it).
      getHolonName(hs, id).then((name) => {
        if (boundHolon === id && name) holonName.set(name);
      });
    }

    // The Library and Roles lenses are toggleable — spin each subscription up
    // or down, leaving the always-on quests subscription untouched. `libraryOn`
    // / `rolesOn` is false only for an explicit caretaker "off": the default
    // `auto` preference keeps the subscription alive so the tab's visibility
    // can follow the content (see `libraryEnabled` / `rolesEnabled` in stores).
    if (libraryOn && !librarySub) {
      librarySub = hs.subscribeFederated(
        id,
        "library",
        (items) => {
          lensEmitAt.library = Date.now();
          rawLibrary.set(items as LibraryItem[]);
        },
        { includeFederated: fed },
      );
    } else if (!libraryOn && librarySub) {
      librarySub.unsubscribe();
      librarySub = null;
      rawLibrary.set([]);
    }
    if (rolesOn && !rolesSub) {
      rolesSub = hs.subscribeFederated(
        id,
        "roles",
        (items) => {
          lensEmitAt.roles = Date.now();
          rawRoles.set(items as Role[]);
        },
        { includeFederated: fed },
      );
    } else if (!rolesOn && rolesSub) {
      rolesSub.unsubscribe();
      rolesSub = null;
      rawRoles.set([]);
    }

    // Federated toggle flipped (holon unchanged) → fold partners in/out live on
    // every active lens, without tearing down the local subscription so the
    // board never blanks.
    if (boundFed !== fed) {
      boundFed = fed;
      questsSub?.setFederated(fed);
      librarySub?.setFederated(fed);
      rolesSub?.setFederated(fed);
    }

    booting = false;

    // Dev/test hook: let a headless test kill the live subscriptions to prove
    // the write-echo watchdog below detects and heals it. DEV builds only.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as any).__kioskKillSubs = () => {
        questsSub?.unsubscribe();
        librarySub?.unsubscribe();
        rolesSub?.unsubscribe();
      };
    }
  }

  // ── Write-echo watchdog ─────────────────────────────────────────────────--
  //
  // A successful LOCAL write must echo back through its lens subscription
  // within a couple of seconds — same Gun graph, same process. When it
  // doesn't, the subscription is provably dead (however it died: quarantine,
  // a torn-down listener, a wedged storage adapter …) and every remote update
  // is being silently dropped too — the "writes work but the screen never
  // changes until reload" failure reported from the field. Detect it on the
  // next write and heal in place: rebind all lens subscriptions, whose seed
  // read (getAll) pulls the missed state — the same recovery a manual reload
  // performs, without the reload.
  const ECHO_GRACE_MS = 3000;
  let lastRebindAt = 0;

  function onLocalWrite(e: Event) {
    const d = (e as CustomEvent).detail as
      | { holon?: string; lens?: string; at?: number }
      | undefined;
    if (!d?.holon || !d.at) return;
    // Writes routed to a partner holon (sourceRef) don't reliably echo when
    // federation is off — only the displayed holon's writes are probes.
    if (d.holon !== boundHolon) return;
    const lens = d.lens as keyof typeof lensEmitAt;
    if (lens !== "quests" && lens !== "library" && lens !== "roles") return;
    const at = d.at;
    setTimeout(() => {
      if (lensEmitAt[lens] >= at) return; // echoed — subscription is alive
      if (lastRebindAt >= at) return; // a burst of writes → one rebind
      lastRebindAt = Date.now();
      console.error(
        `[kiosk] live '${lens}' subscription missed a local write — rebinding all lens subscriptions`,
      );
      showNotice("Live view stalled — resyncing…");
      boundHolon = null; // force refresh() to tear down and re-subscribe
      refresh(
        get(holonIdStore),
        get(federated),
        get(libraryPref) !== "off",
        get(rolesPref) !== "off",
      );
    }, ECHO_GRACE_MS);
  }

  onMount(() => {
    holonIdStore.set(resolveHolonId());
    federated.set(resolveFederated());
    libraryPref.set(resolveLibraryPref());
    rolesPref.set(resolveRolesPref());
    statusEnabled.set(resolveStatusEnabled());
    taskViewMode.set(resolveTaskView());
    libraryViewMode.set(resolveLibraryView());
    rolesViewMode.set(resolveRolesView());
    brandName.set(resolveBrandName() ?? "");
    brandLogo.set(resolveBrandLogo() ?? "");
    accent.set(resolveAccent());
    themeMode.set(resolveThemeMode());
    initAuth();
    mounted = true;
    window.addEventListener("kiosk:write", onLocalWrite);
    const teardown = [
      startClock(),
      startRotation(),
      startTheme(),
      startSwAutoReload(),
    ];
    return () => {
      window.removeEventListener("kiosk:write", onLocalWrite);
      teardown.forEach((fn) => fn());
      if (readyTimer) clearTimeout(readyTimer);
      questsSub?.unsubscribe();
      librarySub?.unsubscribe();
      rolesSub?.unsubscribe();
    };
  });

  // Re-point the live subscriptions when the holon or federated flag changes
  // (CSR-only app, so a reactive statement after mount is safe).
  $: if (mounted)
    refresh(
      $holonIdStore,
      $federated,
      $libraryPref !== "off",
      $rolesPref !== "off",
    );

  // While awaiting the first reveal, (re)arm the settle timer on every data
  // change — including the bind itself, so a holon with no data still reveals.
  // Referencing the raw stores makes this re-run as the initial burst streams.
  $: if (mounted && awaitingReady) {
    void [$rawQuests, $rawLibrary, $rawRoles];
    armReady();
  }

  // Apply the chosen accent as the `--teal` family on :root so every component
  // (header, views, modals) picks it up. `--teal-deep` is derived a shade darker.
  $: if (typeof document !== "undefined") {
    const s = document.documentElement.style;
    s.setProperty("--teal", $accent);
    s.setProperty("--teal-deep", `color-mix(in srgb, ${$accent} 78%, #000)`);
  }

  // Any pointer/touch/key/scroll counts as someone using the screen → reveal the
  // chrome and pause the auto-flip. Capture phase so it fires before view
  // handlers.
  function onActivity() {
    noteInteraction();
  }

  // Mouse movement (no click) also counts as presence, but fires constantly —
  // throttle it so we don't reset the stores on every pixel.
  let lastMove = 0;
  function onMove() {
    const t = Date.now();
    if (t - lastMove < 400) return;
    lastMove = t;
    noteInteraction();
  }
</script>

<svelte:head>
  <!-- Browser-tab / PWA title: the holon's name (caretaker override first),
       falling back to the generic app name until one is known. -->
  <title>{$brandName || $holonName || "kiosk"}</title>
</svelte:head>

<svelte:window
  on:pointerdown|capture={onActivity}
  on:touchstart|capture={onActivity}
  on:keydown|capture={onActivity}
  on:wheel|capture={onActivity}
  on:pointermove|capture={onMove}
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

<!-- Push-to-talk voice agent; renders only when a voice server is reachable.
     Sends the displayed holon + active view + open record as turn context. -->
<VoiceWidget />

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
