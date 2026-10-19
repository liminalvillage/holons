<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One account, the way a bank shows one: whose it is, what is in it, what
  // can be done with it — then where the money comes from, where it goes,
  // and what happened. A person, a project, a fund and the Pot all open on
  // this same screen; what differs is only which buttons their reader has.
  //
  //   Claim         take money out, by whichever way the account allows
  //   Fund          pay money in: the Pot's address, the collective's page
  //   Redistribute  a holon's split, edited by its stewards
  //   Find funds /  ask a fund for a seat
  //   Apply
  //   Resource      give the thing itself — space, tools, seeds, skills,
  //                 time — at any level: the Pot, a fund, a project, a person
  //
  // The balance is read live (`loadStatement`); the lists and the diagram
  // below it come off the map.
  import type {
    FlowGraphIndex,
    ResourceOffer,
    ResourcesContext,
  } from "@holons/core/flows";
  import ActionRow from "./ActionRow.svelte";
  import ActivityList from "./ActivityList.svelte";
  import ApplicationsInbox from "./ApplicationsInbox.svelte";
  import ApplySheet from "./ApplySheet.svelte";
  import BalanceCard from "./BalanceCard.svelte";
  import ClaimSheet from "./ClaimSheet.svelte";
  import FundSheet from "./FundSheet.svelte";
  import GiveSheet from "./GiveSheet.svelte";
  import OfferSheet from "./OfferSheet.svelte";
  import ResourcesSection from "./ResourcesSection.svelte";
  import TraceCard from "./TraceCard.svelte";
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import PartyScreen from "./PartyScreen.svelte";
  import WalletCard from "./WalletCard.svelte";
  import {
    EMPTY_STATEMENT,
    activityOf,
    canSteer,
    loadFund,
    loadStatement,
    type ActivityRow,
    type Statement,
  } from "$lib/account";
  import { myApplications, type MyApplication } from "$lib/applications";
  import { currentUser, displayName } from "$lib/auth";
  import { pct } from "$lib/format";
  import { labelOf, nameFor } from "$lib/graph";
  import { locale, t, type MessageKey } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { loadPayout, rememberSteered, steeredHolons } from "$lib/me";
  import { EMPTY_RESOURCES, accountResources } from "$lib/resources";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { logout } from "$lib/auth";
  import { hrefFor, searchHref } from "$lib/urls";
  import type { AccountAction } from "$lib/viewTypes";

  export let index: FlowGraphIndex;
  export let id: string;
  /** The signed-in person IS this party. */
  export let own = false;

  $: node = index.byId.get(id)!;
  $: isHolon = node.kind !== "person" && node.kind !== "placeholder";
  $: selfId = $currentUser ? String($currentUser.id) : null;

  let statement: Statement = EMPTY_STATEMENT;
  let reading = true;
  let payout: string | null = null;
  let steer = false;
  let queue: ActivityRow[] = [];
  let applications: MyApplication[] = [];
  /** The holons I steward, to ask on their behalf. */
  let mine: string[] = [];
  let sheet: "none" | "claim" | "fund" | "apply" | "give" | "offer" = "none";
  let resources: ResourcesContext = EMPTY_RESOURCES;
  let readingResources = true;
  /** The offer a give answers, or an offer being edited. */
  let offer: ResourceOffer | null = null;

  async function readResources(force = false) {
    readingResources = true;
    resources = await accountResources(id, force);
    readingResources = false;
  }

  async function read(force = false) {
    reading = true;
    const [next, address] = await Promise.all([
      loadStatement(id, force),
      loadPayout(id, $potLive.record?.chainId ?? null),
    ]);
    statement = next;
    payout = address ?? node.payout ?? null;
    reading = false;
  }

  async function readRole() {
    steer = isHolon ? await canSteer(id) : false;
    queue = steer
      ? activityOf(await loadFund(id, true)).filter(
          (r) =>
            r.claim.status === "pending" ||
            r.claim.status === "approved" ||
            r.claim.status === "disputed",
        )
      : [];
    applications = own || steer ? await myApplications(id) : [];
    if (selfId && steer) rememberSteered(selfId, id);
    mine = await steeredHolons(index, selfId, canSteer);
  }

  // Read when the account, the reader or the Pot's state changes.
  let readFor = "";
  $: {
    const key = `${id}:${selfId ?? ""}:${$potLive.status}`;
    if (key !== readFor) {
      readFor = key;
      void read();
      void readRole();
      void readResources();
    }
  }
  const refresh = () => {
    void read(true);
    void readRole();
    void readResources(true);
  };

  /**
   * Signed in, but nothing this session writes would be signed as the
   * person: a key sign-in is held in memory only, and a reload drops it.
   * Offering to act would record entries nobody counts.
   */
  $: unsigned = !!selfId && !$sessionKeyPub;
  $: acting = own && !unsigned;

  $: applicants =
    selfId && !unsigned
      ? [
          { id: selfId, label: displayName($currentUser!) },
          ...mine
            .filter((h) => h !== id)
            .map((h) => ({ id: h, label: labelOf(h) })),
        ]
      : [];
  /** Anyone signed in may resource any account but their own; a steward records what reached theirs. */
  $: canGive = !!selfId && !unsigned && (!own || steer);

  /** Asking this account for a seat makes sense when it is a holon that is not mine. */
  $: canApplyHere = isHolon && !!selfId && !unsigned && !own && !steer;

  $: actions = [
    { id: "claim", icon: "download", label: $t("action.claim"), main: true },
    { id: "fund", icon: "plus", label: $t("action.fund") },
    ...(canGive
      ? [{ id: "give", icon: "gift", label: $t("action.resource") }]
      : []),
    ...(isHolon
      ? [
          {
            id: "split",
            icon: "sliders",
            label: steer ? $t("action.redistribute") : $t("action.split"),
            href: `/h/${encodeURIComponent(id)}/split`,
          },
        ]
      : []),
    ...(canApplyHere
      ? [{ id: "apply", icon: "send", label: $t("action.apply") }]
      : own || steer
        ? [
            {
              id: "find",
              icon: "search",
              label: $t("action.findFunds"),
              href: searchHref("", "fund"),
            },
          ]
        : []),
  ] as AccountAction[];

  const APPLICATION: Record<
    MyApplication["application"]["status"],
    MessageKey
  > = {
    pending: "apply.status.pending",
    approved: "apply.status.approved",
    declined: "apply.status.declined",
    withdrawn: "apply.status.withdrawn",
  };
  $: steered = new Set(steer ? [id] : []);
