<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The wallet side of a seat: where the party is paid, and what its seat has
  // brought — collected, to collect, accruing — in each unit the Pot holds.
  //
  // Two things can be done from here, the two the kiosk's Pot panel offers a
  // person: say where to be paid, and collect. Both need a wallet in the
  // browser; a phone's ordinary browser has none, so the buttons stay and
  // say how (open this page inside the wallet's own browser) rather than
  // disappearing. An address can also be pasted: it is only where the Pot
  // sends, and takes effect at the next new moon's table.
  import { explorerAddressUrl } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import { ChainError, connectedWallet } from "$lib/chain";
  import { amount, shortAddress } from "$lib/format";
  import { locale, t } from "$lib/i18n";
  import { collect, potLive, readAccounts, type PartyAccount } from "$lib/live";
  import { isWalletAvailable } from "$lib/login/ethereum";
  import { loadPayout, savePayout } from "$lib/me";
  import { showNotice } from "$lib/notice";

  export let party: string;
  /** What rests with the party, as a percent of the Pot. */
  export let rest: number;
  /** The signed-in person is this party: they may set its payout address. */
  export let editable = false;
  /** Show what the seat has brought per unit. Off where a balance card already does. */
  export let figures = true;

  const dispatch = createEventDispatcher<{ saved: string }>();

  let payout: string | null = null;
  let accounts: PartyAccount[] = [];
  let loadedFor = "";
  let busy = "";
  let error = "";
  let sheet: "none" | "wallet" | "payout" = "none";
  let pasted = "";

  $: chainId = $potLive.record?.chainId ?? null;
  $: online = typeof navigator === "undefined" || navigator.onLine !== false;

  async function load() {
    payout = await loadPayout(party, chainId);
    accounts = figures ? await readAccounts(party, rest) : [];
  }
  $: {
    const key = `${party}:${$potLive.status}:${chainId ?? ""}`;
    if ($potLive.status === "ready" && key !== loadedFor) {
      loadedFor = key;
      void load();
    }
  }

  const fail = (err: unknown) => {
    if (err instanceof ChainError && err.kind === "no-wallet") {
      sheet = "wallet";
      return;
    }
    const message = (err as Error)?.message ?? "";
    error =
      message === "no-row"
        ? $t("wallet.noRow")
        : message === "no-table"
          ? $t("wallet.noTable")
          : message || $t("wallet.failed");
  };

  async function useWallet() {
    if (!isWalletAvailable()) {
      sheet = "payout";
      return;
    }
    busy = "payout";
    error = "";
    try {
      const address = await connectedWallet();
      await savePayout(party, address);
      payout = address.toLowerCase();
      dispatch("saved", payout);
      showNotice($t("wallet.saved"));
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function usePasted() {
    busy = "payout";
    error = "";
    try {
      await savePayout(party, pasted.trim());
      payout = pasted.trim().toLowerCase();
      dispatch("saved", payout);
      pasted = "";
      sheet = "none";
      showNotice($t("wallet.saved"));
    } catch {
      error = $t("wallet.badAddress");
    } finally {
      busy = "";
    }
  }

  async function collectRow(row: PartyAccount) {
    if (!isWalletAvailable()) {
      sheet = "wallet";
      return;
    }
    busy = `collect:${row.token}`;
    error = "";
    try {
      await collect(row.party, row.token);
      accounts = await readAccounts(party, rest);
      showNotice($t("wallet.collected"));
    } catch (err) {
      fail(err);
    } finally {
      busy = "";
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      showNotice($t("share.copied"));
    } catch {
      showNotice($t("share.failed"));
    }
  }
</script>

<section class="card wallet">
  <div class="row">
    <span class="icon"><Icon name="wallet" /></span>
    <div class="who">
      <span class="label">{$t("wallet.paidAt")}</span>
      {#if payout}
        {@const url =
          chainId != null ? explorerAddressUrl(chainId, payout) : null}
        {#if url}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            class="address">{shortAddress(payout)}<Icon name="external" /></a
          >
        {:else}
          <span class="address">{shortAddress(payout)}</span>
        {/if}
      {:else}
        <span class="address none">{$t("wallet.noAddress")}</span>
      {/if}
    </div>
    {#if editable}
      <button
        class="btn quiet small"
        on:click={useWallet}
        disabled={!!busy || !online}
      >
        {payout ? $t("wallet.change") : $t("wallet.set")}
      </button>
    {/if}
  </div>
  {#if editable && !payout}
    <p class="muted hint">{$t("wallet.setHint")}</p>
  {/if}

  {#each accounts as row (row.token)}
    <div class="unit">
      <div class="figures">
        <div class="main">
          <span class="label">{$t("wallet.collectable")}</span>
          <b>{amount(row.account.collectable, row.unit, $locale)}</b>
        </div>
        <dl>
          <div>
            <dt>{$t("wallet.accruing")}</dt>
            <dd>{amount(row.account.accruing, row.unit, $locale)}</dd>
          </div>
          <div>
            <dt>{$t("wallet.collectedSoFar")}</dt>
            <dd>{amount(row.account.collected, row.unit, $locale)}</dd>
          </div>
        </dl>
      </div>
      {#if row.canCollect}
        <button
          class="btn"
          on:click={() => collectRow(row)}
          disabled={!!busy || !online}
        >
          {busy === `collect:${row.token}`
            ? $t("wallet.collecting")
            : $t("wallet.collect")}
        </button>
      {/if}
    </div>
  {/each}

  {#if !figures}
    <!-- the balance cards above carry the figures -->
  {:else if $potLive.status === "ready" && !$potLive.record}
    <p class="muted hint">{$t("wallet.noPot")}</p>
  {:else if $potLive.status === "ready" && !accounts.length}
    <p class="muted hint">{$t("wallet.nothingYet")}</p>
  {/if}
  {#if !online}
    <p class="notice warn">{$t("wallet.offline")}</p>
  {/if}
  {#if error}
    <p class="notice warn" role="alert">{error}</p>
  {/if}
</section>

{#if sheet === "wallet"}
  <BottomSheet
    title={$t("wallet.needWalletTitle")}
    on:close={() => (sheet = "none")}
  >
    <p>{$t("wallet.needWalletBody")}</p>
    <div class="sheet-actions">
      <button class="btn" on:click={copyLink}
        ><Icon name="copy" />{$t("share.copy")}</button
      >
    </div>
  </BottomSheet>
{:else if sheet === "payout"}
  <BottomSheet
    title={$t("wallet.pasteTitle")}
    on:close={() => (sheet = "none")}
  >
    <p>{$t("wallet.pasteBody")}</p>
    <form on:submit|preventDefault={usePasted}>
      <label class="sr-only" for="payout-address"
        >{$t("wallet.pasteField")}</label
      >
      <input
        id="payout-address"
        bind:value={pasted}
        placeholder="0x…"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        inputmode="text"
      />
      {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
      <div class="sheet-actions">
        <button class="btn" type="submit" disabled={!pasted.trim() || !!busy}
          >{$t("wallet.save")}</button
        >
      </div>
    </form>
  </BottomSheet>
{/if}

<style>
  .wallet {
    display: grid;
    gap: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .icon {
    font-size: 1.4rem;
    color: var(--teal-ink);
    display: inline-flex;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }
  .label,
  dt {
    font-size: 0.76rem;
    color: var(--muted);
  }
  .address {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    color: var(--ink);
  }
  .address.none {
    font-weight: 600;
    color: var(--ink-soft);
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.88rem;
    flex: 0 0 auto;
  }
  .hint {
    font-size: 0.88rem;
  }
  .unit {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding-top: 12px;
  }
  .figures {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .main b {
    display: block;
    font-size: 1.5rem;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 6px 0 0;
  }
  dd {
    margin: 0;
    font-weight: 600;
    font-size: 0.92rem;
    font-variant-numeric: tabular-nums;
  }
  .unit .btn {
    flex: 0 0 auto;
  }
  input {
    width: 100%;
    min-height: var(--tap);
    margin-top: 12px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .sheet-actions {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }
  .sheet-actions .btn {
    flex: 1 1 auto;
  }
</style>
