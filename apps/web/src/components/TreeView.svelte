<script context="module">
	// retain module scoped expansion state for each tree node
	const _expansionState = {
		/* treeNodeId: expanded <boolean> */
	}
</script>
<script>
    import { slide } from 'svelte/transition'
    export let tree
    let {label, children} = tree

    let expanded = _expansionState[label] || false
    const toggleExpansion = () => {
        expanded = _expansionState[label] = !expanded
    }
    $: arrowDown = expanded
</script>

<ul transition:slide>
    <li>
        {#if children}
            <span role="button" tabindex="0" on:click={toggleExpansion} on:keydown={(e) => e.key === 'Enter' && toggleExpansion()}>
                <span class="arrow" class:arrowDown>&#x25b6</span>
                <h2 class="label first-layer">{label}</h2>
            </span>
            {#if expanded}
                {#each children as child}
                    <svelte:self tree={child} />
                {/each}
            {/if}
        {:else}
            <span>
                <span class="no-arrow"></span>
                <h2 class="label">{label}</h2>
            </span>
        {/if}
    </li>
</ul>

<style>
    ul {
        margin: 0;
        list-style: none;
        padding-left: 1.2rem; 
        user-select: none;
    }
    .no-arrow { padding-left: 1.0rem; }
    .arrow {
        color: white;
        cursor: pointer;
        display: inline-block;
        margin-right: 0.5rem; /* Add margin between the arrow and the text */
    }

    .label {
        color: white;
    }
    .label.first-layer {
        font-weight: bold; /* Make only the first layer bold */
        
    }
    span[role="button"] {
        display: flex;
        align-items: center;
    }
</style>