</script>

<header class="head">
  <p class="eyebrow">
    {#if own}{$t("account.yours")}{:else}<KindChip kind={node.kind} />{/if}
  </p>
  <h1>
    {own && node.label === node.id && $currentUser
      ? displayName($currentUser)
      : nameFor(node.id, node.label)}
  </h1>
  <p class="sub">
    {#if own}<KindChip kind={node.kind} />{/if}
    {#if node.kind !== "pot"}
      <span>
        {node.share > 0
          ? $t("party.ofPot", { pct: pct(node.share) })
          : $t("party.unseated")}
      </span>
    {/if}
    {#if steer}<span class="badge">{$t("account.steward")}</span>{/if}
  </p>
</header>

{#if statement.balances.length}
  <div class="balances">
    {#each statement.balances as balance, i (balance.unit)}
      <BalanceCard {balance} primary={i === 0} />
    {/each}
  </div>
{:else}
  <section class="card none">
    <p class="label">{$t("balance.available")}</p>
    <p class="figure">{reading ? "…" : "—"}</p>
    {#if !reading}
      <p class="muted">
        {own ? $t("balance.noneOwn") : $t("balance.none")}
      </p>
    {/if}
  </section>
{/if}
{#if statement.partial}
  <p class="muted partial">{$t("balance.partial")}</p>
{/if}

{#if unsigned && (own || isHolon)}
  <div class="notice warn relogin">
    <p>{$t("account.unsigned")}</p>
    <button class="btn quiet small" on:click={() => void logout()}
      >{$t("account.signInAgain")}</button
    >
  </div>
{/if}

<ActionRow
  {actions}
  onAct={(act) => {
    if (act === "give") offer = null;
    if (act === "claim" || act === "fund" || act === "apply" || act === "give")
      sheet = act;
  }}
/>

{#if own && mine.length}
  <h2 class="section-title">{$t("account.others")}</h2>
  <div class="chips">
    {#each mine as h (h)}
      {@const n = index.byId.get(h)}
      {#if n}
        <a class="chip" href={hrefFor(n)}
          >{n.label}<Icon name="chevron-right" /></a
        >
      {/if}
    {/each}
  </div>
{/if}

{#if own || node.kind === "person" || node.payout}
  <h2 class="section-title">{$t("wallet.title")}</h2>
  <WalletCard
    party={id}
    rest={node.rest}
    editable={acting || steer}
    figures={false}
    on:saved={(e) => (payout = e.detail)}
  />
{/if}

{#if steer}
  <ApplicationsInbox fund={id} on:changed={refresh} />
  {#if queue.length}
    <h2 class="section-title">{$t("account.toPay")} · {queue.length}</h2>
    <ActivityList rows={queue} {steered} showParty on:changed={refresh} />
  {/if}
{/if}

{#if applications.length}
  <h2 class="section-title">{$t("account.applications")}</h2>
  <ul class="apps">
    {#each applications as a (a.fund)}
      {@const fund = index.byId.get(a.fund)}
      <li>
        <svelte:element
          this={fund ? "a" : "span"}
          class="app"
          href={fund ? hrefFor(fund) : undefined}
        >
          <span class="who">
            <b>{fund?.label ?? a.fund}</b>
            <i
              >{new Date(a.application.createdAt * 1000).toLocaleDateString(
                $locale,
              )}{#if a.application.reason}
                · {a.application.reason}{/if}</i
            >
          </span>
          <span class="status {a.application.status}"
            >{$t(APPLICATION[a.application.status])}</span
          >
        </svelte:element>
      </li>
    {/each}
  </ul>
{/if}

<ResourcesSection
  {index}
  {id}
  ctx={resources}
  reading={readingResources}
  {steer}
  {canGive}
  {own}
  on:give={(e) => {
    offer = e.detail;
    sheet = "give";
  }}
  on:offer={(e) => {
    offer = e.detail;
    sheet = "offer";
  }}
  on:changed={() => void readResources(true)}
/>

<TraceCard {index} {id} {resources} />

{#if statement.activity.length}
  <h2 class="section-title">{$t("account.activity")}</h2>
  <ActivityList rows={statement.activity} on:changed={refresh} />
{/if}

<PartyScreen {index} {id} {own} bare>
  <a slot="after-sources" class="more" href={searchHref("", "fund")}
    ><Icon name="search" />{own || steer
      ? $t("account.findMore")
      : $t("account.browseFunds")}</a
  >
  <svelte:fragment slot="after-recipients">
    {#if isHolon}
      <a class="more" href="/h/{encodeURIComponent(id)}/split"
        ><Icon name="sliders" />{steer
          ? $t("account.editSplit")
          : $t("account.viewSplit")}</a
      >
    {/if}
  </svelte:fragment>
</PartyScreen>

{#if sheet === "claim"}
  <ClaimSheet
    party={id}
    {statement}
    own={acting}
    {payout}
    on:changed={refresh}
    on:close={() => (sheet = "none")}
  />
{:else if sheet === "fund"}
  <FundSheet
    {node}
    {steer}
    on:changed={refresh}
    on:close={() => (sheet = "none")}
  />
{:else if sheet === "give"}
  <GiveSheet
    to={node}
    givers={applicants}
    offers={resources.offers}
    {offer}
    {steer}
    on:changed={() => void readResources(true)}
    on:close={() => (sheet = "none")}
  />
{:else if sheet === "offer"}
  <OfferSheet
    holon={node}
    {offer}
    on:changed={() => void readResources(true)}
    on:close={() => (sheet = "none")}
  />
{:else if sheet === "apply"}
  <ApplySheet
    fund={node}
    {applicants}
    on:changed={refresh}
    on:close={() => (sheet = "none")}
  />
{/if}

<style>
  .head {
    display: grid;
    gap: 4px;
    margin-bottom: 14px;
  }
  .eyebrow {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .head h1 {
    font-size: 1.9rem;
    line-height: 1.12;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .badge {
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 0.74rem;
    font-weight: 700;
  }
  .balances {
    display: grid;
    gap: 10px;
  }
  .none {
    display: grid;
    gap: 4px;
    padding: 16px;
  }
  .none .label {
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .none .figure {
    font-size: 2.4rem;
    font-weight: 800;
    line-height: 1.15;
  }
  .relogin {
    display: grid;
    gap: 8px;
    justify-items: start;
    margin-top: 12px;
  }
  .relogin .small {
    min-height: 40px;
    padding: 0 14px;
    font-size: 0.86rem;
  }
  .partial {
    font-size: 0.82rem;
    margin-top: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    max-width: 100%;
    padding: 0 10px 0 16px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--card);
    font-weight: 700;
    font-size: 0.9rem;
    text-decoration: none;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .more {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    margin-top: 6px;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--teal-ink);
    text-decoration: none;
  }
  .apps {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .apps li + li {
    border-top: 1px solid var(--line);
  }
  .app {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 8px 14px;
    text-decoration: none;
    color: inherit;
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
  .status.pending {
    background: color-mix(in srgb, var(--caution) 18%, var(--card));
    color: var(--ink);
  }
  .status.declined {
    background: color-mix(in srgb, var(--danger, #b3261e) 14%, var(--card));
    color: var(--ink);
  }
</style>
