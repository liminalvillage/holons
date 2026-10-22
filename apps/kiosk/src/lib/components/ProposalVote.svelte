<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The ballot on a proposal: the tally so far, the logged-in person's own
  // vote (a signed entry of the `governance_votes` log, one counted vote per
  // party — the newest), and who voted what. Reads and folds the log the way
  // every surface does (`$lib/governanceVotes`); renders, never decides.

  import { onDestroy } from "svelte";
  import { nameOf } from "$lib/names";
  import { userName } from "@holons/core/identity";
  import type { HoloSphere } from "holosphere";
  import { t } from "$lib/i18n";
  import { currentUser, isLoggedIn, loginOpen } from "$lib/auth";
  import { getHolosphere } from "$lib/holosphere";
  import { partnerNames } from "$lib/stores";
  import type { Vote, VoteChoice, VotesContext } from "@holons/core/governance";
  import { VOTE_CHOICES } from "@holons/core/governance";
  import { bindEquation, equationReady, governed } from "$lib/equation";
  import { lang, type MessageKey } from "$lib/i18n";
  import {
    foldVotesContext,
    loadVotesRoster,
    recordVote,
    tallyFor,
    voteSigner,
    watchVotesLogs,
    type VotesLogs,
    type VotesRoster,
  } from "$lib/governanceVotes";

  export let holonId: string;
  export let proposalId: string;

  let hs: HoloSphere | null = null;
  let logs: VotesLogs | null = null;
  let roster: VotesRoster | null = null;
  let off: (() => void) | null = null;
  let boundTo = "";
  let signer: Awaited<ReturnType<typeof voteSigner>> = null;
  let busy = false;
  let error = "";

  $: if (holonId && holonId !== boundTo) void bind(holonId);
  async function bind(holon: string) {
    unbind();
    boundTo = holon;
    hs = await getHolosphere();
    if (boundTo !== holon) return;
    off = watchVotesLogs(hs, holon, (l) => {
      if (boundTo === holon) logs = l;
    });
    const r = await loadVotesRoster(hs, holon);
    if (boundTo === holon) roster = r;
  }
  function unbind() {
    off?.();
    off = null;
    boundTo = "";
    logs = null;
    roster = null;
  }
  onDestroy(unbind);
  $: void refreshSigner($currentUser);
  async function refreshSigner(_u: unknown) {
    signer = await voteSigner();
  }

  // ---- An equation proposal: what it changes, and when it is decided ------
  // The proposal is a signed entry of the votes log, so what it changes and
  // the new moon it closes at come from there — never from the quest, which
  // anyone could edit. Votes after the close are not counted, and if it
  // passed, it is in force from that moon on. Nothing to apply: every board
  // folds the result (`$lib/equation`).
  $: if (holonId) bindEquation(holonId);
  $: eq = $governed.proposals.find((p) => p.id === proposalId) ?? null;
  $: closesAt = eq?.closesAt ?? null;
  $: closed = !!eq?.closed;
  $: closeDate =
    closesAt == null
      ? ""
      : new Intl.DateTimeFormat($lang, {
          day: "numeric",
          month: "long",
        }).format(new Date(closesAt));
  $: changes = eq && $equationReady && !closed ? eq.changes : [];
  const metricLabel = (key: string) =>
    key.startsWith("currencies.")
      ? key.slice("currencies.".length)
      : $t(`status.metric.${key}` as MessageKey);

  $: ctx =
    logs && roster && boundTo
      ? foldVotesContext(boundTo, logs, roster)
      : (null as VotesContext | null);
  $: tally = ctx && roster ? tallyFor(ctx, roster, proposalId) : null;
  $: selfId = $currentUser ? String($currentUser.id) : null;
  $: mine =
    ctx && selfId ? (ctx.folded.ballots[proposalId]?.[selfId] ?? null) : null;
  $: votes = ctx
    ? ctx.folded.votes.filter(
        (v) => v.proposal === proposalId && v.status !== "superseded",
      )
    : ([] as Vote[]);
  $: provisional = ctx?.folded.source === "bootstrap";
  $: total = tally ? tally.total : 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const name = (id: string) => {
    const u = roster?.users.find((x) => String(x?.id ?? "") === id) as
      | { first_name?: string; username?: string }
      | undefined;
    return (
      (u
        ? userName(u, { lastName: "initial", idFallback: false, unknown: "" })
        : "") ||
      $partnerNames[id] ||
      $nameOf(id)
    );
  };

  async function cast(choice: VoteChoice) {
    if (!hs || !boundTo || !selfId || busy) return;
    if (!signer) {
      error = $t("vote.noSigner");
      return;
    }
    busy = true;
    error = "";
    try {
      await recordVote(hs, boundTo, {
        proposal: proposalId,
        party: selfId,
        choice,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="vote" aria-label={$t("vote.title")}>
  {#if eq}
    <div class="k">{$t("vote.equationTitle")}</div>
    {#if changes.length}
      <ul class="changes">
        {#each changes as c (c.key)}
          <li>
            <span class="who">{metricLabel(c.key)}</span>
            <span class="move">{c.from} → {c.to}</span>
          </li>
        {/each}
      </ul>
    {:else if $equationReady && !closed}
      <p class="sub">{$t("vote.equationNoChange")}</p>
    {/if}
    {#if closesAt != null}
      <p class="sub moon">
        {#if !closed}
          {$t("vote.equationOpen", { date: closeDate })}
        {:else if tally?.passed}
          {$t("vote.equationPassed", { date: closeDate })}
        {:else if tally}
          {$t("vote.equationFailed")}
        {/if}
      </p>
    {/if}
  {/if}
  <div class="k">{$t("vote.title")}</div>
  {#if tally}
    <div
      class="bar"
      role="img"
      aria-label={$t("vote.tally", {
        yes: String(tally.yes),
        no: String(tally.no),
        abstain: String(tally.abstain),
        total: String(tally.total),
      })}
    >
      <span class="yes" style:width="{pct(tally.yes)}%"></span>
      <span class="no" style:width="{pct(tally.no)}%"></span>
      <span class="abstain" style:width="{pct(tally.abstain)}%"></span>
    </div>
    <p class="sub">
      {$t("vote.tally", {
        yes: String(tally.yes),
        no: String(tally.no),
        abstain: String(tally.abstain),
        total: String(tally.total),
      })}
      {#if !closed}
        · {tally.passed ? $t("vote.passing") : $t("vote.notPassing")}
      {/if}
    </p>
  {/if}
  {#if provisional}
    <p class="sub">{$t("vote.provisional")}</p>
  {/if}
  {#if closed}
    <!-- The moon has decided it: the ballots below are the record. -->
  {:else if $isLoggedIn && selfId}
    <div class="choices" role="group" aria-label={$t("vote.yours")}>
      {#each VOTE_CHOICES as c (c)}
        <button
          type="button"
          class="choice {c}"
          class:on={mine === c}
          aria-pressed={mine === c}
          disabled={busy}
          on:click={() => cast(c)}>{$t(`vote.choice.${c}`)}</button
        >
      {/each}
    </div>
  {:else}
    <button type="button" class="link" on:click={() => ($loginOpen = true)}
      >{$t("vote.signIn")}</button
    >
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if votes.length}
    <ul class="ballots">
      {#each votes.slice(-12).reverse() as v (v.id)}
        <li class="ballot {v.status}">
          <span class="who">{name(v.party)}</span>
          <span class="choice-tag {v.choice}"
            >{$t(`vote.choice.${v.choice}`)}</span
          >
          {#if v.status !== "counted"}
            <span class="badge">{$t(`vote.status.${v.status}`)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .vote {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--line, rgba(128, 128, 128, 0.35));
    border-radius: var(--radius, 12px);
    background: var(--card, transparent);
  }
  .k {
    font-weight: 600;
    margin-bottom: 0.4rem;
  }
  .sub {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .bar {
    display: flex;
    height: 0.5rem;
    border-radius: 999px;
    overflow: hidden;
    background: var(--line, rgba(128, 128, 128, 0.25));
  }
  .bar .yes {
    background: var(--teal);
  }
  .bar .no {
    background: #c0392b;
  }
  .bar .abstain {
    background: var(--muted);
  }
  .choices {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.6rem;
    flex-wrap: wrap;
  }
  .choice {
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    border: 1px solid var(--line, rgba(128, 128, 128, 0.35));
    background: transparent;
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .choice.on {
    border-color: var(--teal);
    background: var(--teal);
    color: var(--on-teal);
  }
  .choice.on.no {
    border-color: var(--danger);
    background: var(--danger);
    color: var(--on-danger);
  }
  .moon {
    font-weight: 600;
    color: var(--ink);
  }
  .changes {
    list-style: none;
    margin: 0 0 0.75rem;
    padding: 0;
    display: grid;
    gap: 0.3rem;
    font-size: 0.88rem;
  }
  .changes li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .changes .who {
    font-weight: 600;
  }
  .changes .move {
    font-variant-numeric: tabular-nums;
  }
  .choice:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .link {
    margin-top: 0.5rem;
    min-height: 44px;
    background: none;
    border: 0;
    padding: 0;
    color: var(--teal-ink);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
  }
  .error {
    margin: 0.4rem 0 0;
    color: var(--danger);
    font-size: 0.82rem;
  }
  .ballots {
    list-style: none;
    margin: 0.6rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .ballot {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
  }
  .ballot .who {
    font-weight: 600;
  }
  .choice-tag {
    padding: 0.05rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    border: 1px solid var(--line, rgba(128, 128, 128, 0.35));
  }
  .choice-tag.yes {
    border-color: var(--teal);
    color: var(--teal-ink);
  }
  .choice-tag.no {
    border-color: #c0392b;
    color: var(--danger);
  }
  .badge {
    font-size: 0.72rem;
    color: var(--muted);
  }
  .ballot.rejected,
  .ballot.disputed {
    opacity: 0.7;
  }
</style>
