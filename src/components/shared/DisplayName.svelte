<script lang="ts">
	import { nameMap, resolvedName, type NameUser } from '$lib/stores/nameResolver';

	/** The pubkey or holon ID to resolve. */
	export let id: string = '';

	/** Optional user object for first_name/last_name/username fallback. */
	export let user: NameUser | null = null;

	/** Optional explicit fallback string. */
	export let fallback: string = '';

	$: name = resolvedName(id, $nameMap, user, fallback);
</script>

<span>{name}</span>
