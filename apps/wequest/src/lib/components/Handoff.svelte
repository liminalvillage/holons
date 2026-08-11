<script lang="ts">
  import { go } from "$lib/stores";
  import { selectedNeed, confirmHandoffAs, handoffConfirms } from "$lib/live";

  $: need = $selectedNeed;
  $: accepted = (need?.responses ?? []).find((r: any) => r.id === need?.claimedResponseId);
  $: providerName = accepted?.responder?.name ?? "the provider";
  $: hours =
    accepted && typeof accepted.price === "number" && accepted.price > 0 ? accepted.price : 1;
  $: code = need?.handoff?.code ?? "";
  $: confirms = $handoffConfirms[String(need?.id ?? "")] ?? {};
  $: iConfirmed = Boolean(confirms.requesterAt || need?.handoff?.requesterAt);
  $: theyConfirmed = Boolean(confirms.providerAt || need?.handoff?.providerAt);

  // The other side finalized while we were watching — the hours have moved.
  // `replace`: the back button must not land here again (this reactive
  // statement would bounce straight back to the wallet, looping the stack).
  $: if (need?.status === "fulfilled") {
    go("wallet", { replace: true });
  }

  let confirming = false;
  async function confirm() {
    if (confirming) return;
    confirming = true;
    const res = await confirmHandoffAs("requester");
    confirming = false;
    if (res.both) go("wallet", { replace: true });
  }
</script>

<div class="scr" style="background:var(--color-accent-2-800)">
  <div class="body" style="padding:70px 26px 26px;display:flex;flex-direction:column;align-items:center;text-align:center">
    <div style="position:relative;width:190px;height:190px;display:flex;align-items:center;justify-content:center;margin-top:18px">
      <div
        style="position:absolute;width:150px;height:150px;border-radius:999px;border:2px solid #cddbb2;animation:pulseRing 2.4s ease-out infinite"
      ></div>
      <div
        style="position:absolute;width:150px;height:150px;border-radius:999px;border:2px solid #cddbb2;animation:pulseRing 2.4s ease-out infinite 1.2s"
      ></div>
      <svg viewBox="0 0 120 138" style="width:120px;height:138px">
        <polygon points="60,2 118,35 118,103 60,136 2,103 2,35" fill="#c67139" />
      </svg>
      <div style="position:absolute;font-family:var(--font-heading);font-size:34px;color:#f5ead8">{code}</div>
    </div>
    <div style="font-family:var(--font-heading);font-size:28px;color:var(--color-neutral-100);margin-top:26px;text-wrap:pretty">
      Show this to {providerName}
    </div>
    <div style="font-size:14.5px;color:var(--color-accent-2-300);margin-top:10px;max-width:280px;text-wrap:pretty">
      They type it in on their screen; you confirm on yours. When both sides have,
      {hours.toFixed(1)} hour{hours === 1 ? "" : "s"} move to them on the ledger. No money changes
      hands.
    </div>

    <div style="width:100%;background:rgba(245,234,216,.1);border-radius:var(--radius-lg);padding:16px 18px;margin-top:26px;text-align:left">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--color-accent-2-200);padding:5px 0">
        <span>{need?.title ?? "The exchange"}</span><span style="font-weight:700;color:#f5ead8">{hours.toFixed(1)} h</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--color-accent-2-200);padding:5px 0">
        <span>Your confirmation</span>
        <span style="font-weight:700;color:#f5ead8">{iConfirmed ? "✓ done" : "pending"}</span>
      </div>
      <div
        style="display:flex;justify-content:space-between;font-size:13.5px;color:var(--color-accent-2-200);padding:5px 0;border-top:1px solid rgba(245,234,216,.18);margin-top:6px;padding-top:11px"
      >
        <span>{providerName} taps the code in</span>
        <span style="font-weight:700;color:#f5ead8">{theyConfirmed ? "✓ done" : "waiting"}</span>
      </div>
    </div>

    {#if iConfirmed}
      <div
        style="width:100%;margin-top:22px;height:56px;border-radius:999px;border:1.5px solid rgba(245,234,216,.3);color:var(--color-accent-2-200);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:16px"
      >
        Waiting for {providerName}…
      </div>
    {:else}
      <button
        class="tapp"
        on:click={confirm}
        disabled={confirming}
        style="width:100%;margin-top:22px;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px"
      >
        {confirming ? "Recording…" : "Confirm the handoff"}
      </button>
    {/if}
    <button
      class="tapp"
      on:click={() => go("quest")}
      style="height:44px;display:flex;align-items:center;font-size:13px;color:var(--color-accent-2-300)"
    >
      Back to the need
    </button>
  </div>
</div>
