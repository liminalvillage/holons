<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One unit of an account, the way a bank shows it: what can be taken out
  // now, large; then what was asked for, what is gathering and what was
  // paid, small. Units never convert, so each has its own card and there is
  // no total across them. Where the figure comes from is one tap away.
  import type { AccountBalance } from "@holons/core/flows";
  import { amount } from "$lib/format";
  import { labelOf } from "$lib/graph";
  import { locale, t } from "$lib/i18n";

  export let balance: AccountBalance;
  /** The first card of the account: drawn larger. */
  export let primary = false;

  let open = false;
  $: text = (value: number) => amount(value, balance.unit, $locale);
</script>

<section class="card balance" class:primary>
  <p class="label">{$t("balance.available")}</p>
  <p class="figure">{text(balance.available)}</p>
  <dl>
    {#if balance.pending > 0}
      <div>
        <dt>{$t("balance.pending")}</dt>
        <dd>{text(balance.pending)}</dd>
      </div>
    {/if}
    {#if balance.accruing > 0}
      <div>
        <dt>{$t("balance.accruing")}</dt>
        <dd>{text(balance.accruing)}</dd>
      </div>
    {/if}
    <div>
      <dt>{$t("balance.paid")}</dt>
      <dd>{text(balance.paid)}</dd>
    </div>
  </dl>
  <button class="where" aria-expanded={open} on:click={() => (open = !open)}>
    {$t("balance.sources", { n: balance.lines.length })}
  </button>
  {#if open}
    <ul class="lines">
      {#each balance.lines as line (line.holon + line.place)}
        <li>
          <span class="from">
            <b>{labelOf(line.holon)}</b>
            <i
              >{line.place === "chain"
                ? $t("balance.onChain")
                : $t("balance.inFund")}</i
            >
          </span>
          <span class="n">{text(line.available)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .balance {
    display: grid;
    gap: 4px;
    padding: 16px;
  }
  .label {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .figure {
    font-size: 1.7rem;
    font-weight: 800;
    line-height: 1.15;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .primary .figure {
    font-size: 2.4rem;
    letter-spacing: -0.01em;
  }
  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    margin: 8px 0 0;
  }
  dt {
    font-size: 0.76rem;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-weight: 700;
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }
  .where {
    justify-self: start;
    min-height: 40px;
    margin-top: 4px;
    padding: 0;
    font: inherit;
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--teal-ink);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .lines {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .lines li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .lines li:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .from {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .from b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .from i {
    font-style: normal;
    font-size: 0.76rem;
    color: var(--muted);
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
