<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { holosphereStore } from '$lib/stores/holosphere';
  import { telegramStore } from '$lib/stores/telegram';
  import 'tailwindcss/tailwind.css';

  onMount(() => {
    // If holosphere is ready with a public key, redirect to user's dashboard.
    // Prefer the Telegram user id when the user is logged in via Telegram —
    // their holon namespace is keyed by that id, not by the Nostr pubkey.
    const unsubscribe = holosphereStore.subscribe((holosphere) => {
      if (!holosphere?.client?.publicKey) return;
      const tgUser = telegramStore.getState().user;
      const homeId = tgUser ? String(tgUser.id) : holosphere.client.publicKey;
      goto(`/${homeId}/dashboard`);
    });
    return unsubscribe;
  });
</script>

<svelte:head>
  <title>Holons</title>
</svelte:head>

<!-- Root page redirects to user's dashboard after authentication -->

