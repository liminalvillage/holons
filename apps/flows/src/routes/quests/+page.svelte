<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Quests: things people want to make happen, one card at a time. Discover
  // deals the board's open quests closest to tipping first; a yes opens
  // what it needs and who is in. Following is every quest I said yes to,
  // joined, pledged to or proposed — what is assembled (it's on) first.
  //
  // Every quest is filed under a fund — nothing comes straight from the Pot —
  // so the deck is the boards of the funds I follow (those that pay me and
  // the largest, until I choose). An event's holon as `?board=` is a board
  // of its own. Yes and no stay on this device; joining and pledging go on
  // the quest's board.
  import { page } from "$app/stores";
  import { rankQuests, sortFollowed } from "@holons/core/tasks";
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import ProposeQuestSheet from "$lib/components/ProposeQuestSheet.svelte";
  import QuestDeck from "$lib/components/QuestDeck.svelte";
  import QuestFundsSheet from "$lib/components/QuestFundsSheet.svelte";
  import QuestSheet from "$lib/components/QuestSheet.svelte";
  import { currentUser, displayName } from "$lib/auth";
  import { index } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";
  import {
    defaultQuestFunds,
    forgetNoes,
    ratingSets,
    readQuestFunds,
    readRatings,
    readSwipes,
    recordSwipe,
    saveQuestFunds,
    type QuestSwipe,
    type Swipes,
  } from "$lib/questDeck";
  import {
    eventBoard,
    isOnQuest,
    loadPotFunds,
    partyName,
    potFundList,
    questBoard,
    watchBoards,
  } from "$lib/quests";
  import { sessionKeyPub } from "$lib/sessionKey";
  import { withParam } from "$lib/urls";

  const INTRO = "flows_quests_intro";
  const VIEWS: { id: "discover" | "following"; label: MessageKey }[] = [
    { id: "discover", label: "quests.tab.discover" },
    { id: "following", label: "quests.tab.following" },
  ];
  const STATE: Record<string, MessageKey> = {
    open: "quests.state.open",
    assembled: "quests.state.assembled",
    lapsed: "quests.state.lapsed",
    done: "quests.state.done",
    cancelled: "quests.state.cancelled",
  };

  const event = eventBoard();
  // Yes and no are remembered per event, or once for all the funds.
  const scope = event ?? "funds";
  $: view =
    $page.url.searchParams.get("view") === "following"
      ? "following"
      : "discover";

  // Who I am here: a person whose key can sign, else nobody (still free to swipe).
  $: viewer = $currentUser ? String($currentUser.id) : null;
  $: party = viewer && $sessionKeyPub ? viewer : null;
  $: name = $currentUser ? displayName($currentUser) : "";

  let swipes: Swipes = { yes: [], no: [] };
  let seenFor: string | null | undefined;
  $: if (viewer !== seenFor) {
    seenFor = viewer;
    swipes = readSwipes(scope, viewer);
    chosen = readQuestFunds(viewer);
  }

  // The boards watched: one event, or the funds I follow.
  let chosen: string[] | null = null;
  // The funds one may follow: off the map when it has loaded, else off the
  // Pot's own split (its seats are the funds).
  $: directory = $index
    ? $index.graph.nodes
        .filter((n) => n.kind === "fund")
        .sort((a, z) => z.share - a.share || a.label.localeCompare(z.label))
        .map((n) => ({ id: n.id, label: n.label, weight: n.share }))
    : $potFundList;
  $: if (mounted && !$index && !event) void loadPotFunds();
  $: followed =
    chosen ??
    ($index
      ? defaultQuestFunds($index, viewer ? [viewer] : [])
      : ($potFundList ?? []).slice(0, 6).map((f) => f.id));
  $: boards = event ? [event] : followed;
  $: boardsKey = boards.join(",");
  let stopWatch: (() => void) | null = null;
  let watching = "";
  $: if (mounted && boardsKey !== watching) {
    watching = boardsKey;
    stopWatch?.();
    stopWatch = watchBoards(boards);
  }
  $: fundLabel = (id: string) =>
    $index?.byId.get(id)?.label ??
    $potFundList?.find((f) => f.id === id)?.label ??
    id;
  $: choices = boards.map((id) => ({ id, label: fundLabel(id) }));
  function setFunds(next: string[]) {
    chosen = saveQuestFunds(viewer, next);
  }
  $: rated = ratingSets(readRatings(viewer));

  $: deck = rankQuests($questBoard.quests, {
    decided: new Set([...swipes.yes, ...swipes.no]),
    liked: rated.liked,
    avoided: rated.avoided,
  });
  $: following = sortFollowed(
    $questBoard.quests.filter(
      (q) => swipes.yes.includes(q.id) || isOnQuest(q, viewer),
    ),
  );
  $: assembledCount = following.filter((q) => q.state === "assembled").length;

  let open: string | null = null;
  let proposing = false;
  let picking = false;
  let intro = true;
  let mounted = false;

  onMount(() => {
    try {
      intro = localStorage.getItem(INTRO) !== "seen";
    } catch {
      /* show it */
    }
    mounted = true;
    return () => stopWatch?.();
  });

  function dismissIntro() {
    intro = false;
    try {
      localStorage.setItem(INTRO, "seen");
    } catch {
      /* it shows again next visit */
    }
  }

  function decide(e: CustomEvent<{ id: string; swipe: QuestSwipe }>) {
    swipes = recordSwipe(scope, viewer, e.detail.id, e.detail.swipe);
    if (e.detail.swipe === "yes") open = e.detail.id;
  }
