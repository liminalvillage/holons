<script lang="ts">
  import Icon from "./Icon.svelte";
  import { go } from "$lib/stores";
  import {
    holonName,
    holonId,
    partners,
    addPartner,
    removePartner,
  } from "$lib/live";

  let partnerInput = "";
  let linking = false;
  let unlinkingId: string | null = null;

  async function link() {
    if (linking || !partnerInput.trim()) return;
    linking = true;
    const ok = await addPartner(partnerInput);
    linking = false;
    if (ok) partnerInput = "";
  }

  async function unlink(id: string) {
    unlinkingId = id;
    await removePartner(id);
    unlinkingId = null;
  }
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
    <div style="font-family:var(--font-heading);font-size:19px;margin-top:26px">Link a holon</div>
    <div style="font-size:12.5px;color:var(--color-neutral-700);margin-top:4px;text-wrap:pretty">
      Paste a holon id — a Telegram group's chat id, or the id in the dashboard's URL. Needs and
      offers flow both ways over the quests lens.
    </div>
    <form on:submit|preventDefault={link} style="display:flex;gap:8px;margin-top:10px">
      <input
        bind:value={partnerInput}
        placeholder="Holon id, e.g. -1001234567890"
        style="flex:1;height:48px;border-radius:999px;border:1.5px solid var(--color-divider);background:var(--color-surface);padding:0 16px;font:inherit;font-size:14px;min-width:0"
      />
      <button
        type="submit"
        class="tapp"
        disabled={linking || !partnerInput.trim()}
        style="height:48px;padding:0 20px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:15px;flex:none"
      >
        {linking ? "Linking…" : "Federate"}
      </button>
    </form>

    <div style="font-family:var(--font-heading);font-size:19px;margin-top:26px">Open exchanges</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
      {#each $partners as p (p.id)}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;display:flex;align-items:center;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px">{$holonName || "Here"} ⇄ {p.name}</div>
            <div style="font-size:12px;color:var(--color-neutral-600);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              {p.id}
            </div>
          </div>
          <button
            class="tapp"
            on:click={() => unlink(p.id)}
            disabled={unlinkingId === p.id}
            style="height:36px;padding:0 14px;border-radius:999px;border:1.5px solid var(--color-divider);color:var(--color-neutral-700);font-weight:700;font-size:12.5px;flex:none;background:transparent;opacity:{unlinkingId ===
            p.id
              ? 0.5
              : 1}"
          >
            {unlinkingId === p.id ? "Unlinking…" : "Unlink"}
          </button>
        </div>
      {:else}
        <div style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px;font-size:13px;color:var(--color-neutral-700)">
          No federation links yet — link a partner holon above and their needs flow in here.
        </div>
      {/each}
    </div>
  </div>
</div>
