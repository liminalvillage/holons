<script>
  import { ZView, ZSpot, zircle } from '../lib/zircle/index.js';

  let theme = 'Select your theme';

  const elements = [
    { type: 'theme', angle: -50, label: 'blue', labelPos: 'right' },
    { type: 'theme', angle: -30, label: 'black', labelPos: 'right' },
    { type: 'theme', angle: -10, label: 'green', labelPos: 'right' },
    { type: 'theme', angle: 10, label: 'red', labelPos: 'right' },
    { type: 'theme', angle: 30, label: 'light-blue', labelPos: 'right' },
    { type: 'theme', angle: 50, label: 'gray', labelPos: 'right' },
    { type: 'mode', angle: 210, label: 'dark', labelPos: 'left' },
    { type: 'mode', angle: 190, label: 'dark-filled', labelPos: 'left' },
    { type: 'mode', angle: 170, label: 'light', labelPos: 'left' },
    { type: 'mode', angle: 150, label: 'light-filled', labelPos: 'left' }
  ];

  function changeStyle(el) {
    if (el.type === 'theme') {
      zircle.config({ style: { theme: el.label } });
    } else {
      zircle.config({ style: { mode: el.label } });
    }

    const currentTheme = $zircle.style.theme;
    const currentMode = $zircle.style.mode;
    theme = `The theme is ${currentTheme} ${currentMode}`;
  }

  function isActive(el) {
    const state = $zircle;
    if (el.type === 'theme') {
      return state.style.theme === el.label;
    } else {
      return state.style.mode === el.label;
    }
  }
</script>

<ZView label="Settings">
  <div>
    {theme}
  </div>

  <div slot="extension">
    {#each elements as el, index (el.label)}
      <ZSpot
        button
        size="xs"
        distance={120}
        angle={el.angle}
        label={el.label}
        labelPos={el.labelPos}
        class:accent={isActive(el)}
        on:click={() => changeStyle(el)}
      />
    {/each}
  </div>
</ZView>

<style>
  :global(.z-spot.accent) {
    border-color: var(--z-accent) !important;
    box-shadow: 0 0 15px rgba(255, 255, 255, 0.3);
  }
</style>
