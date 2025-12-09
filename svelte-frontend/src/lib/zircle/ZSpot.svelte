<script>
  import { createEventDispatcher } from 'svelte';
  import { zircle } from '../../stores/zircle.js';

  const dispatch = createEventDispatcher();

  // Props
  export let angle = 0;
  export let distance = 100;
  export let size = 'm'; // xs, s, m, l, xl
  export let label = '';
  export let labelPos = 'right'; // left, right, top, bottom
  export let button = false;
  export let toView = null; // string or { name: string, params: object }
  export let progress = 0;
  export let knob = false;
  export let qty = 0;
  export let index = 0;
  export let imagePath = '';

  // Size mapping
  const sizes = {
    xs: 50,
    s: 70,
    m: 100,
    l: 140,
    xl: 180
  };

  let spotSize = sizes[size] || sizes.m;
  let isDragging = false;
  let startAngle = 0;

  // Calculate position based on angle and distance
  $: angleRad = (angle - 90) * (Math.PI / 180);
  $: x = Math.cos(angleRad) * distance;
  $: y = Math.sin(angleRad) * distance;

  function handleClick(event) {
    if (isDragging) return;

    dispatch('click', { index, qty });

    if (toView) {
      if (typeof toView === 'string') {
        zircle.toView(toView);
      } else if (toView.name) {
        zircle.toView({ name: toView.name, params: toView.params || {} });
      }
    }
  }

  function handleKnobStart(event) {
    if (!knob) return;
    isDragging = true;
    startAngle = Math.atan2(event.clientY - window.innerHeight / 2, event.clientX - window.innerWidth / 2);
    window.addEventListener('mousemove', handleKnobMove);
    window.addEventListener('mouseup', handleKnobEnd);
  }

  function handleKnobMove(event) {
    if (!isDragging || !knob) return;

    const currentAngle = Math.atan2(
      event.clientY - window.innerHeight / 2,
      event.clientX - window.innerWidth / 2
    );
    const delta = (currentAngle - startAngle) * (180 / Math.PI);
    startAngle = currentAngle;

    // Update quantity based on rotation
    let newQty = qty + delta * 0.5;
    newQty = Math.max(0, Math.min(100, newQty));
    qty = Math.round(newQty);

    dispatch('qtyChange', { index, qty });
  }

  function handleKnobEnd() {
    setTimeout(() => {
      isDragging = false;
    }, 100);
    window.removeEventListener('mousemove', handleKnobMove);
    window.removeEventListener('mouseup', handleKnobEnd);
  }
</script>

<div
  class="z-spot"
  class:button
  class:knob
  style="
    width: {spotSize}px;
    height: {spotSize}px;
    left: {x - spotSize / 2}px;
    top: {y - spotSize / 2}px;
  "
  on:click={handleClick}
  on:mousedown={handleKnobStart}
  on:keydown={(e) => e.key === 'Enter' && handleClick(e)}
  role="button"
  tabindex="0"
>
  <div class="z-spot-inner">
    <slot />
  </div>

  {#if imagePath}
    <img src={imagePath} alt={label} on:error={(e) => e.target.style.display = 'none'} />
  {/if}

  {#if progress > 0}
    <div class="z-spot-progress" style="width: {progress}%"></div>
  {/if}

  {#if label}
    <span class="z-spot-label {labelPos}">{label}</span>
  {/if}

  {#if knob}
    <div class="z-spot-knob-indicator" style="transform: rotate({qty * 3.6}deg)"></div>
  {/if}
</div>

<style>
  .z-spot {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--z-spot-bg, transparent);
    border: var(--z-spot-border);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }

  .z-spot:hover {
    transform: scale(1.1);
    border-color: var(--z-accent);
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.2);
  }

  .z-spot.button {
    background: var(--z-surface);
  }

  .z-spot.button:hover {
    background: var(--z-primary);
  }

  .z-spot.knob {
    cursor: grab;
  }

  .z-spot.knob:active {
    cursor: grabbing;
  }

  .z-spot-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 80%;
    height: 80%;
    text-align: center;
    font-size: 0.9em;
  }

  .z-spot-label {
    position: absolute;
    font-size: 0.75em;
    font-weight: 600;
    color: var(--z-text);
    white-space: nowrap;
    pointer-events: none;
  }

  .z-spot-label.left {
    right: calc(100% + 10px);
  }

  .z-spot-label.right {
    left: calc(100% + 10px);
  }

  .z-spot-label.top {
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
  }

  .z-spot-label.bottom {
    top: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
  }

  .z-spot-progress {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 4px;
    background: var(--z-accent);
    border-radius: 0 0 50% 50%;
    transition: width 0.3s ease;
  }

  .z-spot-knob-indicator {
    position: absolute;
    width: 2px;
    height: 40%;
    background: var(--z-accent);
    top: 10%;
    left: 50%;
    margin-left: -1px;
    transform-origin: center bottom;
    pointer-events: none;
  }

  .z-spot :global(img) {
    position: absolute;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    opacity: 0.4;
  }
</style>
