<script lang="ts">
  import { cubicInOut } from 'svelte/easing';
  export let pathname: string;

  // Extract the route type more accurately for nested routes
  // For paths like /holonid/offers, we want 'offers' as the key
  // For paths like /holonid/dashboard, we want 'dashboard' as the key
  $: routeSegments = pathname.split('/').filter(segment => segment.length > 0);
  $: routeType = routeSegments.length >= 2 ? routeSegments[1] : routeSegments[0] || 'default';

  const cubicTransition = (node: Element) => {
    return {
      duration: 300,
      easing: cubicInOut,
      css: (t: number) => {
        return `
          opacity: ${t};
          transform: translateX(${(1 - t) * 30}px);
          position: relative;
        `;
      }
    };
  };
</script>

{#key routeType}
  <div in:cubicTransition class="w-full">
    <slot />
  </div>
{/key} 