<script lang="ts" context="module">
  // Shared avatar primitives (also used by the detail modal's people chips).

  /** Telegram profile photo for a user id, resolved by the kiosk's own
   *  /api/avatar route through the Bot API (getUserProfilePhotos → getFile). */
  export function avatarUrl(id: string | number): string {
    return `/api/avatar?user_id=${encodeURIComponent(String(id))}`;
  }
  /** First letter of the human part of the name ("@user" → "U", not "@"). */
  export function avatarInitial(name: string): string {
    return (name.replace(/^[@#]/, "")[0] ?? "·").toUpperCase();
  }
  /** Image fallback handlers: hide on error, un-hide when a retry loads. */
  export function hideImg(e: Event) {
    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
  }
  export function showImg(e: Event) {
    // Remove the override rather than force `visible`: an explicit inline
    // `visibility: visible` beats any hidden ANCESTOR (visibility inherits but
    // children can override it) — it made loaded avatars float free of a
    // drag-ghosted card and glide to the drop slot on their own.
    (e.currentTarget as HTMLImageElement).style.removeProperty("visibility");
  }
</script>

<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // An overlapping stack of participant avatars (Telegram photos with an
  // initials fallback). Shows up to `max`, then a "+N" chip.
  import type { TaskPerson } from "$lib/data";

  export let people: TaskPerson[] = [];
  export let max = 4;
  export let size = "1.7rem";

  $: shown = people.slice(0, max);
  $: extra = people.length - shown.length;
</script>

{#if people.length}
  <div class="avatars" style="--sz: {size};">
    {#each shown as p (p.id)}
      <span class="av" title={p.name}>
        <span class="ini">{avatarInitial(p.name)}</span>
        <img
          src={avatarUrl(p.id)}
          alt=""
          loading="lazy"
          on:error={hideImg}
          on:load={showImg}
        />
      </span>
    {/each}
    {#if extra > 0}
      <span class="av more"><span class="ini">+{extra}</span></span>
    {/if}
  </div>
{/if}

<style>
  .avatars {
    display: flex;
    align-items: center;
  }
  .av {
    flex: 0 0 auto;
    position: relative;
    width: var(--sz);
    height: var(--sz);
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    margin-left: -0.45rem;
    box-shadow: 0 0 0 2px var(--card);
  }
  .av:first-child {
    margin-left: 0;
  }
  .ini {
    font-size: calc(var(--sz) * 0.42);
    font-weight: 800;
    color: #fff;
  }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .av.more {
    background: var(--paper-deep);
  }
  .av.more .ini {
    color: var(--ink-soft);
  }
</style>
