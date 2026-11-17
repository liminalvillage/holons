<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Three places, in a small dock under the thumb: the whole flow, mine, and
  // a way to find anyone. Everything else is a tap away in the flow or the
  // menu.
  import { page } from "$app/stores";
  import Icon from "./Icon.svelte";
  import { t, type MessageKey } from "$lib/i18n";
  import type { IconName } from "$lib/icons";

  const TABS: { href: string; icon: IconName; label: MessageKey }[] = [
    { href: "/", icon: "flow", label: "nav.flow" },
    { href: "/me", icon: "person", label: "nav.me" },
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
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom) + 10px);
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--card) 88%, transparent);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  }
  a {
    width: 76px;
    height: calc(var(--nav-h) - 12px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border-radius: 999px;
    text-decoration: none;
    color: var(--muted);
  }
  a.on {
    color: var(--teal-ink);
    background: var(--teal-wash);
  }
  .icon {
    font-size: 1.25rem;
    display: inline-flex;
  }
  .text {
    font-size: 0.68rem;
    font-weight: 700;
  }
</style>
