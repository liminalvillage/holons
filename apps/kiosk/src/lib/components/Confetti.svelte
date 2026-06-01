<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // A one-shot celebration burst: a spray of confetti that explodes outward
  // from a point (viewport-centred by default) and falls away. Render it
  // conditionally ({#if celebrate}<Confetti />{/if}) and drop it after ~1.3s.
  export let count = 30;
  /** Burst origin as a percentage of the viewport. */
  export let originX = 50;
  export let originY = 44;

  type Piece = {
    dx: number;
    dy: number;
    rot: number;
    hue: number;
    size: number;
    delay: number;
    dur: number;
  };

  const pieces: Piece[] = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 190;
    return {
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed + 130 + Math.random() * 140, // gravity bias
      rot: (Math.random() * 2 - 1) * 720,
      hue: Math.floor(Math.random() * 360),
      size: 7 + Math.random() * 8,
      delay: Math.random() * 70,
      dur: 800 + Math.random() * 650,
    };
  });
</script>

<div
  class="confetti-burst"
  style="--ox: {originX}%; --oy: {originY}%;"
  aria-hidden="true"
>
  {#each pieces as p, i (i)}
    <span
      style="--dx: {p.dx}px; --dy: {p.dy}px; --rot: {p.rot}deg; --hue: {p.hue}; --size: {p.size}px; --delay: {p.delay}ms; --dur: {p.dur}ms;"
    ></span>
  {/each}
</div>

<style>
  .confetti-burst {
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    z-index: 100;
  }
  .confetti-burst span {
    position: absolute;
    left: var(--ox);
    top: var(--oy);
    width: var(--size);
    height: var(--size);
    background: hsl(var(--hue) 85% 60%);
    border-radius: 2px;
    opacity: 0;
    animation: confetti-pop var(--dur) cubic-bezier(0.15, 0.6, 0.3, 1)
      var(--delay) forwards;
  }
  @keyframes confetti-pop {
    0% {
      transform: translate(-50%, -50%) scale(0.4) rotate(0);
      opacity: 1;
    }
    100% {
      transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy)))
        scale(1) rotate(var(--rot));
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .confetti-burst {
      display: none;
    }
  }
</style>
