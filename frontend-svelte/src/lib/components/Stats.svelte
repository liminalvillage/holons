<script lang="ts">
	interface Props {
		appreciation: number | string;
		remaining: number | string;
		rewards?: number | string;
		balance?: number | string;
		casted: number | string;
		totalrewards?: number | string;
		expanded?: boolean;
	}

	let { appreciation, remaining, rewards, balance, casted, totalrewards, expanded = false }: Props = $props();

	let percentage = $derived(() => {
		const appr = Number(appreciation);
		const cast = Number(casted);
		if (appr && cast) {
			return Math.floor((appr / cast) * 100);
		}
		return 0;
	});
</script>

<div>
	<div
		class="inline-block flex-initial text-xs text-green-500 font-semibold"
		class:text-base={expanded}
		class:block={expanded}
		class:p-1={expanded}
		title="appreciation received"
	>
		➡️ ❤️ {appreciation} ({percentage()}%)
		{#if expanded}
			<small>Received</small>
		{/if}
	</div>
	{#if expanded}
		<div
			class="inline-block flex-1 text-xs text-red-500 font-semibold mr-1"
			class:text-base={expanded}
			class:block={expanded}
			class:p-1={expanded}
			title="appreciation left to sent"
		>
			❤️ ➡️ {100 - Number(remaining)}%
			<small>Sent</small>
		</div>
	{/if}
	<br />
	{#if rewards}
		<span
			class="inline-block flex-initial text-xs text-white font-semibold"
			class:text-base={expanded}
			class:block={expanded}
			title="fund balance"
		>
			Ξ {String(rewards).slice(0, 5)} /
			{String(totalrewards || '0').slice(0, 5)}
			{#if expanded}
				<small>Received</small>
			{/if}
		</span>
	{/if}
</div>
