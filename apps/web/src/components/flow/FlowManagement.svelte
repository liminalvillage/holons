<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { ethers } from 'ethers';
  import { walletAddress } from '../../dashboard/store';
  import { HolonsManager } from '../../lib/holons/HolonsManager';
  import type { HolonBundle, FlowConfig } from '../../lib/holons/HolonsContract';
  import type { FederationLink } from '../../lib/holons/FlowSettings';
  import type { HoloSphere } from 'holosphere';
  import { awaitName } from '$lib/stores/nameResolver';
  import {
    loadEquation,
    toAggregates,
    calculateUserScore as calculateScore,
    type ScoreEquation,
    DEFAULT_EQUATION
  } from '../../lib/scoring/ContributionScoring';

  import FlowHeader from './FlowHeader.svelte';
  import FlowControls from './FlowControls.svelte';
  import ConcentricZoneChart from './ConcentricZoneChart.svelte';
  import HolonDrawer from './HolonDrawer.svelte';
  import type { ZonedHolon, InteriorMember } from './types';
  import { steepnessToContract, steepnessFromContract, COLOR_PALETTE } from './types';

  export let holonId: string;

  // Context
  let holosphere: HoloSphere;
  let manager: HolonsManager | null = null;
  let provider: ethers.BrowserProvider | null = null;

  // State
  let loading = true;
  let deploying = false;
  let syncing = false;
  let isConnected = false;
  let existingBundle: HolonBundle | null = null;
  let networkName = 'Unknown';
  let notifications: Array<{id: number, message: string, type: string}> = [];
  let notificationId = 0;

  // Flow configuration
  let interiorPercent = 50;
  let steepness = 50; // UI value 0-100
  let nzones = 6;

  // Track original values for change detection
  let originalInteriorPercent = 50;
  let originalSteepness = 50;
  let originalNzones = 6;
  let originalZoneAssignments = new Map<string, number>();

  // Drawer state
  let drawerOpen = true;

  // Federation data
  let federatedHolons: ZonedHolon[] = [];

  // Interior members data
  let interiorMembers: InteriorMember[] = [];

  // Users from holosphere for score calculation
  interface HolosphereUser {
    id: string;
    username?: string;
    initiated?: string[];
    completed?: string[];
    sent?: number;
    received?: number;
    hours?: number;
    collaboration?: number;
    wants?: string[];
    offers?: string[];
  }
  let holosphereUsers: HolosphereUser[] = [];
  // Use shared equation type with same defaults as Holonsbot
  let equation: ScoreEquation = { ...DEFAULT_EQUATION };

  // Reactive: detect if there are unsaved changes
  $: hasChanges = existingBundle && (
    interiorPercent !== originalInteriorPercent ||
    steepness !== originalSteepness ||
    nzones !== originalNzones ||
    zoneAssignmentsChanged()
  );

  function zoneAssignmentsChanged(): boolean {
    return federatedHolons.some(h => {
      const original = originalZoneAssignments.get(h.id);
      return original !== undefined && original !== h.zone;
    });
  }

  // Try to get holosphere context
  try {
    holosphere = getContext('holosphere');
  } catch (e) {
    console.error('FlowManagement: Failed to get holosphere context');
  }

  // Notification helpers
  function showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') {
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

        // Get network name
        const network = await provider.getNetwork();
        networkName = network.name === 'unknown' ? `Chain ${network.chainId}` : network.name;

        // Initialize manager
        if (holosphere) {
          manager = new HolonsManager(provider, holosphere);
          await manager.connectWallet(signer);
          setupManagerEvents();
        }

        showNotification('Wallet connected!', 'success');
        await loadBundleAndFederation();
      }
    } catch (err: any) {
      console.error('Error connecting wallet:', err);
      showNotification(err.message || 'Failed to connect wallet', 'error');
    }
  }

  function setupManagerEvents() {
    if (!manager) return;

    manager.on('transaction:success', (data: any) => {
      showNotification(data.message || 'Transaction successful!', 'success');
    });

    manager.on('transaction:failed', (data: any) => {
      showNotification(`Transaction failed: ${data.message || 'Unknown error'}`, 'error');
    });

    manager.on('holon:created', (bundle: HolonBundle) => {
      existingBundle = bundle;
      showNotification('Bundle deployed successfully!', 'success');
    });
  }

  // Load existing bundle and federation data
  async function loadBundleAndFederation() {
    if (!holonId) return;

    try {
      loading = true;

      // First, try to load bundle from holosphere settings
      if (holosphere) {
        try {
          const settings = await holosphere.getAll(holonId, 'settings');
          const bundleSettings = settings?.find((s: any) => s.bundle)?.bundle;

          const isValidAddress = (addr: string) =>
            addr && addr.startsWith('0x') && addr.length === 42;

          if (bundleSettings?.address && isValidAddress(bundleSettings.address)) {
            const contractSteepness = BigInt(bundleSettings.steepness || '500000000000000000');
            existingBundle = {
              address: bundleSettings.address,
              creatorUserId: bundleSettings.creatorUserId || holonId,
              name: holonId,
              timestamp: bundleSettings.deployedAt || Date.now(),
              steepness: contractSteepness,
              nzones: bundleSettings.nzones || 6,
              splitterAddress: bundleSettings.address,
              managedAddress: bundleSettings.address,
              zonedAddress: bundleSettings.address
            };
            console.log('[FlowMgmt] Loaded Bundle from settings:', existingBundle);
          }
        } catch (settingsErr) {
          console.log('[FlowMgmt] No Bundle in settings:', settingsErr);
        }
      }

      // If not found in settings, try the contract
      if (!existingBundle && manager) {
        existingBundle = await manager.getHolonBundle(holonId);
      }

      if (existingBundle) {
        // Load flow config from Bundle contract
        if (manager && existingBundle.address) {
          const flowConfig = await manager.getFlowConfiguration(existingBundle.address);
          if (flowConfig) {
            interiorPercent = flowConfig.interiorPercent || 50;
            steepness = steepnessFromContract(flowConfig.steepness || BigInt('500000000000000000'));
            nzones = flowConfig.nzones || 6;
            // Track original values
            originalInteriorPercent = interiorPercent;
            originalSteepness = steepness;
            originalNzones = nzones;
          }
        }
      }

      // Load federation data
      await loadFederationData();

      // Load users from holosphere (calculates interior members)
      await loadUsersFromHolosphere();

      // If bundle exists, try to load members from contract (overrides calculated)
      if (existingBundle) {
        await loadInteriorMembersFromContract();
      }

    } catch (err) {
      console.error('Error loading bundle:', err);
    } finally {
      loading = false;
    }
  }

  async function loadFederationData() {
    if (!holosphere) {
      // Mock data for development
      federatedHolons = [
        { id: 'holon-a', name: 'Community Alpha', zone: -1, angle: 0, status: 'active' },
        { id: 'holon-b', name: 'DAO Beta', zone: -1, angle: 0, status: 'active' },
        { id: 'holon-c', name: 'Collective Gamma', zone: -1, angle: 0, status: 'pending' },
      ];
      return;
    }

    try {
      let federationData: any[] = [];

      // Try getFederation method first
      try {
        const fedInfo = await holosphere.getFederation(holonId);
        if (fedInfo?.federated && Array.isArray(fedInfo.federated)) {
          federationData = fedInfo.federated.map((id: string) => ({ targetId: id }));
        }
      } catch (fedErr) {
        console.log('[FlowMgmt] getFederation not available');
      }

      // Fallback to settings
      if (federationData.length === 0) {
        const settings = await holosphere.getAll(holonId, 'settings');
        if (settings && settings[0]?.federation) {
          federationData = settings[0].federation;
        }
      }

      if (federationData.length > 0) {
        const settings = await holosphere.getAll(holonId, 'settings');
        const holonsWithNames = await Promise.all(
          federationData.map(async (fed: any, index: number) => {
            const targetId = fed.targetId || fed.id || fed;
            const name = await awaitName(String(targetId));
            const savedZone = settings?.[0]?.federationZones?.[targetId];
            return {
              id: String(targetId),
              name,
              zone: savedZone ?? -1, // -1 = unassigned (in drawer)
              angle: 0,
              status: 'active' as const,
            };
          })
        );
        federatedHolons = holonsWithNames;

        // Store original zone assignments
        federatedHolons.forEach(h => {
          originalZoneAssignments.set(h.id, h.zone);
        });
      }
    } catch (err) {
      console.error('Error loading federation data:', err);
    }
  }

  async function loadUsersFromHolosphere() {
    if (!holosphere) {
      // Mock data for development
      holosphereUsers = [
        { id: 'user-1', username: 'Alice', initiated: ['t1', 't2'], completed: ['t3'], sent: 5, received: 3, hours: 10, collaboration: 2, wants: ['design'], offers: ['coding'] },
        { id: 'user-2', username: 'Bob', initiated: ['t4'], completed: ['t1', 't5'], sent: 3, received: 7, hours: 15, collaboration: 4, wants: ['coding'], offers: ['design', 'testing'] },
        { id: 'user-3', username: 'Carol', initiated: [], completed: ['t2', 't4'], sent: 8, received: 2, hours: 8, collaboration: 3, wants: [], offers: ['writing'] },
        { id: 'user-4', username: 'Dave', initiated: ['t6', 't7', 't8'], completed: [], sent: 2, received: 5, hours: 20, collaboration: 1, wants: ['management'], offers: [] },
      ];
      calculateInteriorMembers();
      return;
    }

    try {
      const users = await holosphere.getAll(holonId, 'users');
      if (Array.isArray(users)) {
        holosphereUsers = users.filter((u: any) => u && u.id) as HolosphereUser[];
      } else if (typeof users === 'object' && users !== null) {
        holosphereUsers = Object.values(users).filter((u: any) => u && u.id) as HolosphereUser[];
      }

      // Load equation from settings (using shared service - same as Holonsbot)
      equation = await loadEquation(holosphere, holonId);

      // Calculate interior members from users
      calculateInteriorMembers();
    } catch (err) {
      console.error('Error loading users:', err);
    }
  }

  // Load interior members from smart contract (with balances)
  async function loadInteriorMembersFromContract() {
    if (!manager || !existingBundle?.address) return;

    try {
      const contractMembers = await manager.getInteriorMembersWithBalances(holonId);
      if (contractMembers && contractMembers.length > 0) {
        // Merge contract data with calculated data
        // Contract data has: userId, share, sharePercent, etherBalance, etherFormatted
        interiorMembers = contractMembers.map((cm: any, i: number) => {
          const holosphereUser = holosphereUsers.find(u => u.id === cm.userId);
          return {
            userId: cm.userId,
            username: holosphereUser?.username || cm.userId,
            score: cm.sharePercent || 0,
            percentage: cm.sharePercent || 0,
            color: COLOR_PALETTE[i % COLOR_PALETTE.length],
            breakdown: holosphereUser ? {
              initiated: holosphereUser.initiated?.length || 0,
              completed: holosphereUser.completed?.length || 0,
              sent: holosphereUser.sent || 0,
              received: holosphereUser.received || 0,
              hours: holosphereUser.hours || 0,
              collaboration: holosphereUser.collaboration || 0,
              wants: holosphereUser.wants?.length || 0,
              offers: holosphereUser.offers?.length || 0,
            } : undefined
          };
        });
        console.log('[FlowMgmt] Loaded interior members from contract:', interiorMembers.length);
      }
    } catch (err) {
      console.error('[FlowMgmt] Error loading contract members:', err);
      // Fall back to calculated members
    }
  }

  // Use shared scoring service (same calculation as Holonsbot)
  function calculateUserScore(user: HolosphereUser): number {
    const aggregates = toAggregates(user);
    return calculateScore(aggregates, equation);
  }

  function calculateInteriorMembers() {
    const usersWithScores = holosphereUsers.map((user, i) => ({
      userId: String(user.id),
      username: user.username || String(user.id),
      score: calculateUserScore(user),
      percentage: 0,
      color: COLOR_PALETTE[i % COLOR_PALETTE.length],
      breakdown: {
        initiated: user.initiated?.length || 0,
        completed: user.completed?.length || 0,
        sent: user.sent || 0,
        received: user.received || 0,
        hours: user.hours || 0,
        collaboration: user.collaboration || 0,
        wants: user.wants?.length || 0,
        offers: user.offers?.length || 0,
      }
    }));

    const totalScore = usersWithScores.reduce((sum, u) => sum + u.score, 0);

    interiorMembers = usersWithScores.map(u => ({
      ...u,
      percentage: totalScore > 0 ? (u.score / totalScore) * 100 : 0
    }));
  }

  // Deploy Bundle contract
  async function deployBundle() {
    if (!manager || !holonId) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    try {
      deploying = true;
      showNotification('Please confirm the transaction in your wallet...', 'info');

      const contractSteepness = steepnessToContract(steepness);
      console.log('[FlowMgmt] Deploying Bundle with:', {
        holonId,
        steepnessUI: steepness,
        steepnessContract: contractSteepness.toString(),
        nzones
      });
      const result = await manager.createHolonBundle(holonId, holonId, contractSteepness, nzones);
      showNotification(`Transaction submitted! TX: ${result.transaction.hash.slice(0, 10)}...`, 'info');

      const deployedAddress = result.address;
      showNotification('Waiting for confirmation...', 'info');
      const receipt = await result.transaction.wait();

      if (receipt?.status === 1) {
        let finalAddress = deployedAddress;
        if (!finalAddress && receipt.contractAddress) {
          finalAddress = receipt.contractAddress;
        }

        if (!finalAddress || !ethers.isAddress(finalAddress)) {
          showNotification('Bundle deployed but address not found. Please reload.', 'warning');
          return;
        }

        existingBundle = {
          address: finalAddress,
          creatorUserId: holonId,
          name: holonId,
          timestamp: Date.now(),
          steepness: contractSteepness,
          nzones,
          splitterAddress: finalAddress,
          managedAddress: finalAddress,
          zonedAddress: finalAddress
        };

        // Save to holosphere settings
        if (holosphere) {
          await holosphere.put(holonId, 'settings', {
            bundle: {
              address: finalAddress,
              creatorUserId: holonId,
              steepness: contractSteepness.toString(),
              nzones,
              deployedAt: Date.now(),
              txHash: result.transaction.hash
            }
          });
        }

        originalInteriorPercent = interiorPercent;
        originalSteepness = steepness;
        originalNzones = nzones;

        showNotification('Bundle deployed successfully!', 'success');
      } else {
        showNotification('Transaction failed on chain', 'error');
      }
    } catch (err: any) {
      console.error('Error deploying bundle:', err);
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
        showNotification('Transaction rejected by user', 'error');
      } else {
        showNotification(err.message || 'Failed to deploy bundle', 'error');
      }
    } finally {
      deploying = false;
    }
  }

  // Redeploy Bundle contract (creates a new contract)
  async function redeployBundle() {
    if (!manager || !holonId) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    // Confirm with user
    const confirmed = confirm(
      'This will deploy a NEW Bundle contract. The old contract will no longer be used.\n\n' +
      'The new contract will have the correct bytecode with steepness/zones support.\n\n' +
      'Continue?'
    );
    if (!confirmed) return;

    // Clear existing bundle so deployBundle creates a new one
    existingBundle = null;
    await deployBundle();
  }

  // Sync changes to contract - uses single transaction via syncAll
  async function syncToContract() {
    if (!manager || !existingBundle) return;

    try {
      syncing = true;
      showNotification('Please confirm the transaction in your wallet...', 'info');

      // Prepare interior members data
      const interiorMembersData = interiorMembers.map(m => ({
        userId: m.userId,
        percentage: m.percentage
      }));

      // Prepare exterior members (federated holons with zone assignments)
      const assignedHolons = federatedHolons.filter(h => h.zone >= 1);
      const exteriorMembersData = assignedHolons.map(h => ({
        userId: h.id,
        zone: h.zone
      }));

      // Convert steepness to WAD scale
      const contractSteepness = steepnessToContract(steepness);

      console.log('[FlowMgmt] Syncing all parameters:', {
        bundleAddress: existingBundle.address,
        interiorPercent,
        steepness,
        contractSteepness: contractSteepness.toString(),
        nzones,
        interiorMembers: interiorMembersData,
        exteriorMembers: exteriorMembersData
      });

      // Single transaction to sync everything
      await manager.syncAll(existingBundle.address, {
        interiorPercent,
        steepness: contractSteepness,
        nzones,
        interiorMembers: interiorMembersData,
        exteriorMembers: exteriorMembersData
      });

      // Update original values after successful sync
      originalInteriorPercent = interiorPercent;
      originalSteepness = steepness;
      originalNzones = nzones;
      assignedHolons.forEach(h => {
        originalZoneAssignments.set(h.id, h.zone);
      });

      // Save zone assignments to holosphere
      if (holosphere) {
        const federationZones: Record<string, number> = {};
        federatedHolons.forEach(h => {
          federationZones[h.id] = h.zone;
        });
        await holosphere.put(holonId, 'settings', { federationZones });
      }

      showNotification('All changes synced in a single transaction!', 'success');
    } catch (err: any) {
      console.error('Error syncing:', err);
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
        showNotification('Transaction rejected', 'error');
      } else {
        showNotification(err.message || 'Sync failed', 'error');
      }
    } finally {
      syncing = false;
    }
  }

  // Reset to original values
  function resetChanges() {
    interiorPercent = originalInteriorPercent;
    steepness = originalSteepness;
    nzones = originalNzones;

    // Reset zone assignments
    federatedHolons = federatedHolons.map(h => ({
      ...h,
      zone: originalZoneAssignments.get(h.id) ?? -1
    }));

    showNotification('Changes reset', 'info');
  }

  // Handle holon dropped into zone
  function handleHolonDropped(event: CustomEvent<{ holonId: string; zone: number; angle?: number }>) {
    const { holonId: hId, zone, angle } = event.detail;
    federatedHolons = federatedHolons.map(h =>
      h.id === hId ? { ...h, zone, angle: angle ?? h.angle } : h
    );
  }

  // Handle holon moved within zone (just angle change)
  function handleHolonMoved(event: CustomEvent<{ holonId: string; angle: number }>) {
    const { holonId: hId, angle } = event.detail;
    federatedHolons = federatedHolons.map(h =>
      h.id === hId ? { ...h, angle } : h
    );
  }

  // Handle control changes
  function handleSteepnessChange(event: CustomEvent<number>) {
    steepness = event.detail;
  }

  function handleNzonesChange(event: CustomEvent<number>) {
    nzones = event.detail;
  }

  function handleInteriorChange(event: CustomEvent<number>) {
    interiorPercent = event.detail;
  }

  // Auto-connect wallet on mount if previously connected
  onMount(async () => {
    // Always load federation and users data first
    await loadFederationData();
    await loadUsersFromHolosphere();

    // Then try to auto-connect wallet
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          await connectWallet();
        } else {
          loading = false;
        }
      } catch (e) {
        loading = false;
      }
    } else {
      loading = false;
    }
  });
