<script>
  import { getContext, onMount } from 'svelte';
  import { zircle, isAnimating } from '../../stores/zircle.js';

  export let label = '';
  export let size = 300; // Default size in pixels

  let entering = true;
  let viewSize = size;

  // Check if we should use percent sizes
  $: if ($zircle.usePercentSizes) {
    viewSize = Math.min(window.innerWidth, window.innerHeight) * 0.6;
  }

  onMount(() => {
    setTimeout(() => {
      entering = false;
    }, 400);
  });
</script>

<div
  class="z-view"
  class:entering
  style="
    width: {viewSize}px;
    height: {viewSize}px;
    margin-left: -{viewSize / 2}px;
    margin-top: -{viewSize / 2}px;
  "
>
  <div class="z-view-inner z-content">
    <slot />
  </div>

  {#if label}
    <div class="z-view-label">{label}</div>
  {/if}

  <div class="z-view-extension">
    <slot name="extension" />
  </div>
</div>

<style>
  .z-view {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--z-surface);
    border: var(--z-spot-border);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: visible;
  }

  .z-view.entering {
    animation: viewEnter 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  @keyframes viewEnter {
    from {
      opacity: 0;
      transform: scale(0.5);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .z-view-inner {
    position: absolute;
    width: 70%;
    height: 70%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: auto;
    background: radial-gradient(40% 40% at 50% 50%, hsla(0, 0%, 100%, 0.1) 0, rgba(0, 0, 0, 0.1) 100%);
  }

  .z-view-label {
    position: absolute;
    bottom: 15%;
    font-size: 0.9em;
    font-weight: 600;
    color: var(--z-text-secondary);
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  .z-view-extension {
    position: absolute;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .z-view-extension > :global(*) {
    pointer-events: auto;
  }
</style>
