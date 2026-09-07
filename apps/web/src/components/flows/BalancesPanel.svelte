<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Balances — the holon's mutual credit, read like a phone reads it.
  //
  // The expenses lens is a shared tab: whoever pays is owed a share by whoever
  // it was for. Core (`@holons/core/expenses`) turns those records into the
  // credit matrix, the pairwise debts and the fewest transfers that would
  // square everyone. This panel only asks three questions of it, in this order:
  //
  //   Where do I stand?      — the viewer's own position, first, if logged in.
  //   Where does everyone?   — one row per person, longest bar first.
  //   How do we settle?      — the plan; each line has one "paid" button.
  //
  // A settlement is written back as an expense the debtor paid for the
  // creditor alone, so it cancels through the same matrix the bot reads and
  // no surface needs to learn a new record. Every write also mirrors its REA
  // events, as the Expenses lens and the bot do.
  //
  // Units never mix: one currency at a time, chosen by the pill.

  import { createEventDispatcher } from "svelte";
  import type { HoloSphere } from "holosphere";
  import {
    computeMutualCredit,
    createExpense,
    createSettlement,
    expenseCurrency,
    isSettlement,
    coerceSplitWith,
    type CreditPair,
    type Expense,
  } from "@holons/core/expenses";
  import { REAEventFactory } from "@holons/core/rea";
  import { getEventStore } from "../../lib/rea/eventStore";
  import { notifyWriteDenied } from "../../lib/stores/writeNotifications";
  import { resolveImage } from "../../utils/imageServer";
  import PillSwitch from "./PillSwitch.svelte";
  import Sheet from "./Sheet.svelte";
  import Avatar from "./Avatar.svelte";
  import { currencyLabel, moneyFormatter, relativeDay, stampFmt } from "./format";

  export let holonId = "";
  export let holosphere: HoloSphere | null = null;
  export let expenses: Expense[] = [];
  /** Everyone who can appear in the picture. */
  export let people: { id: string; name: string }[] = [];
  /** Every currency in use, normalized. */
  export let currencies: string[] = [];
  export let currency = "";
  /** The logged-in viewer, when there is one. */
  export let selfId: string | null = null;
  /** Ask the board to show these entries in its ledger. */
  export let onShowLedger: ((query: string) => void) | null = null;

  const dispatch = createEventDispatcher<{ currency: string }>();

  const PAGE = 12;

  $: nameById = new Map(people.map((p) => [p.id, p.name]));
  const nameOf = (id: unknown) => nameById.get(String(id)) ?? String(id ?? "");
  const isMe = (id: unknown) => !!selfId && String(id) === selfId;

  /** A name, or "You" when it is the viewer's. */
  function who(id: unknown, capital = true): string {
    if (isMe(id)) return capital ? "You" : "you";
    return nameOf(id);
  }

  $: format = moneyFormatter(currency);

  $: credit = computeMutualCredit(
    expenses,
    people.map((p) => ({ id: p.id, first_name: p.name })),
    currency,
  );

  $: me = selfId ? credit.balances.find((b) => String(b.userId) === selfId) : null;
  $: myPairs = selfId
    ? credit.pairs.filter((p) => String(p.from) === selfId || String(p.to) === selfId)
    : [];

  // Longest bar first; the square ones fold into one line below.
  $: ranked = [...credit.balances].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  $: active = ranked.filter((b) => Math.abs(b.net) >= 0.005);
  $: square = ranked.filter((b) => Math.abs(b.net) < 0.005);
  $: maxAbs = active.reduce((m, b) => Math.max(m, Math.abs(b.net)), 0) || 1;
  let showSquare = false;

  // The list under it all: this currency's records, newest first.
  $: inCurrency = expenses
    .filter((e) => e && expenseCurrency(e) === currency)
    .map((e) => ({ e, ts: stamp(e) }))
    .sort((a, b) => b.ts - a.ts);
  let limit = PAGE;
  $: if (currency) limit = PAGE;
  $: visible = inCurrency.slice(0, limit);

  /** Older records carried the bot's `date` or a `timestamp`; read all three. */
  function stamp(e: any): number {
    for (const v of [e?.created, e?.timestamp, e?.date]) {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const n = Date.parse(v);
        if (!Number.isNaN(n)) return n;
        const ms = parseInt(v, 10);
        if (!Number.isNaN(ms)) return ms;
      }
    }
    return 0;
  }

  function share(e: Expense): number {
    const n = coerceSplitWith(e.splitWith).length || 1;
    return e.amount / n;
  }

  /** One line that says what a record is, without opening it. */
  function summary(e: Expense): string {
    if (isSettlement(e)) {
      const to = coerceSplitWith(e.splitWith)[0];
      return `${who(e.paidBy)} paid ${who(to, false)} back`;
    }
    const n = coerceSplitWith(e.splitWith).length;
    return `${who(e.paidBy)} paid · split ${n === 1 ? "1 way" : `${n} ways`}`;
  }

  /** The viewer's own take on a record: what it cost them, or earned them. */
  function myLine(e: Expense): { text: string; sign: "in" | "out" | "" } {
    if (!selfId) return { text: "", sign: "" };
    const split = coerceSplitWith(e.splitWith).map(String);
    const paid = isMe(e.paidBy);
    const inSplit = split.includes(selfId);
    if (isSettlement(e)) {
      if (paid) return { text: "You paid it", sign: "out" };
      if (inSplit) return { text: "Paid to you", sign: "in" };
      return { text: "", sign: "" };
    }
    if (paid && inSplit) {
      const owed = e.amount - share(e);
      return owed > 0.005
        ? { text: `You're owed ${format(owed)}`, sign: "in" }
        : { text: "Just you", sign: "" };
    }
    if (paid) return { text: `You're owed ${format(e.amount)}`, sign: "in" };
    if (inSplit) return { text: `Your share ${format(share(e))}`, sign: "out" };
    return { text: "", sign: "" };
  }

  // ---- Sheets ----------------------------------------------------------------

  let personSheet: string | null = null;
  let recordSheet: Expense | null = null;
  let settleSheet: CreditPair | null = null;
  let addSheet = false;

  $: personPairs = personSheet
    ? credit.pairs.filter(
        (p) => String(p.from) === personSheet || String(p.to) === personSheet,
      )
    : [];
  $: personBalance = personSheet
    ? (credit.balances.find((b) => String(b.userId) === personSheet)?.net ?? 0)
    : 0;

  // ---- Settling ----------------------------------------------------------------

  let settleAmount = 0;
  let busy = false;
  let error = "";

  function openSettle(pair: CreditPair) {
    settleAmount = pair.amount;
    settleSheet = pair;
    personSheet = null;
    error = "";
  }

  async function confirmSettle() {
    if (!settleSheet || !holosphere || busy) return;
    const record = createSettlement({
      id: `settlement-${Date.now()}`,
      from: String(settleSheet.from),
      to: String(settleSheet.to),
      amount: settleAmount,
      currency,
    });
    if (!record) {
      error = "Enter an amount above zero.";
      return;
    }
    await persist(record, () => (settleSheet = null));
  }

  // ---- Adding an expense --------------------------------------------------------

  let draft = {
    amount: "" as string | number,
    description: "",
    paidBy: "",
    splitWith: [] as string[],
  };

  $: draftAmount = Number(draft.amount);
  $: draftValid =
    draft.description.trim().length > 0 &&
    Number.isFinite(draftAmount) &&
    draftAmount > 0 &&
    !!draft.paidBy &&
    draft.splitWith.length > 0;
  $: everyoneIn = people.every((p) => draft.splitWith.includes(p.id));
  $: draftShare = draft.splitWith.length ? draftAmount / draft.splitWith.length : 0;

  function openAdd() {
    // "Everyone" is a shortcut: the split is spelled out as every member's id.
    const members = people.map((p) => p.id);
    draft = {
      amount: "",
      description: "",
      paidBy: selfId && nameById.has(selfId) ? selfId : (members[0] ?? ""),
      splitWith: members,
    };
    error = "";
    addSheet = true;
  }

  function toggleSplit(id: string) {
    draft.splitWith = draft.splitWith.includes(id)
      ? draft.splitWith.filter((x) => x !== id)
      : [...draft.splitWith, id];
  }

  function splitEveryone() {
    draft.splitWith = everyoneIn ? [] : people.map((p) => p.id);
  }

  async function confirmAdd() {
    if (!draftValid || !holosphere || busy) return;
    const record = createExpense({
      id: `expense-${Date.now()}`,
      amount: draftAmount,
      currency,
      description: draft.description.trim(),
      paidBy: draft.paidBy,
      splitWith: draft.splitWith,
    });
    if (!record) {
      error = "Enter an amount above zero.";
      return;
    }
    await persist(record, () => (addSheet = false));
  }

  /**
   * One write path for both kinds of record: the lens, then the REA mirror.
   * A denied write is reported the way every other lens reports it; a failed
   * REA mirror is logged, since the lens is the source of truth and the bot
   * re-derives the stream anyway.
   */
  async function persist(record: Expense, done: () => void) {
    if (!holosphere) return;
    busy = true;
    error = "";
    try {
      await holosphere.put(holonId, "expenses", record);
      try {
        const store = getEventStore(holosphere);
        const events = REAEventFactory.expenseEvents(holonId, record as any);
        await Promise.all(events.map((e) => store.put(holonId, e)));
      } catch (err: any) {
        console.warn("[flows] REA mirror failed for", record.id, err?.message ?? err);
      }
      done();
    } catch (err: any) {
      if (err?.name === "AuthorizationError") {
        notifyWriteDenied("Unable to save — no write permission for this holon");
        error = "You can't write to this holon.";
      } else {
        console.error("[flows] expense write failed", err);
        error = "Couldn't save that. Try again.";
      }
    } finally {
      busy = false;
    }
  }

  const sign = (net: number) => (net > 0.005 ? "in" : net < -0.005 ? "out" : "");
  const abs = (net: number) => format(Math.abs(net));
