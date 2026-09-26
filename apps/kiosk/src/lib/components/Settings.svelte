<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  // Caretaker settings for the kiosk, in three groups: which holon the screen
  // shows; how it looks (name, logo, the two colours, theme, language); and
  // what is true of the hub wherever it is shown (location, map, privacy,
  // equation). Device settings persist here (see config.ts), hub settings on
  // the holon's settings lens; all apply reactively — no reload needed. (The
  // dashboard link lives in the user menu; federated visibility is each view's
  // Show pill; tabs are added and removed on the tab strip itself.)
  //
  // Every control applies the moment you touch it — there is no Apply step to
  // forget on a wall-mounted screen. Switches and pickers write straight
  // through and render the live store, so what you see is what the kiosk is
  // actually doing; only the two text fields keep a draft, committed on blur
  // or Enter, so typing an id doesn't re-point the screen character by
  // character.
  import {
    holonId,
    holonName,
    brandName,
    brandLogo,
    accent,
    statusEnabled,
    flowsEnabled,
    settingsOpen,
    showNotice,
  } from "$lib/stores";
  import { showHomePage } from "$lib/home";
  import {
    setHolonId,
    setBrandName,
    setBrandLogo,
    setAccent,
    setThemeMode,
    setLangMode,
    DEFAULT_ACCENT,
    type ThemeMode,
    type LangMode,
  } from "$lib/config";
  import { themeMode } from "$lib/theme";
  import { langMode, t, tr, type MessageKey } from "$lib/i18n";
  import {
    HOME_HEX_DEFAULT_HOPS,
    HOME_HEX_MAX_HOPS,
    mirrorItemToHomeHex,
    readHomeHexLink,
    readSettingsHex,
    setHomeHexLink,
    unlinkHomeHex,
    type HomeHexLink,
  } from "@holons/core/federation";
  import {
    loadSettings,
    readHolonColor,
    saveHolonColor,
  } from "@holons/core/settings";
  import {
    holonColor,
    holonColors,
    resolveCssColor,
    setHolonColor,
  } from "$lib/palette";
  import { readCollectiveSlug, saveCollectiveSlug } from "@holons/core/flows";
  import {
    getPrivacySnapshot,
    setLensPrivacy,
    type PrivacyLensMode,
  } from "@holons/core/privacy";
  import { isLoggedIn, loginOpen } from "$lib/auth";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { npubLabel } from "$lib/login/nostrKey";
  import { getHolosphere } from "$lib/holosphere";
  import {
    resolveHolonAuthority,
    type HolonAuthority,
  } from "@holons/core/holosphere";
  import {
    addHubMember,
    foundHub,
    foundingAuthority,
    hubMembers,
    myHubRole,
    removeHubMember,
    type FoundingAuthority,
  } from "@holons/core/protocol";
  import HexPicker from "./HexPicker.svelte";
  import ValueEquation from "./ValueEquation.svelte";

  // Drafts for the free-text fields only — every other control writes through
  // on touch and renders its store.
  let draftHolon = $holonId ?? "";
  let draftName = $brandName;
  let draftAccent = $accent || DEFAULT_ACCENT;
  let logoError = "";

  // The holon's claimed H3 cell (`settings.hex`, shared with wequest and the
  // dashboard). `undefined` = still loading; the picker is only offered while
  // no cell is claimed yet.
  let homeHex: string | null | undefined = undefined;
  let hexPickerOpen = false;
  $: void loadHomeHex($holonId);
  async function loadHomeHex(id: string | null) {
    homeHex = undefined;
    if (!id) {
      homeHex = null;
      return;
    }
    try {
      const hs = await getHolosphere();
      const hex = await readSettingsHex(hs, id);
      if (id === $holonId) homeHex = hex;
    } catch {
      if (id === $holonId) homeHex = null;
    }
  }

  // ── Private lenses ────────────────────────────────────────────────────
  // A private lens keeps its content sealed on the relays; the vault that
  // holds its key is sealed to the signed-in key, so the toggle needs a
  // person's key, not the device key. Core owns the rule of what may be
  // private and keeps the public hint in step (see @holons/core/privacy).
  const PRIVACY_LENSES = ["quests", "library", "roles", "checklists", "stock"];
  let privacyLenses: Record<string, PrivacyLensMode> = {};
  let privacyBusy = "";
  // How many keys hold each lens (the owner's grant ledger), and who speaks
  // for this hub — the key a partner's grants go to, and the authority the
  // reads enforce. Nothing signed → said plainly: keys cannot be shared with
  // this hub, and every write counts until its bot founds it.
  let privacyShared: Record<string, number> = {};
  let hubAuthority: HolonAuthority | null = null;
  // Who may found this hub when nobody speaks for it yet (core's rule): a
  // Telegram chat is its bot's; anything else a signed-in key may found from
  // here — but only a person's adopted key, never this device's throwaway one.
  let founding: FoundingAuthority | null = null;
  let foundBusy = false;
  // The hub's signed roster, when the adopted key is one of its admins: the
  // Telegram-free way in is being seated here by public key.
  let hubKeys: Map<string, "admin" | "member"> = new Map();
  let hubRole: "admin" | "member" | null = null;
  let keyDraft = "";
  let keyBusy = false;
  let hubKeySource: MessageKey;
  $: hubKeySource =
    hubAuthority?.anchor && hubAuthority.actors?.source === "log"
      ? "settings.hubKeyLog"
      : hubAuthority?.anchor &&
          $holonId &&
          hubAuthority.anchor === $holonId.toLowerCase()
        ? "settings.hubKeyOwn"
        : hubAuthority?.anchor
          ? "settings.hubKeyBoot"
          : "settings.hubKeyNone";
  $: void loadPrivacy($holonId, $isLoggedIn, $sessionKeyPub);
  $: privacyRows = [
    ...PRIVACY_LENSES,
    ...Object.keys(privacyLenses).filter((l) => !PRIVACY_LENSES.includes(l)),
  ];

  async function loadPrivacy(
    id: string | null,
    loggedIn: boolean,
    sessionKey: string | null,
  ) {
    if (!id || !loggedIn) {
      privacyLenses = {};
      founding = null;
      hubKeys = new Map();
      hubRole = null;
      return;
    }
    try {
      const hs = await getHolosphere();
      const snap = await getPrivacySnapshot(hs, id);
      if (id === $holonId) {
        privacyLenses = snap.lenses;
        const counts: Record<string, number> = {};
        for (const g of Object.values(snap.grants)) {
          for (const lens of g.lenses ?? [])
            counts[lens] = (counts[lens] ?? 0) + 1;
        }
        privacyShared = counts;
        try {
          hubAuthority = resolveHolonAuthority(hs, id);
          founding = foundingAuthority(hs, id);
        } catch {
          hubAuthority = null;
          founding = null;
        }
        await loadHubKeys(hs, id, sessionKey);
      }
    } catch {
      if (id === $holonId) {
        privacyLenses = {};
        privacyShared = {};
      }
    }
  }

  async function loadHubKeys(
    hs: Awaited<ReturnType<typeof getHolosphere>>,
    id: string,
    sessionKey: string | null,
  ) {
    if (!sessionKey || founding?.kind !== "anchored") {
      hubKeys = new Map();
      hubRole = null;
      return;
    }
    try {
      const role = await myHubRole(hs, id);
      const keys = role === "admin" ? await hubMembers(hs, id) : new Map();
      if (id === $holonId) {
        hubRole = role;
        hubKeys = keys;
      }
    } catch {
      if (id === $holonId) {
        hubKeys = new Map();
        hubRole = null;
      }
    }
  }

  function reasonOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  async function foundThisHub() {
    if (!$holonId || foundBusy || !$sessionKeyPub) return;
    foundBusy = true;
    try {
      const hs = await getHolosphere();
      await foundHub(hs, $holonId, { name: $holonName || undefined });
      showNotice(tr("settings.hubFounded"));
      await loadPrivacy($holonId, $isLoggedIn, $sessionKeyPub);
    } catch (err) {
      console.error("[kiosk] founding failed", err);
      showNotice(tr("settings.hubFoundFailed", { reason: reasonOf(err) }));
    } finally {
      foundBusy = false;
    }
  }

  async function addKey(role: "admin" | "member") {
    const key = keyDraft.trim();
    if (!$holonId || !key || keyBusy) return;
    keyBusy = true;
    try {
      const hs = await getHolosphere();
      const pub = await addHubMember(hs, $holonId, key, role);
      hubKeys = new Map(hubKeys).set(pub, role);
      keyDraft = "";
    } catch (err) {
      showNotice(tr("settings.hubKeyFailed", { reason: reasonOf(err) }));
    } finally {
      keyBusy = false;
    }
  }

  async function removeKey(pub: string) {
    if (!$holonId || keyBusy) return;
    keyBusy = true;
    try {
      const hs = await getHolosphere();
      await removeHubMember(hs, $holonId, pub);
      const next = new Map(hubKeys);
      next.delete(pub);
      hubKeys = next;
    } catch (err) {
      showNotice(tr("settings.hubKeyFailed", { reason: reasonOf(err) }));
    } finally {
      keyBusy = false;
    }
  }

  async function togglePrivacy(lens: string) {
    if (!$holonId || privacyBusy) return;
    const next: PrivacyLensMode =
      privacyLenses[lens] === "private" ? "public" : "private";
    privacyBusy = lens;
    try {
      const hs = await getHolosphere();
      await setLensPrivacy(hs, $holonId, lens, next);
      privacyLenses = { ...privacyLenses, [lens]: next };
    } catch (err) {
      console.error("[kiosk] lens privacy change failed", err);
      showNotice(tr("settings.privacyFailed"));
    } finally {
      privacyBusy = "";
    }
  }

  // ── On the map ────────────────────────────────────────────────────────
  // The home hex configured as a federation partner. Opening a lens here is
  // what makes an ordinary write show up on the shared map; the reach says how
  // far out you can be zoomed and still find it. The kiosk offers the lenses it
  // actually shows, plus anything already opened elsewhere, so a dashboard
  // setting is never silently dropped when this screen saves.
  const MAP_LENSES = ["quests", "library", "roles", "checklists"];
  let mapLink: HomeHexLink | null = null;
  let mapBusy = false;
  let mapPlacing: { lens: string; done: number; total: number } | null = null;
  $: void loadMapLink($holonId, homeHex);
  $: mapLenses = [
    ...MAP_LENSES,
    ...[...(mapLink?.inbound ?? []), ...(mapLink?.outbound ?? [])]
      .filter((l) => !MAP_LENSES.includes(l))
      .filter((l, i, a) => a.indexOf(l) === i),
  ];

  async function loadMapLink(
    id: string | null,
    hex: string | null | undefined,
  ) {
    if (!id || !hex) {
      mapLink = null;
      return;
    }
    try {
      const hs = await getHolosphere();
      const link = await readHomeHexLink(hs, id);
      if (id === $holonId) mapLink = link;
    } catch {
      if (id === $holonId) mapLink = null;
    }
  }

  /** Reach as a place rather than a number — 0 means nothing is placed. */
  function reachLabel(hops: number): string {
    const i = Math.min(Math.max(hops, 0), 7);
    return $t(`settings.reach${i}` as MessageKey);
  }

  /** setHomeHexLink fully replaces the config, so always pass the whole thing. */
  async function saveMap(next: {
    inbound: string[];
    outbound: string[];
    hops: number;
  }) {
    if (!$holonId || mapBusy) return;
    mapBusy = true;
    try {
      const hs = await getHolosphere();
      mapLink = await setHomeHexLink(hs, $holonId, next);
    } catch (err) {
      console.error("[kiosk] home-hex save failed", err);
      showNotice(tr("settings.onMapFailed"));
      await loadMapLink($holonId, homeHex);
    } finally {
      mapBusy = false;
    }
  }

  async function toggleMapLens(lens: string, dir: "in" | "out") {
    if (!mapLink) return;
    const key = dir === "in" ? "inbound" : "outbound";
    const current = mapLink[key];
    const wasOn = current.includes(lens);
    const next = wasOn ? current.filter((l) => l !== lens) : [...current, lens];
    await saveMap({
      inbound: key === "inbound" ? next : mapLink.inbound,
      outbound: key === "outbound" ? next : mapLink.outbound,
      hops: mapLink.hops,
    });
    // Opening a lens only affects writes from here on, so a board that is
    // already full would leave the map looking broken. Place what is there.
    if (!wasOn && dir === "out") await placeExisting(lens);
  }

  async function placeExisting(lens: string) {
    if (!$holonId || !mapLink) return;
    let items: Array<{ id: string; [k: string]: any }> = [];
    try {
      const hs = await getHolosphere();
      items = (await (hs as any).getAll($holonId, lens)) ?? [];
      const todo = items.filter((i) => i && i.id && !i._deleted);
      if (todo.length === 0) return;
      mapPlacing = { lens, done: 0, total: todo.length };
      for (const item of todo) {
        try {
          await mirrorItemToHomeHex(hs, $holonId, lens, item, mapLink);
        } catch {
          // Best-effort — one unplaceable item must not stop the rest.
        }
        mapPlacing = { ...mapPlacing, done: mapPlacing.done + 1 };
      }
      showNotice(tr("settings.onMapPlaced", { n: todo.length }));
    } catch (err) {
      console.error("[kiosk] backfill failed", err);
    } finally {
      mapPlacing = null;
    }
  }

  async function linkMap() {
    await saveMap({ inbound: [], outbound: [], hops: HOME_HEX_DEFAULT_HOPS });
  }

  async function unlinkMap() {
    if (!$holonId || mapBusy) return;
    mapBusy = true;
    try {
      const hs = await getHolosphere();
      await unlinkHomeHex(hs, $holonId);
      mapLink = null;
    } catch (err) {
      console.error("[kiosk] home-hex unlink failed", err);
      showNotice(tr("settings.onMapFailed"));
    } finally {
      mapBusy = false;
    }
  }

  const THEMES = [
    { id: "auto", labelKey: "common.auto", icon: "contrast" },
    { id: "light", labelKey: "settings.light", icon: "sun" },
    { id: "dark", labelKey: "settings.dark", icon: "moon" },
  ] as const;

  // Language names are endonyms — deliberately not translated.
  const LANG_OPTS: { id: LangMode; label: string | null }[] = [
    { id: "auto", label: null }, // rendered as the localized "Auto"
    { id: "en", label: "English" },
    { id: "it", label: "Italiano" },
    { id: "es", label: "Español" },
  ];

  const SWATCHES = [
    DEFAULT_ACCENT,
    "#3b6fb0",
    "#7a5cc0",
    "#c0567a",
    "#c47d2f",
    "#2f9e6b",
  ];

  function onLogoFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    logoError = "";
    if (!file.type.startsWith("image/")) {
      logoError = $t("settings.notImage");
      return;
    }
    if (file.size > 512 * 1024) {
      logoError = $t("settings.imageTooLarge");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => commitLogo(String(reader.result ?? ""));
    reader.onerror = () => (logoError = $t("settings.imageReadError"));
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    commitLogo("");
    logoError = "";
  }

  // -- write-through commits -------------------------------------------------

  /** Point the screen at another holon. Emptying the field unpins it. */
  function commitHolon() {
    const id = draftHolon.trim();
    if (!id) {
      void clearHolon();
      return;
    }
    if (id === $holonId) return;
    setHolonId(id);
    holonId.set(id);
  }

  /** Unpin the screen and go back to the home page (see lib/home.ts). */
  async function clearHolon() {
    draftHolon = "";
    await showHomePage();
  }

  function commitName() {
    setBrandName(draftName);
    brandName.set(draftName.trim());
  }

  function commitLogo(value: string) {
    setBrandLogo(value || null);
    brandLogo.set(value);
  }

  function commitAccent(value: string) {
    draftAccent = value;
    setAccent(value);
    accent.set(value);
  }

  function commitTheme(mode: ThemeMode) {
    setThemeMode(mode);
    themeMode.set(mode);
  }

  function commitLang(mode: LangMode) {
    setLangMode(mode);
    langMode.set(mode);
  }

  // ---- Value equation ----------------------------------------------------
  // The weights the Status board scores with are settings too, so the group
  // that reads the board can retune them here (offered while the board is
  // on; switching it on happens on the tab strip, behind its framing modal).
  // The editor itself lives in ValueEquation.svelte (the board's own footer
  // opens the same one).
  //
  // It is a disclosure: settings stays scannable, and the equation is only
  // read from the graph once someone actually opens it.
  let eqOpen = false;

  // ---- Flows board -------------------------------------------------------
  // The collective slug is per-holon (it lives on the settings lens, not this
  // device), so a hub that switches holons shows the right collective without
  // anyone re-pasting anything. Written through the core helper, which merges
  // over the existing settings document rather than replacing it.
  let ocSlug = "";
  let ocLoadedFor: string | null = null;
  let ocSaving = false;

  // ---- Holon colour ------------------------------------------------------
  // Per-holon too: the colour its board is washed with, its dock orb and map
  // hexagon are painted in, and its mirrored cards glow with. Blank means the
  // automatic one — the note the id hashes to, the same way a task card gets
  // its colour from its category.
  let colorOverride = "";
  let colorSaving = false;
  $: colorShown = $holonId ? holonColor($holonId, $holonColors) : "";
  // The picker needs a literal: resolve the note variable against the theme.
  $: colorDraft = colorShown ? resolveCssColor(colorShown) : "#000000";

  $: void loadHolonSettings($holonId);

  async function loadHolonSettings(holon: string | null) {
    if (holon === ocLoadedFor) return;
    ocLoadedFor = holon;
    ocSlug = "";
    colorOverride = "";
    if (!holon) return;
    try {
      const hs = await getHolosphere();
      const doc = await loadSettings(hs, holon);
      if (ocLoadedFor !== holon) return; // holon changed while reading
      ocSlug = readCollectiveSlug(doc);
      colorOverride = readHolonColor(doc);
      setHolonColor(holon, colorOverride);
    } catch (err) {
      console.warn("[kiosk] settings: holon settings read failed", err);
    }
  }

  /** Persist a chosen colour ('' restores the automatic one). */
  async function commitHolonColor(value: string) {
    const holon = $holonId;
    if (!holon) return;
    colorSaving = true;
    try {
      const hs = await getHolosphere();
      colorOverride = await saveHolonColor(hs, holon, value);
      setHolonColor(holon, colorOverride);
    } catch (err) {
      console.error("[kiosk] settings: holon colour save failed", err);
      showNotice(tr("settings.holonColorFailed"));
    } finally {
      colorSaving = false;
    }
  }

  /** Commit on blur/Enter, the same as the other text fields here. */
  async function commitCollective() {
    const holon = $holonId;
    if (!holon) return;
    ocSaving = true;
    try {
      const hs = await getHolosphere();
      // Accepts a pasted collective URL as readily as a bare slug, and hands
      // back what was actually stored so the field shows the truth.
      ocSlug = await saveCollectiveSlug(hs, holon, ocSlug);
    } catch (err) {
      console.error("[kiosk] settings: collective slug save failed", err);
      showNotice(tr("settings.collectiveFailed"));
    } finally {
      ocSaving = false;
    }
  }

  /** Enter on a text field commits and dismisses the on-screen keyboard. */
  function blurOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="settings">
  <div class="glyph" aria-hidden="true"><Icon name="gear" /></div>
  <h3>{$t("settings.title")}</h3>

  <h4 class="group">{$t("settings.groupScreen")}</h4>
  <label class="field"
    >{$t("settings.holon")}
    <input
      type="text"
      bind:value={draftHolon}
      placeholder={$t("settings.holonPlaceholder")}
      inputmode="numeric"
      on:change={commitHolon}
      on:keydown={blurOnEnter}
    />
  </label>
  <!-- Emptying the field above does this too, but a blank field is nobody's
       idea of a button: say plainly how a screen gets unpinned. -->
  {#if $holonId}
    <button class="unpin" on:click={clearHolon}>
      {$t("settings.unpinHolon")}
    </button>
  {/if}

  <h4 class="group">{$t("settings.groupLook")}</h4>
  <label class="field"
    >{$t("settings.displayName")}
    <input
      type="text"
      bind:value={draftName}
      placeholder={$holonName || $t("settings.displayNamePlaceholder")}
      on:change={commitName}
      on:keydown={blurOnEnter}
    />
  </label>

  <div class="field">
    {$t("settings.logo")} <span class="sub">{$t("settings.logoSub")}</span>
    <div class="logo-row">
      <div class="logo-preview" class:empty={!$brandLogo}>
        {#if $brandLogo}
          <img src={$brandLogo} alt={$t("settings.logoPreview")} />
        {:else}
          <span class="wm"
            >{draftName.trim() ||
              $holonName ||
              $t("settings.namePlaceholder")}</span
          >
        {/if}
      </div>
      <div class="logo-actions">
        <label class="upload">
          {$t("settings.upload")}
          <input type="file" accept="image/*" on:change={onLogoFile} />
        </label>
        {#if $brandLogo}
          <button type="button" class="link" on:click={clearLogo}
            >{$t("settings.useDefault")}</button
          >
        {/if}
      </div>
    </div>
    {#if logoError}<p class="err">{logoError}</p>{/if}
  </div>

  <div class="field">
    {$t("settings.accent")}
    <div class="accent-row">
      {#each SWATCHES as sw (sw)}
        <button
          type="button"
          class="swatch"
          class:sel={draftAccent.toLowerCase() === sw.toLowerCase()}
          style="background: {sw};"
          aria-label={$t("settings.accentAria", { color: sw })}
          on:click={() => commitAccent(sw)}
        ></button>
      {/each}
      <label class="swatch custom" style="background: {draftAccent};">
        <!-- bind:value previews the drag live; commit once on release. -->
        <input
          type="color"
          bind:value={draftAccent}
          on:change={() => commitAccent(draftAccent)}
          aria-label={$t("settings.customAccent")}
        />
      </label>
    </div>
  </div>

  <!--
    Per-holon, not per-device: the colour lives on the settings lens, so the
    board, its orb, its hexagon and its mirrored cards agree on every screen.
  -->
  {#if $holonId}
    <div class="field">
      {$t("settings.holonColor")}
      <span class="sub">{$t("settings.holonColorSub")}</span>
      <div class="accent-row">
        <label
          class="swatch custom holon-swatch"
          class:auto={!colorOverride}
          style="background: {colorShown};"
        >
          <input
            type="color"
            value={colorDraft}
            disabled={colorSaving}
            on:change={(e) => commitHolonColor(e.currentTarget.value)}
            aria-label={$t("settings.holonColorPick")}
          />
        </label>
        {#if colorOverride}
          <button
            type="button"
            class="hex-pick"
            disabled={colorSaving}
            on:click={() => commitHolonColor("")}
          >
            {$t("settings.holonColorAuto")}
          </button>
        {:else}
          <span class="holon-auto">{$t("settings.holonColorIsAuto")}</span>
        {/if}
      </div>
    </div>
  {/if}

  <div class="field">
    {$t("settings.appearance")}
    <span class="sub">{$t("settings.appearanceSub")}</span>
    <div class="theme-row">
      {#each THEMES as th (th.id)}
        <button
          type="button"
          class="theme-opt"
          class:sel={$themeMode === th.id}
          aria-pressed={$themeMode === th.id}
          on:click={() => commitTheme(th.id)}
        >
          <span class="theme-glyph" aria-hidden="true"
            ><Icon name={th.icon} /></span
          >
          {$t(th.labelKey)}
        </button>
      {/each}
    </div>
  </div>

  <div class="field">
    {$t("settings.language")}
    <span class="sub">{$t("settings.languageSub")}</span>
    <div class="theme-row">
      {#each LANG_OPTS as l (l.id)}
        <button
          type="button"
          class="theme-opt"
          class:sel={$langMode === l.id}
          aria-pressed={$langMode === l.id}
          on:click={() => commitLang(l.id)}
        >
          {l.label ?? $t("common.auto")}
        </button>
      {/each}
    </div>
  </div>

  <!-- Hub settings live on the holon's settings lens, so they only exist
       once the screen shows a holon. -->
  {#if $holonId}
    <h4 class="group">{$t("settings.groupHub")}</h4>

    <div class="field">
      {$t("settings.location")}
      <span class="sub">{$t("settings.locationSub")}</span>
      {#if homeHex === undefined}
        <p class="hex-note">{$t("settings.checking")}</p>
      {:else if homeHex}
        <div class="hex-row">
          <p class="hex-cell">{homeHex}</p>
          <button
            type="button"
            class="hex-pick"
            on:click={() => (hexPickerOpen = true)}
          >
            {$t("settings.change")}
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="hex-pick"
          on:click={() => (hexPickerOpen = true)}
        >
          <Icon name="hexagon" />
          {$t("settings.setLocation")}
        </button>
      {/if}
    </div>

    <!-- Private lenses: sealed on the relays, readable by the keys handed out. -->
    <div class="field">
      {$t("settings.privacy")}
      <span class="sub">{$t("settings.privacySub")}</span>
      {#if !$isLoggedIn}
        <p class="hex-note">{$t("settings.privacyLogin")}</p>
      {:else}
        {#each privacyRows as lens (lens)}
          {@const on = privacyLenses[lens] === "private"}
          <div class="map-row">
            <span class="map-lens"
              >{lens}{#if on && privacyShared[lens]}<span class="shared"
                  >{$t("settings.privacyShared", {
                    n: privacyShared[lens],
                  })}</span
                >{/if}</span
            >
            <div class="map-lanes">
              <button
                type="button"
                class="lane lock"
                class:on
                aria-pressed={on}
                aria-label={$t("settings.privacyAria", {
                  lens,
                  state: $t(
                    on ? "settings.privacyPrivate" : "settings.privacyPublic",
                  ),
                })}
                disabled={!!privacyBusy}
                on:click={() => togglePrivacy(lens)}
                ><Icon name={on ? "lock" : "unlock"} /></button
              >
            </div>
          </div>
        {/each}
        <p class="hex-note">{$t("settings.privacyHint")}</p>
        <p class="hex-note" class:warn={!hubAuthority?.anchor}>
          {#if hubAuthority?.anchor}
            {$t("settings.hubKey", {
              key: `${hubAuthority.anchor.slice(0, 8)}…`,
            })} — {$t(hubKeySource)}
          {:else if founding?.kind === "bot"}
            {$t("settings.hubKeyBot")}
          {:else if founding?.kind === "open" && $sessionKeyPub}
            {$t("settings.hubKeyOpen")}
          {:else if founding?.kind === "open"}
            {$t("settings.hubKeyNeedsKey")}
          {:else}
            {$t("settings.hubKeyNone")}
          {/if}
        </p>
        {#if !hubAuthority?.anchor && founding?.kind === "open"}
          {#if $sessionKeyPub}
            <button
              type="button"
              class="found"
              disabled={foundBusy}
              on:click={foundThisHub}
            >
              <Icon name="key" />
              {$t("settings.hubFound")}
            </button>
          {:else}
            <button
              type="button"
              class="found"
              on:click={() => loginOpen.set(true)}
            >
              <Icon name="key" />
              {$t("settings.hubFoundLogin")}
            </button>
          {/if}
        {/if}
      {/if}
    </div>

    {#if hubRole === "admin"}
      <!-- The hub's signed roster: seating people by public key, no Telegram. -->
      <div class="field">
        {$t("settings.hubKeys")}
        <span class="sub">{$t("settings.hubKeysSub")}</span>
        {#each [...hubKeys] as [pub, role] (pub)}
          <div class="map-row">
            <span class="map-lens key-label" title={pub}
              >{npubLabel(pub)}<span class="shared"
                >{$t(
                  role === "admin"
                    ? "settings.hubKeyRoleAdmin"
                    : "settings.hubKeyRoleMember",
                )}{#if pub === $sessionKeyPub}{" · "}{$t(
                    "settings.hubKeyYou",
                  )}{/if}</span
              ></span
            >
            {#if pub !== $sessionKeyPub}
              <div class="map-lanes">
                <button
                  type="button"
                  class="lane"
                  aria-label={$t("settings.hubKeyRemove", {
                    key: npubLabel(pub),
                  })}
                  disabled={keyBusy}
                  on:click={() => removeKey(pub)}><Icon name="trash" /></button
                >
              </div>
            {/if}
          </div>
        {/each}
        <form class="key-add" on:submit|preventDefault={() => addKey("member")}>
          <input
            type="text"
            bind:value={keyDraft}
            placeholder={$t("settings.hubKeyAddPlaceholder")}
            aria-label={$t("settings.hubKeyAddPlaceholder")}
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <div class="key-actions">
            <button type="submit" class="found" disabled={keyBusy || !keyDraft}
              >{$t("settings.hubKeyAdd")}</button
            >
            <button
              type="button"
              class="found ghost"
              disabled={keyBusy || !keyDraft}
              on:click={() => addKey("admin")}
              >{$t("settings.hubKeyAddAdmin")}</button
            >
          </div>
        </form>
      </div>
    {/if}

    <!--
      The claimed cell, configured as a federation partner: which lenses reach
      the shared map, and how far up the scalespace they travel. Opening a lens
      here is the whole gesture — from then on ordinary writes place themselves.
    -->
    <div class="field">
      {$t("settings.onMap")}
      <span class="sub">{$t("settings.onMapSub")}</span>

      {#if !homeHex}
        <p class="hex-note">{$t("settings.onMapNeedsHex")}</p>
      {:else if !mapLink}
        <button
          type="button"
          class="hex-pick"
          disabled={mapBusy}
          on:click={linkMap}
        >
          <Icon name="hexagon" />
          {$t("settings.onMapLink")}
        </button>
      {:else}
        <div class="reach">
          <div class="reach-head">
            <span>{$t("settings.onMapReach")}</span>
            <strong>{reachLabel(mapLink.hops)}</strong>
          </div>
          <input
            type="range"
            min="0"
            max={HOME_HEX_MAX_HOPS}
            value={mapLink.hops}
            disabled={mapBusy || !!mapPlacing}
            aria-label={$t("settings.onMapReach")}
            on:change={(e) =>
              mapLink &&
              saveMap({
                inbound: mapLink.inbound,
                outbound: mapLink.outbound,
                hops: Number(e.currentTarget.value),
              })}
          />
        </div>

        {#each mapLenses as lens (lens)}
          <div class="map-row">
            <span class="map-lens">{lens}</span>
            <div class="map-lanes">
              <button
                type="button"
                class="lane in"
                class:on={mapLink.inbound.includes(lens)}
                aria-pressed={mapLink.inbound.includes(lens)}
                aria-label={$t("settings.onMapReceive", { lens })}
                disabled={mapBusy || !!mapPlacing}
                on:click={() => toggleMapLens(lens, "in")}
                ><Icon name="arrow-down" /></button
              >
              <button
                type="button"
                class="lane out"
                class:on={mapLink.outbound.includes(lens)}
                aria-pressed={mapLink.outbound.includes(lens)}
                aria-label={$t("settings.onMapSend", { lens })}
                disabled={mapBusy || !!mapPlacing}
                on:click={() => toggleMapLens(lens, "out")}
                ><Icon name="arrow-up" /></button
              >
            </div>
          </div>
        {/each}

        {#if mapPlacing}
          <p class="hex-note">
            {$t("settings.onMapPlacing", {
              done: mapPlacing.done,
              total: mapPlacing.total,
            })}
          </p>
        {:else}
          <p class="hex-note">{$t("settings.onMapReachHint")}</p>
        {/if}

        <button
          type="button"
          class="hex-pick unlink-map"
          disabled={mapBusy || !!mapPlacing}
          on:click={unlinkMap}
        >
          {$t("settings.onMapUnlink")}
        </button>
      {/if}
    </div>
  {/if}

  <!--
    With the Status board on, the weights it scores with are settings too: the
    group that reads the board retunes it here. (The framing lives on the board
    itself and in the modal the tab strip shows before switching it on.)
  -->
  {#if $statusEnabled && $holonId}
    <div class="field">
      <button
        type="button"
        class="eq-toggle"
        aria-expanded={eqOpen}
        on:click={() => (eqOpen = !eqOpen)}
      >
        <span class="eq-toggle-label"
          >{$t("settings.valueEquation")}
          <span class="sub">{$t("settings.valueEquationSub")}</span></span
        >
        <span class="chev" class:open={eqOpen} aria-hidden="true"
          ><Icon name="chevron-down" /></span
        >
      </button>
      {#if eqOpen}
        <ValueEquation holon={$holonId} />
      {/if}
    </div>
  {/if}

  <!--
    Per-holon, not per-device: the slug lives on the settings lens so every
    surface reading this holon finds the same collective.
  -->
  {#if $flowsEnabled && $holonId}
    <div class="field">
      {$t("settings.collective")}
      <span class="sub">{$t("settings.collectiveSub")}</span>
      <input
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder={$t("settings.collectivePlaceholder")}
        bind:value={ocSlug}
        disabled={ocSaving}
        on:change={commitCollective}
        on:keydown={blurOnEnter}
      />
    </div>
  {/if}

  <!-- Federation moved to the dock: close the board and drag one circle onto
       another to link, or tap an intersection to tune its lenses. -->

  <div class="actions">
    <button class="primary" on:click={() => settingsOpen.set(false)}
      >{$t("common.close")}</button
    >
  </div>
</div>

{#if hexPickerOpen && $holonId}
  <HexPicker
    holonId={$holonId}
    current={homeHex ?? null}
    on:close={() => (hexPickerOpen = false)}
    on:saved={(e) => (homeHex = e.detail)}
  />
{/if}

<style>
  .settings {
    text-align: center;
    padding: 0.5rem 0.25rem;
  }
  .glyph {
    font-size: 2rem;
    color: var(--teal);
  }
  h3 {
    margin: 0.4rem 0 1rem;
    font-size: 1.3rem;
    color: var(--ink);
  }
  .unpin {
    display: block;
    margin-top: 0.5rem;
    padding: 0.4rem 0;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--teal);
    text-align: left;
  }
  .unpin:active {
    opacity: 0.6;
  }
  /* Group headings: the sheet reads as three short lists, not one long one. */
  .group {
    margin: 1.6rem 0 -0.2rem;
    padding-bottom: 0.35rem;
    border-bottom: 1.5px solid var(--line);
    text-align: left;
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--teal-deep);
  }
  .group:first-of-type {
    margin-top: 0.4rem;
  }
  .field {
    display: block;
    text-align: left;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    margin-top: 1rem;
  }
  input[type="text"] {
    display: block;
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  input[type="text"]:focus {
    outline: none;
    border-color: var(--teal);
  }

  /* Logo picker */
  .logo-row {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 0.4rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .logo-preview {
    flex: 0 0 auto;
    width: 64px;
    height: 44px;
    border-radius: 10px;
    background: var(--card);
    border: 1.5px solid var(--line);
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .logo-preview img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .logo-preview.empty .wm {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--teal-deep);
    padding: 0 0.3rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--muted);
  }
  .logo-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
  }
  .upload {
    display: inline-block;
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    background: var(--paper);
    color: var(--teal-deep);
    font-size: 0.85rem;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }
  .upload input {
    display: none;
  }
  .link {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-decoration: underline;
  }
  .err {
    text-align: left;
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    color: #9a3b2f;
    text-transform: none;
    letter-spacing: 0;
  }

  /* Location (home hex) */
  .hex-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .hex-row .hex-cell {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hex-row .hex-pick {
    flex: 0 0 auto;
  }
  .map-lens .shared {
    margin-left: 0.5rem;
    font-size: 0.75em;
    opacity: 0.7;
  }
  .hex-note.warn {
    color: #b45309;
  }
  .hex-note {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0;
  }

  /* Value-equation disclosure (offered while the Status board is on). */
  .eq-toggle {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 44px;
    padding: 0.2rem 0;
    text-align: left;
    font: inherit;
    color: var(--muted);
    text-transform: inherit;
    letter-spacing: inherit;
  }
  .eq-toggle-label {
    flex: 1;
    min-width: 0;
  }
  .chev {
    flex: 0 0 auto;
    font-size: 1rem;
    color: var(--teal-deep);
    transform: rotate(-90deg);
    transition: transform 0.15s ease;
  }
  .chev.open {
    transform: rotate(0deg);
  }

  .hex-cell {
    margin: 0.4rem 0 0;
    padding: 0.55rem 0.8rem;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 0.85rem;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    text-transform: none;
    letter-spacing: 0;
  }
  .hex-pick {
    display: block;
    margin-top: 0.4rem;
    padding: 0.6rem 1rem;
    border-radius: 12px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--teal-deep);
    font-size: 0.9rem;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
    transition: transform 0.1s ease;
  }
  .hex-pick:active {
    transform: scale(0.97);
  }
  .hex-pick:disabled {
    opacity: 0.5;
  }

  /* On the map — reach dial and the per-lens direction lanes. */
  .reach {
    margin-top: 0.5rem;
  }
  .reach-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 0.85rem;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0;
  }
  .reach-head strong {
    color: var(--teal-deep);
    font-weight: 700;
  }
  .reach input[type="range"] {
    width: 100%;
    margin-top: 0.3rem;
    accent-color: var(--teal-deep);
  }
  .map-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
  }
  .map-lens {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
    color: var(--ink);
    text-transform: capitalize;
    letter-spacing: 0;
  }
  .map-lanes {
    display: flex;
    gap: 0.4rem;
  }
  .lane {
    width: 44px;
    height: 34px;
    border-radius: 10px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--muted);
    font-size: 1rem;
    line-height: 1;
    transition:
      background 0.12s ease,
      color 0.12s ease,
      border-color 0.12s ease;
  }
  .lane.on {
    background: var(--teal-deep);
    border-color: var(--teal-deep);
    color: #fff;
  }
  .lane:disabled {
    opacity: 0.5;
  }
  .unlink-map {
    color: #9a3b2f;
  }

  .accent-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.45rem;
  }
  .swatch {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    box-shadow: var(--shadow-soft);
    position: relative;
    transition: transform 0.1s ease;
  }
  .swatch:active {
    transform: scale(0.9);
  }
  .swatch.sel {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  .swatch.custom {
    display: grid;
    place-items: center;
    cursor: pointer;
    border: 2px dashed rgba(255, 255, 255, 0.7);
  }
  .swatch.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  /* The holon's colour: a solid rim (dashed only while automatic). */
  .holon-swatch {
    border: 2px solid color-mix(in srgb, var(--ink) 35%, transparent);
  }
  .holon-swatch.auto {
    border-style: dashed;
  }
  .holon-auto {
    align-self: center;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink-soft);
    text-transform: none;
    letter-spacing: 0;
  }
  /* Appearance (theme) segmented control */
  .theme-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.45rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .theme-opt {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.6rem 0.4rem;
    border-radius: 12px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .theme-opt:active {
    transform: scale(0.96);
  }
  .theme-opt.sel {
    border-color: var(--teal);
    color: var(--teal-deep);
  }
  .theme-glyph {
    font-size: 1.3rem;
    line-height: 1;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.3rem;
  }
  .primary {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .primary:active {
    transform: scale(0.97);
  }

  /* Founding and the hub's keys */
  .found {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-top: 0.6rem;
    min-height: 44px;
    padding: 0.6rem 1rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--paper);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
    cursor: pointer;
  }
  .found:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .found.ghost {
    background: transparent;
    color: var(--teal-deep);
    border: 1.5px solid var(--teal);
  }
  .key-label {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .key-add {
    margin-top: 0.6rem;
  }
  .key-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
</style>
