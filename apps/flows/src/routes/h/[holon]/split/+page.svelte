<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Money out: how a holon divides what reaches it, on a page of its own.
  // The editor is `SplitEditor`; saving goes back to the account.
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import SplitEditor from "$lib/components/SplitEditor.svelte";
  import { adopt, index } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { hrefFor } from "$lib/urls";

  $: holon = $page.params.holon ?? "";
  $: node = $index?.byId.get(holon) ?? null;
  $: back = node ? hrefFor(node) : "/";
  // A holon no map reaches yet (one just started) is drawn on its own.
  $: if ($index && holon && !node) void adopt(holon);
  /** Straight to seating someone: the account's "Seat" prompt links here. */
  $: adding = $page.url.searchParams.get("add") === "1";
</script>

<svelte:head
  ><title>{node ? `${node.label} · ${$t("split.title")}` : "Flows"}</title
  ></svelte:head
>

<SnapshotStatus />

<header class="head">
  <a class="backlink" href={back}
    ><Icon name="arrow-left" />{node?.label ?? ""}</a
  >
  <h1>{$t("split.title")}</h1>
  <p class="muted">{$t("split.lead")}</p>
</header>

{#key holon}
  <SplitEditor {holon} {adding} on:saved={() => void goto(back)} />
{/key}

<style>
  .head {
    display: grid;
    gap: 4px;
    margin-bottom: 14px;
  }
  .head h1 {
    font-size: 1.5rem;
    line-height: 1.2;
  }
  .backlink {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    font-weight: 700;
    font-size: 0.9rem;
    color: var(--teal-ink);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
</style>
