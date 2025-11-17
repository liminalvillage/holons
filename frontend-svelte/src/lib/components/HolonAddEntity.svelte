<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	interface Props {
		showAddField: boolean;
	}

	let { showAddField = $bindable() }: Props = $props();

	const dispatch = createEventDispatcher();

	let name = $state('');
	let address = $state('');
	let addingMember = $state(false);

	function resetInput() {
		address = '';
		name = '';
		addingMember = false;
	}

	function addingMemberClick() {
		addingMember = true;
		showAddField = true;
	}

	function handleClose() {
		showAddField = false;
		resetInput();
	}

	function handleAdd() {
		if (addingMember) {
			dispatch('addMember', { address, name });
		} else {
			dispatch('addHolon', { name });
		}
		resetInput();
	}

	function handleVisible(visible: boolean) {
		showAddField = visible;
	}
</script>

<div
	class="circle row-2 c-1"
	class:border={showAddField}
	class:border-blue-900={showAddField}
	class:rounded-full={showAddField}
>
	<div
		class="c-inner text-white text-2xl cursor-pointer overflow-hidden"
		class:circleXL={showAddField}
		class:bg-white={showAddField}
		class:border={showAddField}
		class:border-blue-700={showAddField}
	>
		{#if showAddField}
			<form class="w-full max-w-sm">
				{#if addingMember}
					<div class="flex items-center border-b border-b-2 border-blue-700 py-2 mb-8">
						<input
							class="appearance-none bg-transparent border-none w-full text-black mr-3 py-1 px-5 leading-tight placeholder-blue-700 focus:outline-none"
							type="text"
							placeholder="address"
							bind:value={address}
							aria-label="Address"
						/>
					</div>
				{/if}
				<div class="flex items-center border-b border-b-2 border-blue-700 py-2">
					<input
						class="appearance-none bg-transparent border-none w-full text-black mr-3 py-1 px-5 leading-tight placeholder-blue-700 focus:outline-none"
						type="text"
						bind:value={name}
						placeholder="name"
						aria-label="Name"
					/>
					<button
						class="flex-shrink-0 border-transparent border-4 text-blue-700 hover:text-blue-800 text-sm py-1 px-2 rounded"
						type="button"
						onclick={handleClose}
					>
						Cancel
					</button>
					<button
						class="flex-shrink-0 bg-blue-500 hover:bg-blue-700 border-blue-500 hover:border-blue-700 text-sm border-4 text-white py-1 px-2 rounded"
						type="button"
						onclick={handleAdd}
					>
						{#if addingMember}
							add member
						{:else}
							add holon
						{/if}
					</button>
				</div>
			</form>
		{:else}
			<button
				onclick={() => handleVisible(true)}
				class="p-1 hover:bg-blue-600 text-white w-full h-full"
			>
				holon
			</button>
			<div class="text-3xl absolute">+</div>
			<button
				class="p-1 hover:bg-blue-600 ease-in-out text-white w-full h-full"
				onclick={addingMemberClick}
			>
				member
			</button>
		{/if}
	</div>
</div>
