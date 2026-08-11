<script lang="ts">
  import { composeOpen, composeIntent, draft, go } from "$lib/stores";
  import {
    shoppingList,
    selectedNeed,
    toggleListItem,
    removeListItem,
    partners,
  } from "$lib/live";
  import { initials } from "$lib/config";

  let removingId: string | null = null;
  async function remove(entry: { item: any; need: any }) {
    removingId = String(entry.item.id);
    await removeListItem(entry);
    removingId = null;
  }

  function openCompose() {
    draft.set("");
    composeIntent.set("need");
    composeOpen.set(true);
  }

  function openEntry(entry: { item: any; need: any }) {
    if (entry.need) {
      selectedNeed.set(entry.need);
      go("quest");
    } else {
      void toggleListItem(entry.item);
    }
  }

  function statusOf(entry: { item: any; need: any }): string {
    if (entry.item.checked) return "Done";
    const n = entry.need;
    if (!n) return "Private — not shared yet (tap to check off)";
    const responses = n.responses?.length ?? 0;
    if (n.status === "requested") return "Signalled · waiting for the ring";
    if (n.status === "offered") return `${responses} answer${responses === 1 ? "" : "s"} — tap to choose`;
    if (n.status === "claimed") return "Claimed · ready for handoff";
    return n.status;
  }

  function dotColor(entry: { item: any; need: any }): { dot: string; bg: string } {
    const n = entry.need;
    if (!n || n.status === "requested")
      return { dot: "#c67139", bg: "var(--color-accent-200)" };
    return { dot: "#7a8a5e", bg: "var(--color-accent-2-200)" };
  }
</script>

<div class="scr">
  <div style="padding:52px 20px 14px">
    <div
      style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--color-neutral-600);font-weight:700"
    >
      Shared with {$partners.length} federated holon{$partners.length === 1 ? "" : "s"}
    </div>
    <div style="font-family:var(--font-heading);font-size:30px;line-height:1.08;margin-top:4px">
      Your list is a signal
    </div>
    <div style="font-size:13.5px;color:var(--color-neutral-700);margin-top:8px;text-wrap:pretty">
      Write down what you need. The neighbourhood reads it before the supermarket does.
    </div>
  </div>
  <div class="body" style="padding:6px 16px 116px">
    <div style="display:flex;flex-direction:column;gap:10px">
      {#each $shoppingList as entry (entry.item.id)}
        {@const colors = dotColor(entry)}
        <button
          class="tapp"
          on:click={() => openEntry(entry)}
          style="background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;display:flex;gap:13px;align-items:center;width:100%;opacity:{entry
            .item.checked
            ? 0.55
            : 1}"
        >
          <div
            style="width:26px;height:26px;border-radius:999px;flex:none;display:flex;align-items:center;justify-content:center;background:{colors.bg}"
          >
            <div style="width:9px;height:9px;border-radius:999px;background:{colors.dot}"></div>
          </div>
          <div style="flex:1;min-width:0;text-align:left">
            <div
              style="font-weight:700;font-size:14.5px;{entry.item.checked
                ? 'text-decoration:line-through'
                : ''}"
            >
              {entry.item.text}
            </div>
            <div style="font-size:12px;color:var(--color-neutral-600);margin-top:2px">{statusOf(entry)}</div>
          </div>
          <div style="display:flex;align-items:center">
            {#each (entry.need?.responses ?? []).slice(0, 3) as r, i (r.id)}
              <div
                style="width:26px;height:26px;border-radius:999px;background:var(--color-accent-2-300);color:var(--color-accent-2-900);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-left:{i ===
                0
                  ? '0'
                  : '-7px'};border:2px solid var(--color-surface)"
              >
                {initials(String(r.responder?.name ?? r.responder?.id ?? "?"))}
              </div>
            {/each}
          </div>
          <span
            role="button"
            tabindex="0"
            aria-label="Remove from the list"
            on:click|stopPropagation={() => remove(entry)}
            on:keydown={(e) => e.key === "Enter" && remove(entry)}
            style="width:30px;height:30px;border-radius:999px;display:flex;align-items:center;justify-content:center;color:var(--color-neutral-600);font-size:15px;flex:none;opacity:{removingId ===
            String(entry.item.id)
              ? 0.4
              : 1}"
          >
            ×
          </span>
        </button>
      {:else}
        <div
          style="background:var(--color-surface);border-radius:var(--radius-md);padding:18px;font-size:13px;color:var(--color-neutral-700)"
        >
          The list is empty — start with the first thing you'd write before going to the shop.
        </div>
      {/each}
    </div>
    <button
      class="tapp"
      on:click={openCompose}
      style="width:100%;margin-top:14px;height:52px;border-radius:var(--radius-md);border:1.5px dashed var(--color-neutral-400);display:flex;align-items:center;justify-content:center;gap:8px;color:var(--color-neutral-700);font-weight:700;font-size:14px"
    >
      + Add to the list
    </button>

    <div style="margin-top:24px;background:var(--color-accent-2-200);border-radius:var(--radius-lg);padding:18px 18px 20px">
      <div style="font-family:var(--font-heading);font-size:19px;color:var(--color-accent-2-800)">
        Turn this into a run
      </div>
      <div style="font-size:13px;color:var(--color-accent-2-800);margin-top:6px;text-wrap:pretty">
        Neighbours asking for the same things can collapse their lists into one trip — the producer
        sells at their own price.
      </div>
      <button
        class="tapp"
        on:click={() => go("group")}
        style="margin-top:14px;height:44px;border-radius:999px;background:var(--color-accent-2-700);color:var(--color-neutral-100);display:inline-flex;align-items:center;padding:0 20px;font-family:var(--font-heading);font-size:14.5px"
      >
        Open the solidarity run
      </button>
    </div>
  </div>
</div>
