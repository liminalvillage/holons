<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // A holon's DNA, read-only: its front page as core builds it
  // (`@holons/core/dna`). It is edited in the kiosk's editor, which "Edit DNA"
  // opens — there is one editor, so the dashboard never has a second one.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { ID } from '../../../dashboard/store';
  import FrontData from '../../../components/dna/FrontData.svelte';
  import FrontPage from '../../../components/dna/FrontPage.svelte';

  $: holonId = $page.params.id;

  // Keep the dashboard's holon in step with the URL, as every board does.
  $: if (holonId && holonId !== $ID) ID.set(holonId);
  onMount(() => {
    if (holonId) ID.set(holonId);
  });
</script>

<svelte:head>
  <title>DNA - {holonId}</title>
  <meta name="description" content="The DNA of holon {holonId}: its purpose, values, agreements and how to join." />
</svelte:head>

<FrontData holon={holonId} let:front let:lang>
  <FrontPage {front} {lang} />
</FrontData>
