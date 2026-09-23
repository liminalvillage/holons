<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The ballot on a proposal: the tally so far, the member's own vote (a
  // signed entry of the `governance_votes` log — this instance signs with
  // the member's own derived key, so `append` is enough) and who voted
  // what. The fold is core's (`foldVotesFromLenses`), the same the kiosk
  // and the bot run; this renders it.

  import { getContext, onDestroy, tick } from "svelte";
  import type { HoloSphere } from "holosphere";
  import {
    DELEGATIONS_LENS,
    GOVERNANCE_VOTES_LENS,
    VOTE_CHOICES,
    buildVote,
    foldDelegations,
    foldVotesFromLenses,
    tallyBallots,
    type Vote,
    type VoteChoice,
  } from "@holons/core/governance";
  import {
    MEMBERS_LENS,
    POLICY_LENS,
    importPartnerLogs,
    readMembersLog,
    type LogEvent,
    type MembershipEnvelope,
    type PartnerImport,
  } from "@holons/core/protocol";
  import { attestationsFrom, SHIFT_IDENTITY_LENS } from "@holons/core/shifts";
  import type { IdentityAttestation } from "@holons/core/shifts";

  export let holonId: string;
  export let proposalId: string;
  /** The logged-in member's party id (Telegram id or Nostr pubkey). */
  export let selfId: string = "";
  /** Names for the roster, when the host has them. */
  export let names: Record<string, string> = {};

  const holosphere = getContext("holosphere") as HoloSphere;

  let entries = new Map<string, LogEvent<unknown>>();
  let policyEntries = new Map<string, LogEvent<unknown>>();
  let membersLog: MembershipEnvelope[] = [];
  let attestations: IdentityAttestation[] = [];
  let imports: PartnerImport[] = [];
  let settings: Record<string, unknown> | null = null;
  let users: Array<{ id?: string | number | null; [k: string]: unknown }> = [];
  let delegations: Record<string, string> = {};
  let offs: Array<() => void> = [];
  let boundTo = "";
  let busy = false;
  let error = "";

  $: if (holonId && holonId !== boundTo) bind(holonId);
  function bind(id: string) {
    unbind();
    boundTo = id;
    entries = new Map();
    policyEntries = new Map();
    offs.push(
      holosphere.subscribeLog(id, GOVERNANCE_VOTES_LENS, (e) => {
        if (boundTo !== id) return;
        entries.set(e.id, e as LogEvent<unknown>);
        entries = entries;
      }),
    );
    offs.push(
      holosphere.subscribeLog(id, POLICY_LENS, (e) => {
        if (boundTo !== id) return;
        policyEntries.set(e.id, e as LogEvent<unknown>);
        policyEntries = policyEntries;
        void refreshImports(id);
      }),
    );
    void (async () => {
      try {
        await holosphere.getAll(id, MEMBERS_LENS);
        const log = await readMembersLog(holosphere, id);
        if (boundTo === id) membersLog = log;
      } catch {
        /* not founded yet */
      }
      try {
        const dir = (await holosphere.getAllGlobal(SHIFT_IDENTITY_LENS)) as never[];
        if (boundTo === id) attestations = attestationsFrom(dir || []);
      } catch {
        /* no directory */
      }
      const [doc, roster, del] = await Promise.all([
        holosphere.get(id, "settings", id).catch(() => null),
        holosphere.getAll(id, "users").catch(() => []),
        holosphere.getAll(id, DELEGATIONS_LENS).catch(() => []),
      ]);
      if (boundTo !== id) return;
      settings = (doc as Record<string, unknown>) ?? null;
      users = (roster as typeof users) ?? [];
      delegations = foldDelegations((del as unknown[]) ?? []);
    })();
  }
  // The partners the policy pins are read by their own rules; re-read when
  // the policy log moves.
  let importsFor = "";
  async function refreshImports(id: string) {
    const key = [...policyEntries.keys()].sort().join(",");
    if (key === importsFor) return;
    importsFor = key;
    await tick(); // the fold below has caught up with the new policy entries
    const rule = ctx?.policy;
    try {
      const next = rule ? await importPartnerLogs(holosphere, GOVERNANCE_VOTES_LENS, rule) : [];
      if (boundTo === id) imports = next;
    } catch {
      imports = [];
    }
  }
  function unbind() {
    for (const off of offs) off();
    offs = [];
    boundTo = "";
  }
  onDestroy(unbind);

  $: ctx = boundTo
    ? foldVotesFromLenses({
        holonId: boundTo,
        entries: [...entries.values()],
        policyEntries: [...policyEntries.values()],
        membersLog,
        settings,
        users,
        attestations,
        imports,
      })
    : null;
  $: memberIds = users.map((u) => (u?.id == null ? "" : String(u.id))).filter(Boolean);
  $: tally = ctx ? tallyBallots(ctx.folded.ballots[proposalId] ?? {}, memberIds, { delegations }) : null;
  $: mine = ctx && selfId ? (ctx.folded.ballots[proposalId]?.[selfId] ?? null) : null;
  $: votes = ctx ? ctx.folded.votes.filter((v) => v.proposal === proposalId && v.status !== "superseded") : ([] as Vote[]);
  $: provisional = ctx?.folded.source === "bootstrap";
  $: total = tally?.total ?? 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const name = (id: string) => {
    const u = users.find((x) => String(x?.id ?? "") === id) as { first_name?: string; username?: string } | undefined;
    return names[id] || u?.first_name || u?.username || id;
  };
  const statusLabel: Record<Vote["status"], string> = {
    counted: "Counted",
    superseded: "Replaced",
    pending: "Awaiting attestation",
    disputed: "Disputed",
    rejected: "Not counted",
  };
  const choiceLabel: Record<VoteChoice, string> = { yes: "Yes", no: "No", abstain: "Abstain" };

  async function cast(choice: VoteChoice) {
    if (!boundTo || !selfId || busy) return;
    busy = true;
    error = "";
    try {
      const a = buildVote({ proposal: proposalId, party: selfId, choice });
      await holosphere.append(boundTo, GOVERNANCE_VOTES_LENS, a.item, { refs: a.refs });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="bg-gray-700/30 p-3 rounded-lg" aria-label="Vote">
  <h4 class="text-sm font-medium text-gray-300 mb-2">Vote</h4>
  {#if tally}
    <div
      class="flex h-2 rounded-full overflow-hidden bg-gray-600/60"
      role="img"
      aria-label={`Yes ${tally.yes}, no ${tally.no}, abstain ${tally.abstain}, of ${tally.total}`}
    >
      <span class="bg-emerald-500" style:width="{pct(tally.yes)}%"></span>
      <span class="bg-rose-500" style:width="{pct(tally.no)}%"></span>
      <span class="bg-gray-400" style:width="{pct(tally.abstain)}%"></span>
    </div>
    <p class="text-xs text-gray-400 mt-1">
      Yes {tally.yes} · No {tally.no} · Abstain {tally.abstain} · of {tally.total}
      · {tally.passed ? "passing" : "not passing"}
    </p>
  {/if}
  {#if provisional}
    <p class="text-xs text-amber-300/90 mt-1">This holon is not founded yet: who counts is provisional until the bot signs its membership.</p>
  {/if}
  {#if selfId}
    <div class="flex flex-wrap gap-2 mt-2" role="group" aria-label="Your vote">
      {#each VOTE_CHOICES as c (c)}
        <button
          type="button"
          class="px-3 py-1.5 rounded-full text-sm border transition-colors {mine === c
            ? c === 'no'
              ? 'bg-rose-600 border-rose-500 text-white'
              : c === 'abstain'
                ? 'bg-gray-500 border-gray-400 text-white'
                : 'bg-emerald-600 border-emerald-500 text-white'
            : 'border-gray-600 text-gray-300 hover:border-gray-400'}"
          aria-pressed={mine === c}
          disabled={busy}
          on:click={() => cast(c)}>{choiceLabel[c]}</button
        >
      {/each}
    </div>
  {:else}
    <p class="text-xs text-gray-400 mt-1">Sign in to vote.</p>
  {/if}
  {#if error}<p class="text-xs text-rose-400 mt-1" role="alert">{error}</p>{/if}
  {#if votes.length}
    <ul class="mt-2 space-y-1 text-sm">
      {#each votes.slice(-12).reverse() as v (v.id)}
        <li class="flex items-center gap-2 {v.status === 'counted' ? '' : 'opacity-70'}">
          <span class="font-medium text-gray-200">{name(v.party)}</span>
          <span
            class="px-2 rounded-full text-xs border {v.choice === 'yes'
              ? 'border-emerald-500 text-emerald-300'
              : v.choice === 'no'
                ? 'border-rose-500 text-rose-300'
                : 'border-gray-500 text-gray-300'}">{choiceLabel[v.choice]}</span
          >
          {#if v.status !== "counted"}<span class="text-xs text-gray-400">{statusLabel[v.status]}</span>{/if}
          {#if v.origin}<span class="text-xs text-gray-500">via {names[v.origin] || v.origin}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
