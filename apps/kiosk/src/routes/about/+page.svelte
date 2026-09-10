<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // /about — the reading page: what a hub is, the two ways to start one, and
  // the paste field for a hub you already have. It used to be the front
  // door; the map is now (routes/[[holon]]/[[tab]] with no holon named), and
  // the map links here. A static route wins over the optional `[[holon]]`
  // segment, and holonForPath("/about") names no holon, so the layout shows
  // this page alone — no dock, no board chrome.
  import HomeView from "$lib/views/HomeView.svelte";
</script>

<HomeView />
