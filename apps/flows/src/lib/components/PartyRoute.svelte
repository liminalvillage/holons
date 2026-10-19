<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The body of /p/<party> and /h/<holon>. One id, two routes: a link made
  // before a seat was claimed, or typed with the wrong prefix, still lands —
  // the address is corrected to the party's own (a claimed seat to its
  // claimant, a holon under /p to /h) without adding a step to Back.
  import { resolveParty } from "@holons/core/flows";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import AccountScreen from "./AccountScreen.svelte";
  import SnapshotBadge from "./SnapshotBadge.svelte";
  import SnapshotStatus from "./SnapshotStatus.svelte";
  import { currentUser } from "$lib/auth";
  import { index, snapshot } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { hrefFor, routeOf, searchHref } from "$lib/urls";

  /** The id in the address, decoded. */
  export let raw: string;
  export let route: "p" | "h";

  $: found = $index ? resolveParty($index, raw) : null;
  $: node = found && $index ? ($index.byId.get(found.id) ?? null) : null;
  $: canonical = node && (node.id !== raw || routeOf(node.kind) !== route);
  $: if (node && canonical)
    void goto(hrefFor(node, $page.url.searchParams), { replaceState: true });
  $: settled = $snapshot.status !== "loading";
  $: mine = !!node && !!$currentUser && String($currentUser.id) === node.id;
</script>

<svelte:head
  ><title>{node ? `${node.label} · Flows` : "Flows"}</title></svelte:head
>

<SnapshotStatus />

{#if $index && node && !canonical}
  <AccountScreen index={$index} id={node.id} own={mine} />
  <p class="foot"><SnapshotBadge /></p>
{:else if $index && !node && settled}
  <div class="card unknown">
    <h1>{$t("party.unknownTitle")}</h1>
    <p class="muted">{$t("party.unknownBody")}</p>
    <a class="btn quiet" href={searchHref("")}>{$t("nav.search")}</a>
  </div>
{/if}

<style>
  .unknown {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
  .unknown h1 {
    font-size: 1.2rem;
  }
  .foot {
    margin-top: 22px;
  }
</style>
