<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The front door. Signed in, it is MINE: where I am paid and what I can
  // collect, then my own diagram — who my income comes through, what I pass
  // on. Signed out, it is the way in: sign in, or go straight to a party by
  // pasting a wallet address, an id or a name, or look at the whole map —
  // none of which needs an account.
  import { goto } from "$app/navigation";
  import FlowList from "$lib/components/FlowList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import LoginCard from "$lib/components/LoginCard.svelte";
  import AccountScreen from "$lib/components/AccountScreen.svelte";
  import SnapshotBadge from "$lib/components/SnapshotBadge.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import WalletCard from "$lib/components/WalletCard.svelte";
  import { currentUser, displayName } from "$lib/auth";
  import { pct } from "$lib/format";
  import { index, snapshot } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { canSteer } from "$lib/account";
  import {
    loadPayout,
    myParties,
    quietWalletAddress,
    steeredHolons,
  } from "$lib/me";
  import { addressHref, hrefFor, parseTarget, searchHref } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  $: selfId = $currentUser ? String($currentUser.id) : null;

  // The addresses that are mine: the wallet this browser already shares, and
  // where I said to be paid.
  let wallet: string | null = null;
  let payout: string | null = null;
  let askedFor = "";
  $: if (selfId && selfId !== askedFor) {
    askedFor = selfId;
    void quietWalletAddress().then((a) => (wallet = a));
    void loadPayout(selfId, $potLive.record?.chainId ?? null).then(
      (a) => (payout = a),
    );
  }

  $: mine = myParties($index, selfId, [wallet, payout]);
  $: me = mine.find((m) => m.via === "self") ?? null;
  $: meNode = me && $index ? ($index.byId.get(me.id) ?? null) : null;
  $: others = mine
    .filter((m) => m.via === "address")
    .map((m) => $index?.byId.get(m.id))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map(
      (n): FlowListRow => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        value: pct(n.share),
      }),
    );
  $: settled = $snapshot.status !== "loading";

  // A steward need not be seated: the accounts they look after are offered
  // here, or the front page would have nothing for them.
  let stewarded: FlowListRow[] = [];
  let stewardFor = "";
  $: if ($index && selfId && !meNode && stewardFor !== selfId) {
    stewardFor = selfId;
    void steeredHolons($index, selfId, canSteer).then((ids) => {
      stewarded = ids
        .map((id) => $index?.byId.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({
          id: n.id,
          label: n.label,
          kind: n.kind,
          value: pct(n.share),
        }));
    });
  }

  let pasted = "";
  function go() {
    const target = parseTarget(pasted);
    if (!target) return;
    if (target.type === "address") void goto(addressHref(target.value));
    else void goto(searchHref(target.value));
  }
</script>

<svelte:head><title>Flows</title></svelte:head>

{#if $currentUser && selfId}
  <SnapshotStatus />

  {#if meNode && $index}
    <AccountScreen index={$index} id={meNode.id} own />
  {:else if settled || $index}
    <header class="hello">
      <h1>{$t("me.hello", { name: displayName($currentUser) })}</h1>
    </header>
    {#if !others.length}
      <div class="card nothing">
        <h2>{$t("me.nothingTitle")}</h2>
        <p class="muted">{$t("me.nothingBody")}</p>
        <a class="btn" href={searchHref("", "fund")}
          ><Icon name="search" />{$t("action.findFunds")}</a
        >
      </div>
    {/if}
    {#if stewarded.length && $index}
      <h2 class="section-title">{$t("account.others")}</h2>
      <FlowList
        rows={stewarded}
        hrefOf={(r) => {
          const n = $index?.byId.get(r.id);
          return n ? hrefFor(n) : null;
        }}
      />
    {/if}
    <h2 class="section-title">{$t("wallet.title")}</h2>
    <WalletCard party={selfId} rest={0} editable />
  {/if}

  {#if others.length}
    <h2 class="section-title">{$t("me.paidAtWallet")}</h2>
    <p class="muted lead">{$t("me.paidAtWalletBody")}</p>
    <FlowList
      rows={others}
      hrefOf={(r) => {
        const n = $index?.byId.get(r.id);
        return n ? hrefFor(n) : null;
      }}
    />
  {/if}

  {#if $index}<p class="foot"><SnapshotBadge /></p>{/if}
{:else}
  <header class="hero">
    <h1>{$t("landing.title")}</h1>
    <p class="muted">{$t("landing.lead")}</p>
  </header>

  <a class="btn wide" href="/eco"
    ><Icon name="globe" />{$t("landing.explore")}</a
  >
  <div class="links">
    <a class="btn quiet" href="/story"
      ><Icon name="sprout" />{$t("landing.story")}</a
    >
    <a class="btn quiet" href="/rise"
      ><Icon name="rise" />{$t("landing.rise")}</a
    >
  </div>

  <h2 class="section-title">{$t("landing.findTitle")}</h2>
  <form class="find" on:submit|preventDefault={go}>
    <label class="sr-only" for="find">{$t("landing.findField")}</label>
    <input
      id="find"
      bind:value={pasted}
      placeholder={$t("landing.findPlaceholder")}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="go"
    />
    <button class="btn" type="submit" disabled={!pasted.trim()}
      >{$t("landing.go")}</button
    >
  </form>

  <h2 class="section-title">{$t("landing.signInTitle")}</h2>
  <div class="card login"><LoginCard /></div>
{/if}

<style>
  .hello h1,
  .hero h1 {
    font-size: 1.6rem;
    line-height: 1.2;
  }
  .hero {
    display: grid;
    gap: 8px;
    margin-bottom: 18px;
  }
  .nothing {
    display: grid;
    gap: 6px;
    margin-top: 14px;
  }
  .nothing h2 {
    font-size: 1.1rem;
  }
  .lead {
    font-size: 0.9rem;
    margin-bottom: 10px;
  }
  .wide {
    width: 100%;
  }
  .links {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
  }
  .find {
    display: flex;
    gap: 8px;
  }
  .find input {
    flex: 1 1 auto;
    min-width: 0;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: 14px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .login {
    padding: 18px 14px;
  }
  .foot {
    margin-top: 22px;
  }
</style>