</script>

<section class="panel">
  <header class="head">
    <div class="titles">
      <h2>Balances</h2>
      <p class="sub">Who paid, who owes, and how to square it.</p>
    </div>
    {#if currencies.length > 1}
      <PillSwitch
        options={currencies.map((c) => ({ id: c, label: currencyLabel(c) }))}
        value={currency}
        onChange={(c) => dispatch("currency", c)}
        label="Which currency"
      />
    {/if}
  </header>

  {#if !currency}
    <p class="empty">No shared expenses yet. Add the first one below.</p>
  {:else}
    <!-- Where do I stand? -->
    {#if me}
      <div class="me card">
        <div class="me-top">
          <Avatar id={selfId ?? ""} name="You" size={44} />
          <div class="me-text">
            <div class="k">Your position</div>
            <div class="v {sign(me.net)}">
              {#if sign(me.net) === "in"}
                You're owed {abs(me.net)}
              {:else if sign(me.net) === "out"}
                You owe {abs(me.net)}
              {:else}
                You're square
              {/if}
            </div>
          </div>
        </div>
        {#if myPairs.length}
          <ul class="pairs">
            {#each myPairs as pair (`${pair.from}-${pair.to}`)}
              {@const owe = String(pair.from) === selfId}
              <li>
                <Avatar
                  id={String(owe ? pair.to : pair.from)}
                  name={nameOf(owe ? pair.to : pair.from)}
                  size={32}
                />
                <span class="pair-text">
                  {#if owe}
                    You owe <b>{nameOf(pair.to)}</b>
                  {:else}
                    <b>{nameOf(pair.from)}</b> owes you
                  {/if}
                </span>
                <span class="pair-amount {owe ? 'out' : 'in'}">{format(pair.amount)}</span>
                <button type="button" class="settle" on:click={() => openSettle(pair)}>
                  {owe ? "Pay" : "Got it"}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- Where does everyone stand? -->
    <div class="stats">
      <div class="stat">
        <span class="k">Spent</span>
        <span class="v">{format(credit.volume)}</span>
      </div>
      <div class="stat">
        <span class="k">Expenses</span>
        <span class="v">{credit.count}</span>
      </div>
      <div class="stat">
        <span class="k">Open debts</span>
        <span class="v">{credit.pairs.length}</span>
      </div>
    </div>

    {#if active.length}
      <ul class="people">
        {#each active as b (String(b.userId))}
          {@const id = String(b.userId)}
          <li>
            <button type="button" class="person" on:click={() => (personSheet = id)}>
              <Avatar {id} name={nameOf(id)} size={40} />
              <span class="person-body">
                <span class="person-name">{who(id)}</span>
                <span class="bar" aria-hidden="true">
                  <span
                    class="fill {sign(b.net)}"
                    style="width: {Math.max(4, (Math.abs(b.net) / maxAbs) * 100)}%"
                  ></span>
                </span>
              </span>
              <span class="person-amount {sign(b.net)}">
                <span class="amt">{sign(b.net) === "in" ? "+" : "−"}{abs(b.net)}</span>
                <span class="hint">{sign(b.net) === "in" ? "is owed" : "owes"}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if credit.count}
      <p class="empty">Everyone is square.</p>
    {/if}

    {#if square.length && active.length}
      <button type="button" class="link" on:click={() => (showSquare = !showSquare)}>
        {square.length}
        {square.length === 1 ? "person is" : "people are"} square
        <span aria-hidden="true">{showSquare ? "▴" : "▾"}</span>
      </button>
      {#if showSquare}
        <ul class="chips">
          {#each square as b (String(b.userId))}
            <li class="chip">
              <Avatar id={String(b.userId)} name={nameOf(b.userId)} size={22} />
              {who(b.userId)}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}

    <!-- How do we settle? -->
    {#if credit.plan.length}
      <div class="plan card">
        <div class="plan-head">
          <h3>Settle up</h3>
          <p class="sub">
            {credit.plan.length === 1
              ? "One transfer squares everyone."
              : `${credit.plan.length} transfers square everyone.`}
          </p>
        </div>
        <ul class="pairs">
          {#each credit.plan as pair (`${pair.from}-${pair.to}`)}
            <li>
              <Avatar id={String(pair.from)} name={nameOf(pair.from)} size={32} />
              <span class="pair-text">
                <b>{who(pair.from)}</b> → <b>{who(pair.to)}</b>
              </span>
              <span class="pair-amount">{format(pair.amount)}</span>
              <button type="button" class="settle" on:click={() => openSettle(pair)}>
                Paid
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- The records -->
    {#if inCurrency.length}
      <div class="list-head">
        <h3>Recent</h3>
        {#if onShowLedger}
          <button type="button" class="link" on:click={() => onShowLedger?.("")}>
            Open the ledger
          </button>
        {/if}
      </div>
      <ul class="records">
        {#each visible as { e, ts } (String(e.id))}
          {@const mine = myLine(e)}
          <li>
            <button type="button" class="record" class:settlement={isSettlement(e)} on:click={() => (recordSheet = e)}>
              <Avatar id={String(e.paidBy)} name={nameOf(e.paidBy)} size={40} />
              <span class="record-body">
                <span class="record-title">{e.description || (isSettlement(e) ? "Settled up" : "Expense")}</span>
                <span class="record-meta">{summary(e)} · {relativeDay(ts)}</span>
              </span>
              <span class="record-amount">
                <span class="amt">{format(e.amount)}</span>
                {#if mine.text}
                  <span class="hint {mine.sign}">{mine.text}</span>
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if inCurrency.length > visible.length}
        <button type="button" class="more" on:click={() => (limit += PAGE)}>
          Show {Math.min(PAGE, inCurrency.length - visible.length)} more
        </button>
      {/if}
    {/if}
  {/if}
</section>

<!-- One thumb-reach button to add a record. -->
{#if holosphere}
  <button type="button" class="fab" on:click={openAdd} aria-label="Add an expense">
    <span aria-hidden="true">+</span>
  </button>
{/if}

{#if personSheet}
  {@const pid = personSheet}
  <Sheet title={who(pid)} on:close={() => (personSheet = null)}>
    <div class="sheet-lead">
      <Avatar id={pid} name={nameOf(pid)} size={56} />
      <div>
        <div class="k">Net position</div>
        <div class="v {sign(personBalance)}">
          {#if sign(personBalance) === "in"}
            Is owed {abs(personBalance)}
          {:else if sign(personBalance) === "out"}
            Owes {abs(personBalance)}
          {:else}
            Square
          {/if}
        </div>
      </div>
    </div>
    {#if personPairs.length}
      <ul class="pairs">
        {#each personPairs as pair (`${pair.from}-${pair.to}`)}
          {@const owes = String(pair.from) === pid}
          {@const other = String(owes ? pair.to : pair.from)}
          <li>
            <Avatar id={other} name={nameOf(other)} size={32} />
            <span class="pair-text">
              {#if owes}
                Owes <b>{who(other)}</b>
              {:else}
                <b>{who(other)}</b> owes {who(pid, false) === "you" ? "you" : "them"}
              {/if}
            </span>
            <span class="pair-amount {owes ? 'out' : 'in'}">{format(pair.amount)}</span>
            <button type="button" class="settle" on:click={() => openSettle(pair)}>Paid</button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty">Nothing open.</p>
    {/if}
    {#if onShowLedger}
      <button
        type="button"
        class="link"
        on:click={() => {
          personSheet = null;
          onShowLedger?.(nameOf(pid));
        }}
      >
        See every entry with {who(pid, false)}
      </button>
    {/if}
  </Sheet>
{/if}

{#if recordSheet}
  {@const e = recordSheet}
  <Sheet
    title={e.description || (isSettlement(e) ? "Settled up" : "Expense")}
    on:close={() => (recordSheet = null)}
  >
    <p class="big">{format(e.amount)}</p>
    <p class="sub">{stampFmt.format(stamp(e))}</p>
    {#if e.picture}
      <img class="receipt" src={resolveImage(e.picture)} alt="Receipt" loading="lazy" />
    {/if}
    <dl class="rows">
      <div class="row">
        <dt>{isSettlement(e) ? "Paid by" : "Paid by"}</dt>
        <dd class="with-face">
          <Avatar id={String(e.paidBy)} name={nameOf(e.paidBy)} size={24} />
          {who(e.paidBy)}
        </dd>
      </div>
      <div class="row">
        <dt>{isSettlement(e) ? "Paid to" : "Split with"}</dt>
        <dd>
          <ul class="chips">
            {#each coerceSplitWith(e.splitWith) as id (String(id))}
              <li class="chip">
                <Avatar id={String(id)} name={nameOf(id)} size={22} />
                {who(id)}
              </li>
            {/each}
          </ul>
        </dd>
      </div>
      {#if !isSettlement(e)}
        <div class="row">
          <dt>Each share</dt>
          <dd>{format(share(e))}</dd>
        </div>
      {/if}
      {#if (e as any)._federation?.sourceHolonId || (e as any)._federation?.sourceHolon}
        <div class="row">
          <dt>From</dt>
          <dd>⇄ {nameOf((e as any)._federation.sourceHolonId ?? (e as any)._federation.sourceHolon)}</dd>
        </div>
      {/if}
    </dl>
  </Sheet>
{/if}

{#if settleSheet}
  {@const pair = settleSheet}
  <Sheet title="Settle up" on:close={() => (settleSheet = null)}>
    <p class="sub">
      Record that <b>{who(pair.from)}</b> paid <b>{who(pair.to, false)}</b> back.
      The amount is what's owed; change it for a partial payment.
    </p>
    <label class="amount-field">
      <span class="k">Amount · {currencyLabel(currency)}</span>
      <input
        type="number"
        inputmode="decimal"
        min="0"
        step="0.01"
        bind:value={settleAmount}
      />
    </label>
    {#if error}<p class="error">{error}</p>{/if}
    <svelte:fragment slot="actions">
      <button type="button" class="ghost" on:click={() => (settleSheet = null)}>Cancel</button>
      <button type="button" class="primary" disabled={busy || !(settleAmount > 0)} on:click={confirmSettle}>
        {busy ? "Saving…" : "Mark as paid"}
      </button>
    </svelte:fragment>
  </Sheet>
{/if}

{#if addSheet}
  <Sheet title="New expense" on:close={() => (addSheet = false)}>
    <label class="amount-field">
      <span class="k">Amount · {currencyLabel(currency || "usd")}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="number"
        inputmode="decimal"
        min="0"
        step="0.01"
        placeholder="0.00"
        bind:value={draft.amount}
        autofocus
      />
    </label>
    <label class="text-field">
      <span class="k">What for</span>
      <input type="text" placeholder="Groceries, fuel, the venue…" bind:value={draft.description} />
    </label>

    <div class="k field-label">Paid by</div>
    <ul class="picks" role="radiogroup" aria-label="Paid by">
      {#each people as p (p.id)}
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={draft.paidBy === p.id}
            class="pick"
            class:on={draft.paidBy === p.id}
            on:click={() => (draft.paidBy = p.id)}
          >
            <Avatar id={p.id} name={p.name} size={24} />
            {who(p.id)}
          </button>
        </li>
      {/each}
    </ul>

    <div class="field-row">
      <div class="k field-label">Split with</div>
      <button type="button" class="link" on:click={splitEveryone}>
        {everyoneIn ? "Nobody" : "Everyone"}
      </button>
    </div>
    <ul class="picks" aria-label="Split with">
      {#each people as p (p.id)}
        <li>
          <button
            type="button"
            role="checkbox"
            aria-checked={draft.splitWith.includes(p.id)}
            class="pick"
            class:on={draft.splitWith.includes(p.id)}
            on:click={() => toggleSplit(p.id)}
          >
            <Avatar id={p.id} name={p.name} size={24} />
            {who(p.id)}
          </button>
        </li>
      {/each}
    </ul>
    {#if draftShare > 0}
      <p class="sub">{format(draftShare)} each, {draft.splitWith.length} {draft.splitWith.length === 1 ? "way" : "ways"}.</p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}

    <svelte:fragment slot="actions">
      <button type="button" class="ghost" on:click={() => (addSheet = false)}>Cancel</button>
      <button type="button" class="primary" disabled={busy || !draftValid} on:click={confirmAdd}>
        {busy ? "Saving…" : "Add expense"}
      </button>
    </svelte:fragment>
  </Sheet>
{/if}

<style>
  .panel {
    animation: flows-rise 0.42s ease both;
    padding-bottom: 5rem; /* room for the FAB */
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.8rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .k {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
  }

  .v {
    font-size: 1.3rem;
    color: var(--color-text-primary);
  }

  .in {
    color: #5eead4;
  }

  .out {
    color: #fca5a5;
  }

  .card {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 18px;
    padding: 0.9rem 1rem;
    margin-bottom: 1rem;
  }

  .me-top {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1.4rem;
    margin: 0.2rem 0 0.9rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .pairs {
    list-style: none;
    margin: 0.7rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }

  .pairs li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 2.75rem;
  }

  .pair-text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pair-text b {
    color: var(--color-text-primary);
    font-weight: 600;
  }

  .pair-amount {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-weight: 600;
  }

  .settle {
    min-height: 2.5rem;
    padding: 0 0.85rem;
    border-radius: 999px;
    background: rgba(15, 118, 110, 0.18);
    color: #5eead4;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    touch-action: manipulation;
  }

  .settle:active {
    transform: scale(0.94);
  }

  .people,
  .records {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .person,
  .record {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 3.6rem;
    padding: 0.55rem 0.7rem;
    border-radius: 14px;
    background: var(--color-bg-secondary);
    border: 1.5px solid var(--color-border);
    text-align: left;
    touch-action: manipulation;
    transition:
      transform 0.1s ease,
      border-color 0.2s ease;
  }

  .person:active,
  .record:active {
    transform: scale(0.985);
  }

  .record.settlement {
    border-style: dashed;
  }

  .person-body,
  .record-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .person-name,
  .record-title {
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .record-meta {
    font-size: 0.78rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: block;
    height: 0.4rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .fill.in {
    background: #2dd4bf;
  }

  .fill.out {
    background: #f87171;
  }

  .person-amount,
  .record-amount {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    white-space: nowrap;
  }

  .amt {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .hint.in {
    color: #5eead4;
  }

  .hint.out {
    color: #fca5a5;
  }

  .plan {
    margin-top: 1rem;
  }

  .list-head,
  .field-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 1.2rem 0 0.5rem;
  }

  .link {
    color: #5eead4;
    font-size: 0.82rem;
    text-decoration: underline;
    min-height: 2.5rem;
    padding: 0 0.2rem;
  }

  .chips,
  .picks {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip,
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.25rem;
    padding: 0 0.7rem 0 0.35rem;
    border-radius: 999px;
    background: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .pick {
    min-height: 2.75rem;
    border: 1.5px solid transparent;
    touch-action: manipulation;
  }

  .pick.on {
    background: rgba(15, 118, 110, 0.22);
    border-color: #0f766e;
    color: #f0fdfa;
  }

  .more {
    margin-top: 0.7rem;
    width: 100%;
    min-height: 2.75rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .empty {
    color: var(--color-text-muted);
    text-align: center;
    padding: 1.6rem 1rem;
  }

  .error {
    color: #fca5a5;
    font-size: 0.85rem;
    margin: 0.6rem 0 0;
  }

  .fab {
    position: fixed;
    right: calc(1.1rem + env(safe-area-inset-right));
    bottom: calc(1.3rem + env(safe-area-inset-bottom));
    z-index: 40;
    width: 3.6rem;
    height: 3.6rem;
    border-radius: 50%;
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
    font-size: 2rem;
    line-height: 1;
    display: grid;
    place-items: center;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .fab:active {
    transform: scale(0.92);
  }

  /* Sheet content */
  .sheet-lead {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    margin-bottom: 0.4rem;
  }

  .big {
    margin: 0;
    font-size: 1.8rem;
    color: #5eead4;
  }

  .receipt {
    display: block;
    width: 100%;
    max-height: 40vh;
    object-fit: contain;
    border-radius: 12px;
    margin: 0.8rem 0;
    background: rgba(0, 0, 0, 0.25);
  }

  .rows {
    margin: 0.8rem 0 0;
    display: grid;
    gap: 0.6rem;
  }

  .row {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 0.92rem;
  }

  .row dt {
    color: var(--color-text-muted);
    flex: 0 0 auto;
  }

  .row dd {
    margin: 0;
    color: var(--color-text-primary);
    text-align: right;
  }

  .row dd .chips {
    justify-content: flex-end;
    margin: 0;
  }

  .with-face {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .amount-field,
  .text-field {
    display: block;
    margin-bottom: 0.9rem;
  }

  .amount-field input,
  .text-field input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-border);
    border-radius: 14px;
    color: var(--color-text-primary);
    padding: 0.7rem 0.9rem;
    font-size: 1rem;
    min-height: 3rem;
  }

  .amount-field input {
    font-size: 1.8rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .amount-field input:focus,
  .text-field input:focus {
    outline: none;
    border-color: #0f766e;
  }

  .field-label {
    margin-top: 0.4rem;
  }

  @keyframes flows-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
