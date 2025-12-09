<script>
  import { onMount } from 'svelte';
  import { ZView, ZSpot, zircle } from '../lib/zircle/index.js';
  import { getHoloSphere } from '../libs/holons.js';

  // State
  let id = '';
  let name = '';
  let lense = 'tasks';
  let description = 'Tasks';
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
      const table = await hs.get(id, 'quests');

      let items = [];
      if (Array.isArray(table)) {
        table.forEach(item => {
          if (item.status !== 'completed' && item.type === 'task') {
            // Task item
            items.push({
              'id': id + '.' + item.id,
              'label': item.title || item.name || item.description,
              'lense': lense
            });
          } else if (item.currency) {
            // Expense item
            items.push({
              'id': id + '.' + item.id,
              'label': item.description,
              'lense': lense,
              'payload': item
            });
          }
          if (item.username) {
            // User item
            items.push({
              'id': id + '.' + item.id,
              'label': item.username,
              'lense': lense,
              'payload': item
            });
          }
        });
      }
      holons = items;
    } catch (e) {
      console.warn('HoloSphere fetch error:', e);
      holons = [];
    }
  }

  onMount(() => {
    fetchInfo();
  });
</script>

<ZView label="Tasks">
  <div>
    {description}
  </div>

  <div slot="extension">
    {#each holons as holon, index (holon.id)}
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