</script>

<div class="flow-management">
  <!-- Notifications -->
  {#if notifications.length > 0}
    <div class="notifications">
      {#each notifications as notification (notification.id)}
        <div
          class="notification notification-{notification.type}"
          on:click={() => removeNotification(notification.id)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') removeNotification(notification.id); }}
          role="button"
          tabindex="0"
        >
          {notification.message}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Header -->
  <div class="header-section">
    <div class="title-row">
      <h2 class="title">Flow Management</h2>
      {#if !isConnected}
        <button class="connect-btn" on:click={connectWallet} disabled={loading}>
          Connect Wallet
        </button>
      {:else}
        <span class="wallet-badge">
          <span class="connected-dot"></span>
          Connected
        </span>
      {/if}
    </div>

    <FlowHeader
      bundleAddress={existingBundle?.address || null}
      {networkName}
      {interiorPercent}
      {steepness}
      {nzones}
    />
  </div>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <span>Loading flow configuration...</span>
    </div>
  {:else}
    <!-- Controls at the top -->
    <FlowControls
      {steepness}
      {nzones}
      {interiorPercent}
      hasChanges={!!hasChanges}
      syncing={syncing || deploying}
      hasBundleDeployed={!!existingBundle}
      on:steepnessChange={handleSteepnessChange}
      on:nzonesChange={handleNzonesChange}
      on:interiorChange={handleInteriorChange}
      on:sync={syncToContract}
      on:reset={resetChanges}
      on:deploy={deployBundle}
      on:redeploy={redeployBundle}
    />

    <!-- Main content -->
    <div class="main-content">
      <!-- Chart area -->
      <div class="chart-area">
        <ConcentricZoneChart
          {interiorMembers}
          {federatedHolons}
          {nzones}
          {steepness}
          {interiorPercent}
          on:holonDropped={handleHolonDropped}
          on:holonMoved={handleHolonMoved}
        />
      </div>

      <!-- Drawer -->
      <HolonDrawer
        holons={federatedHolons}
        isOpen={drawerOpen}
        on:toggle={() => drawerOpen = !drawerOpen}
      />
    </div>
  {/if}
</div>

<style>
  .flow-management {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    min-height: 100%;
    background: #0f172a;
    color: #e2e8f0;
  }

  .notifications {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 400px;
  }

  .notification {
    padding: 0.75rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    cursor: pointer;
    animation: slideIn 0.3s ease;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  .notification-success {
    background: rgba(34, 197, 94, 0.2);
    border: 1px solid #22c55e;
    color: #86efac;
  }

  .notification-error {
    background: rgba(239, 68, 68, 0.2);
    border: 1px solid #ef4444;
    color: #fca5a5;
  }

  .notification-info {
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid #3b82f6;
    color: #93c5fd;
  }

  .notification-warning {
    background: rgba(245, 158, 11, 0.2);
    border: 1px solid #f59e0b;
    color: #fcd34d;
  }

  .header-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }

  .connect-btn {
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    border: none;
    border-radius: 0.375rem;
    color: white;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .connect-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  }

  .connect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .wallet-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.75rem;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 9999px;
    font-size: 0.875rem;
    color: #86efac;
  }

  .connected-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 4rem 2rem;
    color: #94a3b8;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #334155;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .main-content {
    display: flex;
    gap: 0;
    flex: 1;
    min-height: 400px;
    background: rgba(30, 41, 59, 0.3);
    border-radius: 0.5rem;
    overflow: hidden;
  }

  .chart-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  @media (max-width: 768px) {
    .flow-management {
      padding: 0.75rem;
    }

    .main-content {
      flex-direction: column;
    }

    .notifications {
      left: 1rem;
      right: 1rem;
      max-width: none;
    }
  }
</style>
