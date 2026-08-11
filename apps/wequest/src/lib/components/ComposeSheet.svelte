<script lang="ts">
  import Icon from "./Icon.svelte";
  import { KINDS, RINGS, SUGGESTIONS } from "$lib/data";
  import { composeOpen, draft, ring } from "$lib/stores";
  import { addToList, demandBars } from "$lib/live";

  let kindIdx = 0;
  let sending = false;

  // Suggest what the rings are actually asking for; the static examples
  // only fill in while there is no live demand at all.
  $: suggestions = $demandBars.length
    ? $demandBars.slice(0, 4).map(([label]) => label)
    : SUGGESTIONS;

  async function submit() {
    if (!$draft.trim() || sending) return;
    sending = true;
    await addToList($draft, kindIdx, $ring);
    sending = false;
    composeOpen.set(false);
    draft.set("");
  }
</script>

{#if $composeOpen}
  <div style="position:absolute;inset:0;background:rgba(32,30,29,.45);display:flex;align-items:flex-end;z-index:20">
    <div
      style="width:100%;background:var(--color-bg);border-radius:var(--radius-lg) var(--radius-lg) 0 0;padding:22px 20px 26px;animation:sheetUp .26s cubic-bezier(.2,.8,.3,1)"
    >
      <div style="width:44px;height:5px;border-radius:999px;background:var(--color-neutral-400);margin:0 auto 16px"></div>
      <div style="font-family:var(--font-heading);font-size:25px">Add to your list</div>
      <div style="font-size:13px;color:var(--color-neutral-700);margin-top:4px">
        Say it the way you'd say it out loud.
      </div>
      <!-- svelte-ignore a11y-autofocus -->
      <input
        bind:value={$draft}
        autofocus
        placeholder="I need…"
        style="width:100%;background:var(--color-surface);border:none;border-radius:var(--radius-md);padding:14px 16px;margin-top:16px;font:inherit;font-size:16px;font-weight:700;min-height:52px"
      />
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        {#each suggestions as s (s)}
          <button
            class="tapp chip"
            on:click={() => draft.set(s)}
            style="background:var(--color-accent-2-200);color:var(--color-accent-2-800);padding:9px 14px;font-size:13px"
          >
            {s}
          </button>
        {/each}
      </div>
      <div style="display:flex;gap:10px;margin-top:18px">
        {#each KINDS as k, i (k.label)}
          <button
            class="tapp"
            on:click={() => (kindIdx = i)}
            style="flex:1;height:64px;border-radius:var(--radius-md);border:1.5px solid {kindIdx === i
              ? 'var(--color-accent-500)'
              : 'transparent'};background:{kindIdx === i
              ? 'var(--color-accent-200)'
              : 'var(--color-surface)'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px"
          >
            <Icon name={k.icon} size={20} />
            <div style="font-size:11.5px;font-weight:700">{k.label}</div>
          </button>
        {/each}
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:18px">
        <div style="font-size:13px;font-weight:700;flex:1">How far should it travel?</div>
        <div style="font-size:12.5px;color:var(--color-accent-700);font-weight:700">{RINGS[$ring]}</div>
      </div>
      <div style="display:flex;gap:6px;margin-top:10px">
        {#each RINGS as r, i (r)}
          <button
            class="tapp"
            on:click={() => ring.set(i)}
            style="flex:1;height:44px;border-radius:999px;background:{$ring === i
              ? 'var(--color-accent-2-700)'
              : 'var(--color-surface)'};color:{$ring === i
              ? 'var(--color-neutral-100)'
              : 'var(--color-text)'};display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700"
          >
            {r}
          </button>
        {/each}
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button
          class="tapp"
          on:click={() => composeOpen.set(false)}
          aria-label="Close"
          style="width:56px;height:56px;border-radius:999px;border:1.5px solid var(--color-divider);display:flex;align-items:center;justify-content:center;font-size:18px"
        >
          ✕
        </button>
        <button
          class="tapp"
          on:click={submit}
          disabled={sending || !$draft.trim()}
          style="flex:1;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px;opacity:{$draft.trim()
            ? 1
            : 0.6}"
        >
          {sending ? "Publishing…" : "Send it to the ring"}
        </button>
      </div>
    </div>
  </div>
{/if}
