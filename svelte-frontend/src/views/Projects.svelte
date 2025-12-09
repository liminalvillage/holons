<script>
  import { onMount } from 'svelte';
  import { ZView, ZSpot, zircle } from '../lib/zircle/index.js';
  import { getHoloSphere } from '../libs/holons.js';

  // State
  let id = '';
  let name = '';
  let lense = 'holons';
  let description = 'Holon';
  let holons = [];
  let editing = false;

  function getParams() {
    const state = $zircle;
    return state.params || {};
  }

  function calculateAngle(index, total) {
    return 200 - (index * (220 / (total > 1 ? total - 1 : 1)));
  }

  function getLabelPos(index, total) {
    return index >= total / 2 ? 'right' : 'left';
  }

  function normalize(idx) {
    console.log('Normalizing index:', idx);
  }

  async function fetchInfo() {
    const params = getParams();
    if (params.id) {
      id = params.id;
    }
    if (params.lense) {
      lense = params.lense;
    }

    try {
      const hs = await getHoloSphere();
      // TODO: load github/npm project info
      await hs.get(id, 'quests');
    } catch (e) {
      console.warn('HoloSphere fetch error:', e);
    }

    // Set project-related holons
    holons = [
      { 'id': id, 'label': 'Contributors', 'lense': 'contributors' },
      { 'id': id, 'label': 'Dependencies', 'lense': 'dependencies' },
      { 'id': id, 'label': 'Issues', 'lense': 'issues' }
    ];
  }

  onMount(() => {
    fetchInfo();
  });
</script>

<ZView label="Project">
  <div>
    Project <br/> {id}
  </div>

  <div slot="extension">
    {#each holons as holon, index (holon.id + '-' + index)}
      <ZSpot
        knob={editing}
        on:click={() => normalize(index)}
        {index}
        label={holon.label}
        angle={calculateAngle(index, holons.length)}
        size="m"
        distance={130}
        labelPos={getLabelPos(index, holons.length)}
        toView={{ name: holon.lense || 'holon', params: { id: holon.id } }}
      />
    {/each}
  </div>
</ZView>
