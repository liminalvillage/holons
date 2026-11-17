<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // How a steward brings others in: one link to send. The Pot's link opens
  // the map on it, where whoever follows it can start their own fund or
  // project and apply. Any other holon's link opens it inside this Pot, for
  // the admins of a fund that should seat it: they paste it into their split.
  import Icon from "./Icon.svelte";
  import { potId } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  export let holon: string;
  export let name: string;
  /** This holon is the Pot the map opens on. */
  export let isPot = false;

  $: origin = typeof location === "undefined" ? "" : location.origin;
  $: href = isPot
    ? `${origin}/?pot=${encodeURIComponent(holon)}`
    : `${origin}/h/${encodeURIComponent(holon)}${
        potId ? `?pot=${encodeURIComponent(potId)}` : ""
      }`;
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  async function copy() {
    try {
      await navigator.clipboard.writeText(href);
      showNotice($t("invite.copied"));
    } catch {
      showNotice($t("invite.copyFailed"));
    }
  }
  async function share() {
    try {
      await navigator.share({ title: name, url: href });
    } catch {
      /* dismissed */
    }
  }
</script>

<h2 class="section-title">{$t("invite.title")}</h2>
<section class="card invite">
  <p>
    {isPot ? $t("invite.potLead") : $t("invite.holonLead", { name })}
  </p>
  <code>{href}</code>
  <div class="acts">
    <button class="btn small" on:click={copy}
      ><Icon name="copy" />{$t("invite.copy")}</button
    >
    {#if canShare}
      <button class="btn quiet small" on:click={share}
        ><Icon name="share" />{$t("invite.share")}</button
      >
    {/if}
  </div>
</section>

<style>
  .invite {
    display: grid;
    gap: 10px;
  }
  p {
    margin: 0;
    font-size: 0.92rem;
    color: var(--ink-soft);
  }
  code {
    display: block;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--paper-deep);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
    user-select: all;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.86rem;
  }
</style>
