<script lang="ts">
  import { go, flash } from "$lib/stores";
  import { myNeeds, foreignNeeds, holonId } from "$lib/live";
  import { getHolosphere, putAs } from "$lib/holosphere";
  import { resolveUserId, resolveUsername, initials } from "$lib/config";
  import { createMarketItem } from "@holons/core/tasks";
  import { get } from "svelte/store";

  const username = resolveUsername() || "you";

  // The run manifest is the real open demand across the rings.
  $: runItems = [
    ...$myNeeds.filter((n) => n.status === "requested" || n.status === "offered"),
    ...$foreignNeeds,
  ].slice(0, 8);

  let joining = false;

  /** Volunteering to carry = a real marketplace offer on the quests lens. */
  async function joinRun() {
    const holon = get(holonId);
    if (!holon || joining) return;
    joining = true;
    const hs = await getHolosphere();
    const offer = createMarketItem({
      holonId: holon,
      initiator: { id: resolveUserId() || "guest", username },
      kind: "offer",
      title: "Carry the solidarity run",
      description: `Collecting ${runItems.length} open need${runItems.length === 1 ? "" : "s"} in one trip.`,
      itemType: "service",
      transactionTypes: ["receive-donate"],
      tags: ["solidarity-run"],
    });
    offer.id = `run-${Date.now().toString(36)}`;
    try {
      await putAs(hs, holon, "quests", offer);
      flash("You're carrying — the offer is live on the board.");
      go("home");
    } catch {
      flash("Could not publish the run offer.");
    } finally {
      joining = false;
    }
  }
</script>

<div class="scr">
  <div style="padding:52px 20px 0">
    <button
      class="tapp"
      on:click={() => go("list")}
      style="width:44px;height:44px;border-radius:999px;background:var(--color-surface);display:flex;align-items:center;justify-content:center;font-size:18px"
    >
      ←
    </button>
  </div>
  <div class="body" style="padding:16px 20px 24px">
    <div
      style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600);font-weight:700"
    >
      Open demand · across your rings
    </div>
    <div style="font-family:var(--font-heading);font-size:30px;line-height:1.06;margin-top:5px">Solidarity run</div>
    <div style="font-size:13.5px;color:var(--color-neutral-700);margin-top:8px;text-wrap:pretty">
      {runItems.length
        ? `${runItems.length} open need${runItems.length === 1 ? "" : "s"} could collapse into one trip. Someone carries; everyone is fed.`
        : "Nothing open right now — when the rings ask, the run assembles here."}
    </div>

    {#if runItems.length}
      <div style="background:var(--color-accent-2-200);border-radius:var(--radius-lg);padding:18px;margin-top:20px">
        <div style="display:flex;align-items:center;gap:12px">
          <div
            style="width:46px;height:46px;border-radius:999px;background:var(--color-accent-2-400);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);color:var(--color-accent-2-900)"
          >
            {initials(username)}
          </div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14.5px">Someone needs to carry</div>
            <div style="font-size:12px;color:var(--color-accent-2-800)">volunteer below — it becomes a live offer</div>
          </div>
        </div>
        <div style="height:1px;background:rgba(32,30,29,.12);margin:14px 0"></div>
        {#each runItems as r (r.id)}
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0">
            <div
              style="width:18px;height:18px;border-radius:6px;background:{r._federation || r._hologram
                ? 'var(--color-accent-2-400)'
                : 'var(--color-accent-400)'};flex:none"
            ></div>
            <div style="flex:1;font-size:13.5px;color:var(--color-accent-2-900)">{r.title}</div>
            <div style="font-size:12px;font-weight:700;color:var(--color-accent-2-800)">
              {r._federation?.originName || r.initiator?.username || "you"}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div style="background:var(--color-surface);border-radius:var(--radius-lg);padding:18px;margin-top:14px">
      <div style="font-family:var(--font-heading);font-size:18px">Producer keeps their price</div>
      <div style="font-size:13px;color:var(--color-neutral-700);margin-top:6px;text-wrap:pretty">
        Producers sell at the counter price — no chain in between. The run only pays for the
        carrying, in hours.
      </div>
    </div>

    <button
      class="tapp"
      on:click={joinRun}
      disabled={joining || runItems.length === 0}
      style="width:100%;margin-top:18px;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px;opacity:{runItems.length
        ? 1
        : 0.5}"
    >
      {joining ? "Publishing…" : "I'll carry the run"}
    </button>
  </div>
</div>
