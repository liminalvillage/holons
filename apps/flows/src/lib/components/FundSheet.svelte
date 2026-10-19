<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Paying INTO an account. Every party here is a fund, and money reaches a
  // fund by two doors: its Pot, on chain — send to the address, the split
  // does the rest at the next new moon — or its OpenCollective, for anyone
  // with a card or a bank account. A party with neither of its own is still
  // funded: through the Pot that seats it, which is where this points.
  //
  // A steward links the collective here. The slug is checked against
  // OpenCollective before it is saved, so a typo cannot quietly point an
  // account's balance at someone else's collective.
  import {
    collectiveDonateUrl,
    collectiveUrl,
    explorerAddressUrl,
    isValidCollectiveSlug,
    normalizeCollectiveSlug,
    type FlowGraphNode,
  } from "@holons/core/flows";
  import { createEventDispatcher, onMount } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import {
    fetchCollective,
    linkCollective,
    loadFund,
    type HolonFund,
  } from "$lib/account";
  import { amount, shortAddress } from "$lib/format";
  import { index, potId } from "$lib/graph";
  import { locale, t } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { showNotice } from "$lib/notice";
  import { hrefFor } from "$lib/urls";

  export let node: FlowGraphNode;
  /** The signed-in person stewards this account. */
  export let steer = false;

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  let fund: HolonFund | null = null;
  let loading = true;
  let editing = false;
  let slug = "";
  let busy = false;
  let error = "";

  // Its own Pot: the root's is read live, any other is on the map.
  $: pot =
    node.id === potId && $potLive.record
      ? { chainId: $potLive.record.chainId, address: $potLive.record.address }
      : (node.pot ?? null);
  $: root = $index?.byId.get(potId) ?? null;
  $: isHolon = node.kind !== "person" && node.kind !== "placeholder";

  async function read(force = false) {
    loading = true;
    fund = isHolon ? await loadFund(node.id, force) : null;
    loading = false;
  }
  onMount(() => void read());

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice($t("share.copied"));
    } catch {
      showNotice($t("share.failed"));
    }
  }

  async function save() {
    const clean = normalizeCollectiveSlug(slug);
    error = "";
    if (clean && !isValidCollectiveSlug(clean)) {
      error = $t("fund.badSlug");
      return;
    }
    busy = true;
    try {
      // A collective that cannot be read is not linked: the balance would be wrong.
      if (clean && !(await fetchCollective(clean, true))) {
        error = $t("fund.noSuchCollective", { slug: clean });
        return;
      }
      await linkCollective(node.id, clean);
      editing = false;
      showNotice(clean ? $t("fund.linked") : $t("fund.unlinked"));
      await read(true);
      dispatch("changed");
    } catch {
      error = $t("claim.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={$t("fund.title", { name: node.label })}
  on:close={() => dispatch("close")}
>
  <section class="door">
    <h3><Icon name="wallet" />{$t("fund.potTitle")}</h3>
    {#if pot}
      {@const url = explorerAddressUrl(pot.chainId, pot.address)}
      <p class="muted">{$t("fund.potBody")}</p>
      <div class="address">
        <code>{pot.address}</code>
        <button class="btn quiet small" on:click={() => copy(pot!.address)}
          ><Icon name="copy" />{$t("share.copy")}</button
        >
      </div>
      {#if url}
        <a class="link" href={url} target="_blank" rel="noopener noreferrer"
          >{shortAddress(pot.address)}<Icon name="external" /></a
        >
      {/if}
    {:else if root && root.id !== node.id}
      <p class="muted">
        {$t("fund.noPot", { pot: root.label })}
      </p>
      <a class="link" href={hrefFor(root)}
        >{$t("fund.openPot", { pot: root.label })}<Icon
          name="chevron-right"
        /></a
      >
    {:else}
      <p class="muted">{$t("wallet.noPot")}</p>
    {/if}
  </section>

  {#if isHolon}
    <section class="door">
      <h3><Icon name="people" />{$t("fund.collectiveTitle")}</h3>
      {#if loading}
        <p class="muted">{$t("fund.reading")}</p>
      {:else if fund?.slug && !editing}
        {#if fund.collective}
          <p class="figure">
            {amount(fund.collective.balance, fund.collective.currency, $locale)}
          </p>
          <p class="muted">
            {$t("fund.collectiveBalance", { name: fund.collective.name })}
          </p>
        {:else}
          <p class="notice warn">
            {$t("fund.collectiveUnread", { slug: fund.slug })}
          </p>
        {/if}
        <a
          class="btn wide"
          href={collectiveDonateUrl(fund.slug)}
          target="_blank"
          rel="noopener noreferrer"
          >{$t("fund.contribute")}<Icon name="external" /></a
        >
        <a
          class="link"
          href={collectiveUrl(fund.slug)}
          target="_blank"
          rel="noopener noreferrer"
          >opencollective.com/{fund.slug}<Icon name="external" /></a
        >
        {#if steer}
          <button
            class="link"
            on:click={() => {
              editing = true;
              slug = fund?.slug ?? "";
            }}>{$t("fund.changeCollective")}</button
          >
        {/if}
      {:else if steer}
        <p class="muted">{$t("fund.linkBody")}</p>
        <form on:submit|preventDefault={save}>
          <label class="sr-only" for="collective-slug"
            >{$t("fund.slugField")}</label
          >
          <input
            id="collective-slug"
            bind:value={slug}
            placeholder="opencollective.com/your-collective"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
          <div class="row">
            {#if editing}
              <button
                class="btn quiet"
                type="button"
                on:click={() => (editing = false)}
                disabled={busy}>{$t("nav.back")}</button
              >
            {/if}
            <button class="btn grow" type="submit" disabled={busy}
              >{busy
                ? $t("fund.checking")
                : slug.trim()
                  ? $t("fund.link")
                  : $t("fund.unlink")}</button
            >
          </div>
        </form>
      {:else}
        <p class="muted">{$t("fund.noCollective")}</p>
      {/if}
    </section>
  {/if}
</BottomSheet>

<style>
  .door {
    display: grid;
    gap: 8px;
    padding: 4px 0 14px;
  }
  .door + .door {
    border-top: 1px solid var(--line);
    padding-top: 16px;
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1rem;
  }
  .figure {
    font-size: 1.6rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .address {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border: 1.5px dashed var(--line);
    border-radius: 12px;
  }
  .address code {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.82rem;
    overflow-wrap: anywhere;
  }
  .small {
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.86rem;
    flex: 0 0 auto;
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-self: start;
    min-height: 40px;
    padding: 0;
    font: inherit;
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--teal-ink);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .wide {
    width: 100%;
  }
  input {
    width: 100%;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .grow {
    flex: 1 1 auto;
  }
</style>
