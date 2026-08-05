<script lang="ts">
  import Icon from "./Icon.svelte";
  import { go } from "$lib/stores";
  import { holonName, holonId, partners } from "$lib/live";
</script>

<div class="scr">
  <div style="padding:52px 20px 0">
    <button
      class="tapp"
      on:click={() => go("coop")}
      style="width:44px;height:44px;border-radius:999px;background:var(--color-surface);display:flex;align-items:center;justify-content:center;font-size:18px"
    >
      ←
    </button>
  </div>
  <div class="body" style="padding:16px 20px 24px">
    <div style="font-family:var(--font-heading);font-size:30px;line-height:1.08">Smart barter</div>
    <div style="font-size:13.5px;color:var(--color-neutral-700);margin-top:8px;text-wrap:pretty">
      Federated holons settle with each other in needs and offers, so nobody needs cash to start.
      These are {$holonName || $holonId}'s live federation links.
    </div>
    <div style="display:flex;align-items:center;gap:12px;margin-top:26px">
      <div style="flex:1;background:var(--color-accent-200);border-radius:var(--radius-lg);padding:18px;text-align:center">
        <div style="display:flex;justify-content:center"><Icon name="wheat" size={26} /></div>
        <div style="font-family:var(--font-heading);font-size:17px;margin-top:6px">
          {$holonName || "This holon"}
        </div>
        <div style="font-size:12px;color:var(--color-accent-800);font-weight:700">publishes needs</div>
      </div>
      <div style="font-size:22px;color:var(--color-neutral-500)">⇄</div>
      <div style="flex:1;background:var(--color-accent-2-200);border-radius:var(--radius-lg);padding:18px;text-align:center">
        <div style="display:flex;justify-content:center"><Icon name="bike" size={26} /></div>
        <div style="font-family:var(--font-heading);font-size:17px;margin-top:6px">
          {$partners.length} partner{$partners.length === 1 ? "" : "s"}
        </div>
        <div style="font-size:12px;color:var(--color-accent-2-800);font-weight:700">answer them</div>
      </div>
    </div>
    <div style="font-family:var(--font-heading);font-size:19px;margin-top:26px">Open exchanges</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      {#each $partners as p (p.id)}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;display:flex;align-items:center;gap:12px">
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px">{$holonName || "Here"} ⇄ {p.name}</div>
            <div style="font-size:12px;color:var(--color-neutral-600);margin-top:2px">{p.id}</div>
          </div>
          <div class="chip" style="background:var(--color-accent-2-300);color:var(--color-accent-2-900)">
            Federated
          </div>
        </div>
      {:else}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px;font-size:13px;color:var(--color-neutral-700)">
          No federation links yet — add partners from the dashboard's federation settings and their
          needs flow in here.
        </div>
      {/each}
    </div>
  </div>
</div>
