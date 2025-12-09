<script>
  import { onMount, setContext } from 'svelte';
  import { zircle, theme, themeMode, currentView } from '../../stores/zircle.js';
  import './zircle.css';

  // Provide zircle context to child components
  setContext('zircle', zircle);

  export let views = {};

  let themeClass = '';
  let modeClass = '';
  let activeView = '';

  // Subscribe to theme changes
  $: themeClass = `theme-${$zircle.style.theme}`;
  $: modeClass = `mode-${$zircle.style.mode}`;
  $: activeView = $currentView;

  onMount(() => {
    // Register views
    Object.keys(views).forEach(name => {
      zircle.registerView(name, views[name]);
    });
  });
</script>

<div class="z-canvas {themeClass} {modeClass}">
  <div class="z-container">
    {#if activeView && views[activeView]}
      <svelte:component this={views[activeView]} />
    {/if}
  </div>
</div>

<style>
  .z-canvas {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }

  .z-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
  }
</style>
