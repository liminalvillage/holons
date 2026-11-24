<script lang="ts">
	import { words } from '$lib/vocabulary';
    import GlobalHolons from "../../components/GlobalHolons.svelte";
</script>

<svelte:head>
    <title>Global {words.Holons} Network</title>
    <meta name="description" content="View all {words.holons} in the network with their statistics and activity" />
</svelte:head>

<GlobalHolons /> 