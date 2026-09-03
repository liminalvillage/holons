<script>
  import { onMount } from 'svelte';
  import HoloSphere from 'holosphere';

  // Relays are the wire and the durable copy; the browser keeps a local
  // IndexedDB cache (the default store adapter) so reads are instant and
  // data survives a reload. Leave `relays` empty for a local-only sandbox.
  const RELAYS = ['wss://relay.holons.io'];

  // Reactive variables
  let hs = null;
  let status = 'Loading...';
  let info = null;
  let storedData = [];
  let newData = { message: '', timestamp: '' };
  let holonId = 'svelte-test';
  let lensId = 'test-lens';
  let dataId = '';

  // Initialize HoloSphere over relays + the local store
  async function initHoloSphere() {
    try {
      status = 'Initializing HoloSphere...';

      // Without `privateKey` an ephemeral device key signs every write;
      // pass your own nsec/hex key to keep an identity across reloads.
      hs = new HoloSphere({ appName: 'svelte-app', relays: RELAYS });

      info = { version: hs.getVersion(), relays: hs.nostrRelays(), pubkey: hs.client.publicKey };

      status = '✅ HoloSphere Ready (relays + local store)';
      console.log('HoloSphere initialized:', info);

    } catch (error) {
      status = '❌ HoloSphere Failed';
      console.error('Error initializing HoloSphere:', error);
    }
  }

  // Store data (signed event → relays, mirrored into the local store)
  async function storeData() {
    if (!hs || !newData.message) return;
    
    try {
      const data = {
        id: dataId || hs.generateId(),
        message: newData.message,
        timestamp: newData.timestamp || new Date().toISOString(),
        storedVia: 'svelte-component'
      };

      const result = await hs.put(holonId, lensId, data);
      
      if (result.success) {
        console.log('Data stored successfully:', data);
        newData = { message: '', timestamp: '' };
        dataId = '';
        await loadAllData(); // Refresh the data list
      } else {
        console.error('Failed to store data:', result);
      }
      
    } catch (error) {
      console.error('Error storing data:', error);
    }
  }

  // Load all data from the current holon and lens
  async function loadAllData() {
    if (!hs) return;
    
    try {
      const data = await hs.getAll(holonId, lensId);
      storedData = data || [];
      console.log('Loaded data:', storedData);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  // Retrieve specific data by ID
  async function retrieveData(id) {
    if (!hs || !id) return;
    
    try {
      const data = await hs.get(holonId, lensId, id);
      if (data) {
        console.log('Retrieved data:', data);
        // You could display this in a modal or update the UI
        alert(`Retrieved: ${JSON.stringify(data, null, 2)}`);
      } else {
        console.log('No data found for ID:', id);
      }
    } catch (error) {
      console.error('Error retrieving data:', error);
    }
  }

  // Test persistence across component reloads
  async function testPersistence() {
    if (!hs) return;
    
    try {
      const testData = {
        id: 'persistence-test',
        message: 'This should persist across Svelte component reloads',
        timestamp: new Date().toISOString(),
        testType: 'svelte-persistence'
      };

      // Store test data
      await hs.put('persistence-holon', 'persistence-lens', testData);
      console.log('Test data stored for persistence test');

      // Simulate component reload by creating a new instance: same appName
      // → same IndexedDB store (and the same relays behind it).
      const newHs = new HoloSphere({ appName: 'svelte-app', relays: RELAYS });

      // Try to retrieve the data
      const retrieved = await newHs.get('persistence-holon', 'persistence-lens', 'persistence-test');
      
      if (retrieved) {
        console.log('✅ Persistence test PASSED - Data persisted across instance reload');
        alert('✅ Persistence test PASSED!');
      } else {
        console.log('❌ Persistence test FAILED - Data not found after reload');
        alert('❌ Persistence test FAILED!');
      }

      await newHs.close();
      
    } catch (error) {
      console.error('Error during persistence test:', error);
    }
  }

  // Clear all test data
  async function clearTestData() {
    if (!hs) return;
    
    try {
      const result = await hs.deleteAll('persistence-holon', 'persistence-lens');
      if (result) {
        console.log('Test data cleared successfully');
        alert('Test data cleared successfully');
      } else {
        console.log('No test data to clear or error occurred');
      }
    } catch (error) {
      console.error('Error clearing test data:', error);
    }
  }

  // Initialize when component mounts
  onMount(() => {
    initHoloSphere();
  });
</script>

<svelte:head>
  <title>HoloSphere Svelte Example</title>
</svelte:head>

<main>
  <div class="container">
    <h1>🔮 HoloSphere Svelte Example</h1>
    
    <div class="status">
      <strong>Status:</strong> {status}
    </div>

    {#if info}
      <div class="stats">
        <h2>📡 Instance</h2>
        <pre>{JSON.stringify(info, null, 2)}</pre>
      </div>
    {/if}

    <div class="section">
      <h2>💾 Store Data</h2>
      <div class="form-group">
        <label for="holon">Holon ID:</label>
        <input 
          type="text" 
          id="holon" 
          bind:value={holonId} 
          placeholder="Holon identifier"
        />
      </div>
      
      <div class="form-group">
        <label for="lens">Lens:</label>
        <input 
          type="text" 
          id="lens" 
          bind:value={lensId} 
          placeholder="Lens identifier"
        />
      </div>
      
      <div class="form-group">
        <label for="dataId">Data ID (optional):</label>
        <input 
          type="text" 
          id="dataId" 
          bind:value={dataId} 
          placeholder="Custom ID or leave empty for auto-generated"
        />
      </div>
      
      <div class="form-group">
        <label for="message">Message:</label>
        <textarea 
          id="message" 
          bind:value={newData.message} 
          placeholder="Enter your message here..."
          rows="3"
        ></textarea>
      </div>
      
      <div class="form-group">
        <label for="timestamp">Timestamp (optional):</label>
        <input 
          type="datetime-local" 
          id="timestamp" 
          bind:value={newData.timestamp}
        />
      </div>
      
      <button on:click={storeData} class="button" disabled={!hs || !newData.message}>
        💾 Store Data
      </button>
      
      <button on:click={loadAllData} class="button" disabled={!hs}>
        📥 Load All Data
      </button>
    </div>

    <div class="section">
      <h2>📋 Stored Data ({storedData.length} items)</h2>
      {#if storedData.length > 0}
        <div class="data-list">
          {#each storedData as item}
            <div class="data-item">
              <strong>ID:</strong> {item.id}<br>
              <strong>Message:</strong> {item.message}<br>
              <strong>Timestamp:</strong> {item.timestamp}<br>
              <button on:click={() => retrieveData(item.id)} class="small-button">
                📥 Retrieve
              </button>
            </div>
          {/each}
        </div>
      {:else}
        <p>No data stored yet. Store some data to see it here!</p>
      {/if}
    </div>

    <div class="section">
      <h2>🧪 Test Persistence</h2>
      <p>Test that data persists across component reloads:</p>
      <button on:click={testPersistence} class="button" disabled={!hs}>
        🔄 Test Persistence
      </button>
      <button on:click={clearTestData} class="button" disabled={!hs}>
        🗑️ Clear Test Data
      </button>
    </div>
  </div>
</main>

<style>
  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  h1 {
    text-align: center;
    color: #4f46e5;
    margin-bottom: 30px;
  }

  .status {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
    font-weight: 600;
  }

  .stats {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 20px;
  }

  .stats pre {
    background: #fff;
    padding: 10px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
  }

  .section {
    background: #fff;
    border: 1px solid #e9ecef;
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }

  .section h2 {
    color: #4f46e5;
    margin-bottom: 15px;
  }

  .form-group {
    margin-bottom: 15px;
  }

  .form-group label {
    display: block;
    margin-bottom: 5px;
    font-weight: 600;
    color: #4f46e5;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .form-group textarea {
    resize: vertical;
    min-height: 80px;
  }

  .button {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    margin: 5px;
    transition: transform 0.2s;
  }

  .button:hover {
    transform: translateY(-2px);
  }

  .button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .small-button {
    background: #6c757d;
    color: white;
    border: none;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    margin-top: 5px;
  }

  .data-list {
    display: grid;
    gap: 15px;
  }

  .data-item {
    background: #f8f9fa;
    border: 1px solid #e9ecef;
    border-radius: 6px;
    padding: 15px;
    font-size: 14px;
  }

  .data-item strong {
    color: #4f46e5;
  }
</style> 