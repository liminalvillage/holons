<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // A round face for an id: the avatar route if it has one, an initial if not.
  import { initial } from "./format";

  export let id: string;
  export let name = "";
  export let size = 36;
  /** A holon, not a person — shown as its hexagon rather than a face. */
  export let holon = false;

  let failed = false;
  // A new id gets a fresh try at the image.
  $: if (id) failed = false;
</script>

<span
  class="avatar"
  class:holon
  style="--size: {size}px"
  aria-hidden="true"
>
  {#if holon}
    ⬡
  {:else if !failed}
    <img
      src={`/api/avatar?user_id=${encodeURIComponent(id)}`}
      alt=""
      loading="lazy"
      on:error={() => (failed = true)}
    />
  {:else}
    {initial(name || id)}
  {/if}
</span>

<style>
  .avatar {
    flex: 0 0 auto;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--color-bg-tertiary);
    color: var(--color-text-secondary);
    font-weight: 700;
    font-size: calc(var(--size) * 0.42);
  }

  .avatar.holon {
    background: rgba(15, 118, 110, 0.25);
    color: #5eead4;
    font-size: calc(var(--size) * 0.55);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
