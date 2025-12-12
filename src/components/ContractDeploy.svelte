<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { ethers } from 'ethers';
  import { walletAddress } from '../dashboard/store';
  import {
    getDeploymentAddresses,
    isDevelopmentMode,
    HOLON_TYPES,
    type HolonType
  } from '../lib/contracts/contractLoader';
  import { HolonsManager } from '../lib/holons/HolonsManager';
  import type { HolonBundle } from '../lib/holons/HolonsContract';

  export let holonId: string;

  // State
  let holosphere: any;
  let manager: HolonsManager | null = null;
  let provider: ethers.BrowserProvider | null = null;
  let loading = true;
  let error: string | null = null;
  let notifications: Array<{id: number, message: string, type: string}> = [];
  let notificationId = 0;

  // Contract state
  let isConnected = false;
  let currentNetwork: string = '';
  let networkChainId: number | null = null;
  let contractAddresses = getDeploymentAddresses();
  let existingBundle: HolonBundle | null = null;
  let bundleLoading = false;

  // Deploy state
  let selectedHolonType: HolonType = 'Splitter';
  let deploymentName: string = '';
  let deploying = false;
  let deploymentTxHash: string | null = null;

  // Setup state
  let flowSplitPercent: number = 50;
  let updatingFlow = false;
  let newMemberAddress: string = '';
  let addingMember = false;

  // Network configurations
  const NETWORKS = {
    1: { name: 'Ethereum Mainnet', key: 'homestead', icon: '1' },
    100: { name: 'Gnosis Chain', key: 'gnosis', icon: '100' },
    11155111: { name: 'Sepolia Testnet', key: 'sepolia', icon: '11155111' },
    31337: { name: 'Localhost', key: 'localhost', icon: 'L' }
  };

  // Holon type descriptions
  const HOLON_TYPE_INFO: Record<HolonType, { icon: string; description: string; color: string }> = {
    'Managed': {
      icon: '1',
      description: 'Managed holon for internal team members with equal distribution',
      color: 'blue'
    },
    'Zoned': {
      icon: '2',
      description: 'Zoned holon for external federation with zone-based allocation',
      color: 'orange'
    },
    'Splitter': {
      icon: '3',
      description: 'Splitter holon that distributes funds between internal and external',
      color: 'purple'
    },
    'Appreciative': {
      icon: '4',
      description: 'Appreciative holon with token-weighted distribution',
      color: 'green'
    }
  };

  // Notification helpers
  function showNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = notificationId++;
    notifications = [...notifications, { id, message, type }];
    setTimeout(() => {
      notifications = notifications.filter(n => n.id !== id);
    }, 5000);
  }

  function removeNotification(id: number) {
    notifications = notifications.filter(n => n.id !== id);
  }

  // Wallet connection
  async function connectWallet() {
    try {
      if (typeof window === 'undefined' || !window.ethereum) {
        showNotification('Please install MetaMask or another Web3 wallet', 'error');
        return;
      }

      provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);

      if (accounts.length > 0) {
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        walletAddress.set(address);
        isConnected = true;

        // Get network info
        const network = await provider.getNetwork();
        networkChainId = Number(network.chainId);
        currentNetwork = NETWORKS[networkChainId]?.name || `Chain ${networkChainId}`;

        // Update contract addresses for the network
        contractAddresses = getDeploymentAddresses();

        // Initialize manager
        if (holosphere) {
          manager = new HolonsManager(provider, holosphere.gun);
          await manager.connectWallet(signer);

          // Setup event listeners
          setupManagerEvents();
        }

        showNotification(`Connected to ${currentNetwork}`, 'success');

        // Load existing bundle
        await loadExistingBundle();
      }
    } catch (err: any) {
      console.error('Error connecting wallet:', err);
      showNotification(err.message || 'Failed to connect wallet', 'error');
    }
  }

  async function disconnectWallet() {
    if (manager) {
      manager.disconnectWallet();
    }
    provider = null;
    manager = null;
    isConnected = false;
    walletAddress.set(null);
    existingBundle = null;
    showNotification('Wallet disconnected', 'info');
  }

  function setupManagerEvents() {
    if (!manager) return;

    manager.on('transaction:pending', (data: any) => {
      showNotification(`Transaction pending: ${data.method}`, 'info');
    });

    manager.on('transaction:submitted', (data: any) => {
      deploymentTxHash = data.hash;
      showNotification(`Transaction submitted: ${data.hash.slice(0, 10)}...`, 'info');
    });

    manager.on('transaction:success', (data: any) => {
      showNotification(data.message || 'Transaction successful!', 'success');
    });

    manager.on('transaction:failed', (data: any) => {
      showNotification(`Transaction failed: ${data.message || 'Unknown error'}`, 'error');
    });

    manager.on('holon:created', (bundle: HolonBundle) => {
      existingBundle = bundle;
      showNotification('Holon created successfully!', 'success');
    });
  }

  // Load existing holon bundle
  async function loadExistingBundle() {
    if (!manager || !holonId) return;

    try {
      bundleLoading = true;
      existingBundle = await manager.getHolonBundle(holonId);

      if (existingBundle) {
        // Load flow configuration
        const flowConfig = await manager.getFlowConfiguration(holonId);
        if (flowConfig) {
          flowSplitPercent = flowConfig.internalPercent || 50;
        }
      }
    } catch (err) {
      console.error('Error loading bundle:', err);
    } finally {
      bundleLoading = false;
    }
  }

  // Deploy new holon
  async function deployHolon() {
    if (!manager || !holonId) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    try {
      deploying = true;
      deploymentTxHash = null;

      const name = deploymentName || holonId;

      if (selectedHolonType === 'Splitter') {
        // Create complete bundle
        const result = await manager.createHolonBundle(holonId, name);
        showNotification(`Creating holon bundle... TX: ${result.transaction.hash.slice(0, 10)}...`, 'info');
      } else {
        // Create individual holon type
        const result = await manager.createHolon(selectedHolonType, holonId, name);
        showNotification(`Creating ${selectedHolonType} holon... TX: ${result.transaction.hash.slice(0, 10)}...`, 'info');
      }

      // Reload bundle after deployment
      setTimeout(() => loadExistingBundle(), 5000);
    } catch (err: any) {
      console.error('Error deploying holon:', err);
      showNotification(err.message || 'Failed to deploy holon', 'error');
    } finally {
      deploying = false;
    }
  }

  // Update flow split
  async function updateFlowSplit() {
    if (!manager || !existingBundle) {
      showNotification('No holon bundle found', 'error');
      return;
    }

    try {
      updatingFlow = true;
      await manager.updateFlowSplit(holonId, flowSplitPercent);
      showNotification(`Flow split updated to ${flowSplitPercent}% internal`, 'success');
    } catch (err: any) {
      console.error('Error updating flow split:', err);
      showNotification(err.message || 'Failed to update flow split', 'error');
    } finally {
      updatingFlow = false;
    }
  }

  // Add member
  async function addMember() {
    if (!manager || !existingBundle || !newMemberAddress) {
      showNotification('Please enter a valid address', 'error');
      return;
    }

    if (!ethers.isAddress(newMemberAddress)) {
      showNotification('Invalid Ethereum address', 'error');
      return;
    }

    try {
      addingMember = true;
      await manager.addMembersToInternal(holonId, [newMemberAddress]);
      newMemberAddress = '';
      showNotification('Member added successfully!', 'success');
    } catch (err: any) {
      console.error('Error adding member:', err);
      showNotification(err.message || 'Failed to add member', 'error');
    } finally {
      addingMember = false;
    }
  }

  // Format address for display
  function formatAddress(address: string): string {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  // React to holonId changes
  $: if (holonId) {
    holosphere = getContext('holosphere');
    loading = false;
    if (isConnected && manager) {
      loadExistingBundle();
    }
  }

  onMount(async () => {
    // Check if already connected
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        provider = new ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();

        if (accounts.length > 0) {
          await connectWallet();
        }
      } catch (err) {
        console.log('No existing wallet connection');
      }
    }
    loading = false;
  });
