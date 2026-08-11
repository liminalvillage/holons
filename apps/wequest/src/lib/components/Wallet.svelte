<script lang="ts">
  import Icon from "./Icon.svelte";
  import { iconForText } from "$lib/icons";
  import { wallet, myReputation } from "$lib/live";
  import { resolveUserId } from "$lib/config";

  const me = resolveUserId();

  $: w = $wallet;
  $: total = Math.max(1, w.hoursGiven + w.hoursReceived);
</script>

<div class="scr">
  <div class="body" style="padding:52px 0 116px">
    <div style="padding:0 20px">
      <div style="font-family:var(--font-heading);font-size:30px">What you hold</div>
      <div style="font-size:13.5px;color:var(--color-neutral-700);margin-top:6px">
        Nothing here can be bought. All of it was given.
      </div>
    </div>
    <div style="display:flex;gap:10px;padding:18px 16px 0">
      <div
        style="flex:1;background:var(--color-accent-2-800);border-radius:var(--radius-lg);padding:18px 16px;color:var(--color-neutral-100)"
      >
        <div style="font-family:var(--font-heading);font-size:30px">{w.hours.toFixed(1)}</div>
        <div
          style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--color-accent-2-300)"
        >
          hours
        </div>
        <div style="font-size:11.5px;color:var(--color-accent-2-200);margin-top:8px">
          net balance on this holon
        </div>
      </div>
      <div
        style="flex:1;background:var(--color-accent);border-radius:var(--radius-lg);padding:18px 16px;color:var(--color-neutral-100)"
      >
        <div style="font-family:var(--font-heading);font-size:30px">{w.karma.toLocaleString()}</div>
        <div
          style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:var(--color-accent-200)"
        >
          karma
        </div>
        <div style="font-size:11.5px;color:var(--color-accent-200);margin-top:8px">
          {$myReputation.count
            ? `★ ${$myReputation.average.toFixed(1)} reputation · ${$myReputation.count} rating${$myReputation.count === 1 ? "" : "s"}`
            : "from the shared value equation"}
        </div>
      </div>
    </div>
    <div style="padding:14px 16px 0">
      <div style="background:var(--color-surface);border-radius:var(--radius-lg);padding:18px">
        <div style="display:flex;align-items:baseline">
          <div style="font-family:var(--font-heading);font-size:19px">
            {w.exchanges > 0 ? `${w.standing}% of the holon's karma` : "No standing yet"}
          </div>
          <div style="flex:1"></div>
          <div style="font-size:12px;color:var(--color-neutral-600);font-weight:700">
            {w.exchanges} exchange{w.exchanges === 1 ? "" : "s"}
          </div>
        </div>
        <div style="display:flex;gap:3px;margin-top:16px;height:14px;border-radius:999px;overflow:hidden">
          <div style="flex:{Math.max(1, w.hoursGiven)};background:var(--color-accent-2-500)"></div>
          <div style="flex:{Math.max(1, w.hoursReceived)};background:var(--color-accent-300)"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:12px;font-weight:700">
          <span style="color:var(--color-accent-2-700)">{w.hoursGiven.toFixed(1)} h given</span>
          <span style="color:var(--color-accent-700)">{w.hoursReceived.toFixed(1)} h received</span>
        </div>
        <div style="font-size:11.5px;color:var(--color-neutral-600);margin-top:10px">
          A balanced ledger is the goal — not a high one. It's a current, not a pile.
        </div>
      </div>
    </div>
    <div style="padding:22px 20px 8px;font-family:var(--font-heading);font-size:19px">Recent</div>
    <div style="display:flex;flex-direction:column;gap:2px;padding:0 16px">
      {#each w.ledger as e (e.id)}
        {@const gave = String(e.paidBy) === me}
        <div style="display:flex;align-items:center;gap:12px;padding:13px 6px;border-bottom:1px solid var(--color-divider)">
          <div
            style="width:34px;height:34px;border-radius:999px;background:{gave
              ? 'var(--color-accent-2-200)'
              : 'var(--color-accent-200)'};display:flex;align-items:center;justify-content:center;flex:none"
          >
            <Icon name={iconForText(e.description)} size={18} />
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700">{e.description}</div>
            <div style="font-size:11.5px;color:var(--color-neutral-600)">
              {gave ? "you provided" : "you received"} · {new Date(e.created).toLocaleDateString()}
            </div>
          </div>
          <div style="text-align:right">
            <div
              style="font-size:14px;font-weight:700;color:{gave
                ? 'var(--color-accent-2-700)'
                : 'var(--color-accent-700)'}"
            >
              {gave ? "+" : "−"}{Number(e.amount).toFixed(1)} {e.currency === "hour" ? "h" : e.currency}
            </div>
          </div>
        </div>
      {:else}
        <div style="padding:16px 6px;font-size:13px;color:var(--color-neutral-700)">
          No exchanges recorded yet — the first confirmed handoff lands here.
        </div>
      {/each}
    </div>
  </div>
</div>
