<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The places the app has: mine, everyone's, who is most resourced, and a
  // way to find one.
  import { page } from "$app/stores";
  import Icon from "./Icon.svelte";
  import { t, type MessageKey } from "$lib/i18n";
  import type { IconName } from "$lib/icons";

  const TABS: { href: string; icon: IconName; label: MessageKey }[] = [
    { href: "/", icon: "person", label: "nav.me" },
    { href: "/eco", icon: "globe", label: "nav.eco" },
    { href: "/rise", icon: "rise", label: "nav.rise" },
    { href: "/search", icon: "search", label: "nav.search" },
  ];
  $: path = $page.url.pathname;
  const isOn = (href: string, at: string) =>
    href === "/" ? at === "/" : at === href || at.startsWith(`${href}/`);
</script>

<nav aria-label={$t("nav.label")}>
  {#each TABS as tab (tab.href)}
    <a
      href={tab.href}
      class:on={isOn(tab.href, path)}
      aria-current={isOn(tab.href, path) ? "page" : undefined}
    >
      <span class="icon"><Icon name={tab.icon} /></span>
      <span class="text">{$t(tab.label)}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: flex;
    justify-content: center;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid var(--line);
    padding: 0 max(6px, env(safe-area-inset-right)) env(safe-area-inset-bottom)
      max(6px, env(safe-area-inset-left));
  }
  a {
    flex: 1 1 0;
    max-width: 180px;
    height: var(--nav-h);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    text-decoration: none;
    color: var(--muted);
  }
  a.on {
    color: var(--teal-ink);
  }
  .icon {
    font-size: 1.35rem;
    display: inline-flex;
  }
  .text {
    font-size: 0.72rem;
    font-weight: 700;
  }
</style>