</script>

<svelte:head><title>{$t("quests.title")} · Flows</title></svelte:head>

<header class="head">
  <h1>{$t("quests.title")}</h1>
  <p class="muted">{$t("quests.lead")}</p>
</header>

{#if intro}
  <section class="card how">
    <p class="eyebrow">{$t("quests.how.title")}</p>
    <p>{$t("quests.how.body")}</p>
    <p class="links">
      <a href="/story">{$t("quests.how.more")}</a>
      <button class="link" on:click={dismissIntro}
        >{$t("quests.how.dismiss")}</button
      >
    </p>
  </section>
{/if}

{#if !event}
  <section class="funds" aria-label={$t("quests.funds.title")}>
    <p class="eyebrow">{$t("quests.funds.title")}</p>
    <div class="chips">
      {#each followed as id (id)}
        <span class="chip">
          {fundLabel(id)}
          <button
            class="x"
            on:click={() => setFunds(followed.filter((f) => f !== id))}
            aria-label={$t("quests.funds.remove", { fund: fundLabel(id) })}
            ><Icon name="close" /></button
          >
        </span>
      {/each}
      <button class="chip add" on:click={() => (picking = true)}
        ><Icon name="plus" /> {$t("quests.funds.add")}</button
      >
    </div>
  </section>
{/if}

<div class="bar">
  <div class="switch" role="group" aria-label={$t("quests.tabsLabel")}>
    {#each VIEWS as v (v.id)}
      <a
        href={withParam($page.url, "view", v.id === "discover" ? null : v.id)}
        class:on={view === v.id}
        aria-current={view === v.id ? "true" : undefined}
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        >{$t(v.label)}{#if v.id === "following" && assembledCount}<span
            class="dot">{assembledCount}</span
          >{/if}</a
      >
    {/each}
  </div>
  {#if party && boards.length}
    <button class="btn small" on:click={() => (proposing = true)}
      ><Icon name="plus" /> {$t("quests.proposeShort")}</button
    >
  {/if}
</div>

{#if !boards.length}
  <div class="card empty">
    <Icon name="sprout" />
    <p class="muted">{$t("quests.funds.none")}</p>
  </div>
{:else if !$questBoard.loaded}
  <p class="muted">{$t("quests.reading")}</p>
{:else if view === "discover"}
  {#if deck.length}
    <QuestDeck
      quests={deck}
      boardLabel={fundLabel}
      on:decide={decide}
      on:open={(e) => (open = e.detail.id)}
    />
  {:else}
    <div class="card empty">
      <Icon name="sprout" />
      <p class="muted">
        {$questBoard.quests.length
          ? $t("quests.empty")
          : $t("quests.emptyBoard")}
      </p>
      {#if swipes.no.length}
        <button
          class="btn quiet"
          on:click={() => (swipes = forgetNoes(scope, viewer))}
          >{$t("quests.again")}</button
        >
      {/if}
    </div>
  {/if}
  {#if !party}
    <p class="notice signin">
      {$t("quests.signIn")} <a href="/me">{$t("quests.signInGo")}</a>
    </p>
  {/if}
{:else if following.length}
  <ul class="list">
    {#each following as q (q.id)}
      <li
        class:quiet={q.state === "lapsed" ||
          q.state === "cancelled" ||
          q.state === "done"}
      >
        <button on:click={() => (open = q.id)}>
          <span class="top">
            <b>{q.title}</b>
            <span class="state {q.state}">{$t(STATE[q.state])}</span>
          </span>
          {#if q.state === "assembled"}
            <span class="go">{$t("quests.assembledBanner")}</span>
          {/if}
          <span class="muted small-text"
            >{#if q.board}{fundLabel(q.board)} ·
            {/if}{$t("quests.by", {
              name: partyName(q, q.proposer),
            })} ·
            {$t("quests.closeness", {
              pct: `${Math.round(q.coverage * 100)}%`,
            })} ·
            {$t("quests.inCount", { n: q.participants.length })}</span
          >
        </button>
      </li>
    {/each}
  </ul>
{:else}
  <div class="card empty">
    <Icon name="star" />
    <p class="muted">{$t("quests.followingEmpty")}</p>
  </div>
{/if}

{#if open}
  <QuestSheet
    questId={open}
    board={event ?? ""}
    boardLabel={fundLabel}
    {party}
    {name}
    on:close={() => (open = null)}
  />
{/if}
{#if proposing && party}
  <ProposeQuestSheet
    boards={choices}
    {party}
    {name}
    on:close={() => (proposing = false)}
    on:proposed={(e) => {
      swipes = recordSwipe(scope, viewer, e.detail.id, "yes");
    }}
  />
{/if}
{#if picking}
  <QuestFundsSheet
    funds={directory}
    {followed}
    on:change={(e) => setFunds(e.detail.funds)}
    on:close={() => (picking = false)}
  />
{/if}

<style>
  .head {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }
  .head h1 {
    font-size: 1.5rem;
  }
  .how {
    display: grid;
    gap: 6px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .eyebrow {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .funds {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
  }
  /* One row that scrolls sideways, so the deck stays above the fold. */
  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    margin: 0 calc(-1 * var(--gutter));
    padding: 0 var(--gutter) 2px;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 36px;
    padding: 0 6px 0 12px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 700;
  }
  .chip.add {
    padding: 0 12px;
    color: var(--teal-ink);
    border-style: dashed;
    cursor: pointer;
  }
  .x {
    border: 0;
    background: none;
    color: var(--muted);
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: 50%;
  }
  .links {
    display: flex;
    gap: 16px;
    font-weight: 700;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 700;
    color: var(--teal-ink);
    text-decoration: underline;
    cursor: pointer;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
  }
  .switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  .switch a {
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--ink-soft);
  }
  .switch a.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }
  .dot {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-size: 0.72rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .small {
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 28px 16px;
    text-align: center;
    font-size: 1.1rem;
  }
  .signin {
    margin-top: 14px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .list button {
    width: 100%;
    display: grid;
    gap: 6px;
    text-align: left;
    padding: 14px 16px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    cursor: pointer;
  }
  .list li.quiet button {
    opacity: 0.6;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .state {
    flex: none;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 800;
    background: var(--paper-deep);
    color: var(--ink-soft);
  }
  .state.assembled {
    background: var(--teal);
    color: var(--on-teal);
  }
  .state.open {
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .go {
    font-weight: 700;
    color: var(--teal-ink);
  }
  .small-text {
    font-size: 0.85rem;
  }
</style>
