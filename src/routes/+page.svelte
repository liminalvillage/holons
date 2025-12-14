<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { holosphereStore } from '$lib/stores/holosphere';
  import 'tailwindcss/tailwind.css';

  onMount(() => {
    // If holosphere is ready with a public key, redirect to user's dashboard
    const unsubscribe = holosphereStore.subscribe((holosphere) => {
      if (holosphere?.client?.publicKey) {
        goto(`/${holosphere.client.publicKey}/dashboard`);
      }
    });
    return unsubscribe;
  });
</script>

<svelte:head>
  <title>Holons</title>
</svelte:head>

<!-- Root page redirects to user's dashboard after authentication -->

