<script lang="ts">
  import { onMount } from "svelte";
  import { screen, NAV_SCREENS } from "$lib/stores";
  import { ensureInit } from "$lib/live";
  import { initHistory } from "$lib/history";
  import { initAuth } from "$lib/auth";
  import { resolveHolon, resolveUserId } from "$lib/config";
  import Setup from "$lib/components/Setup.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import Home from "$lib/components/Home.svelte";
  import ListScreen from "$lib/components/ListScreen.svelte";
  import Quest from "$lib/components/Quest.svelte";
  import Handoff from "$lib/components/Handoff.svelte";
  import Coop from "$lib/components/Coop.svelte";
  import Barter from "$lib/components/Barter.svelte";
  import GroupRun from "$lib/components/GroupRun.svelte";
  import Wallet from "$lib/components/Wallet.svelte";
  import Profile from "$lib/components/Profile.svelte";
  import ComposeSheet from "$lib/components/ComposeSheet.svelte";
  import HexPicker from "$lib/components/HexPicker.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import BottomNav from "$lib/components/BottomNav.svelte";

  let configured = false;

  onMount(async () => {
    // Back button walks screens and closes overlays instead of leaving.
    initHistory();
    // Server-verified Telegram session first (mirrors into the sync config);
    // ?user= stays the dev override, the Setup screen the manual fallback.
    await initAuth();
    configured = Boolean(resolveHolon() && resolveUserId());
    if (configured) void ensureInit();
  });
</script>

<div class="shell">
  <div class="ph">
    {#if !configured}
      <Setup />
    {:else if $screen === "onb"}
      <Onboarding />
    {:else if $screen === "home"}
      <Home />
    {:else if $screen === "list"}
      <ListScreen />
    {:else if $screen === "quest"}
      <Quest />
    {:else if $screen === "handoff"}
      <Handoff />
    {:else if $screen === "coop"}
      <Coop />
    {:else if $screen === "barter"}
      <Barter />
    {:else if $screen === "group"}
      <GroupRun />
    {:else if $screen === "wallet"}
      <Wallet />
    {:else if $screen === "profile"}
      <Profile />
    {/if}

    {#if configured}
      <ComposeSheet />
      <HexPicker />
      <Toast />
      {#if NAV_SCREENS.includes($screen)}
        <BottomNav />
      {/if}
    {/if}
  </div>
</div>
