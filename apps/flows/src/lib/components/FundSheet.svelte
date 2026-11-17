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
  //
  // Two more doors a steward can open, each a real account they already
  // hold: a Safe on an EVM chain, and a Lightning address (core
  // `pay-in.ts`). Paying through any of them is a real transaction; nothing
  // here records an amount someone typed.
  import {
    collectiveDonateUrl,
    collectiveUrl,
    DEFAULT_SAFE_CHAIN,
    NO_PAY_IN,
    describeSafe,
    lightningUri,
    parseLightning,
    parseSafe,
    safeChains,
    type PayIn,
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
  import { linkPayIn, loadPayIn } from "$lib/payIn";

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

  // ── Safe and Lightning ──
  let payIn: PayIn = NO_PAY_IN;
  let editingSafe = false;
  let editingLn = false;
  let safeText = "";
  let safeChain = DEFAULT_SAFE_CHAIN;
  let lnText = "";
  let payErr = "";
  const CHAINS = safeChains();

  async function read(force = false) {
    loading = true;
    [fund, payIn] = isHolon
      ? await Promise.all([loadFund(node.id, force), loadPayIn(node.id)])
      : [null, NO_PAY_IN];
    loading = false;
  }

  async function saveDoor(patch: Parameters<typeof linkPayIn>[1]) {
    payErr = "";
    busy = true;
    try {
      payIn = await linkPayIn(node.id, patch);
      editingSafe = editingLn = false;
      showNotice($t("fund.linked"));
      dispatch("changed");
    } catch {
      payErr = $t("claim.failed");
    } finally {
      busy = false;
    }
  }
  function saveSafe() {
    if (!safeText.trim()) return void saveDoor({ safe: null });
    const safe = parseSafe(safeText, safeChain);
    if (!safe) return void (payErr = $t("fund.badSafe"));
    void saveDoor({ safe });
  }
  function saveLn() {
    if (!lnText.trim()) return void saveDoor({ lightning: null });
    const ln = parseLightning(lnText);
    if (!ln) return void (payErr = $t("fund.badLightning"));
    void saveDoor({ lightning: ln });
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
  title={$t("fund.payTitle", { name: node.label })}
  on:close={() => dispatch("close")}
>
  <!-- The on-chain Pot contract, where there is one, or the Pot that funds this. -->
  {#if pot || (root && root.id !== node.id)}
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
      {/if}
    </section>
  {/if}

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
            <!-- "Remove the link" only when there is a link to remove. -->
            <button
              class="btn grow"
              type="submit"
              disabled={busy || (!slug.trim() && !fund?.slug)}
              >{busy
                ? $t("fund.checking")
                : slug.trim() || !fund?.slug
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

  {#if isHolon}
    <section class="door">
      <h3><Icon name="wallet" />{$t("fund.safeTitle")}</h3>
      {#if payIn.safe && !editingSafe}
        {@const d = describeSafe(payIn.safe)}
        <p class="muted">{$t("fund.safeBody", { chain: d.chain })}</p>
        <div class="address">
          <code>{payIn.safe.address}</code>
          <button
            class="btn quiet small"
            on:click={() => copy(payIn.safe?.address ?? "")}
            ><Icon name="copy" />{$t("share.copy")}</button
          >
        </div>
        {#if d.app}
          <a class="link" href={d.app} target="_blank" rel="noopener noreferrer"
            >{$t("fund.openSafe", { chain: d.chain })}<Icon
              name="external"
            /></a
          >
        {/if}
        {#if steer}
          <button
            class="link"
            on:click={() => {
              editingSafe = true;
              safeText = payIn.safe?.address ?? "";
              safeChain = payIn.safe?.chainId ?? DEFAULT_SAFE_CHAIN;
            }}>{$t("fund.changeDoor")}</button
          >
        {/if}
      {:else if steer && (editingSafe || !payIn.safe)}
        <p class="muted">{$t("fund.safeLink")}</p>
        <form on:submit|preventDefault={saveSafe}>
          <label class="sr-only" for="safe-address"
            >{$t("fund.safeTitle")}</label
          >
          <input
            id="safe-address"
            bind:value={safeText}
            placeholder="gno:0x… or 0x…"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <label class="chain">
            <span>{$t("fund.chain")}</span>
            <select bind:value={safeChain}>
              {#each CHAINS as c (c.chainId)}
                <option value={c.chainId}>{c.name}</option>
              {/each}
            </select>
          </label>
          <button class="btn grow" type="submit" disabled={busy}
            >{safeText.trim() || !payIn.safe
              ? $t("fund.link")
              : $t("fund.unlink")}</button
          >
        </form>
      {:else}
        <p class="muted">{$t("fund.noSafe")}</p>
      {/if}
    </section>

    <section class="door">
      <h3><Icon name="flow" />{$t("fund.lnTitle")}</h3>
      {#if payIn.lightning && !editingLn}
        <p class="muted">{$t("fund.lnBody")}</p>
        <div class="address">
          <code>{payIn.lightning}</code>
          <button
            class="btn quiet small"
            on:click={() => copy(payIn.lightning ?? "")}
            ><Icon name="copy" />{$t("share.copy")}</button
          >
        </div>
        <a class="btn wide" href={lightningUri(payIn.lightning)}
          >{$t("fund.lnPay")}</a
        >
        {#if steer}
          <button
            class="link"
            on:click={() => {
              editingLn = true;
              lnText = payIn.lightning ?? "";
            }}>{$t("fund.changeDoor")}</button
          >
        {/if}
      {:else if steer && (editingLn || !payIn.lightning)}
        <p class="muted">{$t("fund.lnLink")}</p>
        <form on:submit|preventDefault={saveLn}>
          <label class="sr-only" for="ln-address">{$t("fund.lnTitle")}</label>
          <input
            id="ln-address"
            bind:value={lnText}
            placeholder="name@getalby.com"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
          <button class="btn grow" type="submit" disabled={busy}
            >{lnText.trim() || !payIn.lightning
              ? $t("fund.link")
              : $t("fund.unlink")}</button
          >
        </form>
      {:else}
        <p class="muted">{$t("fund.noLightning")}</p>
      {/if}
      {#if payErr}<p class="notice warn" role="alert">{payErr}</p>{/if}
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
  .chain {
    display: grid;
    gap: 4px;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .chain select {
    min-height: var(--tap);
    padding: 0 10px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
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
