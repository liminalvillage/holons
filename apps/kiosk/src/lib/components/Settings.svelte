<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Caretaker settings for the kiosk: choose which holon the screen shows, set a
  // display name, logo, and accent colour. Everything is persisted (see
  // config.ts) and applied reactively — no reload needed. (The dashboard link
  // lives in the user menu; federated visibility is each view's Show pill.)
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
    libraryEnabled,
    rolesEnabled,
    checklistsEnabled,
    shiftsEnabled,
    statusEnabled,
    flowsEnabled,
    tasksEnabled,
    calendarEnabled,
    setTabShown,
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
  import { readSettingsHex } from "@holons/core/federation";
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
  import { getHolosphere } from "$lib/holosphere";
  import HexPicker from "./HexPicker.svelte";
  import ValueEquation from "./ValueEquation.svelte";
  import StatusConfirm from "./StatusConfirm.svelte";

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

  const THEMES = [
    { id: "auto", labelKey: "common.auto", glyph: "◑" },
    { id: "light", labelKey: "settings.light", glyph: "☀" },
    { id: "dark", labelKey: "settings.dark", glyph: "☾" },
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

  // Touching a tab switch records an explicit on/off. Until then the pref stays
  // `auto` and the switch simply mirrors the tab's content-driven visibility —
  // so a caretaker who never opens Settings keeps the automatic behaviour.
  // The tab switches all write through `setTabShown` — the same path the
  // tab strip's own "+" and ✕ use — so the two surfaces never disagree.
  function commitLibrary(on: boolean) {
    setTabShown("library", on);
  }

  function commitTasks(on: boolean) {
    setTabShown("tasks", on);
  }

  function commitCalendar(on: boolean) {
    setTabShown("calendar", on);
  }

  function commitRoles(on: boolean) {
    setTabShown("roles", on);
  }

  function commitChecklists(on: boolean) {
    setTabShown("checklists", on);
  }

  function commitShifts(on: boolean) {
    setTabShown("shifts", on);
  }

  // Turning the board ON is gated behind the framing modal (StatusConfirm):
  // a ranking changes how a group reads itself, so nobody switches one on
  // without having read what it does and doesn't mean. Off needs no ceremony.
  let statusConfirmOpen = false;

  function commitStatus(on: boolean) {
    if (on) {
      statusConfirmOpen = true;
      return;
    }
    setTabShown("status", false);
  }

  function confirmStatus() {
    statusConfirmOpen = false;
    setTabShown("status", true);
  }

  // ---- Value equation ----------------------------------------------------
  // The weights the Status board scores with are settings too, so the group
  // that reads the board can retune them here. The editor itself lives in
  // ValueEquation.svelte (the board's own footer opens the same one).
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

  function commitFlows(on: boolean) {
    setTabShown("flows", on);
  }

  /** Enter on a text field commits and dismisses the on-screen keyboard. */
  function blurOnEnter(e: KeyboardEvent) {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
  }
</script>

<div class="settings">
  <div class="glyph" aria-hidden="true">⚙</div>
  <h3>{$t("settings.title")}</h3>

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
          <span class="theme-glyph" aria-hidden="true">{th.glyph}</span>
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

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.tasksTab")}
      <span class="sub">{$t("settings.tasksTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$tasksEnabled}
      role="switch"
      aria-checked={$tasksEnabled}
      aria-label={$t("settings.tasksTabAria")}
      on:click={() => commitTasks(!$tasksEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.calendarTab")}
      <span class="sub">{$t("settings.calendarTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$calendarEnabled}
      role="switch"
      aria-checked={$calendarEnabled}
      aria-label={$t("settings.calendarTabAria")}
      on:click={() => commitCalendar(!$calendarEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.libraryTab")}
      <span class="sub">{$t("settings.libraryTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$libraryEnabled}
      role="switch"
      aria-checked={$libraryEnabled}
      aria-label={$t("settings.libraryTabAria")}
      on:click={() => commitLibrary(!$libraryEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.rolesTab")}
      <span class="sub">{$t("settings.rolesTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$rolesEnabled}
      role="switch"
      aria-checked={$rolesEnabled}
      aria-label={$t("settings.rolesTabAria")}
      on:click={() => commitRoles(!$rolesEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.listsTab")}
      <span class="sub">{$t("settings.listsTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$checklistsEnabled}
      role="switch"
      aria-checked={$checklistsEnabled}
      aria-label={$t("settings.listsTabAria")}
      on:click={() => commitChecklists(!$checklistsEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.shiftsTab")}
      <span class="sub">{$t("settings.shiftsTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$shiftsEnabled}
      role="switch"
      aria-checked={$shiftsEnabled}
      aria-label={$t("settings.shiftsTabAria")}
      on:click={() => commitShifts(!$shiftsEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.statusTab")}
      <span class="sub">{$t("settings.statusTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$statusEnabled}
      role="switch"
      aria-checked={$statusEnabled}
      aria-label={$t("settings.statusTabAria")}
      on:click={() => commitStatus(!$statusEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <!--
    With the board on, the weights it scores with are settings too: the group
    that reads the board retunes it here. (The framing lives on the board
    itself and in the modal that gates switching it on.)
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
        <span class="chev" class:open={eqOpen} aria-hidden="true">▾</span>
      </button>
      {#if eqOpen}
        <ValueEquation holon={$holonId} />
      {/if}
    </div>
  {/if}

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.flowsTab")}
      <span class="sub">{$t("settings.flowsTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={$flowsEnabled}
      role="switch"
      aria-checked={$flowsEnabled}
      aria-label={$t("settings.flowsTabAria")}
      on:click={() => commitFlows(!$flowsEnabled)}
    >
      <span class="knob"></span>
    </button>
  </div>

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

  {#if $holonId}
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
          ⬡ {$t("settings.setLocation")}
        </button>
      {/if}
    </div>
  {/if}

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

  <!-- Federation moved to the dock: close the board and drag one circle onto
       another to link, or tap an intersection to tune its lenses. -->

  <div class="actions">
    <button class="primary" on:click={() => settingsOpen.set(false)}
      >{$t("common.close")}</button
    >
  </div>
</div>

{#if statusConfirmOpen}
  <StatusConfirm
    on:close={() => (statusConfirmOpen = false)}
    on:accept={confirmStatus}
  />
{/if}

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
  .hex-note {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
    text-transform: none;
    letter-spacing: 0;
  }

  /* Value-equation editor under the Status toggle (see markup). */
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

  /* Roles-tab on/off switch */
  .toggle-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .toggle-label {
    color: var(--ink);
    font-weight: 700;
    font-size: 0.95rem;
  }
  .switch {
    flex: 0 0 auto;
    width: 3.1rem;
    height: 1.8rem;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.18s ease;
  }
  .switch.on {
    background: var(--teal);
  }
  .knob {
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-soft);
    transition: transform 0.18s ease;
  }
  .switch.on .knob {
    transform: translateX(1.3rem);
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

  /* Framing modal shown before the Status board can be switched on. */
</style>
