<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { ethers } from 'ethers';
  import { walletAddress } from '../dashboard/store';
  import { HolonsManager } from '../lib/holons/HolonsManager';
  import type { HolonBundle, FlowConfig } from '../lib/holons/HolonsContract';
  import type { FlowVisualizationData, FlowNode, FlowEdge, FederationLink } from '../lib/holons/FlowSettings';
  import type { HoloSphere } from 'holosphere';

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

  // Reactive: detect if there are unsaved changes
  // Note: Only flow split can be synced to Splitter contract (no steepness/nzones support)
  $: hasChanges = existingBundle && (
    interiorPercent !== originalInteriorPercent
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
      const settings = await holosphere.getAll(holonId, 'settings');
      if (settings && settings[0]?.federation) {
        federatedHolons = settings[0].federation.map((fed: FederationLink, index: number) => ({
          id: fed.targetId,
          name: fed.targetName,
          zone: Math.floor(Math.random() * 4) + 2, // Random zone 2-5 for now
          angle: (index * Math.PI * 2) / settings[0].federation.length,
          flowPercent: Math.floor(100 / settings[0].federation.length),
          status: 'active' as const,
          internalPercent: 50
        }));
      }
    } catch (err) {
      console.error('Error loading federation data:', err);
    }
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
    if (!manager || !existingBundle || !hasChanges) return;

    try {
      syncing = true;
      showNotification('Please confirm the transaction(s) in your wallet...', 'info');

      // Sync flow split if changed
      // Note: Splitter contract supports setContractSplit for interior/exterior percentages
      // but does NOT support setSteepness or setNzones (those are Bundle-only features)
      if (interiorPercent !== originalInteriorPercent) {
        await manager.updateFlowSplit(existingBundle.address, interiorPercent);
        exteriorPercent = 100 - interiorPercent;
        originalInteriorPercent = interiorPercent;
        showNotification(`Flow split synced: ${interiorPercent}% interior`, 'success');
      }

      // Note: Steepness and nzones are display-only in the UI
      // The Splitter contract doesn't support these parameters
      // They are set at deployment time and cannot be changed

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
    // Note: steepness and nzones are not synced to contract, so no need to reset
  }

  // Sankey diagram rendering
  function drawSankey() {
    if (!sankeyCtx) return;

    // Clear canvas
    sankeyCtx.clearRect(0, 0, SANKEY_WIDTH, SANKEY_HEIGHT);

    const padding = 50;
    const nodeWidth = 30;

    // Define nodes
    const nodes = [
      { id: 'input', label: 'Income', x: padding, y: SANKEY_HEIGHT / 2, height: 150 },
      { id: 'splitter', label: 'Splitter', x: 200, y: SANKEY_HEIGHT / 2, height: 150 },
      { id: 'internal', label: `Internal\n${internalPercent}%`, x: 400, y: 80, height: Math.max(30, internalPercent * 1.5) },
      { id: 'external', label: `External\n${externalPercent}%`, x: 400, y: 280, height: Math.max(30, externalPercent * 1.5) },
    ];

    // Add federation nodes
    let yOffset = 50;
    federatedHolons.forEach((holon, i) => {
      const flowHeight = Math.max(20, (holon.flowPercent / 100) * externalPercent * 1.5);
      nodes.push({
        id: holon.id,
        label: `${holon.name}\n${Math.round((holon.flowPercent / 100) * externalPercent)}%`,
        x: 600,
        y: yOffset,
        height: flowHeight
      });
      yOffset += flowHeight + 20;
    });

    // Draw links
    drawSankeyLink(nodes[0], nodes[1], 100, '#8b5cf6');
    drawSankeyLink(nodes[1], nodes[2], internalPercent, '#3b82f6');
    drawSankeyLink(nodes[1], nodes[3], externalPercent, '#f59e0b');

    // Links from external to federated holons
    federatedHolons.forEach((holon, i) => {
      const fedNode = nodes.find(n => n.id === holon.id);
      if (fedNode) {
        const flowValue = (holon.flowPercent / 100) * externalPercent;
        drawSankeyLink(nodes[3], fedNode, flowValue, '#10b981');
      }
    });

    // Draw nodes
    nodes.forEach(node => {
      drawSankeyNode(node);
    });
  }

  function drawSankeyNode(node: any) {
    const { x, y, height, label } = node;
    const width = 30;

    // Node rectangle
    sankeyCtx.fillStyle = '#374151';
    sankeyCtx.fillRect(x, y - height / 2, width, height);
    sankeyCtx.strokeStyle = '#6b7280';
    sankeyCtx.lineWidth = 1;
    sankeyCtx.strokeRect(x, y - height / 2, width, height);

    // Label
    sankeyCtx.fillStyle = '#e5e7eb';
    sankeyCtx.font = '11px sans-serif';
    sankeyCtx.textAlign = 'center';
    sankeyCtx.textBaseline = 'middle';

    const lines = label.split('\n');
    lines.forEach((line: string, i: number) => {
      sankeyCtx.fillText(line, x + width / 2, y + (i - (lines.length - 1) / 2) * 14);
    });
  }

  function drawSankeyLink(source: any, target: any, value: number, color: string) {
    const sourceRight = source.x + 30;
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
      <!-- Quick Deploy Section - Only show if no bundle deployed -->
      {#if !existingBundle}
        <section class="panel deploy-panel">
          <div class="deploy-panel__content">
            <div class="deploy-panel__info">
              <h2 class="deploy-panel__title">Deploy Bundle Contract</h2>
              <p class="deploy-panel__description">Single unified contract with configurable flow distribution</p>
            </div>
          </div>

          <!-- Pre-deployment configuration -->
          <div class="deploy-panel__config">
            <div class="deploy-panel__config-row">
              <div class="deploy-panel__config-item">
                <label class="deploy-panel__config-label">Steepness (Zone Decay)</label>
                <div class="deploy-panel__config-control">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Number(steepness) / 1e16}
                    on:input={(e) => steepness = BigInt(Math.round(parseInt(e.currentTarget.value) * 1e16))}
                    class="deploy-panel__slider"
                  />
                  <span class="deploy-panel__config-value">{formatSteepness(steepness)}</span>
                </div>
                <span class="deploy-panel__config-hint">How much value decays per zone</span>
              </div>
              <div class="deploy-panel__config-item">
                <label class="deploy-panel__config-label">Number of Zones</label>
                <div class="deploy-panel__config-control">
                  <input
                    type="number"
                    min="2"
                    max="10"
                    bind:value={nzones}
                    class="deploy-panel__input"
                  />
                </div>
                <span class="deploy-panel__config-hint">Tiers for external distribution</span>
              </div>
            </div>
          </div>

          <div class="deploy-panel__action">
            <button
              class="btn btn--primary btn--lg"
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

      <!-- Flow Control - Top -->
      <section class="panel">
        <div class="panel__header">
          <h2 class="panel__title">Flow Control</h2>
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

          <!-- Bundle Parameters (only when deployed) -->
          <!-- Note: Steepness and nzones are fixed at deployment time and cannot be changed -->
          {#if existingBundle}
            <div class="flow-params">
              <div class="flow-param">
                <label class="flow-param__label">Steepness (Zone Decay) <span class="flow-param__hint">(set at deploy)</span></label>
                <div class="flow-param__control">
                  <span class="flow-param__value">{formatSteepness(steepness)}</span>
                </div>
              </div>
              <div class="flow-param">
                <label class="flow-param__label">Number of Zones <span class="flow-param__hint">(set at deploy)</span></label>
                <div class="flow-param__control">
                  <span class="flow-param__value">{nzones}</span>
                </div>
              </div>
            </div>
          {/if}
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
              <span class="flow-stat__value">Equal split among members</span>
            </div>
            <div class="flow-stat">
              <span class="flow-stat__label">Member Count</span>
              <span class="flow-stat__value flow-stat__value--large">--</span>
              <span class="flow-stat__hint">Synced from contract</span>
            </div>
            <div class="flow-stat">
              <span class="flow-stat__label">Per-Member Share</span>
              <span class="flow-stat__value flow-stat__value--accent">{interiorPercent}% ÷ members</span>
            </div>
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
            <!-- Zone Weight Visualization -->
            <div class="zone-weights">
              <div class="zone-weights__header">
                <span class="zone-weights__title">Zone Distribution (Steepness: {formatSteepness(steepness)})</span>
                <span class="zone-weights__hint">Per-zone share assuming 1 member each</span>
              </div>
              <div class="zone-weights__bars">
                {#each zoneData.percentages as percent, z}
                  <div class="zone-weight">
                    <div class="zone-weight__label">
                      <span class="zone-weight__zone" style="background-color: {ZONE_COLORS[z] || ZONE_COLORS[5]}20; color: {ZONE_COLORS[z] || ZONE_COLORS[5]}">
                        Z{z}
                      </span>
                      <span class="zone-weight__name">{z === 0 ? 'Core' : z === nzones ? 'Edge' : `Zone ${z}`}</span>
                    </div>
                    <div class="zone-weight__bar-container">
                      <div
                        class="zone-weight__bar"
                        style="width: {percent}%; background-color: {ZONE_COLORS[z] || ZONE_COLORS[5]}"
                      ></div>
                    </div>
                    <span class="zone-weight__percent">{percent.toFixed(1)}%</span>
                  </div>
                {/each}
              </div>
              <div class="zone-weights__formula">
                <span>Formula: weight[z] = s<sup>z</sup> where s = {formatSteepness(steepness)}</span>
              </div>
            </div>

            <!-- Federated Holons -->
            {#if federatedHolons.length > 0}
              <div class="flow-list">
                <div class="flow-list__header">Federated Holons</div>
                {#each federatedHolons as holon}
                  <div class="flow-item">
                    <div class="flow-item__zone" style="background-color: {ZONE_COLORS[holon.zone]}20; color: {ZONE_COLORS[holon.zone]}">
                      Z{holon.zone}
                    </div>
                    <div class="flow-item__info">
                      <span class="flow-item__name">{holon.name}</span>
                      <span class="flow-item__meta">{Math.round((holon.flowPercent / 100) * externalPercent)}% of total</span>
                    </div>
                    <div class="flow-item__control">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={holon.flowPercent}
                        on:input={(e) => updateHolonFlow(holon.id, parseInt(e.currentTarget.value))}
                        class="flow-item__slider"
                      />
                      <span class="flow-item__percent">{holon.flowPercent}%</span>
                    </div>
                  </div>
                {/each}
              </div>

              <div class="flow-summary">
                <span>Active Federations</span>
                <span class="flow-summary__value">{federatedHolons.filter(h => h.status === 'active').length} / {federatedHolons.length}</span>
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
    max-height: 16rem;
    overflow-y: auto;
  }

  .flow-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-3, 0.75rem);
    padding: var(--spacing-3, 0.75rem);
    background: var(--color-bg-primary, #111827);
    border-radius: var(--radius-md, 0.375rem);
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
    font-size: var(--font-size-sm, 0.875rem);
    font-weight: var(--font-weight-medium, 500);
    color: var(--color-text-primary, #fff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
</style>
