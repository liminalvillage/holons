<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A quest after a yes: what it needs and how much of each is covered, who
  // is in, and the time box — then what I can do about it. Join (in, or
  // just curious), pledge to cover a need, add a need nobody listed. Who
  // proposed it closes it; once done, I say privately whether I'd work with
  // each of them again, which only ever shapes my own deck.
  import {
    PEOPLE_UNIT,
    needRemaining,
    questStanding,
    type BoardQuest,
    type QuestNeed,
  } from "@holons/core/tasks";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import { t, type MessageKey } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import {
    addNeed,
    close,
    join,
    leave,
    partyName,
    pledge,
    questBoard,
    unpledge,
  } from "$lib/quests";
  import { rate, readRatings, type Rating } from "$lib/questDeck";

  export let questId: string;
  /** Where to write when the quest names no board (an event's single board). */
  export let board = "";
  /** A board's name as people read it (a fund's label). */
  export let boardLabel: (id: string) => string = (id) => id;
  /** The signed-in person, when their key can sign. */
  export let party: string | null;
  export let name = "";

  const dispatch = createEventDispatcher<{ close: void }>();

  const STATE: Record<BoardQuest["state"], MessageKey> = {
    open: "quests.state.open",
    assembled: "quests.state.assembled",
    lapsed: "quests.state.lapsed",
    done: "quests.state.done",
    cancelled: "quests.state.cancelled",
  };

  $: q = $questBoard.byId[questId] ?? null;
  // A quest is written where it is filed: its fund's board.
  $: target = q?.board ?? board;
  $: mine = q && party ? questStanding(q, party) : null;
  $: live = q?.state === "open" || q?.state === "assembled";
  $: canAct = !!party && live;

  let busy = false;
  let error = "";
  let pledging: QuestNeed | null = null;
  let quantity = "";
  let note = "";
  let adding = false;
  let needLabel = "";
  let needQuantity = "1";
  let needUnit = "";
  let ratings: Record<string, Rating> = readRatings(party);

  async function act(run: () => Promise<unknown>, done?: MessageKey) {
    busy = true;
    error = "";
    try {
      await run();
      if (done) showNotice($t(done));
      return true;
    } catch {
      error = $t("quests.failed");
      return false;
    } finally {
      busy = false;
    }
  }

  const doJoin = (level: "in" | "curious") =>
    party &&
    act(
      () => join(target, questId, party!, level, name || undefined),
      level === "in" ? "quests.joined" : undefined,
    );
  const doLeave = () => party && act(() => leave(target, questId, party!));

  function startPledge(n: QuestNeed) {
    pledging = n;
    quantity = String(needRemaining(n) || 1);
    note = "";
  }
  async function sendPledge() {
    if (!party || !pledging) return;
    const amount = Number(quantity);
    if (!(amount > 0)) return;
    const need = pledging.id;
    if (
      await act(
        () =>
          pledge(target, {
            quest: questId,
            need,
            party: party!,
            quantity: amount,
            note: note.trim() || undefined,
            name: name || undefined,
          }),
        "quests.pledged",
      )
    )
      pledging = null;
  }
  async function sendNeed() {
    if (!party) return;
    const amount = Number(needQuantity);
    if (!needLabel.trim() || !(amount > 0)) return;
    if (
      await act(() =>
        addNeed(target, {
          quest: questId,
          party: party!,
          label: needLabel.trim(),
          quantity: amount,
          unit: needUnit.trim() || undefined,
        }),
      )
    ) {
      adding = false;
      needLabel = "";
      needQuantity = "1";
      needUnit = "";
    }
  }
  const doClose = (outcome: "done" | "cancelled") =>
    party &&
    act(() => close(target, questId, party!, outcome), "quests.closed");

  function setRating(who: string, r: Rating) {
    ratings = rate(party, who, ratings[who] === r ? null : r);
  }

  const unitOf = (n: QuestNeed) =>
    n.unit === PEOPLE_UNIT ? $t("quests.unit.people") : (n.unit ?? "");
  const pctOf = (n: QuestNeed) => Math.round((n.covered / n.quantity) * 100);
  $: others = q
    ? [
        ...new Set([q.proposer, ...q.participants.map((p) => String(p.id))]),
      ].filter((p) => p !== party)
    : [];
</script>

<BottomSheet
  title={q?.title ?? $t("quests.title")}
  on:close={() => dispatch("close")}
