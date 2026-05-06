<script lang="ts">
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';

  export let title = 'Window';
  export let width = 400;
  export let height = 300;
  export let minWidth = 300;
  export let minHeight = 200;
  export let maxWidth = 1200;
  export let maxHeight = 800;
  export let initialX = 100;
  export let initialY = 100;
  export let resizable = true;

  const dispatch = createEventDispatcher();

  let windowElement: HTMLElement;
  let headerElement: HTMLElement;
  let isDragging = false;
  let isResizing = false;
  let dragOffset = { x: 0, y: 0 };
  let resizeType = '';
  
  let x = initialX;
  let y = initialY;
  let w = width;
  let h = height;
  
  // Make current dimensions reactive and bindable
  $: width = w;
  $: height = h;

  onMount(() => {
    // Ensure the window starts within viewport bounds
    const maxX = window.innerWidth - w;
    const maxY = window.innerHeight - h;
    
    x = Math.min(Math.max(0, x), maxX);
    y = Math.min(Math.max(0, y), maxY);
  });

  function handleMouseDown(event: MouseEvent) {
    if (event.target === headerElement || headerElement.contains(event.target as Node)) {
      isDragging = true;
      dragOffset.x = event.clientX - x;
      dragOffset.y = event.clientY - y;
      event.preventDefault();
      
      // Bring window to front
      windowElement.style.zIndex = '10000';
    }
  }

  function handleResizeStart(event: MouseEvent, type: string) {
    if (!resizable) return;
    
    isResizing = true;
    resizeType = type;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleMouseMove(event: MouseEvent) {
    if (isDragging) {
      const newX = event.clientX - dragOffset.x;
      const newY = event.clientY - dragOffset.y;
      
      // Keep window within viewport
      const maxX = window.innerWidth - w;
      const maxY = window.innerHeight - h;
      
      x = Math.min(Math.max(0, newX), maxX);
      y = Math.min(Math.max(0, newY), maxY);
    }
    
    if (isResizing) {
      const rect = windowElement.getBoundingClientRect();
      
      if (resizeType.includes('right')) {
        w = Math.min(maxWidth, Math.max(minWidth, event.clientX - rect.left));
      }
      if (resizeType.includes('bottom')) {
        h = Math.min(maxHeight, Math.max(minHeight, event.clientY - rect.top));
      }
      if (resizeType.includes('left')) {
        const newWidth = Math.min(maxWidth, Math.max(minWidth, rect.right - event.clientX));
        const deltaWidth = newWidth - w;
        w = newWidth;
        x = Math.max(0, x - deltaWidth);
      }
      if (resizeType.includes('top')) {
        const newHeight = Math.min(maxHeight, Math.max(minHeight, rect.bottom - event.clientY));
        const deltaHeight = newHeight - h;
        h = newHeight;
        y = Math.max(0, y - deltaHeight);
      }
    }
  }

  function handleMouseUp() {
    isDragging = false;
    isResizing = false;
    resizeType = '';
  }

  function handleClose() {
    dispatch('close');
  }

  // Global mouse events for dragging/resizing
  $: if (typeof window !== 'undefined') {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
  }
</script>

<svelte:window on:mousemove={handleMouseMove} on:mouseup={handleMouseUp} />

<div 
  bind:this={windowElement}
  class="draggable-window"
  style="left: {x}px; top: {y}px; width: {w}px; height: {h}px;"
  class:dragging={isDragging}
  class:resizing={isResizing}
>
  <div 
    bind:this={headerElement}
    class="window-header"
    on:mousedown={handleMouseDown}
    role="button"
    tabindex="0"
  >
    <div class="window-title">{title}</div>
    <button class="close-button" on:click={handleClose}>
      ✕
    </button>
  </div>
  
  <div class="window-content">
    <slot />
  </div>

  {#if resizable}
    <!-- Resize handles -->
    <div class="resize-handle resize-right" role="button" tabindex="0" aria-label="Resize right" on:mousedown={(e) => handleResizeStart(e, 'right')}></div>
    <div class="resize-handle resize-bottom" role="button" tabindex="0" aria-label="Resize bottom" on:mousedown={(e) => handleResizeStart(e, 'bottom')}></div>
    <div class="resize-handle resize-left" role="button" tabindex="0" aria-label="Resize left" on:mousedown={(e) => handleResizeStart(e, 'left')}></div>
    <div class="resize-handle resize-top" role="button" tabindex="0" aria-label="Resize top" on:mousedown={(e) => handleResizeStart(e, 'top')}></div>
    <div class="resize-handle resize-bottom-right" role="button" tabindex="0" aria-label="Resize bottom right" on:mousedown={(e) => handleResizeStart(e, 'bottom right')}></div>
    <div class="resize-handle resize-bottom-left" role="button" tabindex="0" aria-label="Resize bottom left" on:mousedown={(e) => handleResizeStart(e, 'bottom left')}></div>
    <div class="resize-handle resize-top-right" role="button" tabindex="0" aria-label="Resize top right" on:mousedown={(e) => handleResizeStart(e, 'top right')}></div>
    <div class="resize-handle resize-top-left" role="button" tabindex="0" aria-label="Resize top left" on:mousedown={(e) => handleResizeStart(e, 'top left')}></div>
  {/if}
</div>

<style>
  .draggable-window {
    position: fixed;
    background: rgba(0, 0, 0, 0.95);
    border: 1px solid #333;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 9999;
    overflow: hidden;
    backdrop-filter: blur(10px);
  }

  .draggable-window:global(.dragging) {
    user-select: none;
  }

  .window-header {
    background: rgba(20, 20, 20, 0.9);
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: move;
    border-bottom: 1px solid #333;
    user-select: none;
  }

  .window-title {
    color: white;
    font-weight: 500;
    font-size: 0.9rem;
  }

  .close-button {
    background: transparent;
    border: none;
    color: #999;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 0.8rem;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .window-content {
    height: calc(100% - 40px);
    overflow: hidden;
  }

  /* Resize handles */
  .resize-handle {
    position: absolute;
    background: transparent;
  }

  .resize-right {
    top: 0;
    right: -2px;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
  }

  .resize-bottom {
    bottom: -2px;
    left: 0;
    width: 100%;
    height: 4px;
    cursor: ns-resize;
  }

  .resize-left {
    top: 0;
    left: -2px;
    width: 4px;
    height: 100%;
    cursor: ew-resize;
  }

  .resize-top {
    top: -2px;
    left: 0;
    width: 100%;
    height: 4px;
    cursor: ns-resize;
  }

  .resize-bottom-right {
    bottom: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    cursor: nw-resize;
  }

  .resize-bottom-left {
    bottom: -2px;
    left: -2px;
    width: 8px;
    height: 8px;
    cursor: ne-resize;
  }

  .resize-top-right {
    top: -2px;
    right: -2px;
    width: 8px;
    height: 8px;
    cursor: ne-resize;
  }

  .resize-top-left {
    top: -2px;
    left: -2px;
    width: 8px;
    height: 8px;
    cursor: nw-resize;
  }
</style>