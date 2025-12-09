<script>
  import { createEventDispatcher } from 'svelte';
  import { fade, scale } from 'svelte/transition';

  const dispatch = createEventDispatcher();

  export let open = false;
  export let title = '';
  export let content = '';
  export let width = 400;
  export let height = 300;

  function handleClose() {
    dispatch('close');
  }

  function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      handleClose();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="z-dialog-overlay"
    on:click={handleOverlayClick}
    on:keydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    transition:fade={{ duration: 200 }}
  >
    <div
      class="z-dialog"
      style="width: {width}px; max-height: {height}px;"
      transition:scale={{ duration: 200, start: 0.8 }}
    >
      {#if title}
        <div class="z-dialog-title">{title}</div>
      {/if}

      <div class="z-dialog-content">
        {#if content}
          {content}
        {/if}
        <slot />
      </div>

      <div class="z-dialog-extension">
        <slot name="extension" />
      </div>
    </div>
  </div>
{/if}

<style>
  .z-dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .z-dialog {
    position: relative;
    background: var(--z-surface);
    border: var(--z-spot-border);
    border-radius: 20px;
    padding: 30px;
    max-width: 90vw;
    overflow: auto;
    backdrop-filter: blur(10px);
  }

  .z-dialog-title {
    font-size: 1.5em;
    font-weight: 700;
    margin-bottom: 15px;
    color: var(--z-text);
  }

  .z-dialog-content {
    color: var(--z-text-secondary);
    line-height: 1.6;
  }

  .z-dialog-extension {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(100% + 100px);
    height: calc(100% + 100px);
    pointer-events: none;
  }

  .z-dialog-extension > :global(*) {
    pointer-events: auto;
  }
</style>
