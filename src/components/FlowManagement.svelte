<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { ethers } from 'ethers';
  import { walletAddress } from '../dashboard/store';
  import { HolonsManager } from '../lib/holons/HolonsManager';
  import type { HolonBundle, FlowConfig } from '../lib/holons/HolonsContract';
  import type { FlowVisualizationData, FlowNode, FlowEdge, FederationLink } from '../lib/holons/FlowSettings';
  import type { HoloSphere } from 'holosphere';
  import { fetchHolonName } from '../utils/holonNames';

  export let holonId: string;

  // Context
  let holosphere: HoloSphere;
  let manager: HolonsManager | null = null;
  let provider: ethers.BrowserProvider | null = null;

  // State
  let loading = true;
  let deploying = false;
  let isConnected = false;
  let existingBundle: HolonBundle | null = null;
  let notifications: Array<{id: number, message: string, type: string}> = [];
  let notificationId = 0;

  // Flow configuration (Bundle contract uses interior/exterior terminology)
  let interiorPercent = 50;
  let exteriorPercent = 50;

  // Bundle parameters
  let steepness = BigInt('500000000000000000'); // 0.5e18 = 50% decay per zone
  let nzones = 6;

  // Track original values from contract for change detection
  let originalInteriorPercent = 50;
  let originalSteepness = BigInt('500000000000000000');
  let originalNzones = 6;
  let syncing = false;

  // Interior members state
  interface InteriorMemberInfo {
    userId: string;
    share: bigint;
    sharePercent: number;
    etherBalance: bigint;
    etherFormatted: string;
  }
  let interiorMembers: InteriorMemberInfo[] = [];
  let loadingMembers = false;
  let memberLoadError: string | null = null;

  // Drag and drop state
  let draggingHolonId: string | null = null;
  let dropTargetZone: number | null = null;
  let dragPosition = { x: 0, y: 0 };
  let isDragging = false;
  let svgElement: SVGSVGElement | null = null;
  let draggedFromCard = false;

  // Users from holosphere for syncing
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
  let equation: Record<string, number> = {
    initiated: 1,
    completed: 2,
    sent: 1,
    received: 1,
    hours: 1,
    collaboration: 1,
    wants: 1,
    offers: 1
  };

  // Reactive: compute user percentages for display
  $: displayUsers = holosphereUsers.length > 0 ? calculateUserPercentages() : [];

  // Reactive: detect if there are unsaved changes
  $: hasChanges = existingBundle && (
    interiorPercent !== originalInteriorPercent ||
    steepness !== originalSteepness ||
    nzones !== originalNzones
  );

  // Alias for UI compatibility
  $: internalPercent = interiorPercent;
  $: externalPercent = exteriorPercent;

  // Event signatures for parsing logs
  const NEW_HOLON_EVENT_SIGNATURE = ethers.id('NewHolon(string,address)');
  const HOLON_CREATED_EVENT_SIGNATURE = ethers.id('HolonCreated(address,string,string,address,uint256)');

  // Parse holon address from transaction receipt logs
  function parseHolonAddressFromReceipt(receipt: ethers.TransactionReceipt): string | null {
    if (!receipt.logs || receipt.logs.length === 0) {
      console.log('[FlowMgmt] No logs in receipt');
      return null;
    }

    console.log('[FlowMgmt] Parsing logs from receipt:', receipt.logs.length, 'logs found');

    for (const log of receipt.logs) {
      // Try to parse HolonCreated event (indexed address is in topics[1])
      if (log.topics[0] === HOLON_CREATED_EVENT_SIGNATURE && log.topics.length >= 2) {
        const addressHex = log.topics[1];
        const address = ethers.getAddress('0x' + addressHex.slice(26));
        console.log('[FlowMgmt] Found HolonCreated event, address:', address);
        return address;
      }

      // Try to parse NewHolon event (address is in data)
      if (log.topics[0] === NEW_HOLON_EVENT_SIGNATURE) {
        try {
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          const decoded = abiCoder.decode(['string', 'address'], log.data);
          const address = decoded[1] as string;
          console.log('[FlowMgmt] Found NewHolon event, address:', address);
          return address;
        } catch (e) {
          console.log('[FlowMgmt] Failed to decode NewHolon event:', e);
        }
      }
    }

    // Fallback: try generic parsing
    for (const log of receipt.logs) {
      if (log.data && log.data.length >= 66) {
        try {
          const abiCoder = ethers.AbiCoder.defaultAbiCoder();
          try {
            const decoded = abiCoder.decode(['string', 'address'], log.data);
            if (decoded[1] && ethers.isAddress(decoded[1])) {
              console.log('[FlowMgmt] Found address in (string, address) format:', decoded[1]);
              return decoded[1] as string;
            }
          } catch {}
        } catch {}
      }
    }

    console.log('[FlowMgmt] Could not parse address from logs');
    return null;
  }

  // Zone management - zones 0 (center) to 5 (outer)
  interface ZonedHolon {
    id: string;
    name: string;
    zone: number;
    angle: number; // Position angle in radians
    flowPercent: number;
    status: 'active' | 'pending' | 'inactive';
    splitterAddress?: string;
    internalPercent?: number;
  }

  let federatedHolons: ZonedHolon[] = [];

  // Canvas references
  let sankeyCanvas: HTMLCanvasElement;
  let sankeyCtx: CanvasRenderingContext2D;

  // Canvas dimensions
  const SANKEY_WIDTH = 800;
  const SANKEY_HEIGHT = 400;

  // Zone colors for display
  const ZONE_COLORS = [
    '#3b82f6', // Zone 0 - Blue (center/internal)
    '#8b5cf6', // Zone 1 - Purple
    '#ec4899', // Zone 2 - Pink
    '#f59e0b', // Zone 3 - Amber
    '#10b981', // Zone 4 - Emerald
    '#6b7280', // Zone 5 - Gray (outer)
  ];

  // Animation
  let animationFrame: number;
  let flowAnimation = 0;

  // Try to get holosphere context
  try {
    holosphere = getContext('holosphere');
  } catch (e) {
    console.error('FlowManagement: Failed to get holosphere context');
  }

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

        // Initialize manager
        if (holosphere) {
          manager = new HolonsManager(provider, holosphere.gun);
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

          // Validate that the address is a proper contract address (40 hex chars)
          // Not a tx hash (64 hex chars)
          const isValidAddress = (addr: string) =>
            addr && addr.startsWith('0x') && addr.length === 42;

          if (bundleSettings?.address && isValidAddress(bundleSettings.address)) {
            existingBundle = {
              address: bundleSettings.address,
              creatorUserId: bundleSettings.creatorUserId || holonId,
              name: holonId,
              timestamp: bundleSettings.deployedAt || Date.now(),
              steepness: BigInt(bundleSettings.steepness || '500000000000000000'),
              nzones: bundleSettings.nzones || 6,
              // Legacy compatibility
              splitterAddress: bundleSettings.address,
              managedAddress: bundleSettings.address,
              zonedAddress: bundleSettings.address
            };
            console.log('Loaded Bundle from holosphere settings:', existingBundle);
          } else if (bundleSettings?.address) {
            console.warn('Invalid bundle address in settings (possibly a tx hash):', bundleSettings.address);
            // Clean up corrupted settings
            try {
              console.log('[FlowMgmt] Cleaning up invalid bundle settings...');
              await holosphere.put(holonId, 'settings', { bundle: null });
            } catch (cleanupErr) {
              console.log('[FlowMgmt] Could not clean up invalid settings:', cleanupErr);
            }
          }
        } catch (settingsErr) {
          console.log('No Bundle in holosphere settings:', settingsErr);
        }
      }

      // If not found in settings, try the contract (if manager is available)
      if (!existingBundle && manager) {
        existingBundle = await manager.getHolonBundle(holonId);
      }

      if (existingBundle) {
        // Load flow config from Bundle contract
        if (manager && existingBundle.address) {
          const flowConfig = await manager.getFlowConfiguration(existingBundle.address);
          if (flowConfig) {
            interiorPercent = flowConfig.interiorPercent || 50;
            exteriorPercent = 100 - interiorPercent;
            steepness = flowConfig.steepness || BigInt('500000000000000000');
            nzones = flowConfig.nzones || 6;
            // Track original values for change detection
            originalInteriorPercent = interiorPercent;
            originalSteepness = steepness;
            originalNzones = nzones;
          }
        }
      }

      // Load federation data from holosphere
      await loadFederationData();

      // Load users from holosphere (for syncing to contract)
      await loadUsersFromHolosphere();

      // Load interior members if bundle exists
      if (existingBundle) {
        await loadInteriorMembers();
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
        { id: 'holon-a', name: 'Community Alpha', zone: 2, angle: 0, flowPercent: 25, status: 'active', internalPercent: 60 },
        { id: 'holon-b', name: 'DAO Beta', zone: 3, angle: Math.PI / 2, flowPercent: 35, status: 'active', internalPercent: 40 },
        { id: 'holon-c', name: 'Collective Gamma', zone: 4, angle: Math.PI, flowPercent: 20, status: 'pending', internalPercent: 70 },
        { id: 'holon-d', name: 'Network Delta', zone: 3, angle: Math.PI * 1.5, flowPercent: 20, status: 'active', internalPercent: 55 },
      ];
      return;
    }

    try {
      // Try to get federation data from holosphere
      let federationData: any[] = [];

      // First try getFederation method
      try {
        const fedInfo = await holosphere.getFederation(holonId);
        if (fedInfo?.federated && Array.isArray(fedInfo.federated)) {
          federationData = fedInfo.federated.map((id: string) => ({ targetId: id }));
          console.log('[FlowMgmt] Loaded federation from getFederation:', federationData.length);
        }
      } catch (fedErr) {
        console.log('[FlowMgmt] getFederation not available, trying settings');
      }

      // Fallback to settings if no federation data yet
      if (federationData.length === 0) {
        const settings = await holosphere.getAll(holonId, 'settings');
        if (settings && settings[0]?.federation) {
          federationData = settings[0].federation;
          console.log('[FlowMgmt] Loaded federation from settings:', federationData.length);
        }
      }

      if (federationData.length > 0) {
        const settings = await holosphere.getAll(holonId, 'settings');
        const holonsWithNames = await Promise.all(
          federationData.map(async (fed: FederationLink | { targetId: string }, index: number) => {
            const targetId = (fed as any).targetId || (fed as any).id || fed;
            // Always get name from target holon's settings
            const name = await fetchHolonName(holosphere, String(targetId));
            // Use saved zone if available, otherwise default to last zone
            const savedZone = settings?.[0]?.federationZones?.[targetId];
            return {
              id: String(targetId),
              name,
              zone: savedZone ?? nzones, // Default to last zone
              angle: (index * Math.PI * 2) / federationData.length,
              flowPercent: Math.floor(100 / federationData.length),
              status: 'active' as const,
              internalPercent: 50
            };
          })
        );
        federatedHolons = holonsWithNames;
        console.log('[FlowMgmt] Loaded federated holons:', federatedHolons.length);
      }
    } catch (err) {
      console.error('Error loading federation data:', err);
    }
  }

  // Load interior members with shares and balances from contract
  async function loadInteriorMembers() {
    if (!manager || !existingBundle?.address) {
      interiorMembers = [];
      return;
    }

    try {
      loadingMembers = true;
      memberLoadError = null;

      const members = await manager.getInteriorMembersWithBalances(holonId);
      interiorMembers = members;
    } catch (err: any) {
      console.error('Error loading interior members:', err);
      memberLoadError = err.message || 'Failed to load member data';
      interiorMembers = [];
    } finally {
      loadingMembers = false;
    }
  }

  // Load users from holosphere
  async function loadUsersFromHolosphere() {
    if (!holosphere) return;

    try {
      const users = await holosphere.getAll(holonId, 'users');
      if (Array.isArray(users)) {
        holosphereUsers = users.filter((u: any) => u && u.id) as HolosphereUser[];
      } else if (typeof users === 'object' && users !== null) {
        holosphereUsers = Object.values(users).filter((u: any) => u && u.id) as HolosphereUser[];
      }
      console.log('[FlowMgmt] Loaded users from holosphere:', holosphereUsers.length);

      // Also load equation from settings
      try {
        const settings = await holosphere.getAll(holonId, 'settings');
        if (settings && settings[0]?.equation) {
          equation = settings[0].equation;
          console.log('[FlowMgmt] Loaded equation from settings:', equation);
        }
      } catch (eqErr) {
        console.log('[FlowMgmt] Could not load equation, using defaults');
      }
    } catch (err) {
      console.error('Error loading users from holosphere:', err);
      holosphereUsers = [];
    }
  }

  // Calculate score for a user based on equation
  function calculateUserScore(user: HolosphereUser): number {
    let score = 0;

    if (equation.initiated > 0) {
      const initiated = user.initiated || [];
      score += (Array.isArray(initiated) ? initiated.length : 0) * equation.initiated;
    }
    if (equation.completed > 0) {
      const completed = user.completed || [];
      score += (Array.isArray(completed) ? completed.length : 0) * equation.completed;
    }
    if (equation.sent > 0) {
      score += (user.sent || 0) * equation.sent;
    }
    if (equation.received > 0) {
      score += (user.received || 0) * equation.received;
    }
    if (equation.hours > 0) {
      score += (user.hours || 0) * equation.hours;
    }
    if (equation.collaboration > 0) {
      score += (user.collaboration || 0) * equation.collaboration;
    }
    if (equation.wants > 0) {
      const wants = user.wants || [];
      score += (Array.isArray(wants) ? wants.length : 0) * equation.wants;
    }
    if (equation.offers > 0) {
      const offers = user.offers || [];
      score += (Array.isArray(offers) ? offers.length : 0) * equation.offers;
    }

    return score;
  }

  // Calculate percentages for all users based on their scores
  function calculateUserPercentages(): Array<{ userId: string; username: string; score: number; percentage: number }> {
    const usersWithScores = holosphereUsers.map(user => ({
      userId: String(user.id), // Ensure userId is always a string for contract
      username: user.username || String(user.id), // Use username if available, fallback to id
      score: calculateUserScore(user)
    }));

    const totalScore = usersWithScores.reduce((sum, u) => sum + u.score, 0);

    return usersWithScores.map(u => ({
      ...u,
      percentage: totalScore > 0 ? Math.round((u.score / totalScore) * 100) : 0
    }));
  }

  // One-click deploy Bundle contract
  async function deployBundle() {
    if (!manager || !holonId) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    try {
      deploying = true;
      showNotification('Please confirm the transaction in your wallet...', 'info');

      // Deploy Bundle contract directly (no registry needed!)
      const result = await manager.createHolonBundle(holonId, holonId, steepness, nzones);
      showNotification(`Transaction submitted! TX: ${result.transaction.hash.slice(0, 10)}...`, 'info');

      // The address is returned directly from deployment
      const deployedAddress = result.address;
      console.log('[FlowMgmt] Bundle deployed at:', deployedAddress);

      // Wait for transaction to be mined
      showNotification('Waiting for transaction confirmation...', 'info');
      const receipt = await result.transaction.wait();

      // Debug: log the full receipt
      console.log('[FlowMgmt] Transaction receipt:', {
        status: receipt?.status,
        hash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
        gasUsed: receipt?.gasUsed?.toString(),
        logsCount: receipt?.logs?.length,
        contractAddress: receipt?.contractAddress,
        logs: receipt?.logs?.map(l => ({
          address: l.address,
          topics: l.topics,
          dataLength: l.data?.length
        }))
      });

      // If receipt has no logs, try to fetch them explicitly
      let logsToCheck = receipt?.logs || [];
      if (logsToCheck.length === 0 && provider && receipt?.hash) {
        try {
          console.log('[FlowMgmt] No logs in receipt, fetching explicitly...');
          const txReceipt = await provider.getTransactionReceipt(receipt.hash);
          if (txReceipt?.logs && txReceipt.logs.length > 0) {
            logsToCheck = txReceipt.logs;
            console.log('[FlowMgmt] Fetched logs explicitly:', logsToCheck.length, 'logs found');
          }
        } catch (fetchErr) {
          console.log('[FlowMgmt] Could not fetch logs:', fetchErr);
        }
      }

      if (receipt?.status === 1) {
        // Use the address from direct deployment (no need to parse logs!)
        let finalAddress = deployedAddress;

        // Fallback: try to parse from logs if not available
        if (!finalAddress) {
          finalAddress = parseHolonAddressFromReceipt({ ...receipt, logs: logsToCheck } as ethers.TransactionReceipt);
        }

        // Fallback: use contract address from receipt
        if (!finalAddress && receipt.contractAddress) {
          finalAddress = receipt.contractAddress;
          console.log('[FlowMgmt] Using contract address from receipt:', finalAddress);
        }

        // Validate the address before saving
        if (!finalAddress || !ethers.isAddress(finalAddress)) {
          console.error('[FlowMgmt] Invalid or missing deployed address:', finalAddress);
          showNotification('Bundle deployed but address not found. Please reload to check.', 'warning');
          return;
        }

        console.log('[FlowMgmt] Final deployed address:', finalAddress);

        // Set the bundle directly so UI updates immediately
        existingBundle = {
          address: finalAddress,
          creatorUserId: holonId,
          name: holonId,
          timestamp: Date.now(),
          steepness,
          nzones,
          // Legacy compatibility
          splitterAddress: finalAddress,
          managedAddress: finalAddress,
          zonedAddress: finalAddress
        };

        // Save Bundle to holosphere settings
        if (holosphere) {
          try {
            await holosphere.put(holonId, 'settings', {
              bundle: {
                address: finalAddress,
                creatorUserId: holonId,
                steepness: steepness.toString(),
                nzones,
                deployedAt: Date.now(),
                txHash: result.transaction.hash
              }
            });
            console.log('[FlowMgmt] Bundle saved to holosphere settings:', finalAddress);
          } catch (saveErr) {
            console.error('[FlowMgmt] Failed to save Bundle to settings:', saveErr);
          }
        }

        // Initialize original values for sync tracking
        originalInteriorPercent = interiorPercent;
        originalSteepness = steepness;
        originalNzones = nzones;

        showNotification('Bundle deployed successfully!', 'success');
        showNotification(`Bundle address: ${finalAddress}`, 'success');

        // Also try to reload from contract (may take a moment to index)
        setTimeout(() => loadBundleAndFederation(), 2000);
      } else {
        showNotification('Transaction failed on chain', 'error');
      }
    } catch (err: any) {
      console.error('Error deploying bundle:', err);
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
        showNotification('Transaction rejected by user', 'error');
      } else if (err.code === -32602 || err.message?.includes('failed to decode')) {
        // Transaction encoding error - usually stale wallet session
        showNotification('Wallet session expired. Please disconnect and reconnect your wallet.', 'error');
        isConnected = false;
      } else if (err.code === 4100 || err.message?.includes('not been authorised')) {
        showNotification('Please authorize this site in your wallet settings.', 'error');
        isConnected = false;
      } else if (err.message?.includes('session expired')) {
        showNotification(err.message, 'error');
        isConnected = false;
      } else {
        showNotification(err.message || 'Failed to deploy bundle', 'error');
      }
    } finally {
      deploying = false;
    }
  }

  // Sync UI changes to smart contract
  async function syncToContract() {
    if (!manager || !existingBundle) return;

    // Calculate user percentages from holosphere users
    const usersWithPercentages = calculateUserPercentages();
    const hasMembersToSync = usersWithPercentages.length > 0;

    if (!hasChanges && !hasMembersToSync) return;

    try {
      syncing = true;
      showNotification('Please confirm the transaction(s) in your wallet...', 'info');

      // Sync flow split if changed
      if (interiorPercent !== originalInteriorPercent) {
        await manager.updateFlowSplit(existingBundle.address, interiorPercent);
        exteriorPercent = 100 - interiorPercent;
        originalInteriorPercent = interiorPercent;
        showNotification(`Flow split synced: ${interiorPercent}% interior`, 'success');
      }

      // Sync members from holosphere - first add all members, then set their splits
      if (hasMembersToSync) {
        // Step 1: Add all members to the contract
        const userIds = usersWithPercentages.map(u => u.userId);
        showNotification(`Adding ${userIds.length} members to contract...`, 'info');

        try {
          await manager.addInteriorMembers(existingBundle.address, userIds);
          showNotification(`${userIds.length} members added to contract!`, 'success');
        } catch (addErr: any) {
          // Members might already exist, continue to set splits
          console.log('[FlowMgmt] addMembers error (may already exist):', addErr.message);
        }

        // Step 2: Set their interior split percentages
        showNotification(`Setting share percentages for ${usersWithPercentages.length} members...`, 'info');
        const membersToSync = usersWithPercentages.map(u => ({
          userId: u.userId,
          sharePercent: u.percentage
        }));
        await manager.updateInteriorMembers(existingBundle.address, membersToSync);
        showNotification(`${usersWithPercentages.length} member shares synced to contract!`, 'success');

        // Reload interior members from contract to see updated data
        await loadInteriorMembers();
      }

      // Sync federated holons to the zoned contract (exterior) - batch transaction
      if (federatedHolons.length > 0) {
        showNotification(`Syncing ${federatedHolons.length} federated holons to contract...`, 'info');

        // Step 1: Add all federated holons as members in one transaction
        const holonIds = federatedHolons.map(h => h.id);
        try {
          await manager.addInteriorMembers(existingBundle.address, holonIds);
          showNotification(`${holonIds.length} federated holons added as members!`, 'success');
        } catch (addErr: any) {
          console.log('[FlowMgmt] addMembers for holons (may exist):', addErr.message);
        }

        // Step 2: Batch assign all zones in one transaction
        const zoneAssignments = federatedHolons.map(h => ({
          userId: h.id,
          zone: h.zone
        }));
        try {
          await manager.assignMembersToZones(existingBundle.address, zoneAssignments);
          showNotification(`${federatedHolons.length} federated holons assigned to zones!`, 'success');
        } catch (zoneErr: any) {
          console.log('[FlowMgmt] batch assignToZones error:', zoneErr.message);
        }
      }

      showNotification('All changes synced to contract!', 'success');
    } catch (err: any) {
      console.error('Error syncing to contract:', err);
      if (err.code === 4001 || err.code === 'ACTION_REJECTED') {
        showNotification('Transaction rejected by user', 'error');
      } else {
        showNotification(err.message || 'Failed to sync to contract', 'error');
      }
    } finally {
      syncing = false;
    }
  }

  // Format steepness for display (convert from 1e18 to percentage)
  function formatSteepness(value: bigint): string {
    const percent = Number(value) / 1e16; // Convert to percentage
    return `${percent.toFixed(0)}%`;
  }

  // Calculate zone weights based on steepness and nzones
  // Zone weight[z] = steepness^z (in WAD scale where WAD = 1e18)
  function calculateZoneWeights(s: bigint, zones: number): { weights: number[], percentages: number[] } {
    const WAD = BigInt('1000000000000000000'); // 1e18
    const weights: number[] = [];
    let weight = WAD; // s^0 = 1

    for (let z = 0; z <= zones; z++) {
      weights.push(Number(weight) / 1e18); // Convert to decimal
      // s^(z+1) = s^z * s / WAD
      weight = (weight * s) / WAD;
    }

    // Calculate percentages (assuming 1 member per zone)
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const percentages = weights.map(w => totalWeight > 0 ? (w / totalWeight) * 100 : 0);

    return { weights, percentages };
  }

  // Reactive zone weight calculation
  $: zoneData = calculateZoneWeights(steepness, nzones);

  // Reset to last synced values
  function resetChanges() {
    interiorPercent = originalInteriorPercent;
    exteriorPercent = 100 - interiorPercent;
    steepness = originalSteepness;
    nzones = originalNzones;
  }

  // Sankey diagram rendering
  function drawSankey() {
    if (!sankeyCtx) return;

    // Clear canvas
    sankeyCtx.clearRect(0, 0, SANKEY_WIDTH, SANKEY_HEIGHT);

    const padding = 40;

    // Calculate interior flow for each member
    const interiorFlow = interiorPercent;
    const exteriorFlow = exteriorPercent;

    // Calculate zone flows based on steepness
    const zoneWeights = zoneData.percentages;

    // Group federated holons by zone
    const holonsByZone: Record<number, ZonedHolon[]> = {};
    federatedHolons.forEach(h => {
      if (!holonsByZone[h.zone]) holonsByZone[h.zone] = [];
      holonsByZone[h.zone].push(h);
    });

    // Main nodes - always shown
    const nodes: any[] = [
      { id: 'input', label: 'Income', x: padding, y: SANKEY_HEIGHT / 2, height: 120, color: '#8b5cf6' },
      { id: 'splitter', label: 'Bundle', x: 150, y: SANKEY_HEIGHT / 2, height: 120, color: '#6366f1' },
      { id: 'interior', label: `Interior\n${interiorPercent}%`, x: 280, y: 100, height: Math.max(40, interiorFlow * 1.2), color: '#3b82f6' },
      { id: 'exterior', label: `Exterior\n${exteriorPercent}%`, x: 280, y: 300, height: Math.max(40, exteriorFlow * 1.2), color: '#f59e0b' },
    ];

    // Add interior member nodes (right side of interior)
    let interiorYOffset = 30;
    const memberNodes: any[] = [];

    if (displayUsers.length > 0) {
      displayUsers.slice(0, 6).forEach((user, i) => { // Limit to 6 for display
        const userFlow = (user.percentage / 100) * interiorFlow;
        const nodeHeight = Math.max(15, userFlow * 1.2);
        memberNodes.push({
          id: `member-${user.userId}`,
          label: `${user.username.slice(0, 8)}\n${user.percentage}%`,
          x: 420,
          y: interiorYOffset + nodeHeight / 2,
          height: nodeHeight,
          color: '#3b82f6',
          flowPercent: user.percentage
        });
        interiorYOffset += nodeHeight + 8;
      });
      if (displayUsers.length > 6) {
        memberNodes.push({
          id: 'member-others',
          label: `+${displayUsers.length - 6} more`,
          x: 420,
          y: interiorYOffset + 10,
          height: 20,
          color: '#3b82f6',
          flowPercent: displayUsers.slice(6).reduce((s, u) => s + u.percentage, 0)
        });
      }
    } else {
      // Placeholder for empty members
      memberNodes.push({
        id: 'member-placeholder',
        label: 'No members\n(add users)',
        x: 420,
        y: 80,
        height: 40,
        color: '#4b5563',
        flowPercent: 100
      });
    }
    nodes.push(...memberNodes);

    // Add zone nodes (showing zone distribution) - always show zones
    let exteriorYOffset = 220;
    const zoneNodes: any[] = [];

    // Always show at least the first few zones based on steepness
    for (let z = 0; z <= Math.min(nzones, 5); z++) {
      const zonePercent = zoneWeights[z] || 0;
      const holonsInZone = holonsByZone[z] || [];
      const nodeHeight = Math.max(18, zonePercent * 0.8);

      if (zonePercent > 0.1) { // Show zones with any meaningful weight
        zoneNodes.push({
          id: `zone-${z}`,
          label: `Z${z} ${zonePercent.toFixed(0)}%`,
          x: 420,
          y: exteriorYOffset + nodeHeight / 2,
          height: nodeHeight,
          color: ZONE_COLORS[z] || ZONE_COLORS[5],
          flowPercent: zonePercent,
          holons: holonsInZone
        });
        exteriorYOffset += nodeHeight + 6;
      }
    }
    nodes.push(...zoneNodes);

    // Add individual holon nodes (rightmost column)
    let holonYOffset = 220;
    const holonNodes: any[] = [];

    if (federatedHolons.length > 0) {
      zoneNodes.forEach(zoneNode => {
        const holonsInZone = zoneNode.holons || [];
        holonsInZone.forEach((holon: ZonedHolon) => {
          const holonShare = zoneNode.flowPercent / Math.max(1, holonsInZone.length);
          const nodeHeight = Math.max(14, holonShare * 0.6);
          holonNodes.push({
            id: `holon-${holon.id}`,
            label: holon.name.slice(0, 10),
            x: 560,
            y: holonYOffset + nodeHeight / 2,
            height: nodeHeight,
            color: ZONE_COLORS[holon.zone] || ZONE_COLORS[5],
            flowPercent: holonShare,
            zone: holon.zone
          });
          holonYOffset += nodeHeight + 5;
        });
      });
    } else {
      // Placeholder for empty holons
      holonNodes.push({
        id: 'holon-placeholder',
        label: 'No holons\n(federate)',
        x: 560,
        y: 280,
        height: 40,
        color: '#4b5563',
        flowPercent: 0
      });
    }
    nodes.push(...holonNodes);

    // Draw links - Income to Splitter
    drawSankeyLink(nodes[0], nodes[1], 100, '#8b5cf6');

    // Splitter to Interior/Exterior
    drawSankeyLink(nodes[1], nodes[2], interiorFlow, '#3b82f6');
    drawSankeyLink(nodes[1], nodes[3], exteriorFlow, '#f59e0b');

    // Interior to Members
    memberNodes.forEach(memberNode => {
      const flowValue = memberNode.id === 'member-placeholder'
        ? interiorFlow
        : (memberNode.flowPercent / 100) * interiorFlow;
      drawSankeyLink(nodes[2], memberNode, Math.max(flowValue, 5), memberNode.color);
    });

    // Exterior to Zones
    zoneNodes.forEach(zoneNode => {
      const flowValue = (zoneNode.flowPercent / 100) * exteriorFlow;
      drawSankeyLink(nodes[3], zoneNode, Math.max(flowValue, 3), zoneNode.color);
    });

    // Zones to Holons (only if we have real holons)
    if (federatedHolons.length > 0) {
      holonNodes.forEach(holonNode => {
        if (holonNode.id !== 'holon-placeholder') {
          const zoneNode = zoneNodes.find(z => z.id === `zone-${holonNode.zone}`);
          if (zoneNode) {
            const flowValue = (holonNode.flowPercent / 100) * exteriorFlow;
            drawSankeyLink(zoneNode, holonNode, Math.max(flowValue, 2), holonNode.color);
          }
        }
      });
    } else if (zoneNodes.length > 0) {
      // Draw a single link from first zone to placeholder
      const placeholderNode = holonNodes.find(n => n.id === 'holon-placeholder');
      if (placeholderNode) {
        drawSankeyLink(zoneNodes[0], placeholderNode, 10, '#4b5563');
      }
    }

    // Draw all nodes
    nodes.forEach(node => {
      drawSankeyNode(node);
    });

    // Draw title
    sankeyCtx.fillStyle = '#9ca3af';
    sankeyCtx.font = '12px sans-serif';
    sankeyCtx.textAlign = 'center';
    sankeyCtx.fillText('Flow Distribution Preview', SANKEY_WIDTH / 2, 20);

    // Draw legend
    drawSankeyLegend();
  }

  function drawSankeyLegend() {
    const legendY = SANKEY_HEIGHT - 25;
    sankeyCtx.font = '10px sans-serif';
    sankeyCtx.textAlign = 'left';

    // Interior
    sankeyCtx.fillStyle = '#3b82f6';
    sankeyCtx.fillRect(50, legendY, 12, 12);
    sankeyCtx.fillStyle = '#9ca3af';
    sankeyCtx.fillText('Interior Members', 66, legendY + 10);

    // Exterior
    sankeyCtx.fillStyle = '#f59e0b';
    sankeyCtx.fillRect(180, legendY, 12, 12);
    sankeyCtx.fillStyle = '#9ca3af';
    sankeyCtx.fillText('Exterior Zones', 196, legendY + 10);

    // Holons
    sankeyCtx.fillStyle = '#10b981';
    sankeyCtx.fillRect(300, legendY, 12, 12);
    sankeyCtx.fillStyle = '#9ca3af';
    sankeyCtx.fillText('Federated Holons', 316, legendY + 10);
  }

  function drawSankeyNode(node: any) {
    const { x, y, height, label, color } = node;
    const width = 25;

    // Node rectangle with color
    const nodeColor = color || '#374151';
    sankeyCtx.fillStyle = nodeColor + '40'; // Semi-transparent fill
    sankeyCtx.fillRect(x, y - height / 2, width, height);
    sankeyCtx.strokeStyle = nodeColor;
    sankeyCtx.lineWidth = 2;
    sankeyCtx.strokeRect(x, y - height / 2, width, height);

    // Label to the right of node
    sankeyCtx.fillStyle = '#e5e7eb';
    sankeyCtx.font = '10px sans-serif';
    sankeyCtx.textAlign = 'left';
    sankeyCtx.textBaseline = 'middle';

    const lines = label.split('\n');
    lines.forEach((line: string, i: number) => {
      sankeyCtx.fillText(line, x + width + 5, y + (i - (lines.length - 1) / 2) * 12);
    });
  }

  function drawSankeyLink(source: any, target: any, value: number, color: string) {
    const sourceRight = source.x + 25;
    const targetLeft = target.x;

    const flowHeight = Math.max(5, value * 1.5);

    // Calculate vertical positions
    const sourceY = source.y;
    const targetY = target.y;

    // Draw curved path
    sankeyCtx.beginPath();
    sankeyCtx.moveTo(sourceRight, sourceY - flowHeight / 2);

    // Bezier curve for smooth flow
    const cpX = (sourceRight + targetLeft) / 2;
    sankeyCtx.bezierCurveTo(
      cpX, sourceY - flowHeight / 2,
      cpX, targetY - flowHeight / 2,
      targetLeft, targetY - flowHeight / 2
    );
    sankeyCtx.lineTo(targetLeft, targetY + flowHeight / 2);
    sankeyCtx.bezierCurveTo(
      cpX, targetY + flowHeight / 2,
      cpX, sourceY + flowHeight / 2,
      sourceRight, sourceY + flowHeight / 2
    );
    sankeyCtx.closePath();

    // Gradient fill
    const gradient = sankeyCtx.createLinearGradient(sourceRight, 0, targetLeft, 0);
    gradient.addColorStop(0, `${color}80`);
    gradient.addColorStop(1, `${color}40`);
    sankeyCtx.fillStyle = gradient;
    sankeyCtx.fill();

    // Animated flow particles along the curve
    const flowOffset = flowAnimation % 1;
    for (let i = 0; i < 5; i++) {
      const t = (flowOffset + i * 0.2) % 1;
      const px = sourceRight + (targetLeft - sourceRight) * t;
      // Simple bezier approximation for y
      const py = sourceY + (targetY - sourceY) * (3 * t * t - 2 * t * t * t);

      sankeyCtx.beginPath();
      sankeyCtx.arc(px, py, 3, 0, Math.PI * 2);
      sankeyCtx.fillStyle = color;
      sankeyCtx.fill();
    }
  }

  // Update holon flow percentage
  function updateHolonFlow(holonId: string, newPercent: number) {
    const holon = federatedHolons.find(h => h.id === holonId);
    if (holon) {
      holon.flowPercent = newPercent;
      // Normalize percentages
      const total = federatedHolons.reduce((sum, h) => sum + h.flowPercent, 0);
      if (total > 0) {
        federatedHolons = federatedHolons.map(h => ({
          ...h,
          flowPercent: Math.round((h.flowPercent / total) * 100)
        }));
      }
    }
  }

  // Update zone for a federated holon
  async function updateHolonZone(targetHolonId: string, newZone: number) {
    // Clamp zone to valid range
    const clampedZone = Math.max(0, Math.min(newZone, nzones));

    // Update local state
    federatedHolons = federatedHolons.map(h =>
      h.id === targetHolonId ? { ...h, zone: clampedZone } : h
    );

    // Save to holosphere
    if (holosphere) {
      try {
        const settings = await holosphere.getAll(holonId, 'settings');
        const currentZones = settings?.[0]?.federationZones || {};
        await holosphere.put(holonId, 'settings', {
          ...settings?.[0],
          federationZones: {
            ...currentZones,
            [targetHolonId]: clampedZone
          }
        });
        showNotification(`Zone updated to Z${clampedZone}`, 'success');
      } catch (err) {
        console.error('Error saving zone:', err);
        showNotification('Failed to save zone', 'error');
      }
    }

    // Sync to contract if bundle exists
    if (manager && existingBundle?.address) {
      try {
        await manager.contract.assignToZone(existingBundle.address, targetHolonId, clampedZone);
        showNotification(`Zone synced to contract: Z${clampedZone}`, 'success');
      } catch (err: any) {
        console.error('Error syncing zone to contract:', err);
        // Don't show error for contract sync - it's optional
      }
    }
  }

  // Drag and drop handlers for zone assignment - Card based
  function handleCardDragStart(e: DragEvent, holonId: string) {
    draggingHolonId = holonId;
    draggedFromCard = true;
    isDragging = true;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', holonId);
      // Custom drag image
      const dragEl = e.target as HTMLElement;
      if (dragEl) {
        e.dataTransfer.setDragImage(dragEl, 20, 20);
      }
    }
  }

  function handleCardDragEnd() {
    draggingHolonId = null;
    dropTargetZone = null;
    isDragging = false;
    draggedFromCard = false;
  }

  function handleZoneDragOver(e: DragEvent, zone: number) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    dropTargetZone = zone;
  }

  function handleZoneDragLeave() {
    dropTargetZone = null;
  }

  function handleZoneDrop(e: DragEvent, zone: number) {
    e.preventDefault();
    if (draggingHolonId) {
      updateHolonZone(draggingHolonId, zone);
    }
    draggingHolonId = null;
    dropTargetZone = null;
    isDragging = false;
    draggedFromCard = false;
  }

  // Click on holon node in SVG to select it, then click zone to assign
  let selectedHolonId: string | null = null;

  function handleHolonClick(e: MouseEvent, holonId: string) {
    e.stopPropagation();
    if (selectedHolonId === holonId) {
      selectedHolonId = null; // Deselect
    } else {
      selectedHolonId = holonId;
    }
  }

  function handleZoneClick(e: MouseEvent, zone: number) {
    e.stopPropagation();
    if (selectedHolonId) {
      updateHolonZone(selectedHolonId, zone);
      selectedHolonId = null;
    }
  }

  // Clear selection when clicking outside
  function handleSvgClick() {
    selectedHolonId = null;
  }

  // Animation loop
  function startAnimation() {
    function animate() {
      flowAnimation += 0.01;
      drawSankey();
      animationFrame = requestAnimationFrame(animate);
    }
    animate();
  }

  onMount(async () => {
    // Initialize canvas
    if (sankeyCanvas) {
      sankeyCtx = sankeyCanvas.getContext('2d')!;
    }

    // Load bundle data from holosphere settings first (doesn't require wallet)
    await loadBundleAndFederation();

    // Start animation
    startAnimation();

    // Auto-connect if wallet already connected
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

  onDestroy(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });

  // Reactive updates
  $: if (interiorPercent !== undefined) {
    exteriorPercent = 100 - interiorPercent;
  }
</script>

<div class="min-h-0 pb-8">
  <!-- Header -->
  <div class="bg-gray-800 rounded-2xl shadow-xl p-6 mb-8">
    <div class="flex items-center gap-4">
      <div class="flex-shrink-0">
        <div class="w-12 h-12 flex items-center justify-center bg-purple-600 rounded-xl">
          <span class="text-2xl text-white">F</span>
        </div>
      </div>
      <div class="flex-1">
        <div class="text-2xl font-bold text-white">Flow Management</div>
        <div class="text-sm text-gray-400 font-mono mt-1">
          Deploy, configure and visualize value flows for {holonId || 'your holon'}
        </div>
      </div>
      {#if !isConnected}
        <button
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
          on:click={connectWallet}
        >
          Connect Wallet
        </button>
      {:else}
        <div class="text-sm text-green-400">Connected</div>
      {/if}
    </div>
  </div>

  <!-- Notifications -->
  {#if notifications.length > 0}
    <div class="fixed top-5 right-5 z-50 flex flex-col gap-2">
      {#each notifications as notification (notification.id)}
        <div class="flex items-center justify-between p-4 rounded-xl shadow-lg max-w-sm {notification.type === 'success' ? 'bg-green-500 text-white' : notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}">
          <span class="text-sm font-medium">{notification.message}</span>
          <button class="ml-3 text-white hover:text-gray-200" on:click={() => removeNotification(notification.id)}>x</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if loading}
    <div class="flex items-center justify-center py-12">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
        <p class="text-gray-400">Loading flow configuration...</p>
      </div>
    </div>
  {:else}
    <div class="space-y-8">
      <!-- Bundle Status Section -->
      {#if !existingBundle}
        <section class="panel deploy-panel">
          <div class="deploy-panel__content">
            <div class="deploy-panel__info">
              <h2 class="deploy-panel__title">Deploy Bundle Contract</h2>
              <p class="deploy-panel__description">Deploy to save your flow configuration on-chain</p>
            </div>
            <button
              class="btn btn--primary"
              on:click={deployBundle}
              disabled={deploying || !isConnected}
            >
              {#if deploying}
                <span class="deploy-panel__loading">
                  <span class="deploy-panel__spinner"></span>
                  Deploying...
                </span>
              {:else}
                Deploy Bundle
              {/if}
            </button>
          </div>
        </section>
      {:else}
        <!-- Redeploy option when bundle already exists -->
        <section class="panel">
          <div class="panel__header">
            <h2 class="panel__title">Bundle Contract Deployed</h2>
          </div>
          <div class="panel__body">
            <p style="color: var(--color-text-muted); margin-bottom: 1rem;">
              Bundle deployed at: <code style="color: var(--color-success);">{existingBundle.address?.slice(0, 10)}...{existingBundle.address?.slice(-8)}</code>
            </p>
            <button
              class="btn btn--ghost btn--sm"
              on:click={() => { existingBundle = null; }}
            >
              Deploy New Bundle
            </button>
          </div>
        </section>
      {/if}

      <!-- Unsaved Changes Banner -->
      {#if hasChanges}
        <div class="sync-banner">
          <div class="sync-banner__info">
            <span class="sync-banner__dot"></span>
            <span class="sync-banner__text">You have unsaved changes</span>
          </div>
          <div class="sync-banner__actions">
            <button class="btn btn--ghost btn--sm" on:click={resetChanges}>
              Reset
            </button>
            <button
              class="btn btn--primary btn--sm"
              on:click={syncToContract}
              disabled={syncing}
            >
              {#if syncing}
                Syncing...
              {:else}
                Sync to Contract
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Flow Split Control -->
      <section class="panel">
        <div class="panel__header">
          <h2 class="panel__title">Flow Split</h2>
          {#if existingBundle && !hasChanges}
            <span class="sync-status sync-status--synced">Synced</span>
          {/if}
        </div>
        <div class="panel__body">
          <!-- Visual Split Display -->
          <div class="flow-split-bar">
            <div class="flow-split-bar__internal" style="width: {interiorPercent}%">
              {#if interiorPercent >= 15}
                <span>{interiorPercent}% Interior</span>
              {/if}
            </div>
            <div class="flow-split-bar__external" style="width: {exteriorPercent}%">
              {#if exteriorPercent >= 15}
                <span>{exteriorPercent}% Exterior</span>
              {/if}
            </div>
          </div>

          <!-- Interior/Exterior Slider -->
          <div class="flow-slider">
            <span class="flow-slider__label">Interior</span>
            <input
              type="range"
              min="0"
              max="100"
              bind:value={interiorPercent}
              class="flow-slider__input"
            />
            <span class="flow-slider__label">Exterior</span>
          </div>
        </div>
      </section>

      <!-- Interior / Exterior Overview Grid -->
      <div class="flow-grid">
        <!-- Interior (Left) - Internal Members -->
        <section class="panel flow-panel flow-panel--internal">
          <div class="flow-panel__header">
            <div class="flow-panel__icon">
              <span>👥</span>
            </div>
            <div class="flow-panel__info">
              <h3 class="flow-panel__title">Interior</h3>
              <p class="flow-panel__subtitle">Internal Members</p>
            </div>
            <div class="flow-panel__value">{interiorPercent}%</div>
          </div>

          <div class="flow-panel__body">
            <div class="flow-stat">
              <span class="flow-stat__label">Distribution Method</span>
              <span class="flow-stat__value">Share-weighted distribution</span>
            </div>

            <div class="flow-stat">
              <span class="flow-stat__label">Member Count</span>
              <span class="flow-stat__value flow-stat__value--large">
                {#if loadingMembers}
                  <span class="loading-spinner"></span>
                {:else}
                  {displayUsers.length}
                {/if}
              </span>
            </div>

            {#if memberLoadError}
              <div class="flow-error">
                <span>{memberLoadError}</span>
                <button class="btn btn--ghost btn--sm" on:click={loadUsersFromHolosphere}>Retry</button>
              </div>
            {:else if displayUsers.length > 0}
              <div class="member-list">
                <div class="member-list__header">
                  <span>Name</span>
                  <span>Score</span>
                  <span>Share %</span>
                </div>
                {#each displayUsers as user}
                  <div class="member-item">
                    <span class="member-item__id" title={user.userId}>
                      {user.username.length > 16 ? user.username.slice(0, 16) + '...' : user.username}
                    </span>
                    <span class="member-item__share">
                      {user.score}
                    </span>
                    <span class="member-item__balance">
                      {user.percentage}%
                    </span>
                  </div>
                {/each}
              </div>

              <div class="flow-summary">
                <span>Total Score</span>
                <span class="flow-summary__value">
                  {displayUsers.reduce((sum, u) => sum + u.score, 0)}
                </span>
              </div>
            {:else if !loadingMembers}
              <div class="flow-empty flow-empty--small">
                <span>No users in holosphere yet</span>
              </div>
            {/if}
          </div>
        </section>

        <!-- Exterior (Right) - Federation by Zone -->
        <section class="panel flow-panel flow-panel--external">
          <div class="flow-panel__header">
            <div class="flow-panel__icon flow-panel__icon--secondary">
              <span>🌐</span>
            </div>
            <div class="flow-panel__info">
              <h3 class="flow-panel__title">Exterior</h3>
              <p class="flow-panel__subtitle">Federation by Zone</p>
            </div>
            <div class="flow-panel__value flow-panel__value--secondary">{exteriorPercent}%</div>
          </div>

          <div class="flow-panel__body">
            <!-- Zone Controls -->
            <div class="zone-controls">
              <div class="zone-control">
                <label class="zone-control__label">Steepness</label>
                <input
                  type="range"
                  min="10"
                  max="90"
                  step="5"
                  value={Number(steepness) / 1e16}
                  on:input={(e) => steepness = BigInt(Math.round(parseInt(e.currentTarget.value) * 1e16))}
                  class="zone-control__slider"
                />
                <span class="zone-control__value">{formatSteepness(steepness)}</span>
              </div>
              <div class="zone-control">
                <label class="zone-control__label">Zones</label>
                <input
                  type="range"
                  min="2"
                  max="10"
                  bind:value={nzones}
                  class="zone-control__slider"
                />
                <span class="zone-control__value">{nzones}</span>
              </div>
            </div>

            <!-- Zone Map with Vertical Graph -->
            <div class="zone-map-layout">
              <!-- Vertical Zone Percentage Graph -->
              <div class="zone-graph-vertical">
                {#each zoneData.percentages as percent, z}
                  <div class="zone-bar-vertical">
                    <span class="zone-bar-vertical__label" style="color: {ZONE_COLORS[z] || ZONE_COLORS[5]}">Z{z}</span>
                    <div class="zone-bar-vertical__track">
                      <div
                        class="zone-bar-vertical__fill"
                        style="height: {percent}%; background-color: {ZONE_COLORS[z] || ZONE_COLORS[5]}"
                      ></div>
                    </div>
                    <span class="zone-bar-vertical__percent">{percent.toFixed(0)}%</span>
                  </div>
                {/each}
              </div>

              <!-- Concentric Zone Map -->
              <div class="zone-map">
                <div class="zone-map__container">
                  <svg viewBox="0 0 400 400" class="zone-map__svg" on:click={handleSvgClick}>
                  <!-- Instruction text -->
                  {#if selectedHolonId}
                    <text x="200" y="20" class="zone-instruction" text-anchor="middle">
                      Click a zone to move {federatedHolons.find(h => h.id === selectedHolonId)?.name || 'holon'}
                    </text>
                  {:else if isDragging}
                    <text x="200" y="20" class="zone-instruction" text-anchor="middle">
                      Drop on a zone circle
                    </text>
                  {/if}

                  <!-- Concentric circles for each zone (outer to inner) -->
                  {#each Array(nzones + 1) as _, z}
                    {@const zoneIndex = nzones - z}
                    {@const radius = 180 - (z * (160 / (nzones + 1)))}
                    <circle
                      cx="200"
                      cy="200"
                      r={radius}
                      class="zone-circle {dropTargetZone === zoneIndex ? 'zone-circle--drop-target' : ''} {selectedHolonId ? 'zone-circle--clickable' : ''}"
                      style="fill: {ZONE_COLORS[zoneIndex] || ZONE_COLORS[5]}{dropTargetZone === zoneIndex ? '40' : '15'}; stroke: {ZONE_COLORS[zoneIndex] || ZONE_COLORS[5]}"
                      on:dragover={(e) => handleZoneDragOver(e, zoneIndex)}
                      on:dragleave={handleZoneDragLeave}
                      on:drop={(e) => handleZoneDrop(e, zoneIndex)}
                      on:click={(e) => handleZoneClick(e, zoneIndex)}
                      role="button"
                      tabindex="0"
                    />
                    <!-- Zone label -->
                    <text
                      x={200 + radius - 12}
                      y="200"
                      class="zone-label"
                      style="fill: {ZONE_COLORS[zoneIndex] || ZONE_COLORS[5]}"
                    >Z{zoneIndex}</text>
                  {/each}

                  <!-- Federated holons positioned in their zones -->
                  {#each federatedHolons as holon, i}
                    {@const zoneRadius = 180 - ((nzones - holon.zone) * (160 / (nzones + 1))) - 20}
                    {@const holonsInZone = federatedHolons.filter(h => h.zone === holon.zone)}
                    {@const indexInZone = holonsInZone.findIndex(h => h.id === holon.id)}
                    {@const angle = (indexInZone * (2 * Math.PI / Math.max(holonsInZone.length, 1))) - Math.PI / 2}
                    {@const x = 200 + zoneRadius * Math.cos(angle)}
                    {@const y = 200 + zoneRadius * Math.sin(angle)}
                    <g
                      class="holon-node {selectedHolonId === holon.id ? 'holon-node--selected' : ''} {draggingHolonId === holon.id ? 'holon-node--dragging' : ''}"
                      transform="translate({x}, {y})"
                      on:click={(e) => handleHolonClick(e, holon.id)}
                      role="button"
                      tabindex="0"
                    >
                      <title>{holon.name} (Zone {holon.zone}) - Click to select, then click a zone</title>
                      <circle
                        r={selectedHolonId === holon.id ? 28 : 24}
                        class="holon-node__bg"
                        style="fill: {ZONE_COLORS[holon.zone] || ZONE_COLORS[5]}{selectedHolonId === holon.id ? '80' : '40'}; stroke: {ZONE_COLORS[holon.zone] || ZONE_COLORS[5]}; stroke-width: {selectedHolonId === holon.id ? 3 : 2};"
                      />
                      <text class="holon-node__label" text-anchor="middle" dominant-baseline="middle">
                        {holon.name.slice(0, 3)}
                      </text>
                    </g>
                  {/each}

                  <!-- Center label -->
                  <text x="200" y="200" class="zone-center-label" text-anchor="middle" dominant-baseline="middle">
                    Core
                  </text>
                </svg>
                </div>
              </div>
            </div>

            <!-- Holon cards - drag to zone circles above -->
            {#if federatedHolons.length > 0}
              <div class="zone-map__cards-header">
                Drag cards to zone circles above, or click to select
              </div>
              <div class="zone-map__list">
                {#each federatedHolons as holon}
                  <div
                    class="zone-holon-card {draggingHolonId === holon.id ? 'zone-holon-card--dragging' : ''} {selectedHolonId === holon.id ? 'zone-holon-card--selected' : ''}"
                    draggable="true"
                    on:dragstart={(e) => handleCardDragStart(e, holon.id)}
                    on:dragend={handleCardDragEnd}
                    on:click={() => { selectedHolonId = selectedHolonId === holon.id ? null : holon.id; }}
                    role="listitem"
                    title="{holon.name} - Zone {holon.zone}"
                  >
                    <span class="zone-holon-card__zone" style="background-color: {ZONE_COLORS[holon.zone] || ZONE_COLORS[5]}">
                      Z{holon.zone}
                    </span>
                    <span class="zone-holon-card__name">{holon.name}</span>
                    <span class="zone-holon-card__drag-hint">⋮⋮</span>
                  </div>
                {/each}
              </div>
              <div class="flow-summary">
                <span>Federated Holons</span>
                <span class="flow-summary__value">{federatedHolons.length}</span>
              </div>
            {:else}
              <div class="flow-empty flow-empty--small">
                <span>No federated holons yet</span>
              </div>
            {/if}
          </div>
        </section>
      </div>

      <!-- Sankey Diagram - Bottom -->
      <section class="panel">
        <div class="panel__header">
          <h2 class="panel__title">Flow Visualization</h2>
        </div>
        <div class="panel__body">
          <p class="flow-description">
            How value flows from income through the splitter to internal members and external federation.
          </p>

          <div class="flow-canvas-wrapper">
            <canvas
              bind:this={sankeyCanvas}
              width={SANKEY_WIDTH}
              height={SANKEY_HEIGHT}
              class="flow-canvas"
            ></canvas>
          </div>

          <!-- Flow Legend -->
          <div class="flow-legend">
            <div class="flow-legend__item">
              <div class="flow-legend__color" style="background-color: var(--color-accent)"></div>
              <span>Income</span>
            </div>
            <div class="flow-legend__item">
              <div class="flow-legend__color flow-legend__color--internal"></div>
              <span>Internal</span>
            </div>
            <div class="flow-legend__item">
              <div class="flow-legend__color flow-legend__color--external"></div>
              <span>External</span>
            </div>
            <div class="flow-legend__item">
              <div class="flow-legend__color flow-legend__color--success"></div>
              <span>Federation</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  /* Flow Split Bar */
  .flow-split-bar {
    display: flex;
    height: 2.5rem;
    border-radius: var(--radius-lg, 0.5rem);
    overflow: hidden;
    background: var(--color-bg-primary, #111827);
    margin-bottom: 1rem;
  }

  .flow-split-bar__internal {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-accent, #4f46e5);
    color: var(--color-text-primary, #fff);
    font-weight: 600;
    font-size: var(--font-size-sm, 0.875rem);
    transition: width 200ms ease;
  }

  .flow-split-bar__external {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg-tertiary, #374151);
    color: var(--color-text-primary, #fff);
    font-weight: 600;
    font-size: var(--font-size-sm, 0.875rem);
    transition: width 200ms ease;
  }

  /* Flow Slider */
  .flow-slider {
    display: flex;
    align-items: center;
    gap: var(--spacing-3, 0.75rem);
  }

  .flow-slider__label {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
    min-width: 4rem;
  }

  .flow-slider__label:last-child {
    text-align: right;
  }

  .flow-slider__input {
    flex: 1;
    height: 0.5rem;
    background: var(--color-bg-tertiary, #374151);
    border-radius: var(--radius-full, 9999px);
    appearance: none;
    cursor: pointer;
  }

  .flow-slider__input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 1.25rem;
    height: 1.25rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid var(--color-text-primary, #fff);
    box-shadow: var(--shadow-sm);
  }

  .flow-slider__input::-moz-range-thumb {
    width: 1.25rem;
    height: 1.25rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid var(--color-text-primary, #fff);
    box-shadow: var(--shadow-sm);
  }

  /* Flow Grid */
  .flow-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-4, 1rem);
  }

  @media (max-width: 1024px) {
    .flow-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Flow Panel */
  .flow-panel {
    border: 1px solid var(--color-border, #374151);
  }

  .flow-panel--internal {
    border-color: var(--color-accent-subtle, rgba(79, 70, 229, 0.3));
  }

  .flow-panel--external {
    border-color: var(--color-border-light, #4b5563);
  }

  .flow-panel__header {
    display: flex;
    align-items: center;
    gap: var(--spacing-3, 0.75rem);
    padding: var(--spacing-4, 1rem);
    border-bottom: 1px solid var(--color-border, #374151);
  }

  .flow-panel__icon {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--radius-md, 0.375rem);
    background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
  }

  .flow-panel__icon--secondary {
    background: var(--color-bg-tertiary, #374151);
  }

  .flow-panel__info {
    flex: 1;
  }

  .flow-panel__title {
    font-size: var(--font-size-base, 1rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, #fff);
    margin: 0;
  }

  .flow-panel__subtitle {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  .flow-panel__value {
    font-size: var(--font-size-2xl, 1.5rem);
    font-weight: var(--font-weight-bold, 700);
    color: var(--color-accent-light, #6366f1);
  }

  .flow-panel__value--secondary {
    color: var(--color-text-secondary, #d1d5db);
  }

  .flow-panel__body {
    padding: var(--spacing-4, 1rem);
  }

  /* Flow Stats */
  .flow-stat {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1, 0.25rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
    margin-bottom: var(--spacing-2, 0.5rem);
  }

  .flow-stat:last-child {
    margin-bottom: 0;
  }

  .flow-stat__label {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .flow-stat__value {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-primary, #fff);
  }

  .flow-stat__value--large {
    font-size: var(--font-size-xl, 1.25rem);
    font-weight: var(--font-weight-bold, 700);
  }

  .flow-stat__value--accent {
    color: var(--color-accent-light, #6366f1);
  }

  .flow-stat__hint {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  /* Flow Empty State */
  .flow-empty {
    text-align: center;
    padding: var(--spacing-6, 1.5rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .flow-empty p {
    color: var(--color-text-secondary, #d1d5db);
    margin: 0 0 var(--spacing-1, 0.25rem) 0;
  }

  .flow-empty span {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
  }

  /* Flow List */
  .flow-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2, 0.5rem);
  }

  .flow-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-3, 0.75rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .flow-item--draggable {
    cursor: grab;
    transition: transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
  }

  .flow-item--draggable:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .flow-item--dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .flow-item__zone {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-sm, 0.25rem);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-bold, 700);
    flex-shrink: 0;
  }

  .flow-item__info {
    flex: 1;
    min-width: 0;
  }

  .flow-item__name {
    display: block;
    font-size: var(--font-size-base, 1rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, #fff);
  }

  .flow-item__meta {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .flow-item__control {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .flow-item__slider {
    width: 5rem;
    height: 0.375rem;
    background: var(--color-bg-tertiary, #374151);
    border-radius: var(--radius-full, 9999px);
    appearance: none;
    cursor: pointer;
  }

  .flow-item__slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 0.875rem;
    height: 0.875rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
  }

  .flow-item__slider::-moz-range-thumb {
    width: 0.875rem;
    height: 0.875rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
    border: none;
  }

  .flow-item__percent {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-secondary, #d1d5db);
    min-width: 3rem;
    text-align: right;
  }

  /* Flow Summary */
  .flow-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--spacing-3, 0.75rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
  }

  .flow-summary__value {
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-success, #10b981);
  }

  /* Flow Description */
  .flow-description {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
    margin: 0 0 var(--spacing-4, 1rem) 0;
  }

  /* Flow Canvas */
  .flow-canvas-wrapper {
    overflow-x: auto;
    display: flex;
    justify-content: center;
  }

  .flow-canvas {
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  /* Flow Legend */
  .flow-legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--spacing-4, 1rem);
    margin-top: var(--spacing-4, 1rem);
  }

  .flow-legend__item {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
  }

  .flow-legend__color {
    width: 1rem;
    height: 1rem;
    border-radius: var(--radius-sm, 0.25rem);
    background: var(--color-accent, #4f46e5);
  }

  .flow-legend__color--internal {
    background: var(--color-accent-light, #6366f1);
  }

  .flow-legend__color--external {
    background: var(--color-bg-tertiary, #374151);
  }

  .flow-legend__color--success {
    background: var(--color-success, #10b981);
  }

  canvas {
    touch-action: none;
  }

  @media (max-width: 768px) {
    canvas {
      max-width: 100%;
      height: auto;
    }
  }

  /* Deploy Panel */
  .deploy-panel {
    padding: var(--spacing-6, 1.5rem);
  }

  .deploy-panel__content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-4, 1rem);
  }

  .deploy-panel__info {
    flex: 1;
  }

  .deploy-panel__title {
    font-size: var(--font-size-lg, 1.125rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, #fff);
    margin: 0 0 var(--spacing-1, 0.25rem) 0;
  }

  .deploy-panel__description {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
    margin: 0;
  }

  .deploy-panel__config {
    margin-top: var(--spacing-4, 1rem);
    padding: var(--spacing-4, 1rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .deploy-panel__config-row {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-4, 1rem);
  }

  .deploy-panel__config-item {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2, 0.5rem);
  }

  .deploy-panel__config-label {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-secondary, #d1d5db);
  }

  .deploy-panel__config-control {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .deploy-panel__config-value {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-accent-light, #6366f1);
    min-width: 3rem;
  }

  .deploy-panel__config-hint {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .deploy-panel__slider {
    flex: 1;
    height: 0.5rem;
    background: var(--color-bg-tertiary, #374151);
    border-radius: var(--radius-full, 9999px);
    appearance: none;
    cursor: pointer;
  }

  .deploy-panel__slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 1rem;
    height: 1rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid var(--color-text-primary, #fff);
  }

  .deploy-panel__input {
    width: 5rem;
    padding: var(--spacing-2, 0.5rem);
    background: var(--color-bg-tertiary, #374151);
    border: 1px solid var(--color-border, #374151);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text-primary, #fff);
    font-size: var(--font-size-sm, 0.875rem);
    text-align: center;
  }

  .deploy-panel__action {
    margin-top: var(--spacing-4, 1rem);
    display: flex;
    justify-content: flex-end;
  }

  .deploy-panel__loading {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .deploy-panel__spinner {
    width: 1rem;
    height: 1rem;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .deploy-panel--success {
    border-color: var(--color-success, #10b981);
  }

  .deploy-panel__header {
    padding: var(--spacing-4, 1rem);
    border-bottom: 1px solid var(--color-border, #374151);
  }

  .deploy-panel__status {
    display: flex;
    align-items: center;
    gap: var(--spacing-3, 0.75rem);
  }

  .deploy-panel__check {
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-success, #10b981);
    color: var(--color-text-primary, #fff);
    border-radius: 50%;
    font-size: 1rem;
  }

  .deploy-panel__status-title {
    font-size: var(--font-size-base, 1rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-success, #10b981);
  }

  .deploy-panel__status-text {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
  }

  .deploy-panel__addresses {
    padding: var(--spacing-4, 1rem);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3, 0.75rem);
  }

  .deploy-panel__address {
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .deploy-panel__address--primary {
    border: 1px solid var(--color-success, #10b981);
  }

  .deploy-panel__label {
    display: block;
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-secondary, #d1d5db);
    margin-bottom: var(--spacing-2, 0.5rem);
  }

  .deploy-panel__address-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .deploy-panel__code {
    flex: 1;
    font-size: var(--font-size-sm, 0.875rem);
    font-family: var(--font-mono);
    color: var(--color-success, #10b981);
    background: var(--color-bg-primary, #111827);
    padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
    border-radius: var(--radius-md, 0.375rem);
    word-break: break-all;
  }

  .deploy-panel__params {
    display: flex;
    gap: var(--spacing-4, 1rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .deploy-panel__param {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1, 0.25rem);
  }

  .deploy-panel__param-label {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .deploy-panel__param-value {
    font-size: var(--font-size-base, 1rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, #fff);
  }

  /* Flow Parameters */
  .flow-params {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--spacing-4, 1rem);
    margin-top: var(--spacing-4, 1rem);
    padding-top: var(--spacing-4, 1rem);
    border-top: 1px solid var(--color-border, #374151);
  }

  .flow-param {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2, 0.5rem);
  }

  .flow-param__label {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-muted, #6b7280);
  }

  .flow-param__control {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .flow-param__slider {
    flex: 1;
    height: 0.375rem;
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-full, 9999px);
    appearance: none;
    cursor: pointer;
  }

  .flow-param__slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 1rem;
    height: 1rem;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid var(--color-text-primary, #fff);
  }

  .flow-param__value {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-accent-light, #6366f1);
    min-width: 3rem;
  }

  .flow-param__input {
    width: 5rem;
    padding: var(--spacing-2, 0.5rem);
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text-primary, #fff);
    font-size: var(--font-size-sm, 0.875rem);
    text-align: center;
  }

  .flow-param__hint {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    font-weight: var(--font-weight-normal, 400);
  }

  @media (max-width: 640px) {
    .deploy-panel__config-row {
      grid-template-columns: 1fr;
    }

    .flow-params {
      grid-template-columns: 1fr;
    }
  }

  /* Zone Weights Visualization */
  .zone-weights {
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
    margin-bottom: var(--spacing-4, 1rem);
  }

  .zone-weights__header {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1, 0.25rem);
    margin-bottom: var(--spacing-3, 0.75rem);
  }

  .zone-weights__title {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-secondary, #d1d5db);
  }

  .zone-weights__hint {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .zone-weights__bars {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2, 0.5rem);
  }

  .zone-weight {
    display: grid;
    grid-template-columns: 100px 1fr 50px;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-2, 0.5rem);
    border-radius: var(--radius-md, 0.375rem);
    border: 2px solid transparent;
    transition: all 150ms ease;
  }

  .zone-weight--drop-target {
    border-color: var(--color-accent, #4f46e5);
    background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
  }

  .zone-weight__label {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .zone-weight__zone {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm, 0.25rem);
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-bold, 700);
    flex-shrink: 0;
  }

  .zone-weight__name {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .zone-weight__bar-container {
    height: 8px;
    background: var(--color-bg-secondary, #1f2937);
    border-radius: var(--radius-full, 9999px);
    overflow: hidden;
  }

  .zone-weight__bar {
    height: 100%;
    border-radius: var(--radius-full, 9999px);
    transition: width 300ms ease;
  }

  .zone-weight__percent {
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-secondary, #d1d5db);
    text-align: right;
  }

  .zone-weights__formula {
    margin-top: var(--spacing-3, 0.75rem);
    padding-top: var(--spacing-2, 0.5rem);
    border-top: 1px solid var(--color-border, #374151);
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    font-family: var(--font-mono);
  }

  .zone-weights__formula sup {
    font-size: 0.7em;
  }

  .flow-list__header {
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: var(--spacing-2, 0.5rem);
    padding-top: var(--spacing-3, 0.75rem);
    border-top: 1px solid var(--color-border, #374151);
  }

  .flow-empty--small {
    padding: var(--spacing-2, 0.5rem);
    font-size: var(--font-size-xs, 0.75rem);
  }

  /* Sync Banner */
  .sync-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
    background: var(--color-accent-subtle, rgba(79, 70, 229, 0.1));
    border: 1px solid var(--color-accent, #4f46e5);
    border-radius: var(--radius-lg, 0.5rem);
  }

  .sync-banner__info {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  .sync-banner__dot {
    width: 0.5rem;
    height: 0.5rem;
    background: var(--color-accent, #4f46e5);
    border-radius: 50%;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .sync-banner__text {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-primary, #fff);
  }

  .sync-banner__actions {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
  }

  /* Sync Status */
  .sync-status {
    font-size: var(--font-size-xs, 0.75rem);
    padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
    border-radius: var(--radius-full, 9999px);
  }

  .sync-status--synced {
    background: var(--color-success, #10b981);
    color: var(--color-text-primary, #fff);
  }

  @media (max-width: 640px) {
    .deploy-panel__content {
      flex-direction: column;
      align-items: stretch;
    }

    .sync-banner {
      flex-direction: column;
      gap: var(--spacing-3, 0.75rem);
    }
  }

  /* Member List Styles */
  .member-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1, 0.25rem);
    max-height: 200px;
    overflow-y: auto;
    margin-top: var(--spacing-3, 0.75rem);
  }

  .member-list__header {
    display: grid;
    grid-template-columns: 1fr 80px 100px;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-2, 0.5rem);
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-muted, #6b7280);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--color-border, #374151);
  }

  .member-item {
    display: grid;
    grid-template-columns: 1fr 80px 100px;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-2, 0.5rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-sm, 0.25rem);
    font-size: var(--font-size-sm, 0.875rem);
  }

  .member-item__id {
    color: var(--color-text-primary, #fff);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member-item__share {
    color: var(--color-accent-light, #6366f1);
    font-weight: var(--font-weight-semibold, 600);
    text-align: right;
  }

  .member-item__balance {
    color: var(--color-success, #10b981);
    text-align: right;
  }

  .flow-error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--spacing-3, 0.75rem);
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--color-error, #ef4444);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-error, #ef4444);
    font-size: var(--font-size-sm, 0.875rem);
  }

  .flow-summary {
    display: flex;
    justify-content: space-between;
    padding: var(--spacing-3, 0.75rem);
    margin-top: var(--spacing-3, 0.75rem);
    background: var(--color-bg-tertiary, #1f2937);
    border-radius: var(--radius-md, 0.375rem);
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-secondary, #9ca3af);
  }

  .flow-summary__value {
    color: var(--color-success, #10b981);
    font-weight: var(--font-weight-semibold, 600);
  }

  .flow-empty--small {
    padding: var(--spacing-4, 1rem);
    text-align: center;
    color: var(--color-text-muted, #6b7280);
    font-size: var(--font-size-sm, 0.875rem);
  }

  .loading-spinner {
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 2px solid var(--color-border, #374151);
    border-top-color: var(--color-accent, #4f46e5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Preview indicator styles */
  .zone-weights--preview {
    border: 1px dashed var(--color-accent, #4f46e5);
    border-radius: var(--radius-md, 0.375rem);
    padding: var(--spacing-2, 0.5rem);
  }

  .zone-weights__preview-badge {
    display: inline-block;
    padding: var(--spacing-1, 0.25rem) var(--spacing-2, 0.5rem);
    background: var(--color-accent, #4f46e5);
    color: var(--color-text-primary, #fff);
    font-size: var(--font-size-xs, 0.75rem);
    border-radius: var(--radius-full, 9999px);
    margin-left: var(--spacing-2, 0.5rem);
  }

  .flow-param__changed {
    color: var(--color-accent, #4f46e5);
    font-weight: var(--font-weight-bold, 700);
    margin-left: var(--spacing-1, 0.25rem);
  }

  .flow-params--editable {
    background: var(--color-bg-primary, #111827);
    padding: var(--spacing-4, 1rem);
    border-radius: var(--radius-md, 0.375rem);
    margin-top: var(--spacing-4, 1rem);
  }

  .flow-param__slider {
    flex: 1;
    height: 6px;
    appearance: none;
    background: var(--color-bg-tertiary, #1f2937);
    border-radius: var(--radius-full, 9999px);
    cursor: pointer;
  }

  .flow-param__slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: var(--color-accent, #4f46e5);
    border-radius: 50%;
    cursor: pointer;
  }

  .flow-param__input {
    width: 80px;
    padding: var(--spacing-2, 0.5rem);
    background: var(--color-bg-tertiary, #1f2937);
    border: 1px solid var(--color-border, #374151);
    border-radius: var(--radius-md, 0.375rem);
    color: var(--color-text-primary, #fff);
    font-size: var(--font-size-sm, 0.875rem);
    text-align: center;
  }

  .flow-param__input:focus {
    outline: none;
    border-color: var(--color-accent, #4f46e5);
  }

  /* Zone Controls */
  .zone-controls {
    display: flex;
    gap: var(--spacing-4, 1rem);
    margin-bottom: var(--spacing-4, 1rem);
  }

  .zone-control {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1, 0.25rem);
  }

  .zone-control__label {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  .zone-control__slider {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    background: var(--color-bg-primary, #111827);
    border-radius: 3px;
    cursor: pointer;
  }

  .zone-control__slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--color-accent, #4f46e5);
    cursor: pointer;
  }

  .zone-control__value {
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-semibold, 600);
    color: var(--color-text-primary, #fff);
  }

  /* Zone Map Layout - Side by side */
  .zone-map-layout {
    display: flex;
    gap: var(--spacing-4, 1rem);
    align-items: stretch;
  }

  /* Vertical Zone Graph */
  .zone-graph-vertical {
    display: flex;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
    min-width: 120px;
  }

  .zone-bar-vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--spacing-1, 0.25rem);
    flex: 1;
  }

  .zone-bar-vertical__label {
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-bold, 700);
  }

  .zone-bar-vertical__track {
    flex: 1;
    width: 16px;
    min-height: 100px;
    background: var(--color-bg-tertiary, #1f2937);
    border-radius: var(--radius-sm, 0.25rem);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }

  .zone-bar-vertical__fill {
    width: 100%;
    border-radius: var(--radius-sm, 0.25rem) var(--radius-sm, 0.25rem) 0 0;
    transition: height 0.3s ease;
  }

  .zone-bar-vertical__percent {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
  }

  /* Zone Map - Concentric Circles */
  .zone-map {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .zone-map__container {
    display: flex;
    justify-content: center;
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-lg, 0.5rem);
  }

  .zone-map__svg {
    width: 100%;
    max-width: 350px;
    height: auto;
  }

  .zone-instruction {
    font-size: 11px;
    font-weight: 500;
    fill: var(--color-accent-light, #6366f1);
    animation: fadeIn 0.3s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .zone-circle {
    stroke-width: 2;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .zone-circle:hover {
    stroke-width: 3;
    filter: brightness(1.2);
  }

  .zone-circle--clickable {
    cursor: pointer;
    stroke-dasharray: 4 2;
  }

  .zone-circle--clickable:hover {
    stroke-width: 4;
    filter: brightness(1.3);
  }

  .zone-circle--drop-target {
    stroke-width: 4;
    filter: brightness(1.4);
    stroke-dasharray: 8 4;
    animation: pulseZone 0.8s infinite;
  }

  @keyframes pulseZone {
    0%, 100% { opacity: 1; stroke-width: 4; }
    50% { opacity: 0.8; stroke-width: 5; }
  }

  .zone-label {
    font-size: 10px;
    font-weight: 600;
    pointer-events: none;
  }

  .zone-center-label {
    font-size: 12px;
    font-weight: 600;
    fill: var(--color-text-muted, #6b7280);
  }

  .holon-node {
    cursor: pointer;
    transition: transform 0.2s ease;
  }

  .holon-node:hover {
    transform: scale(1.1);
  }

  .holon-node--selected {
    animation: selectedPulse 1.5s infinite;
  }

  @keyframes selectedPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  .holon-node--dragging {
    opacity: 0.3;
  }

  .holon-node__bg {
    stroke-width: 2;
  }

  .holon-node__label {
    font-size: 10px;
    font-weight: 600;
    fill: var(--color-text-primary, #fff);
    pointer-events: none;
  }

  .zone-map__cards-header {
    font-size: var(--font-size-xs, 0.75rem);
    color: var(--color-text-muted, #6b7280);
    text-align: center;
    padding: var(--spacing-2, 0.5rem);
    margin-top: var(--spacing-3, 0.75rem);
  }

  .zone-map__list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
  }

  .zone-holon-card {
    display: flex;
    align-items: center;
    gap: var(--spacing-2, 0.5rem);
    padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
    background: var(--color-bg-tertiary, #1f2937);
    border-radius: var(--radius-md, 0.375rem);
    cursor: grab;
    transition: all 0.2s ease;
  }

  .zone-holon-card:hover {
    background: var(--color-bg-secondary, #374151);
    transform: translateY(-1px);
  }

  .zone-holon-card--dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .zone-holon-card__zone {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: var(--font-size-xs, 0.75rem);
    font-weight: var(--font-weight-bold, 700);
    color: #fff;
  }

  .zone-holon-card__name {
    font-size: var(--font-size-sm, 0.875rem);
    color: var(--color-text-primary, #fff);
    flex: 1;
  }

  .zone-holon-card__drag-hint {
    color: var(--color-text-muted, #6b7280);
    font-size: var(--font-size-sm, 0.875rem);
    opacity: 0.5;
    margin-left: auto;
  }

  .zone-holon-card:hover .zone-holon-card__drag-hint {
    opacity: 1;
  }

  .zone-holon-card--selected {
    outline: 2px solid var(--color-accent, #4f46e5);
    outline-offset: 2px;
    background: var(--color-accent-subtle, rgba(79, 70, 229, 0.15));
  }
</style>
