<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Taking money out. Three questions, one at a time: from where (when the
  // account has more than one place with something in it), by which way,
  // and how much.
  //
  // The ways are core's (`claimRails`), and so are the reasons one is shut.
  // A seat in the Pot is collected on chain, to the wallet the table
  // committed — the party sends that itself. Everything else is a REQUEST:
  // a signed claim on the fund's own log that its stewards pay and mark
  // paid. PayPal and bank transfers leave through the fund's OpenCollective,
  // which is where the payee's details are entered and kept: this app asks
  // for none and stores none.
  import {
    claimRails,
    collectiveExpenseUrl,
    type AccountLine,
    type ClaimRail,
    type RailOption,
    type RailReason,
  } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import { requestClaim, type Statement } from "$lib/account";
  import { ChainError } from "$lib/chain";
  import { amount as money, shortAddress } from "$lib/format";
  import { labelOf } from "$lib/graph";
  import { locale, t, type MessageKey } from "$lib/i18n";
  import type { IconName } from "$lib/icons";
  import { collect } from "$lib/live";
  import { isWalletAvailable } from "$lib/login/ethereum";
  import { showNotice } from "$lib/notice";

  export let party: string;
  export let statement: Statement;
  /** The signed-in person is this party: they may ask to be paid. */
  export let own = false;
  export let payout: string | null = null;

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  const RAILS: Record<
    ClaimRail,
    { icon: IconName; label: MessageKey; hint: MessageKey }
  > = {
    wallet: { icon: "wallet", label: "rail.wallet", hint: "rail.walletHint" },
    opencollective: {
      icon: "people",
      label: "rail.opencollective",
      hint: "rail.opencollectiveHint",
    },
    paypal: { icon: "card", label: "rail.paypal", hint: "rail.paypalHint" },
    bank: { icon: "bank", label: "rail.bank", hint: "rail.bankHint" },
  };
  const REASONS: Record<RailReason, MessageKey> = {
    "no-wallet": "rail.why.noWallet",
    "on-chain": "rail.why.onChain",
    "no-collective": "rail.why.noCollective",
    "other-currency": "rail.why.otherCurrency",
    empty: "rail.why.empty",
  };

  $: lines = statement.lines.filter((l) => l.available > 0);
  let line: AccountLine | null = null;
  $: if (!line && lines.length === 1) line = lines[0];

  $: fund = line ? (statement.funds[line.holon] ?? null) : null;
  $: options = line
    ? claimRails({
        line,
        payoutAddress: payout,
        collective: fund?.slug
          ? { slug: fund.slug, currency: fund.collective?.currency ?? "" }
          : null,
      })
    : [];
  /**
   * A collect anyone may send. A request is the party's own word, and the
   * fund must be one that hears this session: a founded fund counts only
   * its members' entries.
   */
  $: heard = !!fund?.heard;
  $: usable = (o: RailOption) =>
    o.enabled && (o.mode === "collect" || (own && heard));
  $: whyNot = (o: RailOption) =>
    o.reason
      ? $t(REASONS[o.reason])
      : o.mode !== "request"
        ? ""
        : !own
          ? $t("rail.why.notYours")
          : !heard
            ? $t("rail.why.notMember", {
                fund: line ? labelOf(line.holon) : "",
              })
            : "";

  let rail: RailOption | null = null;
  let value = "";
  let memo = "";
  let busy = false;
  let error = "";
  let sent: { id: string; rail: ClaimRail; amount: number } | null = null;
  let needWallet = false;

  function pick(option: RailOption) {
    error = "";
    rail = option;
    if (line) value = String(Math.floor(line.available * 100) / 100);
  }

  $: asked = Number(String(value).replace(",", "."));
  $: valid =
    !!line &&
    Number.isFinite(asked) &&
    asked > 0 &&
    asked <= line.available + 0.005;

  async function collectNow() {
    if (!line?.token) return;
    if (!isWalletAvailable()) {
      needWallet = true;
      return;
    }
    busy = true;
    error = "";
    try {
      await collect(party, line.token);
      showNotice($t("wallet.collected"));
      dispatch("changed");
      dispatch("close");
    } catch (err) {
      if (err instanceof ChainError && err.kind === "no-wallet")
        needWallet = true;
      else {
        const message = (err as Error)?.message ?? "";
        error =
          message === "no-row"
            ? $t("wallet.noRow")
            : message === "no-table"
              ? $t("wallet.noTable")
              : message || $t("wallet.failed");
      }
    } finally {
      busy = false;
    }
  }

  async function request() {
    if (!line || !rail || !valid) return;
    busy = true;
    error = "";
    try {
      const id = await requestClaim(line.holon, {
        party,
        amount: asked,
        unit: line.unit,
        rail: rail.rail,
        memo: memo.trim() || undefined,
      });
      sent = { id, rail: rail.rail, amount: asked };
      dispatch("changed");
    } catch (err) {
      error =
        (err as Error)?.message === "over-right"
          ? $t("claim.over")
          : $t("claim.failed");
    } finally {
      busy = false;
    }
  }

  $: reference = sent
    ? $t("claim.reference", {
        id: sent.id.slice(0, 8),
        fund: line ? labelOf(line.holon) : "",
      })
    : "";
  $: expenseUrl = fund?.slug ? collectiveExpenseUrl(fund.slug) : "";

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice($t("share.copied"));
    } catch {
      showNotice($t("share.failed"));
    }
  }
