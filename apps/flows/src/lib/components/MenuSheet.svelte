<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The device's own choices — language, day or night, adding the app to the
  // home screen — and who is signed in. Nothing here changes the map.
  import { createEventDispatcher, onMount } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import { currentUser, displayName, logout } from "$lib/auth";
  import type { LangMode, ThemeMode } from "$lib/config";
  import { setLangMode } from "$lib/config";
  import { langMode, t, type MessageKey } from "$lib/i18n";
  import { themeMode } from "$lib/theme";

  const dispatch = createEventDispatcher<{ close: void }>();

  const LANG: { mode: LangMode; label: string | null }[] = [
    { mode: "auto", label: null },
    { mode: "en", label: "English" },
    { mode: "it", label: "Italiano" },
    { mode: "es", label: "Español" },
  ];
  const THEME: { mode: ThemeMode; label: MessageKey }[] = [
    { mode: "auto", label: "menu.themeAuto" },
    { mode: "light", label: "menu.themeLight" },
    { mode: "dark", label: "menu.themeDark" },
  ];

  /** Chromium hands the install prompt over once; app.html keeps it. */
  let installable = false;
  onMount(() => {
    installable = !!window.__installPrompt;
  });
  async function install() {
    const prompt = window.__installPrompt as any;
    if (!prompt?.prompt) return;
    await prompt.prompt();
    window.__installPrompt = null;
    installable = false;
  }

  function pickLang(mode: LangMode) {
    setLangMode(mode);
    langMode.set(mode);
  }
</script>

<BottomSheet title={$t("menu.title")} on:close={() => dispatch("close")}>
  <h3 class="section-title first">{$t("menu.language")}</h3>
  <div class="options" role="group" aria-label={$t("menu.language")}>
    {#each LANG as l (l.mode)}
      <button
        class:on={$langMode === l.mode}
        aria-pressed={$langMode === l.mode}
        on:click={() => pickLang(l.mode)}>{l.label ?? $t("menu.auto")}</button
      >
    {/each}
  </div>

  <h3 class="section-title">{$t("menu.theme")}</h3>
  <div class="options" role="group" aria-label={$t("menu.theme")}>
    {#each THEME as th (th.mode)}
      <button
        class:on={$themeMode === th.mode}
        aria-pressed={$themeMode === th.mode}
        on:click={() => themeMode.set(th.mode)}>{$t(th.label)}</button
      >
    {/each}
  </div>

  {#if installable}
    <h3 class="section-title">{$t("menu.install")}</h3>
    <button class="btn quiet wide" on:click={install}
      >{$t("menu.installAction")}</button
    >
  {/if}

  <h3 class="section-title">{$t("menu.account")}</h3>
  {#if $currentUser}
    <p class="who">
      {$t("login.signedInAs", { name: displayName($currentUser) })}
    </p>
    <button
      class="btn quiet wide"
      on:click={async () => {
        await logout();
        dispatch("close");
      }}>{$t("menu.logout")}</button
    >
  {:else}
    <a class="btn wide" href="/" on:click={() => dispatch("close")}
      >{$t("menu.signIn")}</a
    >
  {/if}
</BottomSheet>

<style>
  .first {
    margin-top: 6px;
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .options button {
    min-height: 44px;
    padding: 0 16px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    font-weight: 700;
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  .options button.on {
    background: var(--teal);
    border-color: var(--teal);
    color: var(--on-teal);
  }
  .wide {
    width: 100%;
  }
  .who {
    margin-bottom: 10px;
  }
</style>
