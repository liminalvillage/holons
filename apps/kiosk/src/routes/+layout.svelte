<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { afterNavigate, replaceState } from "$app/navigation";
  import { getHolosphere, getHolonName, subscribeLens } from "$lib/holosphere";
  import type { Subscription } from "$lib/holosphere";
  import { subdomainOf, SUBDOMAIN_HOLONS } from "$lib/holons";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { HIDDEN_LENS, hiddenIdSet, isRefHidden } from "@holons/core/hidden";
  import type { HiddenEntry } from "@holons/core/hidden";
  import { sourceRef } from "@holons/core/holosphere";
  import type { HoloSphere } from "holosphere";
  import {
    resolveHolonId,
    resolveScope,
    resolveLibraryPref,
    resolveRolesPref,
    resolveChecklistsPref,
    resolveShiftsPref,
    resolveStatusEnabled,
    resolveFlowsEnabled,
    resolveBrandName,
    resolveBrandLogo,
    resolveAccent,
    resolveThemeMode,
    resolveLangMode,
    resolveTaskView,
    resolveTaskSort,
    resolveLibraryView,
    resolveRolesView,
    resolveCalendarView,
    resolveLibraryCalendarView,
  } from "$lib/config";
  import { themeMode, startTheme } from "$lib/theme";
  import { langMode, holonLang, startI18n, tr, type Lang } from "$lib/i18n";
  import { loadSettings } from "@holons/core/settings";
  import { get } from "svelte/store";
  import {
    rawQuests,
    rawLibrary,
    rawRoles,
    rawChecklists,
    lensEmitAt,
    showNotice,
    holonName,
    holonId as holonIdStore,
    partnerNames,
    brandName,
    brandLogo,
    accent,
    scope,
    federated,
    libraryPref,
    rolesPref,
    checklistsPref,
    shiftsPref,
    statusEnabled,
    flowsEnabled,
    taskViewMode,
    taskSort,
    libraryViewMode,
    rolesViewMode,
    calendarMode,
    libraryCalendarMode,
    boardReady,
    settingsOpen,
    userMenuOpen,
    connected,
    notice,
    startClock,
    startRotation,
    noteInteraction,
    activeTab,
    requestedTab,
    visibleTabs,
    type TabId,
  } from "$lib/stores";
  import { pathForTab, tabForPath } from "$lib/tabroute";
  import { initAuth, loginOpen } from "$lib/auth";
  import { startShifts } from "$lib/shifts";
  import { startSwAutoReload } from "$lib/swUpdate";
  import type { Quest } from "@holons/core/tasks";
  import type { LibraryItem } from "@holons/core/library";
  import type { Role } from "@holons/core/roles";
  import type { Checklist } from "@holons/core/checklists";
  import { keyLinkOpen } from "$lib/sessionKey";
  import HomeView from "$lib/views/HomeView.svelte";
  import TabBar from "$lib/components/TabBar.svelte";
  import DetailModal from "$lib/components/DetailModal.svelte";
  import KeyLinkModal from "$lib/components/KeyLinkModal.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import LoginCard from "$lib/components/LoginCard.svelte";
  import UserMenu from "$lib/components/UserMenu.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import CompleteConfirm from "$lib/components/CompleteConfirm.svelte";
  import VoiceWidget from "$lib/components/VoiceWidget.svelte";

  let booting = true;
  let mounted = false;
  // One federation-aware subscription per lens, bound to the current holon.
  // HoloSphere's `subscribeFederated` folds in the partners this holon receives
  // each lens from (tagging partner items `_federation`) and, via `setFederated`,
  // adds/drops them live — so flipping the Show pill to/from "Network" never
  // blanks the local subscription. Replaces the old hand-rolled aggregator.
  type FederatedSub = {
    unsubscribe: () => void;
    setFederated: (on: boolean) => void;
  };
  let boundHolon: string | null = null;
  let boundFed = false;
  let questsSub: FederatedSub | null = null;
  let librarySub: FederatedSub | null = null;
  let rolesSub: FederatedSub | null = null;
  let checklistsSub: FederatedSub | null = null;

  // The holon's mute list (`hidden` lens): source addresses of federated
  // cards this board has hidden. "Deleting" a federated card writes here —
  // the owner's record is never touched (see deleteQuest in DetailModal) —
  // and the quests emission is filtered against it below. Both feeds are
  // live, so a hide (or un-hide) lands without waiting for the next quests
  // burst: whichever side emits last re-applies the filter.
  let hiddenSub: Subscription | null = null;
  let hiddenSet: Set<string> = new Set();
  let lastQuestItems: Quest[] = [];

  function emitQuests() {
    rawQuests.set(
      hiddenSet.size === 0
        ? lastQuestItems
        : lastQuestItems.filter(
            (q) =>
              !isRefHidden(
                hiddenSet,
                withLens(sourceRef(q, String(q.id ?? q.title))),
              ),
          ),
    );
  }
  // A hide-entry keys on the source's full address; provenance refs carry
  // holon+key, and everything here reads from the quests lens.
  const withLens = (ref?: { holon: string; key: string }) =>
    ref && { ...ref, lens: "quests" };

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
    checklistsOn: boolean,
  ) {
    if (!id) {
      questsSub?.unsubscribe();
      librarySub?.unsubscribe();
      rolesSub?.unsubscribe();
      checklistsSub?.unsubscribe();
      hiddenSub?.unsubscribe();
      questsSub = librarySub = rolesSub = checklistsSub = hiddenSub = null;
      boundHolon = null;
      hiddenSet = new Set();
      lastQuestItems = [];
      rawQuests.set([]);
      rawLibrary.set([]);
      rawRoles.set([]);
      rawChecklists.set([]);
      holonName.set("");
      holonLang.set(null);
      partnerNames.set({});
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
      checklistsSub?.unsubscribe();
      hiddenSub?.unsubscribe();
      librarySub = null; // recreated below when the Library tab is enabled
      rolesSub = null; // recreated below when the Roles tab is enabled
      checklistsSub = null; // recreated below when the Lists tab is enabled
      hiddenSet = new Set();
      lastQuestItems = [];
      questsSub = hs.subscribeFederated(
        id,
        "quests",
        (items) => {
          lensEmitAt.quests = Date.now();
          lastQuestItems = items as Quest[];
          emitQuests();
        },
        { includeFederated: fed },
      );
      hiddenSub = subscribeLens<HiddenEntry>(hs, id, HIDDEN_LENS, (entries) => {
        hiddenSet = hiddenIdSet(entries);
        emitQuests();
      });
      boundHolon = id;
      boundFed = fed;
      holonName.set("");
      // Holon display name (best-effort; the screen works without it).
      getHolonName(hs, id).then((name) => {
        if (boundHolon === id && name) holonName.set(name);
      });
      // Holon language (best-effort) for auto-mode i18n. Read the RAW settings
      // field: `parseHolonSettings` defaults a missing language to "en", which
      // would wrongly pin auto-mode kiosks to English on holons that never
      // chose one — absence must fall through to the device locale.
      holonLang.set(null);
      loadSettings(hs, id)
        .then((raw) => {
          if (boundHolon !== id) return;
          const l =
            typeof raw?.language === "string"
              ? raw.language.slice(0, 2).toLowerCase()
              : "";
          holonLang.set(
            l === "en" || l === "it" || l === "es" ? (l as Lang) : null,
          );
        })
        .catch(() => {});
      // Partner display names (best-effort) for the per-item source chips.
      partnerNames.set({});
      hydratePartnerNames(hs, id);
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
    if (checklistsOn && !checklistsSub) {
      checklistsSub = hs.subscribeFederated(
        id,
        "checklists",
        (items) => {
          lensEmitAt.checklists = Date.now();
          rawChecklists.set(items as Checklist[]);
        },
        // A checklist's id is its NAME, and `agenda`/`shopping` exist under
        // that same id in every holon — the default cross-space collapse would
        // let our own copy shadow every partner's. Keep each holon's copy; the
        // view models key them by origin (`recordKey`).
        { includeFederated: fed, dedupeAcrossSpaces: false },
      );
    } else if (!checklistsOn && checklistsSub) {
      checklistsSub.unsubscribe();
      checklistsSub = null;
      rawChecklists.set([]);
    }

    // Federated toggle flipped (holon unchanged) → fold partners in/out live on
    // every active lens, without tearing down the local subscription so the
    // board never blanks.
    if (boundFed !== fed) {
      boundFed = fed;
      questsSub?.setFederated(fed);
      librarySub?.setFederated(fed);
      rolesSub?.setFederated(fed);
      checklistsSub?.setFederated(fed);
    }

    booting = false;

    // Dev/test hook: let a headless test kill the live subscriptions to prove
    // the write-echo watchdog below detects and heals it. DEV builds only.
    if (import.meta.env.DEV && typeof window !== "undefined") {
      (window as any).__kioskKillSubs = () => {
        questsSub?.unsubscribe();
        librarySub?.unsubscribe();
        rolesSub?.unsubscribe();
        checklistsSub?.unsubscribe();
        hiddenSub?.unsubscribe();
      };
    }
  }

  // Fill the `partnerNames` store (partner id → display name) from the
  // federation record, then resolve any still-unnamed partners via HNS/settings.
  // Best-effort: source chips fall back to raw ids until names arrive.
  async function hydratePartnerNames(hs: HoloSphere, id: string) {
    try {
      const snap = await getFederationSnapshot(hs, id);
      if (boundHolon !== id) return;
      partnerNames.set({ ...snap.partnerNames });
      for (const partner of snap.federated) {
        if (snap.partnerNames[partner]) continue;
        getHolonName(hs, partner).then((name) => {
          if (boundHolon !== id || !name) return;
          partnerNames.update((cur) => ({ ...cur, [partner]: name }));
        });
      }
    } catch {
      /* names stay ids */
    }
  }

  // The Settings federation editor changed the federation record. The active
  // `subscribeFederated` subs snapshot partner config once on attach — and
  // `setFederated(true)` alone never detaches a partner whose lenses were just
  // disabled — so bounce each sub off/on to re-read the config. The local
  // subscription is untouched; partner items purge and re-seed.
  function onFederationChanged() {
    if (get(federated)) {
      for (const sub of [questsSub, librarySub, rolesSub, checklistsSub]) {
        sub?.setFederated(false);
        sub?.setFederated(true);
      }
    }
    const id = boundHolon;
    if (id) getHolosphere().then((hs) => hydratePartnerNames(hs, id));
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
  // A fresh subscription replays the lens it just bound, so it always emits
  // within a beat — silence past this means the rebind never attached.
  const REBIND_ECHO_MS = 5000;
  // holosphere's post-fire-storm quarantine cooldown (30s), plus a beat.
  const QUARANTINE_COOLDOWN_MS = 31000;
  let lastRebindAt = 0;

  function rebindAll() {
    boundHolon = null; // force refresh() to tear down and re-subscribe
    refresh(
      get(holonIdStore),
      get(federated),
      get(libraryPref) !== "off",
      get(rolesPref) !== "off",
      get(checklistsPref) !== "off",
    );
  }

  /**
   * A rebind can be REFUSED. When holosphere quarantines a lens after a
   * fire-storm it turns every re-subscribe into a no-op for a cooldown, so the
   * heal above silently does nothing and the board stays frozen until someone
   * reloads it. Watch for the replay the new subscription owes us and, if it
   * never comes, try once more past the cooldown.
   */
  function verifyRebind(lens: keyof typeof lensEmitAt, at: number) {
    setTimeout(() => {
      if (lensEmitAt[lens] >= at) return; // the rebind attached
      console.error(
        `[kiosk] rebind of '${lens}' did not attach (lens quarantined?) — retrying after the cooldown`,
      );
      setTimeout(() => {
        if (lensEmitAt[lens] >= at) return;
        lastRebindAt = Date.now();
        rebindAll();
      }, QUARANTINE_COOLDOWN_MS);
    }, REBIND_ECHO_MS);
  }

  function onLocalWrite(e: Event) {
    const d = (e as CustomEvent).detail as
      | { holon?: string; lens?: string; at?: number }
      | undefined;
    if (!d?.holon || !d.at) return;
    // Writes routed to a partner holon (sourceRef) don't reliably echo when
    // federation is off — only the displayed holon's writes are probes.
    if (d.holon !== boundHolon) return;
    const lens = d.lens as keyof typeof lensEmitAt;
    if (
      lens !== "quests" &&
      lens !== "library" &&
      lens !== "roles" &&
      lens !== "checklists"
    )
      return;
    const at = d.at;
    setTimeout(() => {
      if (lensEmitAt[lens] >= at) return; // echoed — subscription is alive
      if (lastRebindAt >= at) return; // a burst of writes → one rebind
      lastRebindAt = Date.now();
      console.error(
        `[kiosk] live '${lens}' subscription missed a local write — rebinding all lens subscriptions`,
      );
      showNotice(tr("layout.resync"));
      rebindAll();
      verifyRebind(lens, at);
    }, ECHO_GRACE_MS);
  }

  // Pre-name tab-title fallback: the registered label that selected this holon
  // (URL path first — it wins in holon resolution — then the subdomain),
  // capitalised for the tab. Empty on unlabelled hosts (localhost, previews).
  let holonLabel = "";
  function labelFromUrl(): string {
    const seg = decodeURIComponent(
      location.pathname.replace(/^\/+/, "").split("/")[0] ?? "",
    )
      .trim()
      .toLowerCase();
    const label = SUBDOMAIN_HOLONS[seg] ? seg : subdomainOf(location.host);
    // An undeclared subdomain can be a bare holon id (see holonForHost); a
    // string of digits is no kind of tab title, so fall through to "Holons".
    if (!label || /^\d+$/.test(label)) return "";
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  onMount(() => {
    holonLabel = labelFromUrl();
    holonIdStore.set(resolveHolonId());
    // A deep-linked tab (`/tasks`, `/liminal/calendar`) opens that view. It
    // only picks the starting tab — it is not a pin, so a wall display's
    // rotation and idle snap-back behave exactly as configured. A
    // content-driven tab (shifts, library…) may not be visible yet while its
    // data is still streaming in: register the ask so the tab claims the
    // screen the moment it appears instead of being reset to the fallback.
    const urlTab = tabForPath(location.pathname);
    if (urlTab) {
      activeTab.set(urlTab);
      if (!get(visibleTabs).some((t) => t.id === urlTab))
        requestedTab.set(urlTab);
    }
    lastSyncedTab = get(activeTab);
    scope.set(resolveScope());
    libraryPref.set(resolveLibraryPref());
    rolesPref.set(resolveRolesPref());
    checklistsPref.set(resolveChecklistsPref());
    shiftsPref.set(resolveShiftsPref());
    statusEnabled.set(resolveStatusEnabled());
    flowsEnabled.set(resolveFlowsEnabled());
    taskViewMode.set(resolveTaskView());
    taskSort.set(resolveTaskSort());
    libraryViewMode.set(resolveLibraryView());
    rolesViewMode.set(resolveRolesView());
    calendarMode.set(resolveCalendarView());
    libraryCalendarMode.set(resolveLibraryCalendarView());
    brandName.set(resolveBrandName() ?? "");
    brandLogo.set(resolveBrandLogo() ?? "");
    accent.set(resolveAccent());
    themeMode.set(resolveThemeMode());
    langMode.set(resolveLangMode());
    initAuth();
    mounted = true;
    window.addEventListener("kiosk:write", onLocalWrite);
    window.addEventListener("kiosk:federation-changed", onFederationChanged);
    const teardown = [
      startClock(),
      startRotation(),
      startTheme(),
      startI18n(),
      startSwAutoReload(),
      // The Shifts feed follows the holonId store on its own; it reads a
      // relay, not Holosphere, so it lives outside refresh().
      startShifts(),
    ];
    return () => {
      window.removeEventListener("kiosk:write", onLocalWrite);
      window.removeEventListener(
        "kiosk:federation-changed",
        onFederationChanged,
      );
      teardown.forEach((fn) => fn());
      if (readyTimer) clearTimeout(readyTimer);
      questsSub?.unsubscribe();
      librarySub?.unsubscribe();
      rolesSub?.unsubscribe();
      checklistsSub?.unsubscribe();
      hiddenSub?.unsubscribe();
    };
  });

  // The signing-key vault (routes/key) is a Telegram Mini App — a phone-sized
  // page with its own life. It must not boot the board: no subscriptions, no
  // kiosk chrome, just the route.
  $: isMiniApp = $page.url.pathname.replace(/\/+$/, "") === "/key";

  // No holon resolved and nothing left to wait for → this isn't a board, it's
  // the front door: show the landing page (HomeView) instead of the kiosk
  // chrome, with the board-only overlays stood down.
  $: isHome = !isMiniApp && !booting && !$holonIdStore;

  // Reflect tab switches in the address bar — shallow, no navigation, so the
  // showing view is always shareable (`/tasks`, `/liminal/calendar`). Seeded
  // with the boot-time tab in onMount so merely loading a bare URL doesn't
  // rewrite it; every later switch (a tap, rotation, a pin snap-back) does.
  // Gated on the router having finished the initial navigation: a tab reset
  // can fire during the first flush (a deep-linked content-driven tab isn't
  // visible yet), and replaceState before router init THROWS — an uncaught
  // error there freezes the whole board's reactivity.
  let lastSyncedTab: TabId | null = null;
  let routerReady = false;
  afterNavigate(() => (routerReady = true));
  $: if (
    routerReady &&
    mounted &&
    !isMiniApp &&
    !isHome &&
    $activeTab !== lastSyncedTab
  ) {
    lastSyncedTab = $activeTab;
    const path = pathForTab(location.pathname, $activeTab);
    if (path !== location.pathname)
      replaceState(path + location.search + location.hash, {});
  }

  // Re-point the live subscriptions when the holon or federated flag changes
  // (CSR-only app, so a reactive statement after mount is safe).
  $: if (mounted && !isMiniApp)
    refresh(
      $holonIdStore,
      $federated,
      $libraryPref !== "off",
      $rolesPref !== "off",
      $checklistsPref !== "off",
    );

  // While awaiting the first reveal, (re)arm the settle timer on every data
  // change — including the bind itself, so a holon with no data still reveals.
  // Referencing the raw stores makes this re-run as the initial burst streams.
  $: if (mounted && awaitingReady) {
    void [$rawQuests, $rawLibrary, $rawRoles, $rawChecklists];
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
  <!-- Browser-tab / PWA title: the holon's name (caretaker override first).
       Until one is known, the subdomain/path label that selected the holon
       stands in (e.g. armoniaduale.hubs.network → "Armoniaduale") — never
       the app's own name. The landing page titles itself (HomeView), so stand
       aside there rather than racing it for the same tag. -->
  {#if !isHome}
    <title>{$brandName || $holonName || holonLabel || "Holons"}</title>
  {/if}
</svelte:head>

<svelte:window
  on:pointerdown|capture={onActivity}
  on:touchstart|capture={onActivity}
  on:keydown|capture={onActivity}
  on:wheel|capture={onActivity}
  on:pointermove|capture={onMove}
/>

{#if isMiniApp}
  <!-- Telegram Mini App route: no board, no chrome — the page is the app. -->
  <slot />
{:else}
  {#if isHome}
    <!-- Front door: what Holons is, and the button that starts one. -->
    <HomeView />
  {:else}
    <div class="kiosk">
      <TabBar />
      <main class="stage">
        <slot />
      </main>
    </div>

    <!-- Zoomed detail / edit overlay for the tapped post-it or card. -->
    <DetailModal />
  {/if}

  <!-- Login overlay, raised from the header chip or an "edit" prompt. -->
  {#if $loginOpen}
    <Modal on:close={() => loginOpen.set(false)}>
      <LoginCard />
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

  <!-- Board-only companions: they all act on the displayed holon, and the
       landing page has none. -->
  {#if !isHome}
    <!-- E2E pairing of the user's Telegram-held signing key (see pairing.ts). -->
    {#if $keyLinkOpen}
      <Modal on:close={() => keyLinkOpen.set(false)}>
        <KeyLinkModal />
      </Modal>
    {/if}

    <!-- Participant confirmation before a completion records REA. -->
    <CompleteConfirm />

    <!-- Push-to-talk voice agent; renders only when a voice server is reachable.
       Sends the displayed holon + active view + open record as turn context. -->
    <VoiceWidget />
  {/if}

  <!-- Transient one-line feedback for taps that can't proceed. -->
  {#if $notice}
    <div class="notice" role="status">{$notice}</div>
  {/if}
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
