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
  import { Plus } from 'svelte-feathers';

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
  let deploymentStatus: 'idle' | 'pending' | 'confirming' | 'success' | 'failed' = 'idle';
  let deployedAddress: string | null = null;

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
    },
    'Bundle': {
      icon: '5',
      description: 'Bundle holon that combines managed and zoned functionality',
      color: 'cyan'
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
          manager = new HolonsManager(provider, holosphere);
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
    if (!manager) return;

    // Try multiple names: registered name first, then holonId
    const namesToTry = [
      registeredHolonName,
      holonId,
      deploymentName
    ].filter(Boolean);

    console.log('[LoadBundle] Attempting to load bundle with names:', namesToTry);

    try {
      bundleLoading = true;

      // First try to load from blockchain
      for (const name of namesToTry) {
        if (!name) continue;
        console.log('[LoadBundle] Trying name from blockchain:', name);
        const bundle = await manager.getHolonBundle(name);
        if (bundle?.address) {
          console.log('[LoadBundle] Found bundle for name:', name, 'address:', bundle.address);
          existingBundle = bundle;
          deployedAddress = bundle.address;
          registeredHolonName = name; // Remember which name worked

          // Load flow configuration using the bundle address
          try {
            const flowConfig = await manager.getFlowConfiguration(bundle.address);
            if (flowConfig) {
              flowSplitPercent = flowConfig.interiorPercent || 50;
              console.log('[LoadBundle] Flow config loaded:', flowConfig);
            }
          } catch (flowErr) {
            console.log('[LoadBundle] Could not load flow config:', flowErr);
          }
          return;
        }
      }

      // Fallback: try to load from Nostr storage
      console.log('[LoadBundle] No bundle found on blockchain, trying Nostr storage...');
      const nostrData = await loadHolonContract();
      if (nostrData?.address) {
        console.log('[LoadBundle] Found contract in Nostr:', nostrData);
        existingBundle = {
          address: nostrData.address,
          creatorUserId: nostrData.name,
          name: nostrData.name,
          timestamp: Date.now(),
          steepness: BigInt('500000000000000000'),
          nzones: 6,
          splitterAddress: nostrData.address,
          managedAddress: nostrData.address,
          zonedAddress: nostrData.address
        };
        deployedAddress = nostrData.address;
        registeredHolonName = nostrData.name;
        return;
      }

      console.log('[LoadBundle] No bundle found in any source');
      existingBundle = null;
    } catch (err) {
      console.error('[LoadBundle] Error loading bundle:', err);
    } finally {
      bundleLoading = false;
    }
  }

  // The name used for contract registration (important for lookups)
  let registeredHolonName: string = '';

  // Save deployed holon contract to Nostr via HoloSphere
  async function saveHolonContract(name: string, address: string, type: string) {
    if (!holosphere || !address) return;

    const contractData = {
      bundle: {
        address,
        type,
        name,
        deployedAt: new Date().toISOString(),
        chainId: networkChainId
      }
    };

    console.log('[SaveContract] Saving holon contract:', contractData);

    try {
      await holosphere.put(holonId, 'settings', contractData);
      console.log('[SaveContract] Successfully saved holon contract to Nostr');
    } catch (err) {
      console.error('[SaveContract] Failed to save holon contract:', err);
    }
  }

  // Load holon contract from Nostr via HoloSphere
  async function loadHolonContract(): Promise<{ address: string; name: string; type: string } | null> {
    if (!holosphere || !holonId) return null;

    try {
      const settings = await holosphere.getAll(holonId, 'settings');
      console.log('[LoadContract] Settings from Nostr:', settings);

      if (settings?.bundle?.address) {
        console.log('[LoadContract] Found contract in Nostr:', settings.bundle);
        return {
          address: settings.bundle.address,
          name: settings.bundle.name || holonId,
          type: settings.bundle.type || 'Splitter'
        };
      }
      return null;
    } catch (err) {
      console.error('[LoadContract] Error loading from Nostr:', err);
      return null;
    }
  }

  // Event signatures for parsing logs
  const NEW_HOLON_EVENT_SIGNATURE = ethers.id('NewHolon(string,address)');
  const HOLON_CREATED_EVENT_SIGNATURE = ethers.id('HolonCreated(address,string,string,address,uint256)');

  // Parse holon address from transaction receipt logs
  function parseHolonAddressFromReceipt(receipt: ethers.TransactionReceipt): string | null {
    if (!receipt.logs || receipt.logs.length === 0) {
      console.log('[Deploy] No logs in receipt');
      return null;
    }

    console.log('[Deploy] Parsing logs from receipt:', receipt.logs.length, 'logs found');
    console.log('[Deploy] Looking for event signatures:');
    console.log('[Deploy]   NewHolon:', NEW_HOLON_EVENT_SIGNATURE);
    console.log('[Deploy]   HolonCreated:', HOLON_CREATED_EVENT_SIGNATURE);

    for (const log of receipt.logs) {
      console.log('[Deploy] Log address:', log.address);
      console.log('[Deploy] Log topic[0]:', log.topics[0]);
      console.log('[Deploy] Log data length:', log.data?.length);

      // Try to parse HolonCreated event (indexed address is in topics[1])
      if (log.topics[0] === HOLON_CREATED_EVENT_SIGNATURE && log.topics.length >= 2) {
        // The holonAddress is the first indexed parameter (topics[1])
        const addressHex = log.topics[1];
        const address = ethers.getAddress('0x' + addressHex.slice(26));
        console.log('[Deploy] Found HolonCreated event, address:', address);
        return address;
      }

      // Try to parse NewHolon event (address is in data)
      if (log.topics[0] === NEW_HOLON_EVENT_SIGNATURE) {
        try {
          // NewHolon(string name, address addr) - both params are in data (non-indexed)
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const decoded = abiCoder.decode(['string', 'address'], log.data);
          const address = decoded[1] as string;
          console.log('[Deploy] Found NewHolon event, name:', decoded[0], 'address:', address);
          return address;
        } catch (e) {
          console.log('[Deploy] Failed to decode NewHolon event:', e);
        }
      }

      // Try generic parsing - look for any log with address-like data
      if (log.data && log.data.length >= 66) {
        try {
          // Many contract events have address as first or second parameter
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          // Try to decode as (string, address)
          try {
            const decoded = abiCoder.decode(['string', 'address'], log.data);
            if (decoded[1] && ethers.isAddress(decoded[1])) {
              console.log('[Deploy] Found address in (string, address) format:', decoded[1]);
              return decoded[1] as string;
            }
          } catch {}
          // Try to decode as just (address)
          try {
            const decoded = abiCoder.decode(['address'], log.data);
            if (decoded[0] && ethers.isAddress(decoded[0])) {
              console.log('[Deploy] Found address in (address) format:', decoded[0]);
              return decoded[0] as string;
            }
          } catch {}
        } catch (e) {
          // Continue to next log
        }
      }
    }

    console.log('[Deploy] Could not parse address from any log');
    return null;
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
      deploymentStatus = 'pending';
      deployedAddress = null;

      // Use holonId as the name for contract registration (this is what gets stored in toAddress mapping)
      // deploymentName is just for display, the contract uses the holonId/name parameter
      const name = deploymentName || holonId;
      registeredHolonName = name; // Store for later lookups

      console.log('[Deploy] Starting deployment for holon:', holonId);
      console.log('[Deploy] Contract registration name:', name);

      let result: { transaction: ethers.TransactionResponse; holonId: string };

      if (selectedHolonType === 'Splitter') {
        // Create complete bundle - pass name as both creatorUserId and holonName for consistency
        result = await manager.createHolonBundle(name, name);
        console.log('[Deploy] createHolonBundle called, returned holonId:', result.holonId);
      } else {
        // Create individual holon type
        result = await manager.createHolon(selectedHolonType, name, name);
        console.log('[Deploy] createHolon called, returned holonId:', result.holonId);
      }

      deploymentTxHash = result.transaction.hash;
      deploymentStatus = 'confirming';
      showNotification(`Transaction submitted. Waiting for confirmation...`, 'info');
      console.log('[Deploy] Transaction hash:', deploymentTxHash);

      // Wait for transaction to be mined
      const receipt = await result.transaction.wait();
      console.log('[Deploy] Transaction receipt received, status:', receipt?.status);

      if (receipt && receipt.status === 1) {
        deploymentStatus = 'success';

        // Parse the deployed address from the receipt logs
        const parsedAddress = parseHolonAddressFromReceipt(receipt);

        if (parsedAddress) {
          deployedAddress = parsedAddress;
          console.log('[Deploy] Successfully parsed address from logs:', parsedAddress);
          showNotification(`Holon deployed at ${parsedAddress.slice(0, 10)}...`, 'success');

          // Create a bundle object with the parsed address
          existingBundle = {
            address: parsedAddress,
            creatorUserId: name,
            name: name,
            timestamp: Date.now(),
            steepness: BigInt('500000000000000000'),
            nzones: 6,
            splitterAddress: parsedAddress,
            managedAddress: parsedAddress,
            zonedAddress: parsedAddress
          };
          console.log('[Deploy] Created bundle object:', existingBundle);

          // Save to Nostr for persistence
          await saveHolonContract(name, parsedAddress, selectedHolonType);
        } else {
          console.log('[Deploy] Could not parse address from logs, trying to load bundle...');
          showNotification('Holon deployed! Loading details...', 'success');

          // Fallback: try to load the bundle using the registered name
          await new Promise(resolve => setTimeout(resolve, 3000));

          // Use the name we registered with, not holonId
          const bundle = await manager.getHolonBundle(registeredHolonName);
          console.log('[Deploy] Loaded bundle:', bundle);

          if (bundle?.address) {
            existingBundle = bundle;
            deployedAddress = bundle.address;
            console.log('[Deploy] Bundle loaded successfully, address:', deployedAddress);

            // Save to Nostr for persistence
            await saveHolonContract(registeredHolonName, bundle.address, selectedHolonType);
          } else {
            console.log('[Deploy] Bundle not found after deployment');
            showNotification('Holon created but address not found in registry. Try refreshing.', 'info');
          }
        }
      } else {
        deploymentStatus = 'failed';
        showNotification('Transaction failed', 'error');
      }
    } catch (err: any) {
      console.error('[Deploy] Error deploying holon:', err);
      deploymentStatus = 'failed';
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
            <div class="space-y-6">
              <div class="p-4 bg-green-500/20 border border-green-500/50 rounded-xl">
                <div class="flex items-center gap-2 text-green-400 mb-2">
                  <span>V</span>
                  <span class="font-medium">Holon contracts deployed</span>
                </div>
              </div>

              <!-- Stylized Bucket Flow Visualization -->
              <div class="flow-visualization bg-gray-800 rounded-2xl p-6">
                <!-- Bucket (Holon Address) -->
                <div class="flex flex-col items-center">
                  <!-- Bucket shape -->
                  <div class="bucket-container relative">
                    <svg width="120" height="80" viewBox="0 0 120 80" class="bucket-svg">
                      <!-- Bucket body -->
                      <path
                        d="M15 20 L25 70 L95 70 L105 20 Z"
                        fill="url(#bucketGradient)"
                        stroke="#60a5fa"
                        stroke-width="2"
                      />
                      <!-- Bucket rim -->
                      <ellipse cx="60" cy="20" rx="48" ry="10" fill="#3b82f6" stroke="#60a5fa" stroke-width="2"/>
                      <!-- Bucket inner -->
                      <ellipse cx="60" cy="20" rx="40" ry="7" fill="#1e3a5f" opacity="0.7"/>
                      <!-- Flow waves inside bucket -->
                      <path
                        d="M30 25 Q45 30 60 25 Q75 20 90 25"
                        fill="none"
                        stroke="#93c5fd"
                        stroke-width="1.5"
                        opacity="0.6"
                        class="flow-wave"
                      />
                      <defs>
                        <linearGradient id="bucketGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stop-color="#3b82f6"/>
                          <stop offset="100%" stop-color="#1e40af"/>
                        </linearGradient>
                      </defs>
                    </svg>
                    <!-- Address label on bucket -->
                    <div class="absolute inset-0 flex items-center justify-center pt-4">
                      <span class="text-white text-xs font-mono bg-gray-900/60 px-2 py-1 rounded">
                        {formatAddress(existingBundle.address)}
                      </span>
                    </div>
                  </div>

                  <!-- Holon Name -->
                  <div class="mt-2 text-sm text-gray-300 font-medium">
                    {existingBundle.name || holonId}
                  </div>

                  <!-- Flow Stream Down -->
                  <div class="flow-stream relative h-16 w-1 my-2">
                    <div class="absolute inset-0 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full animate-flow-down"></div>
                    <div class="flow-particles"></div>
                  </div>

                  <!-- Splitter Node -->
                  <div class="splitter-node bg-purple-600 rounded-full w-12 h-12 flex items-center justify-center shadow-lg shadow-purple-500/30 border-2 border-purple-400">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                      <path d="M12 5v14M5 12l7 7 7-7"/>
                    </svg>
                  </div>

                  <!-- Split Label -->
                  <div class="text-xs text-gray-400 mt-1 mb-2">SPLITTER</div>

                  <!-- Split Branches -->
                  <div class="split-branches relative w-full max-w-md">
                    <svg width="100%" height="60" viewBox="0 0 300 60" preserveAspectRatio="xMidYMid meet">
                      <!-- Left branch to Interior -->
                      <path
                        d="M150 0 Q100 30 60 55"
                        fill="none"
                        stroke="url(#leftBranchGradient)"
                        stroke-width="3"
                        stroke-linecap="round"
                        class="branch-line"
                      />
                      <!-- Right branch to Exterior -->
                      <path
                        d="M150 0 Q200 30 240 55"
                        fill="none"
                        stroke="url(#rightBranchGradient)"
                        stroke-width="3"
                        stroke-linecap="round"
                        class="branch-line"
                      />
                      <defs>
                        <linearGradient id="leftBranchGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stop-color="#a855f7"/>
                          <stop offset="100%" stop-color="#22c55e"/>
                        </linearGradient>
                        <linearGradient id="rightBranchGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stop-color="#a855f7"/>
                          <stop offset="100%" stop-color="#f97316"/>
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>

                  <!-- Interior / Exterior Targets -->
                  <div class="flex justify-between w-full max-w-md px-4 -mt-2">
                    <!-- Interior (Managed) -->
                    <div class="flex flex-col items-center">
                      <div class="target-node bg-green-600 rounded-xl w-20 h-20 flex flex-col items-center justify-center shadow-lg shadow-green-500/30 border-2 border-green-400">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                          <circle cx="12" cy="8" r="4"/>
                          <path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>
                        </svg>
                        <span class="text-white text-xs mt-1 font-bold">{flowSplitPercent}%</span>
                      </div>
                      <div class="mt-2 text-sm text-green-400 font-medium">Interior</div>
                      <div class="text-xs text-gray-500">Members</div>
                    </div>

                    <!-- Exterior (Zoned) -->
                    <div class="flex flex-col items-center">
                      <div class="target-node bg-orange-600 rounded-xl w-20 h-20 flex flex-col items-center justify-center shadow-lg shadow-orange-500/30 border-2 border-orange-400">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M2 12h20M12 2c3 3 4.5 6 4.5 10s-1.5 7-4.5 10c-3-3-4.5-6-4.5-10s1.5-7 4.5-10"/>
                        </svg>
                        <span class="text-white text-xs mt-1 font-bold">{100 - flowSplitPercent}%</span>
                      </div>
                      <div class="mt-2 text-sm text-orange-400 font-medium">Exterior</div>
                      <div class="text-xs text-gray-500">Federation</div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Contract Addresses (collapsed) -->
              <details class="bg-gray-600/50 rounded-xl">
                <summary class="p-4 cursor-pointer text-gray-300 hover:text-white transition-colors">
                  Contract Addresses
                </summary>
                <div class="p-4 pt-0 grid grid-cols-1 gap-3">
                  <div class="p-3 bg-gray-700 rounded-lg">
                    <div class="text-xs text-gray-400 mb-1">Bundle Contract</div>
                    <div class="text-white font-mono text-sm break-all">{existingBundle.address}</div>
                  </div>
                </div>
              </details>
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
              <span class="block text-sm font-medium text-gray-300 mb-3">Select Holon Type</span>
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
              {#if deploymentStatus === 'pending'}
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Preparing Transaction...</span>
              {:else if deploymentStatus === 'confirming'}
                <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Confirming on Blockchain...</span>
              {:else}
                <span>R</span>
                <span>Deploy {selectedHolonType} Holon</span>
              {/if}
            </button>

            <!-- Deployment Progress -->
            {#if deploymentStatus !== 'idle'}
              <div class="deployment-progress p-4 bg-gray-600 rounded-xl space-y-3">
                <!-- Progress Steps -->
                <div class="flex items-center gap-3">
                  <div class="flex items-center gap-2 {deploymentStatus === 'pending' || deploymentStatus === 'confirming' || deploymentStatus === 'success' ? 'text-green-400' : 'text-gray-500'}">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center {deploymentStatus === 'pending' ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}">
                      {#if deploymentStatus === 'pending'}
                        <span class="text-xs">1</span>
                      {:else}
                        <span class="text-xs">V</span>
                      {/if}
                    </div>
                    <span class="text-sm">Transaction Created</span>
                  </div>
                  <div class="flex-1 h-0.5 bg-gray-700 rounded">
                    <div class="h-full bg-green-500 rounded transition-all duration-500 {deploymentStatus === 'confirming' || deploymentStatus === 'success' ? 'w-full' : 'w-0'}"></div>
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <div class="flex items-center gap-2 {deploymentStatus === 'confirming' || deploymentStatus === 'success' ? 'text-green-400' : 'text-gray-500'}">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center {deploymentStatus === 'confirming' ? 'bg-blue-500 animate-pulse' : deploymentStatus === 'success' ? 'bg-green-500' : 'bg-gray-600'}">
                      {#if deploymentStatus === 'confirming'}
                        <span class="text-xs">2</span>
                      {:else if deploymentStatus === 'success'}
                        <span class="text-xs">V</span>
                      {:else}
                        <span class="text-xs">2</span>
                      {/if}
                    </div>
                    <span class="text-sm">Confirming on Chain</span>
                  </div>
                  <div class="flex-1 h-0.5 bg-gray-700 rounded">
                    <div class="h-full bg-green-500 rounded transition-all duration-500 {deploymentStatus === 'success' ? 'w-full' : 'w-0'}"></div>
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <div class="flex items-center gap-2 {deploymentStatus === 'success' ? 'text-green-400' : 'text-gray-500'}">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center {deploymentStatus === 'success' ? 'bg-green-500' : 'bg-gray-600'}">
                      {#if deploymentStatus === 'success'}
                        <span class="text-xs">V</span>
                      {:else}
                        <span class="text-xs">3</span>
                      {/if}
                    </div>
                    <span class="text-sm">Deployed</span>
                  </div>
                </div>

                <!-- Transaction Hash -->
                {#if deploymentTxHash}
                  <div class="mt-3 pt-3 border-t border-gray-500">
                    <div class="text-xs text-gray-400 mb-1">Transaction Hash</div>
                    <div class="text-white font-mono text-xs break-all">{deploymentTxHash}</div>
                  </div>
                {/if}

                <!-- Error state -->
                {#if deploymentStatus === 'failed'}
                  <div class="mt-3 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                    <div class="text-red-400 text-sm">Deployment failed. Please try again.</div>
                  </div>
                {/if}
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
                    <label class="block text-sm text-gray-300 mb-2">Internal: {flowSplitPercent}%
                    <input
                      type="range"
                      min="0"
                      max="100"
                      bind:value={flowSplitPercent}
                      class="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                    />
                    </label>
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
                  class="btn btn--primary"
                  on:click={addMember}
                  disabled={addingMember || !newMemberAddress}
                >
                  <Plus size="16" />
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

  /* Flow visualization animations */
  .flow-visualization {
    background: linear-gradient(180deg, var(--color-bg-secondary) 0%, var(--color-bg-primary) 100%);
  }

  .bucket-svg {
    filter: drop-shadow(0 4px 12px rgba(59, 130, 246, 0.3));
  }

  .flow-wave {
    animation: wave 2s ease-in-out infinite;
  }

  @keyframes wave {
    0%, 100% {
      d: path("M30 25 Q45 30 60 25 Q75 20 90 25");
    }
    50% {
      d: path("M30 25 Q45 20 60 25 Q75 30 90 25");
    }
  }

  .animate-flow-down {
    animation: flowDown 1.5s ease-in-out infinite;
  }

  @keyframes flowDown {
    0% {
      opacity: 0.3;
      transform: scaleY(0.8);
    }
    50% {
      opacity: 1;
      transform: scaleY(1);
    }
    100% {
      opacity: 0.3;
      transform: scaleY(0.8);
    }
  }

  .flow-stream::before {
    content: '';
    position: absolute;
    width: 6px;
    height: 6px;
    background: #93c5fd;
    border-radius: 50%;
    left: 50%;
    transform: translateX(-50%);
    animation: droplet 1s ease-in infinite;
  }

  @keyframes droplet {
    0% {
      top: 0;
      opacity: 1;
    }
    100% {
      top: 100%;
      opacity: 0;
    }
  }

  .splitter-node {
    animation: pulse-purple 2s ease-in-out infinite;
  }

  @keyframes pulse-purple {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.4);
    }
    50% {
      box-shadow: 0 0 20px 8px rgba(168, 85, 247, 0.2);
    }
  }

  .target-node {
    transition: transform 0.3s ease, box-shadow 0.3s ease;
  }

  .target-node:hover {
    transform: scale(1.05);
  }

  .branch-line {
    stroke-dasharray: 8 4;
    animation: dash 1s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: -12;
    }
  }

  /* Responsive design */
  @media (max-width: 768px) {
    .grid {
      grid-template-columns: 1fr;
    }

    .flow-visualization .split-branches {
      max-width: 280px;
    }

    .target-node {
      width: 64px !important;
      height: 64px !important;
    }
  }
</style>
