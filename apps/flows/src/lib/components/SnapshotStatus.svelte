<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Why there is no map on screen, or why the one on screen is not fresher.
  // With a graph (from the cache, or the one before a torn publish) this is a
  // quiet line above it; without one it is the whole screen.
  import Icon from "./Icon.svelte";
  import { loadSnapshot, snapshot, type SnapshotStatus } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";

  const BODY: Partial<Record<SnapshotStatus, MessageKey>> = {
    unconfigured: "status.unconfigured",
    missing: "status.missing",
    incomplete: "status.incomplete",
    version: "status.version",
    corrupt: "status.corrupt",
    offline: "status.offline",
  };
  $: status = $snapshot.status;
  $: has = !!$snapshot.graph;
  $: key = BODY[status];
  $: retry =
    status === "offline" || status === "incomplete" || status === "missing";
</script>

{#if status === "loading" && !has}
  <div class="skeleton" role="status" aria-label={$t("status.loading")}>
    <span></span><span></span><span></span><span></span>
  </div>
{:else if key && !has}
  <div class="card full" role="status">
    <p class="big"><Icon name="info" /></p>
    <p>{$t(key)}</p>
    {#if retry}
      <button class="btn quiet" on:click={() => loadSnapshot(true)}
        ><Icon name="refresh" />{$t("status.retry")}</button
      >
    {/if}
  </div>
{:else if key && has}
  <p class="notice warn line" role="status">{$t(key)}</p>
{/if}

<style>
  .full {
    display: grid;
    justify-items: center;
    gap: 12px;
    text-align: center;
    padding: 28px 18px;
  }
  .big {
    font-size: 1.8rem;
    color: var(--muted);
  }
  .line {
    margin-bottom: 12px;
  }
  .skeleton {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 14%;
    height: 240px;
    padding: 18px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .skeleton span {
    flex: 1 1 0;
    border-radius: 6px;
    background: var(--paper-deep);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .skeleton span:nth-child(1) {
    height: 100%;
  }
  .skeleton span:nth-child(2) {
    height: 62%;
    animation-delay: 0.15s;
  }
  .skeleton span:nth-child(3) {
    height: 84%;
    animation-delay: 0.3s;
  }
  .skeleton span:nth-child(4) {
    height: 40%;
    animation-delay: 0.45s;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
</style>
