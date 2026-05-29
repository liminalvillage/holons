<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { ethers } from 'ethers';
  import { HolonsManager } from '$lib/holons/HolonsManager.js';
  import { getContext } from 'svelte';
  import { ID } from '../../../dashboard/store';
  import HolonFlowVisualization from '../../../components/HolonFlowVisualization.svelte';
  import type { HoloSphere } from 'holosphere';

  const holosphere = getContext('holosphere') as HoloSphere;

  // Reactive holonId that updates when URL changes
  $: holonId = $page.params.id || 'default';

  // Synchronize the ID store with URL params
  $: if ($page.params.id && $page.params.id !== $ID) {
    ID.set($page.params.id);
  }

  // Track current holon for reactivity
  let currentHolonId: string | null = null;

  // Reactive block: reload holon data when holonId changes
  $: if (holonId && holonId !== currentHolonId && holonsManager) {
    currentHolonId = holonId;
    holonsManager.setCurrentHolon(holonId);
    loadHolonData();
  }

  let holonsManager: HolonsManager;
  let provider: ethers.Provider | null = null;
  let isConnected = false;
  let walletAddress = '';
  let currentTab = 'overview';
  let loading = false;
  let error = '';
  let success = '';
  
  // Holon data
  let holonBundle: any = null;
  let holonMembers: any[] = [];
  let holonSettings: any = null;
  let holonBalances: any[] = [];
  let flowConfig: any = null;
  let flowVisualization: any = null;
  
  // Creation form
  let showCreateForm = false;
  let creatorUserId = '';
  let holonName = '';
  let selectedHolonType = 'Managed';
  let availableHolonTypes: string[] = [];
  
  // Flow management
  let internalPercent = 50;
  let externalPercent = 50;
  
  // Federation
  let federationTargetId = '';
  let federationTargetName = '';
  let federationRelationship = 'federated';
  
  // Members
  let newMemberIds = '';
  
  // Transaction status
  let transactionStatus = '';
  let pendingTransactions = new Map();
  
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'flow', label: 'Flow Management', icon: '🌊' },
    { id: 'members', label: 'Members', icon: '👥' },
    { id: 'federation', label: 'Federation', icon: '🔗' },
    { id: 'settings', label: 'Settings', icon: '⚙️' }
  ];

  onMount(async () => {
    try {
      if (window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum);
        
        if (!holosphere) {
          error = 'Holosphere connection not available. Please refresh the page.';
          return;
        }
        
        holonsManager = new HolonsManager(provider, holosphere);
        
        // Setup event listeners
        holonsManager.on('wallet:connected', handleWalletConnected);
        holonsManager.on('wallet:disconnected', handleWalletDisconnected);
        holonsManager.on('transaction:pending', handleTransactionPending);
        holonsManager.on('transaction:success', handleTransactionSuccess);
        holonsManager.on('transaction:failed', handleTransactionFailed);
        holonsManager.on('holon:created', handleHolonCreated);
        holonsManager.on('flow:updated', handleFlowUpdated);
        holonsManager.on('federation:added', handleFederationAdded);
        holonsManager.on('members:added', handleMembersAdded);
        
        // Set current holon context
        holonsManager.setCurrentHolon(holonId);
        
        // Load available holon types
        availableHolonTypes = await holonsManager.getAvailableHolonTypes();
        
        // Check if already connected
        if (holonsManager.isWalletConnected()) {
          isConnected = true;
          walletAddress = await holonsManager.getWalletAddress() || '';
          await loadHolonData();
        } else {
          // Try to load existing holon data anyway
          await loadHolonData();
        }
      } else {
        error = 'MetaMask not detected. Please install MetaMask to use Holons.';
      }
    } catch (err) {
      console.error('Error initializing Holons:', err);
      error = 'Failed to initialize Holons system.';
    }
  });
  
  onDestroy(() => {
    if (holonsManager) {
      holonsManager.removeAllListeners();
    }
  });
  
  async function connectWallet() {
    if (!provider || !holonsManager) return;
    
    try {
      loading = true;
      error = '';
      
      await window.ethereum?.request({ method: 'eth_requestAccounts' });
      const signer = await (provider as ethers.BrowserProvider).getSigner();
      await holonsManager.connectWallet(signer);
      
    } catch (err) {
      console.error('Error connecting wallet:', err);
      error = 'Failed to connect wallet.';
    } finally {
      loading = false;
    }
  }
  
  async function disconnectWallet() {
    if (!holonsManager) return;
    
    holonsManager.disconnectWallet();
  }
  
  async function loadHolonData() {
    if (!holonsManager) return;
    
    try {
      const status = await holonsManager.getHolonStatus(holonId);
      holonBundle = status.bundle;
      holonMembers = status.members;
      holonSettings = status.settings;
      holonBalances = status.balances;
      flowConfig = status.flowConfig;
      flowVisualization = status.visualization;
      
      if (flowConfig?.settings) {
        internalPercent = flowConfig.settings.internalPercent || 50;
        externalPercent = flowConfig.settings.externalPercent || 50;
      }
    } catch (err) {
      console.error('Error loading holon data:', err);
    }
  }
  
  async function createHolonBundle() {
    if (!holonsManager || !creatorUserId) return;
    
    try {
      loading = true;
      error = '';
      success = '';
      
      const result = await holonsManager.createHolonBundle(creatorUserId, holonName || holonId);
      transactionStatus = `Creating holon bundle... Transaction: ${result.transaction.hash}`;
      
    } catch (err) {
      console.error('Error creating holon bundle:', err);
      error = 'Failed to create holon bundle.';
    } finally {
      loading = false;
    }
  }
  
  async function updateFlowSplit() {
    if (!holonsManager || !holonBundle) return;
    
    try {
      loading = true;
      error = '';
      
      const tx = await holonsManager.updateFlowSplit(holonId, internalPercent);
      transactionStatus = `Updating flow split... Transaction: ${tx.hash}`;
      
    } catch (err) {
      console.error('Error updating flow split:', err);
      error = 'Failed to update flow split.';
    } finally {
      loading = false;
    }
  }
  
  async function addFederationLink() {
    if (!holonsManager || !federationTargetId || !federationTargetName) return;
    
    try {
      loading = true;
      error = '';
      
      await holonsManager.addFederationLink(
        holonId,
        federationTargetId,
        federationTargetName,
        federationRelationship as any
      );
      
      success = 'Federation link added successfully.';
      federationTargetId = '';
      federationTargetName = '';
      
      // Reload data
      await loadHolonData();
      
    } catch (err) {
      console.error('Error adding federation link:', err);
      error = 'Failed to add federation link.';
    } finally {
      loading = false;
    }
  }
  
  async function addMembers() {
    if (!holonsManager || !newMemberIds) return;
    
    try {
      loading = true;
      error = '';
      
      const memberIds = newMemberIds.split(',').map(id => id.trim()).filter(id => id);
      const tx = await holonsManager.addMembersToInternal(holonId, memberIds);
      
      transactionStatus = `Adding ${memberIds.length} members... Transaction: ${tx.hash}`;
      newMemberIds = '';
      
    } catch (err) {
      console.error('Error adding members:', err);
      error = 'Failed to add members.';
    } finally {
      loading = false;
    }
  }
  
  function clearMessages() {
    error = '';
    success = '';
    transactionStatus = '';
  }
  
  // Event handlers
  function handleWalletConnected(address: string) {
    isConnected = true;
    walletAddress = address;
    success = 'Wallet connected successfully.';
    loadHolonData();
  }
  
  function handleWalletDisconnected() {
    isConnected = false;
    walletAddress = '';
  }
  
  function handleTransactionPending(data: any) {
    pendingTransactions.set(data.hash || 'pending', data);
    transactionStatus = `Transaction pending: ${data.method}`;
  }
  
  function handleTransactionSuccess(data: any) {
    pendingTransactions.delete(data.hash);
    success = data.message || 'Transaction successful.';
    transactionStatus = '';
    loadHolonData();
  }
  
  function handleTransactionFailed(data: any) {
    pendingTransactions.delete(data.hash);
    error = data.message || 'Transaction failed.';
    transactionStatus = '';
  }
  
  function handleHolonCreated(bundle: any) {
    success = 'Holon bundle created successfully!';
    showCreateForm = false;
    loadHolonData();
  }
  
  function handleFlowUpdated(holonId: string, config: any) {
    success = `Flow updated: ${config.internalPercent}% internal, ${config.externalPercent}% external`;
  }
  
  function handleFederationAdded(holonId: string, targetId: string) {
    success = `Federation link added to ${targetId}`;
  }
  
  function handleMembersAdded(holonId: string, members: string[]) {
    success = `Added ${members.length} members to holon`;
  }

  $: externalPercent = 100 - internalPercent;
