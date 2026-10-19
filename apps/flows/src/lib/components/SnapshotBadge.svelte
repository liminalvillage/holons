<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // How old the map on screen is, and whether it is whole. The snapshot is
  // cut once a lunation, so "a few days ago" is fresh; past a missed cut it
  // turns amber. A partial map and a map from this device's cache say so.
  import Icon from "./Icon.svelte";
  import { snapshot } from "$lib/graph";
  import { ageOf, isStale } from "$lib/format";
  import { t } from "$lib/i18n";

  const now = Date.now();
  $: graph = $snapshot.graph;
  $: age = graph ? ageOf(graph.at, now) : null;
  $: stale = graph ? isStale(graph.at, now) : false;
</script>

{#if graph && age}
  <p class="badge" class:stale>
    <Icon name={stale ? "warning" : "refresh"} />
    <span>
      {$t("snapshot.mapped", {
        age: age.key === "age.now" ? $t(age.key) : $t(age.key, { n: age.n }),
      })}{#if !graph.complete}
        · {$t(
          "snapshot.partial",
        )}{/if}{#if $snapshot.cached && $snapshot.status !== "loading"}
        · {$t("snapshot.cached")}{/if}
    </span>
  </p>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .badge.stale {
    color: var(--caution);
  }
</style>
