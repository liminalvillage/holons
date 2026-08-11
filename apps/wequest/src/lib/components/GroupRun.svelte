<script lang="ts">
  import { go, flash } from "$lib/stores";
  import {
    myNeeds,
    foreignNeeds,
    holonId,
    solidarityRuns,
    toggleRunParticipation,
    endRun,
  } from "$lib/live";
  import { getHolosphere, putAs } from "$lib/holosphere";
  import { resolveUserId, resolveUsername, initials } from "$lib/config";
  import { createMarketItem } from "@holons/core/tasks";
  import { get } from "svelte/store";

  const username = resolveUsername() || "you";
  const me = resolveUserId();

  // The run manifest is the real open demand across the rings.
  $: runItems = [
    ...$myNeeds.filter((n) => n.status === "requested" || n.status === "offered"),
    ...$foreignNeeds,
  ].slice(0, 8);

  $: runs = $solidarityRuns;
  $: myRun = runs.find((r: any) => String(r.initiator?.id ?? "") === me);

  function isIn(run: any): boolean {
    return (run.participants ?? []).some((p: any) => String(p?.id) === me);
  }

  let joining = false;
  let busyRunId: string | null = null;

  async function toggleRun(run: any) {
    busyRunId = String(run.id);
    await toggleRunParticipation(run);
    busyRunId = null;
  }

  async function finishRun(run: any) {
    busyRunId = String(run.id);
    await endRun(run);
    busyRunId = null;
  }

  /** Volunteering to carry = a real marketplace offer on the quests lens. */
  async function joinRun() {
    const holon = get(holonId);
    if (!holon || joining) return;
    joining = true;
    const hs = await getHolosphere();
    const offer = createMarketItem({
      holonId: holon,
      initiator: { id: me || "guest", username },
      kind: "offer",
      title: "Carry the solidarity run",
      description: `Collecting ${runItems.length} open need${runItems.length === 1 ? "" : "s"} in one trip.`,
      itemType: "service",
      transactionTypes: ["receive-donate"],
      tags: ["solidarity-run"],
    });
    // One active run per carrier: same id → upsert, not a new offer per tap.
    offer.id = `run-${me || "guest"}`;
    try {
      await putAs(hs, holon, "quests", offer);
      flash("You're carrying — the offer is live on the board.");
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

    {#if runs.length}
      <div style="font-family:var(--font-heading);font-size:19px;margin-top:22px">Active runs</div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        {#each runs as run (run.id)}
          <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:14px;display:flex;gap:12px;align-items:center">
            <div
              style="width:42px;height:42px;border-radius:999px;background:var(--color-accent-300);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:15px;color:var(--color-accent-800);flex:none"
            >
              {initials(String(run.initiator?.username ?? run.initiator?.id ?? "?"))}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:14.5px">
                {String(run.initiator?.id ?? "") === me
                  ? "You're carrying"
                  : `${run.initiator?.username ?? "Someone"} is carrying`}
              </div>
              <div style="font-size:12px;color:var(--color-neutral-700);margin-top:2px">
                {(run.participants ?? []).length} along for the ride
              </div>
            </div>
            {#if String(run.initiator?.id ?? "") === me}
              <button
                class="tapp"
                disabled={busyRunId === String(run.id)}
                on:click={() => finishRun(run)}
                style="height:40px;padding:0 16px;border-radius:999px;background:var(--color-accent-2-700);color:var(--color-neutral-100);font-family:var(--font-heading);font-size:13.5px"
              >
                End run
              </button>
            {:else}
              <button
                class="tapp"
                disabled={busyRunId === String(run.id)}
                on:click={() => toggleRun(run)}
                style="height:40px;padding:0 16px;border-radius:999px;background:{isIn(run)
                  ? 'var(--color-surface-2, var(--color-accent-200))'
                  : 'var(--color-accent)'};color:{isIn(run)
                  ? 'var(--color-text)'
                  : 'var(--color-neutral-100)'};font-family:var(--font-heading);font-size:13.5px"
              >
                {isIn(run) ? "Leave" : "Join"}
              </button>
            {/if}
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

    {#if !myRun}
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
    {/if}
  </div>
</div>
