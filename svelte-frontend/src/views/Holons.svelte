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
      await hs.get(id, 'quests');
    } catch (e) {
      console.warn('HoloSphere fetch error:', e);
    }

    // Set default holons categories
    holons = [
      { 'id': id + '.quests', 'label': 'Tasks', 'lense': 'tasks' },
      { 'id': id + '.users', 'label': 'People', 'lense': 'users' },
      { 'id': id + '.shopping', 'label': 'Shopping', 'lense': 'shopping' },
      { 'id': id + '.tags', 'label': 'Tags', 'lense': 'tags' },
      { 'id': id + '.expenses', 'label': 'Expenses', 'lense': 'expenses' },
      { 'id': id + '.projects', 'label': 'Projects', 'lense': 'projects' },
      { 'id': id + '.settings', 'label': 'Settings', 'lense': 'settings' },
    ];
  }

  onMount(() => {
    fetchInfo();
  });
</script>

<ZView label="Holon">
  <div>
    Holon <br/> {id}
  </div>

  <div slot="extension">
    {#each holons as holon, index (holon.id)}
      <ZSpot
        knob={editing}
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
