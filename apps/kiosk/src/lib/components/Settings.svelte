<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Caretaker settings for the kiosk: choose which holon the screen shows, set a
  // display name, logo, and accent colour. Everything is persisted (see
  // config.ts) and applied reactively — no reload needed. (The dashboard link
  // lives in the user menu; federated visibility is each view's Show pill.)
  import {
    holonId,
    holonName,
    brandName,
    brandLogo,
    accent,
    libraryEnabled,
    rolesEnabled,
    checklistsEnabled,
    libraryPref,
    rolesPref,
    checklistsPref,
    statusEnabled,
    settingsOpen,
  } from "$lib/stores";
  import {
    setHolonId,
    setBrandName,
    setBrandLogo,
    setAccent,
    setLibraryPref,
    setRolesPref,
    setChecklistsPref,
    setStatusEnabled,
    setThemeMode,
    setLangMode,
    resolveVoiceKey,
    setVoiceKey,
    DEFAULT_ACCENT,
    type ThemeMode,
    type LangMode,
  } from "$lib/config";
  import { refreshVoice } from "$lib/voice/controller";
  import { themeMode } from "$lib/theme";
  import { langMode, t } from "$lib/i18n";
  import { readSettingsHex } from "@holons/core/federation";
  import { getHolosphere } from "$lib/holosphere";
  import FederationSettings from "./FederationSettings.svelte";
  import HexPicker from "./HexPicker.svelte";

  // Local drafts so typing/uploading doesn't re-point the screen mid-edit.
  let draftHolon = $holonId ?? "";
  let draftName = $brandName;
  let draftLogo = $brandLogo; // data URL or image URL; "" = bundled logo
  let draftAccent = $accent || DEFAULT_ACCENT;
  // The Library/Roles switches show the tab's *effective* visibility (an
  // untouched device is in content-driven `auto` mode). Flipping one records an
  // explicit on/off; leaving it alone preserves auto — so applying an unrelated
  // setting never freezes a content-driven tab into a manual choice.
  let draftLibrary = $libraryEnabled;
  let draftRoles = $rolesEnabled;
  let draftChecklists = $checklistsEnabled;
  const initialLibrary = $libraryEnabled;
  const initialRoles = $rolesEnabled;
  const initialChecklists = $checklistsEnabled;
  let draftStatus = $statusEnabled;
  let draftTheme: ThemeMode = $themeMode;
  let draftLang: LangMode = $langMode;
  let draftVoiceKey = resolveVoiceKey() ?? "";
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
    reader.onload = () => (draftLogo = String(reader.result ?? ""));
    reader.onerror = () => (logoError = $t("settings.imageReadError"));
    reader.readAsDataURL(file);
  }

  function clearLogo() {
    draftLogo = "";
    logoError = "";
  }

  function apply() {
    const id = draftHolon.trim();
    if (id) {
      setHolonId(id);
      holonId.set(id);
    }
    setBrandName(draftName);
    brandName.set(draftName.trim());
    setBrandLogo(draftLogo || null);
    brandLogo.set(draftLogo);
    setAccent(draftAccent);
    accent.set(draftAccent);
    if (draftLibrary !== initialLibrary) {
      setLibraryPref(draftLibrary ? "on" : "off");
      libraryPref.set(draftLibrary ? "on" : "off");
    }
    if (draftRoles !== initialRoles) {
      setRolesPref(draftRoles ? "on" : "off");
      rolesPref.set(draftRoles ? "on" : "off");
    }
    if (draftChecklists !== initialChecklists) {
      setChecklistsPref(draftChecklists ? "on" : "off");
      checklistsPref.set(draftChecklists ? "on" : "off");
    }
    setStatusEnabled(draftStatus);
    statusEnabled.set(draftStatus);
    setThemeMode(draftTheme);
    themeMode.set(draftTheme);
    setLangMode(draftLang);
    langMode.set(draftLang);
    setVoiceKey(draftVoiceKey);
    refreshVoice();
    settingsOpen.set(false);
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
      on:keydown={(e) => e.key === "Enter" && apply()}
    />
  </label>

  <label class="field"
    >{$t("settings.displayName")}
    <input
      type="text"
      bind:value={draftName}
      placeholder={$holonName || $t("settings.displayNamePlaceholder")}
      on:keydown={(e) => e.key === "Enter" && apply()}
    />
  </label>

  <div class="field">
    {$t("settings.logo")} <span class="sub">{$t("settings.logoSub")}</span>
    <div class="logo-row">
      <div class="logo-preview" class:empty={!draftLogo}>
        {#if draftLogo}
          <img src={draftLogo} alt={$t("settings.logoPreview")} />
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
        {#if draftLogo}
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
          on:click={() => (draftAccent = sw)}
        ></button>
      {/each}
      <label class="swatch custom" style="background: {draftAccent};">
        <input
          type="color"
          bind:value={draftAccent}
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
          class:sel={draftTheme === th.id}
          aria-pressed={draftTheme === th.id}
          on:click={() => (draftTheme = th.id)}
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
          class:sel={draftLang === l.id}
          aria-pressed={draftLang === l.id}
          on:click={() => (draftLang = l.id)}
        >
          {l.label ?? $t("common.auto")}
        </button>
      {/each}
    </div>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >{$t("settings.libraryTab")}
      <span class="sub">{$t("settings.libraryTabSub")}</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={draftLibrary}
      role="switch"
      aria-checked={draftLibrary}
      aria-label={$t("settings.libraryTabAria")}
      on:click={() => (draftLibrary = !draftLibrary)}
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
      class:on={draftRoles}
      role="switch"
      aria-checked={draftRoles}
      aria-label={$t("settings.rolesTabAria")}
      on:click={() => (draftRoles = !draftRoles)}
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
      class:on={draftChecklists}
      role="switch"
      aria-checked={draftChecklists}
      aria-label={$t("settings.listsTabAria")}
      on:click={() => (draftChecklists = !draftChecklists)}
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
      class:on={draftStatus}
      role="switch"
      aria-checked={draftStatus}
      aria-label={$t("settings.statusTabAria")}
      on:click={() => (draftStatus = !draftStatus)}
    >
      <span class="knob"></span>
    </button>
  </div>

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

  {#if $holonId}
    <div class="field">
      {$t("settings.federation")}
      <span class="sub">{$t("settings.federationSub")}</span>
      <FederationSettings />
    </div>
  {/if}

  <label class="field"
    >{$t("settings.voice")}
    <span class="sub">{$t("settings.voiceSub")}</span>
    <input
      type="password"
      bind:value={draftVoiceKey}
      placeholder="sk-…"
      autocomplete="off"
      on:keydown={(e) => e.key === "Enter" && apply()}
    />
  </label>

  <div class="actions">
    <button class="primary" on:click={apply}>{$t("common.apply")}</button>
    <button class="ghost" on:click={() => settingsOpen.set(false)}
      >{$t("common.cancel")}</button
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
  .primary,
  .ghost {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }
  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }
</style>