</script>

<BottomSheet title={$t("claim.title")} on:close={() => dispatch("close")}>
  {#if sent && line}
    <div class="done">
      <span class="tick"><Icon name="check" /></span>
      <h3>
        {$t("claim.sentTitle", {
          amount: money(sent.amount, line.unit, $locale),
        })}
      </h3>
      {#if sent.rail === "wallet"}
        <p class="muted">
          {$t("claim.sentWallet", {
            fund: labelOf(line.holon),
            address: payout ? shortAddress(payout) : "",
          })}
        </p>
      {:else}
        <p class="muted">
          {$t("claim.sentCollective", { fund: labelOf(line.holon) })}
        </p>
        <div class="ref">
          <code>{reference}</code>
          <button class="btn quiet small" on:click={() => copy(reference)}
            ><Icon name="copy" />{$t("share.copy")}</button
          >
        </div>
        {#if expenseUrl}
          <a
            class="btn wide"
            href={expenseUrl}
            target="_blank"
            rel="noopener noreferrer"
            >{$t("claim.openExpense")}<Icon name="external" /></a
          >
        {/if}
      {/if}
      <button class="btn quiet wide" on:click={() => dispatch("close")}
        >{$t("claim.done")}</button
      >
    </div>
  {:else if needWallet}
    <p>{$t("wallet.needWalletBody")}</p>
    <div class="row">
      <button class="btn wide" on:click={() => copy(location.href)}
        ><Icon name="copy" />{$t("share.copy")}</button
      >
    </div>
  {:else if !lines.length}
    <p class="muted">{$t("claim.nothing")}</p>
  {:else if !line}
    <p class="step">{$t("claim.fromWhere")}</p>
    <ul class="choices">
      {#each lines as l (l.holon + l.unit + l.place)}
        <li>
          <button class="choice" on:click={() => (line = l)}>
            <span class="what">
              <b>{labelOf(l.holon)}</b>
              <i
                >{l.place === "chain"
                  ? $t("balance.onChain")
                  : $t("balance.inFund")}</i
              >
            </span>
            <span class="n">{money(l.available, l.unit, $locale)}</span>
            <Icon name="chevron-right" />
          </button>
        </li>
      {/each}
    </ul>
  {:else if !rail}
    <p class="step">
      {$t("claim.byWhichWay", {
        amount: money(line.available, line.unit, $locale),
        fund: labelOf(line.holon),
      })}
    </p>
    <ul class="choices">
      {#each options as option (option.rail)}
        {@const meta = RAILS[option.rail]}
        {@const ok = usable(option)}
        <li>
          <button class="choice" disabled={!ok} on:click={() => pick(option)}>
            <span class="disc"><Icon name={meta.icon} /></span>
            <span class="what">
              <b>{$t(meta.label)}</b>
              <i>{ok ? $t(meta.hint) : whyNot(option)}</i>
            </span>
            {#if ok}<Icon name="chevron-right" />{/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if lines.length > 1}
      <button class="back" on:click={() => (line = null)}
        ><Icon name="arrow-left" />{$t("claim.otherSource")}</button
      >
    {/if}
  {:else if rail.mode === "collect"}
    <p class="step">
      {$t("claim.collectBody", {
        amount: money(line.available, line.unit, $locale),
        address: payout ? shortAddress(payout) : "",
      })}
    </p>
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <div class="row">
      <button class="btn quiet" on:click={() => (rail = null)} disabled={busy}
        >{$t("nav.back")}</button
      >
      <button class="btn grow" on:click={collectNow} disabled={busy}
        >{busy ? $t("wallet.collecting") : $t("wallet.collect")}</button
      >
    </div>
  {:else}
    <form on:submit|preventDefault={request}>
      <p class="step">
        {$t("claim.howMuch", { way: $t(RAILS[rail.rail].label) })}
      </p>
      <label class="field">
        <span>{$t("claim.amount", { unit: line.unit })}</span>
        <input
          bind:value
          inputmode="decimal"
          autocomplete="off"
          aria-invalid={!valid}
        />
        <small
          >{$t("claim.upTo", {
            amount: money(line.available, line.unit, $locale),
          })}</small
        >
      </label>
      <label class="field">
        <span>{$t("claim.note")}</span>
        <input bind:value={memo} maxlength="140" autocomplete="off" />
      </label>
      {#if rail.rail !== "wallet"}
        <p class="muted small-print">{$t("claim.detailsElsewhere")}</p>
      {/if}
      {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
      <div class="row">
        <button
          class="btn quiet"
          type="button"
          on:click={() => (rail = null)}
          disabled={busy}>{$t("nav.back")}</button
        >
        <button class="btn grow" type="submit" disabled={busy || !valid}
          >{busy ? $t("claim.sending") : $t("claim.send")}</button
        >
      </div>
    </form>
  {/if}
</BottomSheet>

<style>
  .step {
    font-weight: 600;
    margin-bottom: 12px;
  }
  .choices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 64px;
    padding: 10px 12px;
    border: 1.5px solid var(--line);
    border-radius: 16px;
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    text-align: left;
  }
  .choice:disabled {
    opacity: 0.6;
  }
  .disc {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .what {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .what b {
    font-weight: 700;
  }
  .what i {
    font-style: normal;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    margin-top: 8px;
    font: inherit;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--teal-ink);
  }
  .field {
    display: grid;
    gap: 4px;
    margin-bottom: 12px;
  }
  .field span {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .field small {
    font-size: 0.78rem;
    color: var(--muted);
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
    font-variant-numeric: tabular-nums;
  }
  .small-print {
    font-size: 0.82rem;
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    gap: 10px;
    margin-top: 14px;
  }
  .grow {
    flex: 1 1 auto;
  }
  .wide {
    width: 100%;
  }
  .done {
    display: grid;
    gap: 10px;
    justify-items: center;
    text-align: center;
  }
  .done h3 {
    font-size: 1.2rem;
  }
  .tick {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.6rem;
    background: var(--teal);
    color: var(--on-teal);
  }
  .ref {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 8px 8px 12px;
    border: 1.5px dashed var(--line);
    border-radius: 12px;
    text-align: left;
  }
  .ref code {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.86rem;
    overflow-wrap: anywhere;
  }
  .small {
    min-height: 40px;
    padding: 0 12px;
    font-size: 0.86rem;
    flex: 0 0 auto;
  }
</style>