</script>

<div class="min-h-0 pb-8">
  <!-- Header Section -->
  <div class="bg-gray-800 rounded-2xl shadow-xl p-6 mb-8">
    <div class="flex items-center gap-4">
      <div class="flex-shrink-0">
        <div class="w-12 h-12 flex items-center justify-center">
          <span class="text-3xl">C</span>
        </div>
      </div>
      <div class="flex-1">
        <div class="text-2xl font-bold text-white">Contract Deployment</div>
        <div class="text-sm text-gray-400 font-mono mt-1">
          Deploy and configure smart contracts for {holonId || 'your holon'}
        </div>
      </div>
    </div>
  </div>

  <!-- Notifications -->
  {#if notifications.length > 0}
    <div class="fixed top-5 right-5 z-50 flex flex-col gap-2">
      {#each notifications as notification (notification.id)}
        <div class="flex items-center justify-between p-4 rounded-xl shadow-lg max-w-sm {notification.type === 'success' ? 'bg-green-500 text-white' : notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}">
          <span class="text-sm font-medium">{notification.message}</span>
          <button
            class="ml-3 text-white hover:text-gray-200 transition-colors"
            on:click={() => removeNotification(notification.id)}
          >
            x
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
        <p class="text-gray-400">Loading...</p>
      </div>
    </div>
  {:else}
    <div class="space-y-8">
      <!-- Wallet Connection Section -->
      <section class="bg-gray-700/50 rounded-2xl p-8">
        <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">W Wallet Connection</h2>

        <div class="space-y-4">
          {#if isConnected}
            <div class="flex items-center justify-between p-4 bg-gray-600 rounded-xl">
              <div>
                <div class="text-sm text-gray-400">Connected Address</div>
                <div class="text-white font-mono">{$walletAddress ? formatAddress($walletAddress) : 'Unknown'}</div>
              </div>
              <div>
                <div class="text-sm text-gray-400">Network</div>
                <div class="text-white">{currentNetwork}</div>
              </div>
              <button
                class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
                on:click={disconnectWallet}
              >
                Disconnect
              </button>
            </div>
          {:else}
            <div class="text-center py-8">
              <div class="text-4xl mb-4">W</div>
              <p class="text-gray-400 mb-4">Connect your wallet to deploy and manage contracts</p>
              <button
                class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors font-medium"
                on:click={connectWallet}
              >
                Connect Wallet
              </button>
            </div>
          {/if}
        </div>
      </section>

      <!-- Contract Addresses Section -->
      <section class="bg-gray-700/50 rounded-2xl p-8">
        <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">A Contract Addresses</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each Object.entries(contractAddresses) as [name, address]}
            <div class="p-4 bg-gray-600 rounded-xl">
              <div class="text-sm text-gray-400 mb-1">{name}</div>
              <div class="text-white font-mono text-sm break-all">{address}</div>
            </div>
          {/each}
        </div>

        {#if isDevelopmentMode()}
          <div class="mt-4 p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-xl">
            <div class="flex items-center gap-2 text-yellow-400">
              <span>!</span>
              <span>Development mode - using localhost contracts</span>
            </div>
          </div>
        {/if}
      </section>

      <!-- Existing Bundle Status -->
      {#if isConnected}
        <section class="bg-gray-700/50 rounded-2xl p-8">
          <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">S Contract Status</h2>

          {#if bundleLoading}
            <div class="flex items-center justify-center py-8">
              <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span class="ml-2 text-gray-400">Loading contract status...</span>
            </div>
          {:else if existingBundle}
            <div class="space-y-4">
              <div class="p-4 bg-green-500/20 border border-green-500/50 rounded-xl">
                <div class="flex items-center gap-2 text-green-400 mb-2">
                  <span>V</span>
                  <span class="font-medium">Holon contracts deployed</span>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="p-4 bg-gray-600 rounded-xl">
                  <div class="text-sm text-gray-400 mb-1">Splitter</div>
                  <div class="text-white font-mono text-sm break-all">{formatAddress(existingBundle.splitterAddress)}</div>
                </div>
                <div class="p-4 bg-gray-600 rounded-xl">
                  <div class="text-sm text-gray-400 mb-1">Managed (Internal)</div>
                  <div class="text-white font-mono text-sm break-all">{formatAddress(existingBundle.managedAddress)}</div>
                </div>
                <div class="p-4 bg-gray-600 rounded-xl">
                  <div class="text-sm text-gray-400 mb-1">Zoned (External)</div>
                  <div class="text-white font-mono text-sm break-all">{formatAddress(existingBundle.zonedAddress)}</div>
                </div>
              </div>
            </div>
          {:else}
            <div class="text-center py-8">
              <div class="text-4xl mb-4">-</div>
              <p class="text-gray-400">No contracts deployed for this holon yet</p>
            </div>
          {/if}
        </section>
      {/if}

      <!-- Deploy Section -->
      {#if isConnected && !existingBundle}
        <section class="bg-gray-700/50 rounded-2xl p-8">
          <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">D Deploy New Holon</h2>

          <div class="space-y-6">
            <!-- Holon Type Selection -->
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-3">Select Holon Type</label>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                {#each HOLON_TYPES as type}
                  {@const info = HOLON_TYPE_INFO[type]}
                  <button
                    class="p-4 rounded-xl border-2 transition-all duration-200 text-left {selectedHolonType === type ? 'border-blue-500 bg-blue-500/20' : 'border-gray-500 bg-gray-600 hover:border-gray-400'}"
                    on:click={() => selectedHolonType = type}
                  >
                    <div class="flex items-center gap-3 mb-2">
                      <span class="text-2xl">{info.icon}</span>
                      <span class="text-white font-medium">{type}</span>
                      {#if type === 'Splitter'}
                        <span class="px-2 py-0.5 bg-purple-500 text-white text-xs rounded">Recommended</span>
                      {/if}
                    </div>
                    <p class="text-sm text-gray-400">{info.description}</p>
                  </button>
                {/each}
              </div>
            </div>

            <!-- Deployment Name -->
            <div>
              <label for="deployment-name" class="block text-sm font-medium text-gray-300 mb-2">
                Holon Name (optional)
              </label>
              <input
                id="deployment-name"
                type="text"
                bind:value={deploymentName}
                placeholder={holonId || 'Enter holon name'}
                class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
              />
            </div>

            <!-- Deploy Button -->
            <button
              class="w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium flex items-center justify-center gap-2"
              on:click={deployHolon}
              disabled={deploying}
            >
              {#if deploying}
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Deploying...</span>
              {:else}
                <span>R</span>
                <span>Deploy {selectedHolonType} Holon</span>
              {/if}
            </button>

            {#if deploymentTxHash}
              <div class="p-4 bg-gray-600 rounded-xl">
                <div class="text-sm text-gray-400 mb-1">Transaction Hash</div>
                <div class="text-white font-mono text-sm break-all">{deploymentTxHash}</div>
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Setup Section -->
      {#if isConnected && existingBundle}
        <section class="bg-gray-700/50 rounded-2xl p-8">
          <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">G Configure Contracts</h2>

          <div class="space-y-8">
            <!-- Flow Split Configuration -->
            <div>
              <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">% Flow Split</h3>
              <p class="text-sm text-gray-400 mb-4">
                Configure how funds are split between internal members and external federation.
              </p>

              <div class="space-y-4">
                <div class="flex items-center gap-4">
                  <div class="flex-1">
                    <label class="block text-sm text-gray-300 mb-2">Internal: {flowSplitPercent}%</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      bind:value={flowSplitPercent}
                      class="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                  <div class="text-center px-4">
                    <div class="text-2xl text-white font-bold">{flowSplitPercent}%</div>
                    <div class="text-xs text-gray-400">Internal</div>
                  </div>
                  <div class="text-center px-4">
                    <div class="text-2xl text-white font-bold">{100 - flowSplitPercent}%</div>
                    <div class="text-xs text-gray-400">External</div>
                  </div>
                </div>

                <button
                  class="px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium"
                  on:click={updateFlowSplit}
                  disabled={updatingFlow}
                >
                  {#if updatingFlow}
                    <span>Updating...</span>
                  {:else}
                    <span>Update Flow Split</span>
                  {/if}
                </button>
              </div>
            </div>

            <!-- Add Members -->
            <div>
              <h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">+ Add Members</h3>
              <p class="text-sm text-gray-400 mb-4">
                Add wallet addresses to the internal (managed) holon for fund distribution.
              </p>

              <div class="flex gap-2">
                <input
                  type="text"
                  bind:value={newMemberAddress}
                  placeholder="0x... Enter wallet address"
                  class="flex-1 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors font-mono"
                />
                <button
                  class="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-colors font-medium"
                  on:click={addMember}
                  disabled={addingMember || !newMemberAddress}
                >
                  {#if addingMember}
                    <span>Adding...</span>
                  {:else}
                    <span>Add</span>
                  {/if}
                </button>
              </div>
            </div>
          </div>
        </section>
      {/if}

      <!-- Help Section -->
      <section class="bg-gray-700/50 rounded-2xl p-8">
        <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">? Help & Documentation</h2>

        <div class="space-y-4">
          <div class="p-4 bg-gray-600 rounded-xl">
            <h3 class="text-white font-medium mb-2">What is a Holon Bundle?</h3>
            <p class="text-sm text-gray-400">
              A holon bundle consists of three contracts working together: a Splitter that divides incoming funds,
              a Managed contract for internal team distribution, and a Zoned contract for federation with other holons.
            </p>
          </div>

          <div class="p-4 bg-gray-600 rounded-xl">
            <h3 class="text-white font-medium mb-2">Flow Split Explained</h3>
            <p class="text-sm text-gray-400">
              The flow split determines what percentage of incoming funds goes to internal members vs. external federation.
              For example, 70% internal means 70% goes to your team and 30% flows to federated holons.
            </p>
          </div>

          <div class="p-4 bg-gray-600 rounded-xl">
            <h3 class="text-white font-medium mb-2">Supported Networks</h3>
            <p class="text-sm text-gray-400">
              Contracts are deployed on: Ethereum Mainnet, Gnosis Chain, Sepolia Testnet, and localhost for development.
              Switch networks in your wallet to interact with contracts on different chains.
            </p>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  /* Custom range slider */
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #3b82f6;
    cursor: pointer;
    border-radius: 50%;
  }

  input[type="range"]::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #3b82f6;
    cursor: pointer;
    border-radius: 50%;
    border: none;
  }

  /* Responsive design */
  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
