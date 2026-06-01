<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // An overlapping stack of participant avatars (Telegram photos with an
  // initials fallback). Shows up to `max`, then a "+N" chip.
  import type { TaskPerson } from "$lib/data";

  export let people: TaskPerson[] = [];
  export let max = 4;
  export let size = "1.7rem";

  function url(id: string | number): string {
    return `https://telegram.holons.io/getavatar?user_id=${id}`;
  }
  function hide(e: Event) {
    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
  }

  $: shown = people.slice(0, max);
  $: extra = people.length - shown.length;
</script>

{#if people.length}
  <div class="avatars" style="--sz: {size};">
    {#each shown as p (p.id)}
      <span class="av" title={p.name}>
        <span class="ini">{(p.name[0] ?? "·").toUpperCase()}</span>
        <img src={url(p.id)} alt="" loading="lazy" on:error={hide} />
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
