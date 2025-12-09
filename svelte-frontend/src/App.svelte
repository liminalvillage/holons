<script>
  import { onMount } from 'svelte';
  import { ZCanvas, zircle } from './lib/zircle/index.js';
  import './lib/zircle/zircle.css';

  // Import all views
  import Holon from './views/Holon.svelte';
  import Holons from './views/Holons.svelte';
  import Tasks from './views/Tasks.svelte';
  import Users from './views/Users.svelte';
  import Projects from './views/Projects.svelte';
  import Settings from './views/Settings.svelte';

  // Views object for ZCanvas
  const views = {
    holon: Holon,
    holons: Holons,
    tasks: Tasks,
    users: Users,
    projects: Projects,
    settings: Settings
  };

  onMount(() => {
    // Configure zircle
    zircle.config({
      usePercentSizes: true,
      mode: 'full',
      style: {
        theme: 'black',
        mode: 'dark'
      },
      debug: false
    });

    // Navigate to initial view
    zircle.toView('holon');
  });
</script>

<ZCanvas {views} />

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family: 'Source Sans Pro', sans-serif;
  }

  :global(a) {
    color: var(--z-primary);
    font-weight: bold;
  }
</style>
