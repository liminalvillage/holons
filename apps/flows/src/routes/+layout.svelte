<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The shell: a bar on top (back, where you are, share, the menu), the page,
  // and the tabs under the thumb. It also starts what every page needs
  // and none owns — the snapshot, the Pot's live counters, who is signed in,
  // the language and the palette.
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import BottomNav from "$lib/components/BottomNav.svelte";
  import FlowsLogo from "$lib/components/FlowsLogo.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MenuSheet from "$lib/components/MenuSheet.svelte";
  import { initAuth } from "$lib/auth";
  import { loadSnapshot } from "$lib/graph";
  import { startI18n, t } from "$lib/i18n";
  import { loadPotLive } from "$lib/live";
  import { notice, shareLink, showNotice } from "$lib/notice";
  import { startTheme } from "$lib/theme";

  let menu = false;

  onMount(() => {
    const stopI18n = startI18n();
    const stopTheme = startTheme();
    void loadSnapshot();
    void loadPotLive();
    void initAuth();
    // Back on the network: whatever was missing may be there now.
    const online = () => {
      void loadSnapshot(true);
      void loadPotLive(true);
    };
    addEventListener("online", online);
    return () => {
      stopI18n();
      stopTheme();
      removeEventListener("online", online);
    };
  });

  const TABS = new Set(["/", "/eco", "/rise", "/search"]);
  $: deep = !TABS.has($page.url.pathname);

  function back() {
    if (history.length > 1) history.back();
    else location.assign("/");
  }

  async function share() {
    const out = await shareLink(location.href, document.title);
    if (out === "copied") showNotice($t("share.copied"));
    else if (out === "failed") showNotice($t("share.failed"));
  }
</script>

<a class="skip" href="#main">{$t("nav.skip")}</a>

<header class="bar">
  {#if deep}
    <button class="tool" on:click={back} aria-label={$t("nav.back")}
      ><Icon name="arrow-left" /></button
    >
  {/if}
  <a class="brand" class:home={!deep} href="/"><FlowsLogo /><b>Flows</b></a>
  <button class="tool" on:click={share} aria-label={$t("share.action")}
    ><Icon name="share" /></button
  >
  <button
    class="tool"
    on:click={() => (menu = true)}
    aria-label={$t("menu.title")}
    aria-haspopup="dialog"><Icon name="person" /></button
  >
</header>

<main id="main" tabindex="-1">
  <slot />
</main>

<BottomNav />

{#if menu}
  <MenuSheet on:close={() => (menu = false)} />
{/if}

<div class="toast" role="status" aria-live="polite">
  {#if $notice}<span>{$notice}</span>{/if}
</div>

<style>
  .skip {
    position: absolute;
    left: -999px;
    top: 0;
    z-index: 100;
    background: var(--card);
    padding: 12px 16px;
    border-radius: 0 0 12px 0;
    font-weight: 700;
  }
  .skip:focus {
    left: 0;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 56px;
    padding: env(safe-area-inset-top) max(6px, env(safe-area-inset-right)) 0
      max(6px, env(safe-area-inset-left));
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .tool {
    width: var(--tap);
    height: var(--tap);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    color: var(--ink-soft);
    border-radius: 999px;
    flex: 0 0 auto;
  }
  .brand {
    flex: 1 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .brand.home {
    padding-left: 10px;
  }
  .brand :global(.logo) {
    font-size: 1.75rem;
  }
  .brand b {
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  main {
    width: min(46rem, 100%);
    margin: 0 auto;
    padding: 16px max(var(--gutter), env(safe-area-inset-right))
      calc(var(--nav-h) + env(safe-area-inset-bottom) + 28px)
      max(var(--gutter), env(safe-area-inset-left));
    outline: none;
  }
  .toast {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(var(--nav-h) + env(safe-area-inset-bottom) + 12px);
    z-index: 60;
    display: flex;
    justify-content: center;
    pointer-events: none;
    padding: 0 var(--gutter);
  }
  .toast span {
    background: var(--ink);
    color: var(--paper);
    padding: 10px 16px;
    border-radius: 999px;
    font-size: 0.92rem;
    font-weight: 600;
    box-shadow: var(--shadow-soft);
  }
</style>
