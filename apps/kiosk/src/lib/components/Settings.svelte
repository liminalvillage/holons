<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Caretaker settings for the kiosk: choose which holon the screen shows, set a
  // display name, logo, and accent colour. Everything is persisted (see
  // config.ts) and applied reactively — no reload needed. (Federated toggle and
  // the dashboard link live in the user menu.)
  import {
    holonId,
    holonName,
    brandName,
    brandLogo,
    accent,
    rolesEnabled,
    settingsOpen,
  } from "$lib/stores";
  import {
    setHolonId,
    setBrandName,
    setBrandLogo,
    setAccent,
    setRolesEnabled,
    setThemeMode,
    DEFAULT_ACCENT,
    type ThemeMode,
  } from "$lib/config";
  import { themeMode } from "$lib/theme";

  // Local drafts so typing/uploading doesn't re-point the screen mid-edit.
  let draftHolon = $holonId ?? "";
  let draftName = $brandName;
  let draftLogo = $brandLogo; // data URL or image URL; "" = bundled logo
  let draftAccent = $accent || DEFAULT_ACCENT;
  let draftRoles = $rolesEnabled;
  let draftTheme: ThemeMode = $themeMode;
  let logoError = "";

  const THEMES: { id: ThemeMode; label: string; glyph: string }[] = [
    { id: "auto", label: "Auto", glyph: "◑" },
    { id: "light", label: "Light", glyph: "☀" },
    { id: "dark", label: "Dark", glyph: "☾" },
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
      logoError = "Please choose an image file.";
      return;
    }
    if (file.size > 512 * 1024) {
      logoError = "Image is too large — keep it under 512 KB.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => (draftLogo = String(reader.result ?? ""));
    reader.onerror = () => (logoError = "Could not read that image.");
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
    setRolesEnabled(draftRoles);
    rolesEnabled.set(draftRoles);
    setThemeMode(draftTheme);
    themeMode.set(draftTheme);
    settingsOpen.set(false);
  }
</script>

<div class="settings">
  <div class="glyph" aria-hidden="true">⚙</div>
  <h3>Kiosk settings</h3>

  <label class="field"
    >Holon
    <input
      type="text"
      bind:value={draftHolon}
      placeholder="holon id"
      inputmode="numeric"
      on:keydown={(e) => e.key === "Enter" && apply()}
    />
  </label>

  <label class="field"
    >Display name
    <input
      type="text"
      bind:value={draftName}
      placeholder={$holonName || "shown in the header"}
      on:keydown={(e) => e.key === "Enter" && apply()}
    />
  </label>

  <div class="field">
    Logo <span class="sub">— optional; the name shows as text otherwise</span>
    <div class="logo-row">
      <div class="logo-preview" class:empty={!draftLogo}>
        {#if draftLogo}
          <img src={draftLogo} alt="Logo preview" />
        {:else}
          <span class="wm">{draftName.trim() || $holonName || "name"}</span>
        {/if}
      </div>
      <div class="logo-actions">
        <label class="upload">
          Upload…
          <input type="file" accept="image/*" on:change={onLogoFile} />
        </label>
        {#if draftLogo}
          <button type="button" class="link" on:click={clearLogo}
            >Use default</button
          >
        {/if}
      </div>
    </div>
    {#if logoError}<p class="err">{logoError}</p>{/if}
  </div>

  <div class="field">
    Accent colour
    <div class="accent-row">
      {#each SWATCHES as sw (sw)}
        <button
          type="button"
          class="swatch"
          class:sel={draftAccent.toLowerCase() === sw.toLowerCase()}
          style="background: {sw};"
          aria-label="Accent {sw}"
          on:click={() => (draftAccent = sw)}
        ></button>
      {/each}
      <label class="swatch custom" style="background: {draftAccent};">
        <input
          type="color"
          bind:value={draftAccent}
          aria-label="Custom accent"
        />
      </label>
    </div>
  </div>

  <div class="field">
    Appearance
    <span class="sub">— Auto follows local sunset</span>
    <div class="theme-row">
      {#each THEMES as t (t.id)}
        <button
          type="button"
          class="theme-opt"
          class:sel={draftTheme === t.id}
          aria-pressed={draftTheme === t.id}
          on:click={() => (draftTheme = t.id)}
        >
          <span class="theme-glyph" aria-hidden="true">{t.glyph}</span>
          {t.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="field toggle-field">
    <span class="toggle-label"
      >Roles tab
      <span class="sub">— show standing roles people can take on</span></span
    >
    <button
      type="button"
      class="switch"
      class:on={draftRoles}
      role="switch"
      aria-checked={draftRoles}
      aria-label="Show the Roles tab"
      on:click={() => (draftRoles = !draftRoles)}
    >
      <span class="knob"></span>
    </button>
  </div>

  <div class="actions">
    <button class="primary" on:click={apply}>Apply</button>
    <button class="ghost" on:click={() => settingsOpen.set(false)}
      >Cancel</button
    >
  </div>
</div>

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
