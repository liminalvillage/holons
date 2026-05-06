<script lang="ts">
  import { sdgs } from '$lib/sdgs';
  import { goto } from '$app/navigation';

  function openSDG(code: string) {
    goto(`/sdgs/${code}`);
  }
</script>

<div class="px-6 py-6">
  <h1 class="text-3xl font-semibold text-gray-100 mb-6">Sustainable Development Goals</h1>
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
    {#each sdgs as g}
      <button
        class="group rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-sm hover:shadow transition bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        on:click={() => openSDG(g.code)}
        title={`${g.number}. ${g.title}`}
        aria-label={`SDG ${g.number}: ${g.title}`}
      >
        <div class="relative w-full pb-[100%] overflow-hidden rounded-2xl">
          <img alt={`SDG ${g.number}`} src={g.imageLocal} on:error={(e)=>{(e.currentTarget as HTMLImageElement).src=g.imageRemote||''}} class="absolute inset-0 w-full h-full object-cover block group-hover:scale-[1.02] transition-transform"/>
        </div>
        
      </button>
    {/each}
  </div>
</div>

<style>
  :global(body) { background-color: transparent; }
</style>


