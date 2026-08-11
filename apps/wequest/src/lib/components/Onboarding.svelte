<script lang="ts">
  import { buildGrid } from "$lib/hex";
  import { ONB } from "$lib/data";
  import { onbStep, go, hexPickerOpen, markOnboarded } from "$lib/stores";
  import { settingsHex } from "$lib/live";

  function done() {
    markOnboarded();
    go("home");
  }

  const hexes = buildGrid(390, 500, 44, 3).map((h) => ({
    pts: h.pts,
    fill: h.n > 0.72 ? "#c67139" : "none",
    op: h.n > 0.72 ? 0.5 : 0.35,
  }));

  $: slide = ONB[$onbStep];

  function next() {
    // "Claim your cell" opens the hex picker unless a home is already set.
    if ($onbStep === 1 && !$settingsHex) hexPickerOpen.set(true);
    if ($onbStep < ONB.length - 1) onbStep.update((s) => s + 1);
    else done();
  }
</script>

<div class="scr" style="background:var(--color-accent-2-800)">
  <div
    style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:0 30px 30px;position:relative;overflow:hidden"
  >
    <svg viewBox="0 0 390 500" style="position:absolute;top:-40px;left:0;width:390px;height:500px;opacity:.5">
      {#each hexes as h (h.pts)}
        <polygon points={h.pts} fill={h.fill} stroke="#cddbb2" stroke-width="0.8" opacity={h.op} />
      {/each}
    </svg>
    <div style="position:relative">
      <div
        style="font-family:var(--font-heading);font-size:13px;letter-spacing:.22em;text-transform:uppercase;color:var(--color-accent-300);margin-bottom:18px"
      >
        WΞQUEST
      </div>
      <div
        style="font-family:var(--font-heading);font-size:38px;line-height:1.05;color:var(--color-neutral-100);text-wrap:pretty"
      >
        {slide.t}
      </div>
      <div
        style="font-size:15.5px;line-height:1.55;color:var(--color-accent-2-300);margin-top:16px;max-width:300px;text-wrap:pretty"
      >
        {slide.b}
      </div>
    </div>
  </div>
  <div style="padding:0 26px 40px;position:relative">
    <div style="display:flex;gap:7px;margin-bottom:20px">
      {#each ONB as _, i (i)}
        <div
          style="height:4px;border-radius:999px;flex:1;background:{i <= $onbStep
            ? '#cddbb2'
            : 'rgba(245,234,216,.25)'}"
        ></div>
      {/each}
    </div>
    <button
      class="tapp"
      on:click={next}
      style="width:100%;height:56px;border-radius:999px;background:var(--color-accent);color:var(--color-neutral-100);display:flex;align-items:center;justify-content:center;font-family:var(--font-heading);font-size:17px"
    >
      {slide.c}
    </button>
    <button
      class="tapp"
      on:click={done}
      style="width:100%;height:44px;display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--color-accent-2-300)"
    >
      Skip the manifesto
    </button>
  </div>
</div>
