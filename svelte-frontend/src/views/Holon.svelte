<script>
  import { onMount } from 'svelte';
  import { marked } from 'marked';
  import { ZView, ZSpot, ZDialog, zircle } from '../lib/zircle/index.js';
  import { fetchInfo } from '../libs/holons.js';
  import { route } from '../stores/app.js';

  // State
  let dialog = false;
  let editing = false;
  let url = null;
  let type = 'HOLONS';
  let lense = null;
  let id = '';
  let name = '';
  let description = '';
  let quote = '';
  let quoteauthor = '';
  let image = '';
  let holons = [];
  let holonslabels = [];
  let holonsimages = [];
  let holonsvalues = [];

  // Computed - parse markdown
  $: descriptionHtml = description ? marked(description) : '';

  // Get params from zircle
  function getParams() {
    const state = $zircle;
    return state.params || {};
  }

  function openComms() {
    console.log('emitting ' + id);
    // Could dispatch an event or open a modal
  }

  function sendFunds(address, amount) {
    console.log(address);
    console.log(amount);
    // web3.eth.sendTransaction implementation
  }

  function sendERC20(tokenaddress, address, amount) {
    console.log(address);
    console.log(amount);
  }

  function add() {
    console.log('Add holon invoked');
    dialog = true;
  }

  function goToSite(address) {
    console.log('Go to Site:' + address);
    window.open(address, '_blank');
  }

  function truncate(text) {
    return text ? text.substring(0, 6) + '..' : '';
  }

  function normalize(idx) {
    const index = idx;
    const qty = holonsvalues[index];
    const total = holonsvalues.reduce((sum, num) => sum + num, 0);

    if (total > 100) {
      const diff = total - 100;
      const delta = holonsvalues.map((x) => {
        return -x / (total - qty) * diff;
      });

      const normal = holonsvalues.map((x, i) => {
        return Math.floor(x + delta[i]);
      });
      normal[index] = qty;
      holonsvalues = [...normal];
      console.log(holonsvalues.reduce((sum, num) => sum + num, 0));
    }
  }

  function calculateAngle(index, total) {
    return 200 - (index * (220 / (total > 1 ? total - 1 : 1)));
  }

  function getLabelPos(index, total) {
    return index >= total / 2 ? 'right' : 'left';
  }

  async function holonInfo() {
    const params = getParams();
    if (params.id) {
      id = params.id;
    }
    if (params.lense) {
      lense = params.lense;
    }

    // Handle URL-based IDs
    if (id && id.startsWith('http')) {
      try {
        const urlObj = new URL(id);
        const pathArray = urlObj.pathname.split('/');
        // Update route if needed
      } catch (e) {
        console.error('Invalid URL:', e);
      }
    }

    // Handle relative paths
    if (id && (id.startsWith('./') || id.startsWith('/') || id.startsWith('..') || id.match(/^[a-zA-Z]+$/))) {
      const routeQuery = $route.query.id || '';
      id = routeQuery + '/' + id;
    }

    const r = await fetchInfo(id || $route.query.id, lense);

    console.log(r.type);
    type = r.type;
    const json = r.json;

    if (json) {
      name = json.name || '';
      description = json.description || json.text || '';
      url = json.url || null;
      quote = json.quote || '';
      image = json.image || '';
      quoteauthor = json.quoteauthor || '';
      holons = json.holons || [];

      if (json.holons) {
        // Fetch names of each sub-holon
        const labels = await Promise.all(
          holons.map(async (holon) => {
            if (holon.label) {
              return holon.label;
            } else {
              const r = await fetchInfo(holon.id);
              return r.json?.name || '';
            }
          })
        );
        holonslabels = labels;

        // Fetch images of each sub-holon
        const images = await Promise.all(
          holons.map(async (holon) => {
            if (holon.image) {
              return holon.image;
            } else {
              const r = await fetchInfo(holon.id);
              return r.json?.image || '';
            }
          })
        );
        holonsimages = images;

        // Fetch subholon values if available
        holonsvalues = holons.map((holon) => parseInt(holon.value) || 0);
      }
    }
  }

  onMount(() => {
    holonInfo();
  });
</script>

<ZView>
  <div style="width:85%;margin:5%;">
    <h1>{name}</h1>
    {#if type === 'ETHEREUM'}
      <small>{id}</small>
      <br />
      <button on:click={() => sendFunds(id)}>Send Funds</button> <br />
      <button on:click={() => sendERC20('0x123', id)}>Send ERC20</button> <br />
    {/if}
  </div>

  <div style="width:85%;margin:5%;">
    {@html descriptionHtml}
  </div>

  <div slot="extension">
    <ZDialog
      {title}
      width={600}
      height={600}
      content={description}
      open={dialog}
      on:close={() => dialog = false}
    >
      <ZSpot
        button
        slot="extension"
        angle={45}
        size="s"
        on:click={() => dialog = false}
      >
        Close
      </ZSpot>
      Please copy an holon.json file from existing holons, modify it and save it in your own location (e.g. github/ftp/ipfs)
    </ZDialog>

    {#each holons as holon, index (holon.id)}
      <ZSpot
        knob={editing}
        on:click={() => holonsvalues[index] ? normalize(index) : null}
        bind:qty={holonsvalues[index]}
        {index}
        label={holonslabels[index] || ''}
        progress={parseInt(holon.value) || 0}
        angle={calculateAngle(index, holons.length)}
        size="m"
        distance={130}
        labelPos={getLabelPos(index, holons.length)}
        toView={editing ? null : { name: holon.lense || 'holon', params: { id: holon.id } }}
      >
        {#if holonsimages[index]}
          <img src={holonsimages[index]} style="width: 100%; opacity:0.4;" alt={holonslabels[index]} on:error={(e) => e.target.style.display = 'none'} />
        {/if}
      </ZSpot>
    {/each}

    <!-- Edit button -->
    <ZSpot
      button
      angle={270}
      distance={125}
      size="s"
      label={editing ? 'Save' : 'Edit'}
      labelPos="top"
      on:click={() => editing = !editing}
    >
      {#if editing}
        <i class="fas fa-save"></i>
      {:else}
        <i class="fas fa-edit"></i>
      {/if}
    </ZSpot>

    <!-- Website button -->
    {#if url}
      <ZSpot
        button
        angle={250}
        distance={125}
        size="s"
        label="Website"
        labelPos="top"
        on:click={() => goToSite(url)}
      >
        <i class="fab fa-github"></i>
      </ZSpot>
    {/if}

    <!-- Comms button -->
    <ZSpot
      button
      angle={290}
      distance={125}
      size="s"
      labelPos="top"
      label="Comms"
      on:click={openComms}
    >
      <i class="fas fa-video"></i>
    </ZSpot>

    <!-- Add button -->
    <ZSpot
      button
      angle={90}
      distance={100}
      size="s"
      labelPos="top"
      label="Add"
      on:click={add}
    >
      <i class="fas fa-plus"></i>
    </ZSpot>
  </div>
</ZView>

<style>
  h1 {
    margin: 0;
    font-size: 1.2em;
  }

  small {
    font-size: 0.7em;
    opacity: 0.7;
  }

  button {
    background: var(--z-surface);
    border: 1px solid var(--z-primary);
    color: var(--z-text);
    padding: 5px 10px;
    margin: 5px 0;
    cursor: pointer;
    border-radius: 5px;
  }

  button:hover {
    background: var(--z-primary);
  }
</style>
