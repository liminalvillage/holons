<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The statement: every claim, newest first, with where it stands. The
  // status is the fund's own judgement of its log (core `foldClaims`), not
  // something this screen decides.
  //
  // A steward of the fund also acts from here: approve or decline a claim
  // waiting for a word, and — once the money has actually been sent by
  // whatever way the claim asked for — mark it paid, with where the payment
  // can be looked up.
  import type { ClaimRail, ClaimStatus } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import Icon from "./Icon.svelte";
  import { judgeClaim, markPaid, type ActivityRow } from "$lib/account";
  import { amount } from "$lib/format";
  import { labelOf } from "$lib/graph";
  import { locale, t, type MessageKey } from "$lib/i18n";
  import { showNotice } from "$lib/notice";

  export let rows: ActivityRow[] = [];
  /** Holons the signed-in person stewards. */
  export let steered: ReadonlySet<string> = new Set();
  /** Name the party on each row: a fund's whole queue rather than one account. */
  export let showParty = false;

  const dispatch = createEventDispatcher<{ changed: void }>();

  const STATUS: Record<ClaimStatus, MessageKey> = {
    pending: "claim.status.pending",
    approved: "claim.status.approved",
    disputed: "claim.status.disputed",
    over: "claim.status.over",
    conflict: "claim.status.conflict",
    settled: "claim.status.settled",
    rejected: "claim.status.rejected",
  };
  const RAIL: Record<ClaimRail, MessageKey> = {
    wallet: "rail.wallet",
    opencollective: "rail.opencollective",
    paypal: "rail.paypal",
    bank: "rail.bank",
  };

  let busy = "";
  let paying = "";
  let ref = "";

  const date = (seconds: number) =>
    new Date(seconds * 1000).toLocaleDateString($locale, {
      day: "numeric",
      month: "short",
    });

  async function run(id: string, work: () => Promise<void>, done: MessageKey) {
    busy = id;
    try {
      await work();
      showNotice($t(done));
      dispatch("changed");
    } catch {
      showNotice($t("claim.failed"));
    } finally {
      busy = "";
    }
  }
</script>

<ul class="list">
  {#each rows as row (row.claim.id)}
    {@const c = row.claim}
    {@const mine = steered.has(row.holon)}
    <li>
      <div class="line">
        <span class="who">
          <b>{showParty ? labelOf(c.party) : labelOf(row.holon)}</b>
          <i>
            {date(c.createdAt)}
            {#if c.rail}· {$t(RAIL[c.rail])}{/if}
            {#if c.memo}· {c.memo}{/if}
          </i>
        </span>
        <span class="right">
          <span class="n">{amount(c.amount, c.unit, $locale)}</span>
          <span class="status {c.status}">{$t(STATUS[c.status])}</span>
        </span>
      </div>
      {#if row.payout?.ref}
        {#if /^https:\/\//.test(row.payout.ref)}
          <a
            class="proof"
            href={row.payout.ref}
            target="_blank"
            rel="noopener noreferrer"
            >{$t("claim.proof")}<Icon name="external" /></a
          >
        {:else}
          <p class="proof">{row.payout.ref}</p>
        {/if}
      {/if}
      {#if mine && (c.status === "pending" || c.status === "disputed")}
        <div class="acts">
          <button
            class="btn small"
            disabled={!!busy}
            on:click={() =>
              run(
                c.id,
                () => judgeClaim(row.holon, c.id, "attest"),
                "claim.approved",
              )}>{$t("claim.approve")}</button
          >
          {#if c.status === "pending"}
            <button
              class="btn quiet small"
              disabled={!!busy}
              on:click={() =>
                run(
                  c.id,
                  () => judgeClaim(row.holon, c.id, "dispute"),
                  "claim.declined",
                )}>{$t("claim.decline")}</button
            >
          {/if}
        </div>
      {:else if mine && c.status === "approved"}
        {#if paying === c.id}
          <form
            class="pay"
            on:submit|preventDefault={() =>
              run(
                c.id,
                async () => {
                  await markPaid(row.holon, c, {
                    ref: ref.trim() || undefined,
                  });
                  paying = "";
                  ref = "";
                },
                "claim.markedPaid",
              )}
          >
            <label>
              <span>{$t("claim.proofField")}</span>
              <input
                bind:value={ref}
                placeholder="https://…"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
              />
            </label>
            <div class="acts">
              <button class="btn small" type="submit" disabled={!!busy}
                >{$t("claim.markPaid")}</button
              >
              <button
                class="btn quiet small"
                type="button"
                on:click={() => (paying = "")}>{$t("common.close")}</button
              >
            </div>
          </form>
        {:else}
          <div class="acts">
            <button
              class="btn small"
              disabled={!!busy}
              on:click={() => {
                paying = c.id;
                ref = "";
              }}>{$t("claim.markPaid")}</button
            >
          </div>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  li {
    padding: 12px 14px;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .who b {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who i {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    flex: 0 0 auto;
  }
  .n {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .status {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
    white-space: nowrap;
  }
  .status.settled {
    background: color-mix(in srgb, var(--teal) 22%, var(--card));
  }
  .status.pending,
  .status.over,
  .status.conflict {
    background: color-mix(in srgb, var(--caution) 18%, var(--card));
    color: var(--ink);
  }
  .status.disputed,
  .status.rejected {
    background: color-mix(in srgb, var(--danger, #b3261e) 14%, var(--card));
    color: var(--ink);
  }
  .proof {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 6px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--teal-ink);
    overflow-wrap: anywhere;
  }
  .acts {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.86rem;
  }
  .pay {
    margin-top: 10px;
  }
  .pay label {
    display: grid;
    gap: 4px;
  }
  .pay span {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--ink-soft);
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
</style>