</script>

<div class="holons-page">
  <!-- Header -->
  <div class="header">
    <div class="title-section">
      <h1>🏛️ Holons Management</h1>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Holon ID: <span class="font-mono">{holonId}</span>
      </p>
    </div>
    
    <div class="wallet-section">
      {#if isConnected}
        <div class="wallet-info">
          <div class="text-sm text-gray-600 dark:text-gray-400">Connected:</div>
          <div class="font-mono text-sm">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
          <button class="btn-secondary" on:click={disconnectWallet}>Disconnect</button>
        </div>
      {:else}
        <button class="btn-primary" on:click={connectWallet} disabled={loading}>
          {loading ? 'Connecting...' : 'Connect Wallet'}
        </button>
      {/if}
    </div>
  </div>

  <!-- Messages -->
  {#if error || success || transactionStatus}
    <div class="messages">
      {#if error}
        <div class="message error">
          <span>❌ {error}</span>
          <button on:click={clearMessages}>×</button>
        </div>
      {/if}
      
      {#if success}
        <div class="message success">
          <span>✅ {success}</span>
          <button on:click={clearMessages}>×</button>
        </div>
      {/if}
      
      {#if transactionStatus}
        <div class="message info">
          <span>⏳ {transactionStatus}</span>
          <button on:click={clearMessages}>×</button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Main Content -->
  <div class="main-content">
    <!-- Holon Status -->
    <div class="status-card">
      {#if holonBundle}
        <div class="holon-exists">
          <h3>✅ Holon Bundle Active</h3>
          <div class="addresses">
            <div class="address-item">
              <span class="label">Splitter:</span>
              <span class="address">{holonBundle.splitterAddress}</span>
            </div>
            <div class="address-item">
              <span class="label">Internal:</span>
              <span class="address">{holonBundle.managedAddress}</span>
            </div>
            <div class="address-item">
              <span class="label">External:</span>
              <span class="address">{holonBundle.zonedAddress}</span>
            </div>
          </div>
        </div>
      {:else}
        <div class="holon-missing">
          <h3>⚠️ No Holon Bundle Found</h3>
          <p>This holon doesn't have smart contracts deployed yet.</p>
          
          {#if !showCreateForm}
            <button class="btn-primary" on:click={() => showCreateForm = true}>
              Create Holon Bundle
            </button>
          {:else}
            <div class="create-form">
              <h4>Create New Holon Bundle</h4>
              <div class="form-group">
                <label for="creator-user-id">Creator User ID:</label>
                <input id="creator-user-id" type="text" bind:value={creatorUserId} placeholder="Your user ID">
              </div>
              <div class="form-group">
                <label for="holon-name">Holon Name (optional):</label>
                <input id="holon-name" type="text" bind:value={holonName} placeholder="Leave empty to use holon ID">
              </div>
              <div class="form-actions">
                <button class="btn-primary" on:click={createHolonBundle} disabled={loading || !creatorUserId}>
                  {loading ? 'Creating...' : 'Create Bundle'}
                </button>
                <button class="btn-secondary" on:click={() => showCreateForm = false}>
                  Cancel
                </button>
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Tabs -->
    <div class="tabs">
      <div class="tab-list">
        {#each tabs as tab}
          <button 
            class="tab {currentTab === tab.id ? 'active' : ''}"
            on:click={() => currentTab = tab.id}
          >
            <span class="tab-icon">{tab.icon}</span>
            <span class="tab-label">{tab.label}</span>
          </button>
        {/each}
      </div>

      <div class="tab-content">
        {#if currentTab === 'overview'}
          <div class="tab-panel">
            <h3>Overview</h3>
            
            {#if flowVisualization}
              <div class="visualization-container">
                <HolonFlowVisualization 
                  holonId={holonId}
                  width={800}
                  height={400}
                />
              </div>
              
              <div class="metrics-grid">
                <div class="metric-card">
                  <div class="metric-value">{flowVisualization.metrics.totalNodes}</div>
                  <div class="metric-label">Nodes</div>
                </div>
                <div class="metric-card">
                  <div class="metric-value">{flowVisualization.metrics.activeMembers}</div>
                  <div class="metric-label">Members</div>
                </div>
                <div class="metric-card">
                  <div class="metric-value">{flowVisualization.metrics.federationCount}</div>
                  <div class="metric-label">Federations</div>
                </div>
                <div class="metric-card">
                  <div class="metric-value">{flowVisualization.metrics.totalBalance.toFixed(2)}</div>
                  <div class="metric-label">Balance</div>
                </div>
              </div>
            {:else}
              <div class="empty-state">
                <p>No visualization data available. Create a holon bundle to see flows.</p>
              </div>
            {/if}
          </div>

        {:else if currentTab === 'flow'}
          <div class="tab-panel">
            <h3>Flow Management</h3>
            
            {#if holonBundle}
              <div class="flow-controls">
                <div class="flow-split">
                  <h4>Internal vs External Split</h4>
                  
                  <div class="split-visual">
                    <div class="split-bar">
                      <div class="internal-portion" style="width: {internalPercent}%">
                        Internal: {internalPercent}%
                      </div>
                      <div class="external-portion" style="width: {externalPercent}%">
                        External: {externalPercent}%
                      </div>
                    </div>
                  </div>
                  
                  <div class="split-control">
                    <label for="internal-percentage">Internal Percentage:</label>
                    <input
                      id="internal-percentage"
                      type="range"
                      min="0"
                      max="100"
                      bind:value={internalPercent}
                      class="slider"
                    >
                    <span>{internalPercent}%</span>
                  </div>
                  
                  <button class="btn-primary" on:click={updateFlowSplit} disabled={loading}>
                    {loading ? 'Updating...' : 'Update Flow Split'}
                  </button>
                </div>
              </div>
            {:else}
              <div class="empty-state">
                <p>Create a holon bundle first to manage flows.</p>
              </div>
            {/if}
          </div>

        {:else if currentTab === 'members'}
          <div class="tab-panel">
            <h3>Members</h3>
            
            <div class="members-section">
              <div class="current-members">
                <h4>Current Members ({holonMembers.length})</h4>
                {#if holonMembers.length > 0}
                  <div class="members-list">
                    {#each holonMembers as member}
                      <div class="member-item">
                        <span class="member-id">{member.id}</span>
                        <span class="member-role">{member.role}</span>
                        <span class="member-joined">Joined: {new Date(member.joinedAt).toLocaleDateString()}</span>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-gray-600">No members found.</p>
                {/if}
              </div>
              
              {#if holonBundle}
                <div class="add-members">
                  <h4>Add New Members</h4>
                  <div class="form-group">
                    <label for="new-member-ids">Member User IDs (comma-separated):</label>
                    <textarea
                      id="new-member-ids"
                      bind:value={newMemberIds}
                      placeholder="user1, user2, user3..."
                      rows="3"
                    ></textarea>
                  </div>
                  <button class="btn-primary" on:click={addMembers} disabled={loading || !newMemberIds}>
                    {loading ? 'Adding...' : 'Add Members'}
                  </button>
                </div>
              {/if}
            </div>
          </div>

        {:else if currentTab === 'federation'}
          <div class="tab-panel">
            <h3>Federation Links</h3>
            
            <div class="federation-section">
              <div class="current-federations">
                <h4>Current Federations</h4>
                {#if holonSettings?.federation && holonSettings.federation.length > 0}
                  <div class="federation-list">
                    {#each holonSettings.federation as fed}
                      <div class="federation-item">
                        <div class="fed-info">
                          <span class="fed-name">{fed.targetName}</span>
                          <span class="fed-id">({fed.targetId})</span>
                          <span class="fed-type">{fed.relationship}</span>
                        </div>
                        <div class="fed-lenses">
                          {#if fed.lenses.inbound.length > 0}
                            <span class="lenses">Inbound: {fed.lenses.inbound.join(', ')}</span>
                          {/if}
                          {#if fed.lenses.outbound.length > 0}
                            <span class="lenses">Outbound: {fed.lenses.outbound.join(', ')}</span>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-gray-600">No federation links configured.</p>
                {/if}
              </div>
              
              <div class="add-federation">
                <h4>Add Federation Link</h4>
                <div class="form-group">
                  <label for="federation-target-id">Target Holon ID:</label>
                  <input id="federation-target-id" type="text" bind:value={federationTargetId} placeholder="target_holon_id">
                </div>
                <div class="form-group">
                  <label for="federation-target-name">Target Name:</label>
                  <input id="federation-target-name" type="text" bind:value={federationTargetName} placeholder="Target Holon Name">
                </div>
                <div class="form-group">
                  <label for="federation-relationship">Relationship:</label>
                  <select id="federation-relationship" bind:value={federationRelationship}>
                    <option value="federated">Federated (Bidirectional)</option>
                    <option value="notifies">Notifies (One-way)</option>
                  </select>
                </div>
                <button class="btn-primary" on:click={addFederationLink} disabled={loading || !federationTargetId || !federationTargetName}>
                  {loading ? 'Adding...' : 'Add Federation'}
                </button>
              </div>
            </div>
          </div>

        {:else if currentTab === 'settings'}
          <div class="tab-panel">
            <h3>Holon Settings</h3>
            
            {#if holonSettings}
              <div class="settings-grid">
                <div class="setting-item">
                  <span class="setting-label">Name:</span>
                  <span>{holonSettings.name}</span>
                </div>
                <div class="setting-item">
                  <span class="setting-label">Theme:</span>
                  <span>{holonSettings.theme}</span>
                </div>
                <div class="setting-item">
                  <span class="setting-label">Language:</span>
                  <span>{holonSettings.language}</span>
                </div>
                <div class="setting-item">
                  <span class="setting-label">Timezone:</span>
                  <span>{holonSettings.timezone}</span>
                </div>
                <div class="setting-item">
                  <span class="setting-label">Max Tasks:</span>
                  <span>{holonSettings.maxTasks}</span>
                </div>
                <div class="setting-item">
                  <span class="setting-label">Auto Balance:</span>
                  <span>{holonSettings.flowManagement.autoBalance ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
            {:else}
              <div class="empty-state">
                <p>Loading settings...</p>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .holons-page {
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    gap: 24px;
  }

  .title-section h1 {
    font-size: 1.875rem;
    font-weight: bold;
    margin: 0 0 8px 0;
  }

  .wallet-section {
    flex-shrink: 0;
  }

  .wallet-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: right;
  }

  .messages {
    margin-bottom: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message {
    padding: 12px 16px;
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .message.error {
    background-color: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .message.success {
    background-color: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .message.info {
    background-color: #dbeafe;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .message button {
    background: none;
    border: none;
    font-size: 1.2rem;
    cursor: pointer;
    opacity: 0.7;
  }

  .message button:hover {
    opacity: 1;
  }

  .status-card {
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 24px;
  }

  :global(.dark) .status-card {
    background: var(--color-bg-secondary);
    border-color: var(--color-bg-tertiary);
  }

  .holon-exists h3,
  .holon-missing h3 {
    margin: 0 0 16px 0;
    font-size: 1.25rem;
  }

  .addresses {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .address-item {
    display: flex;
    gap: 12px;
    font-family: monospace;
    font-size: 0.875rem;
  }

  .address-item .label {
    font-weight: 600;
    min-width: 80px;
  }

  .address-item .address {
    color: var(--color-text-muted);
    word-break: break-all;
  }

  .create-form {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--color-text-secondary);
  }

  .create-form h4 {
    margin: 0 0 16px 0;
  }

  .form-group {
    margin-bottom: 16px;
  }

  .form-group label {
    display: block;
    margin-bottom: 4px;
    font-weight: 500;
  }

  .form-group input,
  .form-group textarea,
  .form-group select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .form-actions {
    display: flex;
    gap: 12px;
  }

  .tabs {
    background: white;
    border: 1px solid #d1d5db;
    border-radius: 12px;
    overflow: hidden;
  }

  :global(.dark) .tabs {
    background: var(--color-bg-secondary);
    border-color: var(--color-bg-tertiary);
  }

  .tab-list {
    display: flex;
    border-bottom: 1px solid var(--color-text-secondary);
  }

  :global(.dark) .tab-list {
    border-color: var(--color-bg-tertiary);
  }

  .tab {
    flex: 1;
    background: none;
    border: none;
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .tab:hover {
    background-color: #f9fafb;
  }

  :global(.dark) .tab:hover {
    background-color: var(--color-bg-tertiary);
  }

  .tab.active {
    background-color: #3b82f6;
    color: var(--color-text-primary);
  }

  .tab-icon {
    font-size: 1.125rem;
  }

  .tab-label {
    font-weight: 500;
  }

  .tab-content {
    padding: 24px;
  }

  .tab-panel h3 {
    margin: 0 0 24px 0;
    font-size: 1.5rem;
  }

  .visualization-container {
    margin-bottom: 24px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    overflow: hidden;
  }

  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }

  .metric-card {
    text-align: center;
    padding: 16px;
    background: #f9fafb;
    border-radius: 8px;
  }

  :global(.dark) .metric-card {
    background: var(--color-bg-tertiary);
  }

  .metric-value {
    font-size: 1.5rem;
    font-weight: bold;
    color: #3b82f6;
  }

  .metric-label {
    font-size: 0.875rem;
    color: var(--color-text-muted);
    margin-top: 4px;
  }

  .flow-controls {
    max-width: 600px;
  }

  .flow-split h4 {
    margin: 0 0 16px 0;
  }

  .split-visual {
    margin-bottom: 24px;
  }

  .split-bar {
    height: 40px;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    border: 1px solid #d1d5db;
  }

  .internal-portion {
    background: linear-gradient(45deg, #3b82f6, #1d4ed8);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    font-size: 0.875rem;
    transition: width 0.3s ease;
  }

  .external-portion {
    background: linear-gradient(45deg, #10b981, #059669);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    font-size: 0.875rem;
    transition: width 0.3s ease;
  }

  .split-control {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }

  .split-control label {
    font-weight: 500;
    min-width: 140px;
  }

  .slider {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: #d1d5db;
    outline: none;
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
  }

  .members-section,
  .federation-section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }

  .current-members h4,
  .add-members h4,
  .current-federations h4,
  .add-federation h4 {
    margin: 0 0 16px 0;
    font-size: 1.125rem;
  }

  .members-list,
  .federation-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .member-item,
  .federation-item {
    padding: 12px;
    background: #f9fafb;
    border-radius: 8px;
    font-size: 0.875rem;
  }

  :global(.dark) .member-item,
  :global(.dark) .federation-item {
    background: var(--color-bg-tertiary);
  }

  .member-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .member-id {
    font-family: monospace;
    font-weight: 600;
  }

  .member-role {
    background: #3b82f6;
    color: var(--color-text-primary);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
  }

  .federation-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fed-info {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .fed-name {
    font-weight: 600;
  }

  .fed-id {
    font-family: monospace;
    color: var(--color-text-muted);
  }

  .fed-type {
    background: #10b981;
    color: var(--color-text-primary);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
  }

  .fed-lenses {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .lenses {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  }

  .setting-item {
    padding: 12px;
    background: #f9fafb;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  :global(.dark) .setting-item {
    background: var(--color-bg-tertiary);
  }

  .setting-item .setting-label {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--color-text-muted);
  }

  .setting-item span {
    font-size: 0.875rem;
  }

  .empty-state {
    text-align: center;
    padding: 48px 24px;
    color: var(--color-text-muted);
  }

  .btn-primary {
    background-color: var(--color-accent);
    color: var(--color-text-primary);
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    background-color: var(--color-accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-secondary {
    background-color: #6b7280;
    color: var(--color-text-primary);
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;
  }

  .btn-secondary:hover {
    background-color: var(--color-border-light);
  }

  @media (max-width: 768px) {
    .header {
      flex-direction: column;
      gap: 16px;
    }

    .wallet-info {
      text-align: left;
    }

    .tab-list {
      flex-wrap: wrap;
    }

    .tab {
      min-width: 0;
      flex: 1 1 50%;
    }

    .tab-label {
      display: none;
    }

    .members-section,
    .federation-section {
      grid-template-columns: 1fr;
      gap: 24px;
    }

    .metrics-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>