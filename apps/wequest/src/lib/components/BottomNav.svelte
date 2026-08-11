<script lang="ts">
  import Icon from "./Icon.svelte";
  import { NAV } from "$lib/data";
  import { go, screen, type Screen } from "$lib/stores";

  function isOn(k: string, scr: Screen): boolean {
    return scr === k || (k === "coop" && scr === "barter") || (k === "list" && scr === "group");
  }
</script>

<div
  style="position:absolute;left:0;right:0;bottom:0;height:88px;background:var(--color-bg);border-top:1px solid var(--color-divider);display:flex;align-items:flex-start;padding:8px 6px 0;z-index:10"
>
  {#each NAV as n (n.k)}
    {@const on = isOn(n.k, $screen)}
    <button
      class="tapp"
      on:click={() => go(n.to as Screen)}
      style="flex:1;height:62px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:{on
        ? 'var(--color-accent-700)'
        : 'var(--color-neutral-500)'}"
    >
      {#if n.icon}
        <Icon name={n.icon} size={22} />
      {:else}
        <svg viewBox="0 0 22 25" style="width:22px;height:25px">
          <polygon
            points="11,1 21,6.5 21,18.5 11,24 1,18.5 1,6.5"
            fill={on ? "var(--color-accent-300)" : "transparent"}
            stroke={on ? "var(--color-accent-700)" : "var(--color-neutral-500)"}
            stroke-width="1.8"
          />
        </svg>
      {/if}
      <div style="font-size:10px;font-weight:700">{n.label}</div>
    </button>
  {/each}
</div>
