<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Whoever is paid at an address. One party: straight there. Several (a
  // person paid at the wallet of a project they also hold): a choice. None on
  // the map: the Pot's own table is asked, since a row names its address even
  // where the map has not caught up — and failing that, the address is simply
  // not one the Pot pays.
  import { partiesByAddress } from "@holons/core/flows";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import FlowList from "$lib/components/FlowList.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { pct, shortAddress } from "$lib/format";
  import { index, snapshot } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { hrefFor } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  $: address = ($page.params.address ?? "").trim().toLowerCase();
  $: valid = /^0x[0-9a-f]{40}$/.test(address);
  $: onMap = $index && valid ? partiesByAddress($index, address) : [];
  // A row of the active table paid to this address names its party too.
  $: inTable =
    valid && !onMap.length
      ? [
          ...new Set(
            ($potLive.activeTable?.rows ?? [])
              .filter((r) => String(r.to).toLowerCase() === address)
              .map((r) => r.party),
          ),
        ].filter((id) => $index?.byId.has(id))
      : [];
  $: ids = onMap.length ? onMap : inTable;
  $: if ($index && ids.length === 1) {
    const node = $index.byId.get(ids[0]);
    if (node) void goto(hrefFor(node), { replaceState: true });
  }
  $: rows = ids
    .map((id) => $index?.byId.get(id))
    .filter((n): n is NonNullable<typeof n> => !!n)
    .map(
      (n): FlowListRow => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        value: pct(n.share),
      }),
    );
  $: settled = $snapshot.status !== "loading" && $potLive.status !== "loading";
</script>

<svelte:head><title>{shortAddress(address)} · Flows</title></svelte:head>

<SnapshotStatus />

{#if $index}
  {#if !valid}
    <div class="card">
      <h1>{$t("address.invalidTitle")}</h1>
      <p class="muted">{$t("address.invalidBody")}</p>
    </div>
  {:else if rows.length > 1}
    <h1>{$t("address.manyTitle", { address: shortAddress(address) })}</h1>
    <p class="muted lead">{$t("address.manyBody")}</p>
    <FlowList
      {rows}
      hrefOf={(r) => {
        const n = $index?.byId.get(r.id);
        return n ? hrefFor(n) : null;
      }}
    />
  {:else if !rows.length && settled}
    <div class="card">
      <h1>{$t("address.noneTitle", { address: shortAddress(address) })}</h1>
      <p class="muted">{$t("address.noneBody")}</p>
    </div>
  {/if}
{/if}

<style>
  h1 {
    font-size: 1.25rem;
    overflow-wrap: anywhere;
  }
  .lead {
    margin: 6px 0 14px;
  }
  .card {
    display: grid;
    gap: 8px;
  }
</style>
