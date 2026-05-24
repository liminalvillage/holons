<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { holosphereStore } from '$lib/stores/holosphere';
  import { telegramStore } from '$lib/stores/telegram';
  import 'tailwindcss/tailwind.css';

  // Root-page redirect to the user's home dashboard. The layout's
  // initializeUserHolon() already routes after auth, so this is purely a
  // safety net for direct navigations to "/" while a session is live.
  //
  // Important details:
  //  - One-shot: unsubscribe + flag the moment we fire goto(), otherwise every
  //    subsequent holosphereStore update would re-redirect and clobber whatever
  //    route the user navigated to.
  //  - replaceState: don't push "/" into history — back-button after a redirect
  //    would land us right back here and ping-pong the user.
  //  - Prefer the Telegram user id when present; the holon namespace is keyed
  //    by that id, not by the underlying Nostr pubkey.
  onMount(() => {
    let redirected = false;
    const tryRedirect = (hs: any) => {
      if (redirected || !hs?.client?.publicKey) return false;
      const tgUser = telegramStore.getState().user;
      const homeId = tgUser ? String(tgUser.id) : hs.client.publicKey;
      redirected = true;
      goto(`/${homeId}/dashboard`, { replaceState: true });
      return true;
    };

    if (tryRedirect(get(holosphereStore))) return;

    const unsubscribe = holosphereStore.subscribe((hs) => {
      if (tryRedirect(hs)) unsubscribe();
    });
    return unsubscribe;
  });
</script>

<svelte:head>
  <title>Holons</title>
</svelte:head>

<!-- Root page redirects to user's dashboard after authentication -->
