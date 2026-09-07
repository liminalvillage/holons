<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The Flows board's Balances layout: the holon's mutual credit, read the
  // way a phone reads it.
  //
  // The expenses lens is a shared tab — whoever pays is owed a share by
  // whoever it was for. Core (`@holons/core/expenses`) turns those records
  // into the credit matrix, the pairwise debts and the fewest transfers that
  // square everyone. This view asks it three things, in this order:
  //
  //   Where do I stand?      the viewer's own position first, when logged in.
  //   Where does everyone?   one row per person, longest bar first.
  //   How do we settle?      the plan; each line has one "paid" button.
  //
  // A settlement is written back as an expense the debtor paid for the
  // creditor alone, so it cancels through the same matrix the bot's /balance
  // reads and no surface needs a new record. Every write also mirrors its REA
  // events, as the bot and the dashboard do, through the same `getReaStore`
  // the task completion flow uses — so the acting identity is the logged-in
  // user, signed by the device key.
  //
  // Units never mix: one currency at a time, chosen by the pill. Data is the
  // parent FlowsView's; this only renders and writes.
  //
  // `mine` is the "My balance" view: the viewer's card, their debts with a
  // way to settle each, and the records they are part of — nothing about
  // anyone else. Without it, "All balances": everyone's position, the
  // settle-up plan and every record.

  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { rotationHold } from "$lib/stores";
  import { currentUser, loginOpen } from "$lib/auth";
  import { t, locale } from "$lib/i18n";
  import { getReaStore } from "$lib/holosphere";
  import { resolveImage } from "$lib/image";
  import {
    coerceSplitWith,
    computeMutualCredit,
    createExpense,
    createSettlement,
    expenseCurrency,
    isSettlement,
    normalizeCurrency,
    type CreditPair,
    type Expense,
  } from "@holons/core/expenses";
  import { REAEventFactory } from "@holons/core/rea";
  import PillSwitch from "$lib/components/PillSwitch.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import {
    avatarInitial,
    avatarUrl,
    hideImg,
    showImg,
  } from "$lib/components/Avatars.svelte";

  export let holonId = "";
  export let expenses: Expense[] = [];
  /** Everyone who can appear in the picture. */
  export let people: { id: string; name: string }[] = [];
  /** Every currency in use, normalized. */
  export let currencies: string[] = [];
  export let currency = "";
  export let onCurrency: (c: string) => void = () => {};
  /** The viewer's own tab only (the "My balance" view). */
  export let mine = false;
  /**
   * The Show pill's Personal scope: keep everyone's numbers (a balance is
   * computed over the whole tab, not a slice of it) but list only the rows,
   * transfers and records the viewer is part of.
   */
  export let filterMine = false;

  const PAGE = 10;

  $: selfId = $currentUser ? String($currentUser.id) : null;
  $: nameById = new Map(people.map((p) => [p.id, p.name]));
  // Reactive closures, so a late-arriving name re-labels the rows in place.
  $: nameOf = (id: unknown) => nameById.get(String(id)) ?? String(id ?? "");
  $: isMe = (id: unknown) => !!selfId && String(id) === selfId;
  /** A name, or "You" for the viewer. */
  $: who = (id: unknown) => (isMe(id) ? $t("balances.you") : nameOf(id));

  // Money in this currency, cents included. Real ISO codes get the locale's
  // currency form; a holon's own scrip is a plain number plus its unit.
  $: format = (() => {
    const code = currency.toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      try {
        const nf = new Intl.NumberFormat($locale, {
          style: "currency",
          currency: code,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return (v: number) => nf.format(v);
      } catch {
        // Not a currency Intl knows — fall through.
      }
    }
    const nf = new Intl.NumberFormat($locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (v: number) => `${nf.format(v)} ${currency}`;
  })();

  $: credit = computeMutualCredit(
    expenses,
    people.map((p) => ({ id: p.id, first_name: p.name })),
    currency,
  );

  $: me = selfId
    ? credit.balances.find((b) => String(b.userId) === selfId)
    : null;
  $: myPairs = selfId
    ? credit.pairs.filter(
        (p) => String(p.from) === selfId || String(p.to) === selfId,
      )
    : [];

  // Longest bar first; the square ones fold into one line below.
  $: ranked = [...credit.balances].sort(
    (a, b) => Math.abs(b.net) - Math.abs(a.net),
  );
  $: active = ranked
    .filter((b) => Math.abs(b.net) >= 0.005)
    .filter((b) => !filterMine || isMe(b.userId));
  $: plan = credit.plan.filter(
    (p) => !filterMine || isMe(p.from) || isMe(p.to),
  );
  $: square = ranked.filter((b) => Math.abs(b.net) < 0.005);
  $: maxAbs = active.reduce((m, b) => Math.max(m, Math.abs(b.net)), 0) || 1;
  let showSquare = false;

  // The list under it all: this currency's records, newest first.
  $: inCurrency = expenses
    .filter((e) => e && expenseCurrency(e) === currency)
    .filter((e) => !(mine || filterMine) || involvesMe(e))
    .map((e) => ({ e, ts: stamp(e) }))
    .sort((a, b) => b.ts - a.ts);

  let limit = PAGE;
  $: if (currency) limit = PAGE;
  $: visible = inCurrency.slice(0, limit);

  /** Paid by the viewer, or shared with them. */
  function involvesMe(e: Expense): boolean {
    if (!selfId) return false;
    if (isMe(e.paidBy)) return true;
    return coerceSplitWith(e.splitWith).map(String).includes(selfId);
  }

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

  $: dateFmt = new Intl.DateTimeFormat($locale, { dateStyle: "medium" });
  $: stampFmt = new Intl.DateTimeFormat($locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  function share(e: Expense): number {
    const n = coerceSplitWith(e.splitWith).length || 1;
    return e.amount / n;
  }

  /** One line that says what a record is, without opening it. */
  function summary(e: Expense): string {
    if (isSettlement(e)) {
      const to = coerceSplitWith(e.splitWith)[0];
      return $t("balances.paidBack", { from: who(e.paidBy), to: who(to) });
    }
    const n = coerceSplitWith(e.splitWith).length;
    return $t("balances.paidSplit", { name: who(e.paidBy), n });
  }

  /** The viewer's own take on a record: what it cost them, or earned them. */
  function myLine(e: Expense): { text: string; sign: "in" | "out" | "" } {
    if (!selfId) return { text: "", sign: "" };
    const split = coerceSplitWith(e.splitWith).map(String);
    const paid = isMe(e.paidBy);
    const inSplit = split.includes(selfId);
    if (isSettlement(e)) {
      if (paid) return { text: $t("balances.youPaidIt"), sign: "out" };
      if (inSplit) return { text: $t("balances.paidToYou"), sign: "in" };
      return { text: "", sign: "" };
    }
    if (paid && inSplit) {
      const owed = e.amount - share(e);
      return owed > 0.005
        ? { text: $t("balances.youOwed", { amount: format(owed) }), sign: "in" }
        : { text: $t("balances.justYou"), sign: "" };
    }
    if (paid)
      return {
        text: $t("balances.youOwed", { amount: format(e.amount) }),
        sign: "in",
      };
    if (inSplit)
      return {
        text: $t("balances.yourShare", { amount: format(share(e)) }),
        sign: "out",
      };
    return { text: "", sign: "" };
  }

  const sign = (net: number) =>
    net > 0.005 ? "in" : net < -0.005 ? "out" : "";
  const abs = (net: number) => format(Math.abs(net));

  // ── Modals ───────────────────────────────────────────────────────────────

  let personSheet: string | null = null;
  let recordSheet: Expense | null = null;
  let settleSheet: CreditPair | null = null;
  let addSheet = false;

  // Suspend auto-rotation while a card is forward so the screen cannot flip
  // away mid-read (same rule as every kiosk modal).
  $: rotationHold.set(
    personSheet != null ||
      recordSheet != null ||
      settleSheet != null ||
      addSheet,
  );
  onDestroy(() => rotationHold.set(false));

  $: personPairs = personSheet
    ? credit.pairs.filter(
        (p) => String(p.from) === personSheet || String(p.to) === personSheet,
      )
    : [];
  $: personBalance = personSheet
    ? (credit.balances.find((b) => String(b.userId) === personSheet)?.net ?? 0)
    : 0;

  // Hover on a person's row answers in place — their debts, one line each —
  // the way the Sankey's bars do. Tap opens the sheet, which clears it, so
  // a touch screen's emulated hover cannot leave it standing behind.
  let hoverId: string | null = null;
  $: hoverPairs = hoverId
    ? credit.pairs.filter(
        (p) => String(p.from) === hoverId || String(p.to) === hoverId,
      )
    : [];
  function openPerson(id: string) {
    hoverId = null;
    personSheet = id;
  }

  /** Every write starts here: not logged in → the login card, nothing else. */
  function requireLogin(): boolean {
    if (get(currentUser)) return true;
    loginOpen.set(true);
    return false;
  }

  // ── Settling ─────────────────────────────────────────────────────────────

  let settleAmount = 0;
  let busy = false;
  let error = "";

  function openSettle(pair: CreditPair) {
    if (!requireLogin()) return;
    settleAmount = pair.amount;
    settleSheet = pair;
    personSheet = null;
    error = "";
  }

  async function confirmSettle() {
    if (!settleSheet || busy) return;
    const record = createSettlement({
      id: `settlement-${Date.now()}`,
      from: String(settleSheet.from),
      to: String(settleSheet.to),
      amount: settleAmount,
      currency,
    });
    if (!record) {
      error = $t("balances.errAmount");
      return;
    }
    await persist(record, () => (settleSheet = null));
  }

  // ── Adding an expense ────────────────────────────────────────────────────

  let draft = {
    amount: "" as string | number,
    description: "",
    paidBy: "",
    splitWith: [] as string[],
    currency: "",
  };
  // "Other…" reveals a free-text code; it is normalized the way the bot
  // normalizes (lowercase, singular, letters only) so "Euros" and "eur" meet.
  let otherCurrency = "";
  let pickingOther = false;
  $: draftCurrency = pickingOther
    ? normalizeCurrency(otherCurrency)
    : draft.currency;

  $: draftAmount = Number(draft.amount);
  $: draftValid =
    draft.description.trim().length > 0 &&
    Number.isFinite(draftAmount) &&
    draftAmount > 0 &&
    !!draftCurrency &&
    !!draft.paidBy &&
    draft.splitWith.length > 0;
  // "Everyone" is a shortcut: the split is spelled out as every member's id.
  $: members = people.map((p) => p.id);
  $: everyoneIn = members.every((id) => draft.splitWith.includes(id));
  $: draftShare = draft.splitWith.length
    ? draftAmount / draft.splitWith.length
    : 0;

  function openAdd() {
    if (!requireLogin()) return;
    draft = {
      amount: "",
      description: "",
      paidBy: selfId && nameById.has(selfId) ? selfId : (members[0] ?? ""),
      splitWith: members,
      currency: currency || currencies[0] || "usd",
    };
    otherCurrency = "";
    pickingOther = false;
    error = "";
    addSheet = true;
  }

  function toggleSplit(id: string) {
    draft.splitWith = draft.splitWith.includes(id)
      ? draft.splitWith.filter((x) => x !== id)
      : [...draft.splitWith, id];
  }

  function splitEveryone() {
    draft.splitWith = everyoneIn ? [] : members;
  }

  async function confirmAdd() {
    if (!draftValid || busy) return;
    const record = createExpense({
      id: `expense-${Date.now()}`,
      amount: draftAmount,
      currency: draftCurrency,
      description: draft.description.trim(),
      paidBy: draft.paidBy,
      splitWith: draft.splitWith,
    });
    if (!record) {
      error = $t("balances.errAmount");
      return;
    }
    await persist(record, () => {
      addSheet = false;
      // Show the sheet the record landed on, so what was just added is seen.
      if (record.currency !== currency) onCurrency(record.currency);
    });
  }

  /**
   * One write path for both kinds of record: the lens, then the REA mirror.
   * The lens is the source of truth (the bot re-derives the stream anyway),
   * so a failed mirror is logged, not surfaced.
   */
  async function persist(record: Expense, done: () => void) {
    busy = true;
    error = "";
    try {
      const store = await getReaStore();
      await store.put(holonId, "expenses", record);
      try {
        const events = REAEventFactory.expenseEvents(holonId, record as any);
        await Promise.all(
          events.map((e) => store.put(holonId, "rea_events", e)),
        );
      } catch (err) {
        console.warn("[kiosk] balances: REA mirror failed", err);
      }
      done();
    } catch (err: any) {
      const denied =
        err?.name === "AuthorizationError" ||
        /denied|unauthori[sz]ed|permission/i.test(String(err?.message ?? ""));
      error = denied ? $t("balances.errDenied") : $t("balances.errSave");
      if (!denied) console.error("[kiosk] balances: write failed", err);
    } finally {
      busy = false;
    }
  }
</script>

<section class="balances">
  <header class="head">
    <div class="titles">
      <h2>{mine ? $t("balances.mineTitle") : $t("balances.title")}</h2>
      <p class="sub">
        {mine ? $t("balances.mineAbout") : $t("balances.about")}
      </p>
    </div>
    {#if currencies.length}
      <PillSwitch
        options={currencies.map((c) => ({ id: c, label: c.toUpperCase() }))}
        value={currency}
        onChange={onCurrency}
        label={$t("balances.currencyLabel")}
        showText
        expanded
      />
    {/if}
  </header>
  {#if currencies.length > 1}
    <p class="note">{$t("balances.allCurrencies")}</p>
  {/if}

  {#if !currency || !inCurrency.length}
    <p class="empty">
      {$t("balances.empty")}
      {#if $currentUser}<br /><span class="hint"
          >{$t("balances.emptyHint")}</span
        >{/if}
    </p>
  {:else}
    <!-- Where do I stand? (the whole of "My balance") -->
    {#if me && mine}
      <div class="card me">
        <div class="me-top">
          <span class="av big">
            <span class="ini"
              >{avatarInitial($currentUser?.first_name || "?")}</span
            >
            <img
              src={avatarUrl(selfId ?? "")}
              alt=""
              loading="lazy"
              on:error={hideImg}
              on:load={showImg}
            />
          </span>
          <div>
            <div class="k">{$t("balances.yourPosition")}</div>
            <div class="v {sign(me.net)}">
              {#if sign(me.net) === "in"}
                {$t("balances.youOwed", { amount: abs(me.net) })}
              {:else if sign(me.net) === "out"}
                {$t("balances.youOwe", { amount: abs(me.net) })}
              {:else}
                {$t("balances.youSquare")}
              {/if}
            </div>
          </div>
        </div>
        {#if myPairs.length}
          <ul class="pairs">
            {#each myPairs as pair (`${pair.from}-${pair.to}`)}
              {@const owe = String(pair.from) === selfId}
              {@const other = String(owe ? pair.to : pair.from)}
              <li>
                <span class="av">
                  <span class="ini">{avatarInitial(nameOf(other))}</span>
                  <img
                    src={avatarUrl(other)}
                    alt=""
                    loading="lazy"
                    on:error={hideImg}
                    on:load={showImg}
                  />
                </span>
                <span class="pair-text">
                  {owe
                    ? $t("balances.youOweTo", { name: nameOf(other) })
                    : $t("balances.owesYou", { name: nameOf(other) })}
                </span>
                <span class="pair-amount {owe ? 'out' : 'in'}"
                  >{format(pair.amount)}</span
                >
                <button class="settle" on:click={() => openSettle(pair)}>
                  {owe ? $t("balances.pay") : $t("balances.gotIt")}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- Where does everyone stand? -->
    {#if !mine}
      <div class="stats">
        <div class="stat">
          <span class="k">{$t("balances.spent")}</span>
          <span class="v">{format(credit.volume)}</span>
        </div>
        <div class="stat">
          <span class="k">{$t("balances.expenses")}</span>
          <span class="v">{credit.count}</span>
        </div>
        <div class="stat">
          <span class="k">{$t("balances.openDebts")}</span>
          <span class="v">{credit.pairs.length}</span>
        </div>
      </div>

      {#if active.length}
        <ul class="people">
          {#each active as b (String(b.userId))}
            {@const id = String(b.userId)}
            <li class="person">
              <button
                class="row"
                on:click={() => openPerson(id)}
                on:mouseenter={() => (hoverId = id)}
                on:mouseleave={() => (hoverId = null)}
                on:focus={() => (hoverId = id)}
                on:blur={() => (hoverId = null)}
              >
                <span class="av">
                  <span class="ini">{avatarInitial(nameOf(id))}</span>
                  <img
                    src={avatarUrl(id)}
                    alt=""
                    loading="lazy"
                    on:error={hideImg}
                    on:load={showImg}
                  />
                </span>
                <span class="body">
                  <span class="name">{who(id)}</span>
                  <span class="bar" aria-hidden="true">
                    <span
                      class="fill {sign(b.net)}"
                      style="width: {Math.max(
                        4,
                        (Math.abs(b.net) / maxAbs) * 100,
                      )}%"
                    ></span>
                  </span>
                </span>
                <span class="right {sign(b.net)}">
                  <span class="amt"
                    >{sign(b.net) === "in" ? "+" : "−"}{abs(b.net)}</span
                  >
                  <span class="hint"
                    >{sign(b.net) === "in"
                      ? $t("balances.isOwed")
                      : $t("balances.owes")}</span
                  >
                </span>
              </button>
              {#if hoverId === id && hoverPairs.length}
                <div class="tip" role="tooltip">
                  <dl>
                    {#each hoverPairs as pair (`${pair.from}-${pair.to}`)}
                      {@const owes = String(pair.from) === id}
                      <div class="tip-row">
                        <dt>{who(pair.from)} → {who(pair.to)}</dt>
                        <dd class={owes ? "out" : "in"}>
                          {format(pair.amount)}
                        </dd>
                      </div>
                    {/each}
                  </dl>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{$t("balances.everyoneSquare")}</p>
      {/if}

      {#if square.length && active.length}
        <button class="link" on:click={() => (showSquare = !showSquare)}>
          {$t("balances.squareCount", { n: square.length })}
          <span aria-hidden="true">{showSquare ? "▴" : "▾"}</span>
        </button>
        {#if showSquare}
          <ul class="chips">
            {#each square as b (String(b.userId))}
              <li class="chip">{who(b.userId)}</li>
            {/each}
          </ul>
        {/if}
      {/if}

      <!-- How do we settle? -->
      {#if plan.length}
        <div class="card plan">
          <h3>{$t("balances.settleTitle")}</h3>
          <p class="sub">
            {$t("balances.settleCount", { n: plan.length })}
          </p>
          <ul class="pairs">
            {#each plan as pair (`${pair.from}-${pair.to}`)}
              <li>
                <span class="av">
                  <span class="ini">{avatarInitial(nameOf(pair.from))}</span>
                  <img
                    src={avatarUrl(String(pair.from))}
                    alt=""
                    loading="lazy"
                    on:error={hideImg}
                    on:load={showImg}
                  />
                </span>
                <span class="pair-text"
                  ><b>{who(pair.from)}</b> → <b>{who(pair.to)}</b></span
                >
                <span class="pair-amount">{format(pair.amount)}</span>
                <button class="settle" on:click={() => openSettle(pair)}
                  >{$t("balances.paid")}</button
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}

    <!-- The records -->
    <h3 class="list-head">{$t("balances.recent")}</h3>
    <ul class="records">
      {#each visible as { e, ts } (String(e.id))}
        {@const mine = myLine(e)}
        <li>
          <button
            class="row"
            class:settlement={isSettlement(e)}
            on:click={() => (recordSheet = e)}
          >
            <span class="av">
              <span class="ini">{avatarInitial(nameOf(e.paidBy))}</span>
              <img
                src={avatarUrl(String(e.paidBy))}
                alt=""
                loading="lazy"
                on:error={hideImg}
                on:load={showImg}
              />
            </span>
            <span class="body">
              <span class="name"
                >{e.description ||
                  (isSettlement(e)
                    ? $t("balances.settledUp")
                    : $t("balances.expense"))}</span
              >
              <span class="meta">{summary(e)} · {dateFmt.format(ts)}</span>
            </span>
            <span class="right">
              <span class="amt">{format(e.amount)}</span>
              {#if mine.text}<span class="hint {mine.sign}">{mine.text}</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if inCurrency.length > visible.length}
      <button class="more" on:click={() => (limit += PAGE)}>
        {$t("balances.showMore", {
          n: Math.min(PAGE, inCurrency.length - visible.length),
        })}
      </button>
    {/if}
  {/if}
</section>

<!-- One thumb-reach button to add a record; not logged in → the login card. -->
<button
  class="fab"
  on:click={openAdd}
  aria-label={$t("balances.addLabel")}
  title={$t("balances.addLabel")}>＋</button
>

{#if personSheet}
  {@const pid = personSheet}
  <Modal on:close={() => (personSheet = null)}>
    <div class="sheet">
      <div class="lead">
        <span class="av big">
          <span class="ini">{avatarInitial(nameOf(pid))}</span>
          <img
            src={avatarUrl(pid)}
            alt=""
            loading="lazy"
            on:error={hideImg}
            on:load={showImg}
          />
        </span>
        <div>
          <h3>{who(pid)}</h3>
          <div class="k">{$t("balances.netPosition")}</div>
          <div class="v {sign(personBalance)}">
            {#if sign(personBalance) === "in"}
              {$t("balances.personOwed", { amount: abs(personBalance) })}
            {:else if sign(personBalance) === "out"}
              {$t("balances.personOwes", { amount: abs(personBalance) })}
            {:else}
              {$t("balances.personSquare")}
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
              <span class="pair-text">
                {owes
                  ? $t("balances.owesTo", { name: who(other) })
                  : isMe(other)
                    ? $t("balances.owesYou", { name: who(pid) })
                    : $t("balances.owedBy", { name: who(other) })}
              </span>
              <span class="pair-amount {owes ? 'out' : 'in'}"
                >{format(pair.amount)}</span
              >
              <button class="settle" on:click={() => openSettle(pair)}
                >{$t("balances.paid")}</button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty">{$t("balances.nothingOpen")}</p>
      {/if}
    </div>
  </Modal>
{/if}

{#if recordSheet}
  {@const e = recordSheet}
  <Modal on:close={() => (recordSheet = null)}>
    <div class="sheet">
      <h3>
        {e.description ||
          (isSettlement(e) ? $t("balances.settledUp") : $t("balances.expense"))}
      </h3>
      <p class="amount">{format(e.amount)}</p>
      <p class="sub">{stampFmt.format(stamp(e))}</p>
      {#if e.picture}
        <img
          class="receipt"
          src={resolveImage(e.picture)}
          alt=""
          loading="lazy"
          on:error={hideImg}
        />
      {/if}
      <dl class="rows">
        <div class="drow">
          <dt>{$t("balances.paidBy")}</dt>
          <dd>{who(e.paidBy)}</dd>
        </div>
        <div class="drow">
          <dt>
            {isSettlement(e) ? $t("balances.paidTo") : $t("balances.splitWith")}
          </dt>
          <dd>{coerceSplitWith(e.splitWith).map(who).join(", ")}</dd>
        </div>
        {#if !isSettlement(e)}
          <div class="drow">
            <dt>{$t("balances.eachShare")}</dt>
            <dd>{format(share(e))}</dd>
          </div>
        {/if}
        {#if (e as any)._federation?.sourceHolonId}
          <div class="drow">
            <dt>{$t("balances.from")}</dt>
            <dd>⇄ {nameOf((e as any)._federation.sourceHolonId)}</dd>
          </div>
        {/if}
      </dl>
    </div>
  </Modal>
{/if}

{#if settleSheet}
  {@const pair = settleSheet}
  <Modal on:close={() => (settleSheet = null)}>
    <div class="sheet">
      <h3>{$t("balances.settleTitle")}</h3>
      <p class="sub">
        {$t("balances.settleLead", { from: who(pair.from), to: who(pair.to) })}
      </p>
      <label class="field">
        <span class="k">{$t("balances.amount")} · {currency.toUpperCase()}</span
        >
        <input
          class="money"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          bind:value={settleAmount}
        />
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button class="ghost" on:click={() => (settleSheet = null)}
          >{$t("common.cancel")}</button
        >
        <button
          class="primary"
          disabled={busy || !(settleAmount > 0)}
          on:click={confirmSettle}
        >
          {busy ? $t("common.saving") : $t("balances.markPaid")}
        </button>
      </div>
    </div>
  </Modal>
{/if}

{#if addSheet}
  <Modal on:close={() => (addSheet = false)}>
    <div class="sheet">
      <h3>{$t("balances.newExpense")}</h3>
      <label class="field">
        <span class="k"
          >{$t("balances.amount")} · {(
            draftCurrency || "?"
          ).toUpperCase()}</span
        >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="money"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          placeholder="0.00"
          bind:value={draft.amount}
          autofocus
        />
      </label>

      <div class="k">{$t("balances.currency")}</div>
      <ul class="picks" role="radiogroup" aria-label={$t("balances.currency")}>
        {#each currencies.length ? currencies : ["usd"] as c (c)}
          <li>
            <button
              role="radio"
              aria-checked={!pickingOther && draft.currency === c}
              class="pick"
              class:on={!pickingOther && draft.currency === c}
              on:click={() => {
                pickingOther = false;
                draft.currency = c;
              }}
            >
              {c.toUpperCase()}
            </button>
          </li>
        {/each}
        <li>
          <button
            role="radio"
            aria-checked={pickingOther}
            class="pick"
            class:on={pickingOther}
            on:click={() => (pickingOther = true)}
          >
            {$t("balances.otherCurrency")}
          </button>
        </li>
      </ul>
      {#if pickingOther}
        <label class="field tight">
          <span class="k">{$t("balances.currency")}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            type="text"
            autocapitalize="none"
            placeholder={$t("balances.currencyHint")}
            bind:value={otherCurrency}
            autofocus
          />
        </label>
      {/if}
      <label class="field">
        <span class="k">{$t("balances.whatFor")}</span>
        <input
          type="text"
          placeholder={$t("balances.whatForHint")}
          bind:value={draft.description}
        />
      </label>

      <div class="k">{$t("balances.paidBy")}</div>
      <ul class="picks" role="radiogroup" aria-label={$t("balances.paidBy")}>
        {#each people as p (p.id)}
          <li>
            <button
              role="radio"
              aria-checked={draft.paidBy === p.id}
              class="pick"
              class:on={draft.paidBy === p.id}
              on:click={() => (draft.paidBy = p.id)}
            >
              {who(p.id)}
            </button>
          </li>
        {/each}
      </ul>

      <div class="field-row">
        <span class="k">{$t("balances.splitWith")}</span>
        <button class="link" on:click={splitEveryone}>
          {everyoneIn ? $t("balances.nobody") : $t("balances.everyone")}
        </button>
      </div>
      <ul class="picks" aria-label={$t("balances.splitWith")}>
        {#each people as p (p.id)}
          <li>
            <button
              role="checkbox"
              aria-checked={draft.splitWith.includes(p.id)}
              class="pick"
              class:on={draft.splitWith.includes(p.id)}
              on:click={() => toggleSplit(p.id)}
            >
              {who(p.id)}
            </button>
          </li>
        {/each}
      </ul>
      {#if draftShare > 0}
        <p class="sub">
          {$t("balances.eachOf", {
            amount: format(draftShare),
            n: draft.splitWith.length,
          })}
        </p>
      {/if}
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button class="ghost" on:click={() => (addSheet = false)}
          >{$t("common.cancel")}</button
        >
        <button
          class="primary"
          disabled={busy || !draftValid}
          on:click={confirmAdd}
        >
          {busy ? $t("common.saving") : $t("balances.add")}
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .balances {
    animation: kiosk-rise 0.42s ease both;
    padding-bottom: 5rem; /* room for the FAB */
  }

  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.8rem;
    margin-bottom: 0.7rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--ink);
  }

  h3 {
    margin: 0;
    font-size: 1.02rem;
    color: var(--ink);
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .k {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .v {
    font-size: 1.3rem;
    color: var(--ink);
  }

  .in {
    color: var(--teal);
  }

  .out {
    color: #c0392b;
  }

  :global(:root[data-theme="dark"]) .out {
    color: #ff8a7a;
  }

  .card {
    background: var(--card);
    border-radius: var(--radius);
    box-shadow: var(--shadow-soft);
    padding: 0.9rem 1rem;
    margin-bottom: 1rem;
  }

  .me-top,
  .lead {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  /* Avatars: the shared recipe from Avatars.svelte, sized per use. */
  .av {
    --sz: 2.25rem;
    flex: 0 0 auto;
    position: relative;
    width: var(--sz);
    height: var(--sz);
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
  }

  .av.big {
    --sz: 3.2rem;
  }

  .av .ini {
    font-size: calc(var(--sz) * 0.42);
    font-weight: 800;
    color: #fff;
  }

  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
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
    margin: 0.6rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
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
    font-size: 0.92rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pair-text b {
    color: var(--ink);
    font-weight: 700;
  }

  .pair-amount {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-weight: 700;
    color: var(--ink);
  }

  .pair-amount.in {
    color: var(--teal);
  }

  .settle {
    min-height: 2.5rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--teal);
    font-size: 0.85rem;
    font-weight: 700;
    white-space: nowrap;
    touch-action: manipulation;
    transition: transform 0.1s ease;
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

  /* Grid items default to min-width:auto, so a nowrap amount would widen the
     row past the card instead of squeezing the title. */
  .people > li,
  .records > li {
    min-width: 0;
  }
  .people > li.person {
    position: relative;
  }

  /* Hover on a person: their debts, one line each, under the row. Lets the
     pointer pass through, so leaving the row is what closes it. */
  .tip {
    position: absolute;
    left: 0.75rem;
    right: 0.75rem;
    top: calc(100% - 0.2rem);
    z-index: 10;
    pointer-events: none;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 0.6rem;
    padding: 0.55rem 0.7rem;
    box-shadow: 0 10px 28px rgb(20 30 30 / 0.18);
    font-size: 0.8rem;
    line-height: 1.35;
  }
  .tip dl {
    margin: 0;
    display: grid;
    gap: 0.15rem;
  }
  .tip-row {
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }
  .tip dt {
    color: var(--muted);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tip dd {
    margin: 0;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* The kiosk's row shape: a card surface, soft shadow, everything tappable. */
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 3.6rem;
    padding: 0.55rem 0.75rem;
    border-radius: 14px;
    background: var(--card);
    box-shadow: var(--shadow-soft);
    text-align: left;
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .row:active {
    transform: scale(0.985);
  }

  .row.settlement {
    background: var(--paper);
    box-shadow: none;
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .name {
    font-weight: 700;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 0.78rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: block;
    height: 0.4rem;
    border-radius: 999px;
    background: var(--paper-deep);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s ease;
  }

  .fill.in {
    background: var(--teal);
  }

  .fill.out {
    background: #e07060;
  }

  .right {
    flex: 0 0 auto;
    max-width: 50%;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    white-space: nowrap;
    color: var(--ink);
  }

  .right .hint {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .amt {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--muted);
  }

  .hint.in {
    color: var(--teal);
  }

  .hint.out {
    color: #c0392b;
  }

  .plan {
    margin-top: 1rem;
  }

  .list-head {
    margin: 1.2rem 0 0.5rem;
  }

  .field-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-top: 0.8rem;
  }

  .link {
    color: var(--teal);
    font-size: 0.85rem;
    font-weight: 700;
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
    min-height: 2.25rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.88rem;
    font-weight: 600;
  }

  .pick {
    min-height: 2.75rem;
    border: 1.5px solid transparent;
    touch-action: manipulation;
  }

  .pick.on {
    background: var(--teal);
    color: #fff;
  }

  .more {
    margin-top: 0.7rem;
    width: 100%;
    min-height: 2.75rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 700;
    font-size: 0.88rem;
  }

  .empty {
    color: var(--muted);
    text-align: center;
    padding: 1.8rem 1rem;
  }

  .note {
    margin: -0.2rem 0 0.8rem;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .field.tight {
    margin-top: 0.4rem;
  }

  .empty .hint {
    font-size: 0.85rem;
  }

  .error {
    color: #c0392b;
    font-size: 0.88rem;
    margin: 0.6rem 0 0;
  }

  .fab {
    position: absolute;
    right: 1.3rem;
    bottom: 1.3rem;
    z-index: 7;
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 50%;
    font-size: 2rem;
    line-height: 1;
    color: #fff;
    background: var(--teal);
    box-shadow: 0 10px 24px rgba(14, 107, 102, 0.4);
    display: grid;
    place-items: center;
    transition:
      transform 0.12s ease,
      background 0.15s ease;
  }

  .fab:active {
    transform: scale(0.92);
    background: var(--teal-deep);
  }

  /* Modal content */
  .sheet {
    padding: 0.2rem 0.1rem;
    min-width: min(20rem, 80vw);
  }

  .sheet h3 {
    margin: 0 0 0.3rem;
    padding-right: 2.5rem;
    font-size: 1.15rem;
  }

  .amount {
    margin: 0;
    font-size: 1.6rem;
    color: var(--teal);
  }

  .receipt {
    display: block;
    width: 100%;
    max-height: 40vh;
    object-fit: contain;
    border-radius: 12px;
    margin: 0.8rem 0;
    background: var(--paper-deep);
  }

  .rows {
    margin: 0.8rem 0 0;
    display: grid;
    gap: 0.45rem;
  }

  .drow {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    font-size: 0.92rem;
  }

  .drow dt {
    color: var(--muted);
    flex: 0 0 auto;
  }

  .drow dd {
    margin: 0;
    color: var(--ink);
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .field {
    display: block;
    margin: 0.8rem 0 0;
  }

  .field input {
    display: block;
    width: 100%;
    margin-top: 0.3rem;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    min-height: 3rem;
  }

  .field input.money {
    font-size: 1.7rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .field input:focus {
    outline: none;
    border-color: var(--teal);
  }

  .sheet .k {
    display: block;
    margin-top: 0.8rem;
  }

  .field .k,
  .field-row .k {
    margin-top: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.3rem;
  }

  .primary,
  .ghost {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }

  .primary {
    background: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }

  .ghost {
    background: rgba(255, 255, 255, 0.5);
    color: var(--ink);
  }

  .primary:active,
  .ghost:active {
    transform: scale(0.97);
  }

  .primary:disabled {
    opacity: 0.6;
  }
</style>