>
  {#if !q}
    <p class="muted">{$t("quests.reading")}</p>
  {:else}
    <p class="meta">
      <span class="state {q.state}">{$t(STATE[q.state])}</span>
      <span class="muted"
        >{#if q.board}{$t("quests.in", { fund: boardLabel(q.board) })} ·
        {/if}{$t("quests.by", { name: partyName(q, q.proposer) })} ·
        {$t("quests.until", {
          date: new Date(q.until).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        })}</span
      >
    </p>
    {#if q.state === "assembled"}
      <p class="notice">{$t("quests.assembledBanner")}</p>
    {:else if q.state === "lapsed"}
      <p class="notice warn">{$t("quests.lapsedNote")}</p>
    {/if}
    {#if q.description}<p class="desc">{q.description}</p>{/if}

    <h3 class="section-title">{$t("quests.needs")}</h3>
    <ul class="needs">
      {#each q.needs as n (n.id)}
        <li>
          <div class="row">
            <b>{n.label}</b>
            <span class="muted"
              >{$t("quests.need.covered", {
                covered: n.covered,
                quantity: `${n.quantity}${unitOf(n) ? ` ${unitOf(n)}` : ""}`,
              })}</span
            >
          </div>
          <div class="bar" aria-hidden="true">
            <i style:width="{pctOf(n)}%"></i>
          </div>
          {#if n.unit === PEOPLE_UNIT}
            {#if canAct && mine?.level !== "in"}
              <p class="hint muted">{$t("quests.headcountHint")}</p>
            {/if}
          {:else if canAct && needRemaining(n) > 0 && pledging?.id !== n.id}
            <button
              class="btn quiet small"
              on:click={() => startPledge(n)}
              disabled={busy}>{$t("quests.pledge")}</button
            >
          {/if}
          {#if pledging?.id === n.id}
            <form class="inline" on:submit|preventDefault={sendPledge}>
              <label class="field">
                <span>{$t("quests.pledgeQuantity")}</span>
                <input
                  bind:value={quantity}
                  type="number"
                  inputmode="decimal"
                  min="0.01"
                  step="any"
                />
              </label>
              <label class="field">
                <span>{$t("quests.pledgeNote")}</span>
                <input bind:value={note} maxlength="300" />
              </label>
              <div class="pair">
                <button
                  class="btn quiet"
                  type="button"
                  on:click={() => (pledging = null)}
                  >{$t("quests.cancel")}</button
                >
                <button
                  class="btn"
                  type="submit"
                  disabled={busy || !(Number(quantity) > 0)}
                  >{$t("quests.pledgeSend")}</button
                >
              </div>
            </form>
          {/if}
          {#each mine?.pledges.filter((p) => p.need === n.id) ?? [] as p (p.id)}
            <p class="mine">
              {$t("quests.yourPledge", {
                amount: `${p.quantity}${unitOf(n) ? ` ${unitOf(n)}` : ""}`,
              })}
              {#if p.note}— {p.note}{/if}
              {#if canAct}
                <button
                  class="link"
                  on:click={() =>
                    party && act(() => unpledge(target, questId, p.id, party))}
                  disabled={busy}>{$t("quests.unpledge")}</button
                >
              {/if}
            </p>
          {/each}
        </li>
      {/each}
    </ul>

    {#if canAct}
      {#if adding}
        <form class="inline" on:submit|preventDefault={sendNeed}>
          <p class="muted">{$t("quests.addNeedHint")}</p>
          <label class="field">
            <span>{$t("quests.needLabel")}</span>
            <input bind:value={needLabel} maxlength="120" />
          </label>
          <div class="pair">
            <label class="field">
              <span>{$t("quests.needQuantity")}</span>
              <input
                bind:value={needQuantity}
                type="number"
                inputmode="decimal"
                min="0.01"
                step="any"
              />
            </label>
            <label class="field">
              <span>{$t("quests.needUnit")}</span>
              <input bind:value={needUnit} maxlength="24" />
            </label>
          </div>
          <div class="pair">
            <button
              class="btn quiet"
              type="button"
              on:click={() => (adding = false)}>{$t("quests.cancel")}</button
            >
            <button
              class="btn"
              type="submit"
              disabled={busy || !needLabel.trim()}
              >{$t("quests.needAdd")}</button
            >
          </div>
        </form>
      {:else}
        <button class="btn quiet wide" on:click={() => (adding = true)}
          >{$t("quests.addNeed")}</button
        >
      {/if}
    {/if}

    {#if q.yields?.length}
      <h3 class="section-title">{$t("quests.yields")}</h3>
      <ul class="yields">
        {#each q.yields as y, i (i)}
          <li>
            <b>{y.label}</b>{#if y.quantity}<span class="muted">
                {y.quantity}{y.unit ? ` ${y.unit}` : ""}</span
              >{/if}
          </li>
        {/each}
      </ul>
    {/if}

    <h3 class="section-title">{$t("quests.people")}</h3>
    {#if q.participants.length}
      <p class="names">
        {q.participants.map((p) => partyName(q, String(p.id))).join(", ")}
      </p>
    {:else}
      <p class="muted">{$t("quests.nobody")}</p>
    {/if}
    {#if q.curious.length}
      <p class="muted">
        {$t("quests.curious")}: {q.curious
          .map((p) => partyName(q, p))
          .join(", ")}
      </p>
    {/if}

    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}

    {#if !party}
      <p class="notice">{$t("quests.signIn")}</p>
      <a class="btn wide" href="/me">{$t("quests.signInGo")}</a>
    {:else if live}
      {#if mine?.proposer}<p class="muted">{$t("quests.proposedByYou")}</p>{/if}
      <div class="pair">
        {#if mine?.level === "in"}
          <button class="btn quiet" on:click={doLeave} disabled={busy}
            >{$t("quests.leave")}</button
          >
          <button class="btn" disabled>{$t("quests.youAreIn")}</button>
        {:else}
          <button
            class="btn quiet"
            on:click={() =>
              mine?.level === "curious" ? doLeave() : doJoin("curious")}
            disabled={busy}
            >{mine?.level === "curious"
              ? $t("quests.leave")
              : $t("quests.imCurious")}</button
          >
          <button class="btn" on:click={() => doJoin("in")} disabled={busy}
            >{$t("quests.imIn")}</button
          >
        {/if}
      </div>
      {#if mine?.proposer}
        <div class="pair">
          <button
            class="btn quiet"
            on:click={() => doClose("cancelled")}
            disabled={busy}>{$t("quests.closeCancel")}</button
          >
          <button
            class="btn quiet"
            on:click={() => doClose("done")}
            disabled={busy}>{$t("quests.closeDone")}</button
          >
        </div>
      {/if}
    {/if}

    {#if q.state === "done" && party && (mine?.level === "in" || mine?.proposer) && others.length}
      <h3 class="section-title">{$t("quests.rateTitle")}</h3>
      <p class="muted">{$t("quests.ratePrivate")}</p>
      <ul class="rate">
        {#each others as who (who)}
          <li>
            <span>{partyName(q, who)}</span>
            <span class="choices">
              <button
                class="chip"
                class:on={ratings[who] === "again"}
                on:click={() => setRating(who, "again")}
                >{$t("quests.rateAgain")}</button
              >
              <button
                class="chip"
                class:on={ratings[who] === "not"}
                on:click={() => setRating(who, "not")}
                >{$t("quests.rateNot")}</button
              >
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</BottomSheet>

<style>
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .state {
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.78rem;
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
  .desc {
    margin-bottom: 12px;
    color: var(--ink-soft);
  }
  .notice {
    margin-bottom: 12px;
  }
  .section-title {
    margin: 18px 0 8px;
  }
  .needs {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: grid;
    gap: 14px;
  }
  .needs li {
    display: grid;
    gap: 6px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--teal-wash);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--teal);
  }
  .hint {
    font-size: 0.85rem;
  }
  .small {
    justify-self: start;
    min-height: 36px;
    padding: 0 14px;
  }
  .mine {
    font-size: 0.9rem;
  }
  .link {
    border: 0;
    background: none;
    color: var(--teal-ink);
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
    padding: 0 4px;
  }
  .inline {
    display: grid;
    gap: 4px;
    padding: 12px;
    border-radius: 12px;
    background: var(--paper);
    border: 1px solid var(--line);
    margin-bottom: 12px;
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 6px 0;
  }
  .field span {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  input {
    width: 100%;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
  }
  .wide {
    width: 100%;
  }
  .yields {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .yields li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .names {
    font-weight: 600;
  }
  .rate {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .rate li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .choices {
    display: inline-flex;
    gap: 6px;
  }
  .chip {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .chip.on {
    background: var(--teal-wash);
    border-color: var(--teal);
    color: var(--teal-ink);
  }
</style>
