<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { page } from "$app/stores";
  import PartyRoute from "$lib/components/PartyRoute.svelte";
</script>

{#key $page.params.holon}
  <PartyRoute raw={$page.params.holon ?? ""} route="h" />
{/key}
