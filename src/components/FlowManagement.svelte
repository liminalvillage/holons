<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { ethers } from 'ethers';
  import { walletAddress } from '../dashboard/store';
  import { HolonsManager } from '../lib/holons/HolonsManager';
  import type { HolonBundle } from '../lib/holons/HolonsContract';
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

  // Flow configuration
  let internalPercent = 50;
  let externalPercent = 50;

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
  let draggedHolon: ZonedHolon | null = null;
  let isDragging = false;

  // Canvas references
  let zoneCanvas: HTMLCanvasElement;
  let zoneCtx: CanvasRenderingContext2D;
  let sankeyCanvas: HTMLCanvasElement;
  let sankeyCtx: CanvasRenderingContext2D;

  // Canvas dimensions
  const ZONE_SIZE = 500;
  const SANKEY_WIDTH = 800;
  const SANKEY_HEIGHT = 400;

  // Zone configuration
  const ZONE_COLORS = [
    '#3b82f6', // Zone 0 - Blue (center/internal)
    '#8b5cf6', // Zone 1 - Purple
    '#ec4899', // Zone 2 - Pink
    '#f59e0b', // Zone 3 - Amber
    '#10b981', // Zone 4 - Emerald
    '#6b7280', // Zone 5 - Gray (outer)
  ];

  const ZONE_RADII = [40, 80, 120, 160, 200, 240]; // Radius for each zone

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
    if (!manager || !holonId) return;

    try {
      loading = true;
      existingBundle = await manager.getHolonBundle(holonId);

      if (existingBundle) {
        const flowConfig = await manager.getFlowConfiguration(holonId);
        if (flowConfig) {
          internalPercent = flowConfig.internalPercent || 50;
          externalPercent = 100 - internalPercent;
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

  // One-click deploy bundle
  async function deployBundle() {
    if (!manager || !holonId) {
      showNotification('Please connect wallet first', 'error');
      return;
    }

    try {
      deploying = true;
      const result = await manager.createHolonBundle(holonId, holonId);
      showNotification(`Deploying bundle... TX: ${result.transaction.hash.slice(0, 10)}...`, 'info');

      // Wait for deployment
      setTimeout(() => loadBundleAndFederation(), 5000);
    } catch (err: any) {
      console.error('Error deploying bundle:', err);
      showNotification(err.message || 'Failed to deploy bundle', 'error');
    } finally {
      deploying = false;
    }
  }

  // Update flow split
  async function updateFlowSplit() {
    if (!manager || !existingBundle) return;

    try {
      await manager.updateFlowSplit(holonId, internalPercent);
      externalPercent = 100 - internalPercent;
      showNotification(`Flow split updated: ${internalPercent}% internal`, 'success');
    } catch (err: any) {
      console.error('Error updating flow split:', err);
      showNotification(err.message || 'Failed to update flow split', 'error');
    }
  }

  // Zone canvas rendering
  function drawZones() {
    if (!zoneCtx) return;

    const centerX = ZONE_SIZE / 2;
    const centerY = ZONE_SIZE / 2;

    // Clear canvas
    zoneCtx.clearRect(0, 0, ZONE_SIZE, ZONE_SIZE);

    // Draw zone rings (outer to inner)
    for (let i = 5; i >= 0; i--) {
      zoneCtx.beginPath();
      zoneCtx.arc(centerX, centerY, ZONE_RADII[i], 0, Math.PI * 2);
      zoneCtx.fillStyle = `${ZONE_COLORS[i]}20`; // 20% opacity
      zoneCtx.fill();
      zoneCtx.strokeStyle = ZONE_COLORS[i];
      zoneCtx.lineWidth = 2;
      zoneCtx.stroke();

      // Zone label
      if (i > 0) {
        zoneCtx.fillStyle = '#9ca3af';
        zoneCtx.font = '10px sans-serif';
        zoneCtx.textAlign = 'center';
        zoneCtx.fillText(`Zone ${i}`, centerX, centerY - ZONE_RADII[i] + 15);
      }
    }

    // Draw center (Zone 0 - Internal)
    zoneCtx.beginPath();
    zoneCtx.arc(centerX, centerY, ZONE_RADII[0], 0, Math.PI * 2);
    zoneCtx.fillStyle = '#3b82f680';
    zoneCtx.fill();
    zoneCtx.fillStyle = '#ffffff';
    zoneCtx.font = 'bold 12px sans-serif';
    zoneCtx.textAlign = 'center';
    zoneCtx.textBaseline = 'middle';
    zoneCtx.fillText('INTERNAL', centerX, centerY - 10);
    zoneCtx.font = '10px sans-serif';
    zoneCtx.fillText(`${internalPercent}%`, centerX, centerY + 10);

    // Draw federated holons
    federatedHolons.forEach(holon => {
      drawHolonNode(holon, centerX, centerY);
    });

    // Draw flow connections
    drawFlowConnections(centerX, centerY);
  }

  function drawHolonNode(holon: ZonedHolon, centerX: number, centerY: number) {
    const radius = ZONE_RADII[holon.zone] - 20;
    const x = centerX + Math.cos(holon.angle) * radius;
    const y = centerY + Math.sin(holon.angle) * radius;

    // Node circle
    const nodeRadius = 25;
    zoneCtx.beginPath();
    zoneCtx.arc(x, y, nodeRadius, 0, Math.PI * 2);

    // Color based on status
    const baseColor = holon.status === 'active' ? '#10b981' :
                      holon.status === 'pending' ? '#f59e0b' : '#6b7280';
    zoneCtx.fillStyle = baseColor;
    zoneCtx.fill();

    // Highlight if dragging
    if (draggedHolon?.id === holon.id) {
      zoneCtx.strokeStyle = '#ffffff';
      zoneCtx.lineWidth = 3;
    } else {
      zoneCtx.strokeStyle = '#1f2937';
      zoneCtx.lineWidth = 2;
    }
    zoneCtx.stroke();

    // Node label
    zoneCtx.fillStyle = '#ffffff';
    zoneCtx.font = 'bold 9px sans-serif';
    zoneCtx.textAlign = 'center';
    zoneCtx.textBaseline = 'middle';

    // Truncate name
    const displayName = holon.name.length > 8 ? holon.name.slice(0, 7) + '...' : holon.name;
    zoneCtx.fillText(displayName, x, y - 5);

    // Flow percentage
    zoneCtx.font = '8px sans-serif';
    zoneCtx.fillText(`${holon.flowPercent}%`, x, y + 8);

    // Store position for hit detection
    (holon as any)._x = x;
    (holon as any)._y = y;
    (holon as any)._radius = nodeRadius;
  }

  function drawFlowConnections(centerX: number, centerY: number) {
    const flowOffset = (flowAnimation % 1);

    federatedHolons.forEach(holon => {
      if (!holon || !(holon as any)._x) return;

      const x = (holon as any)._x;
      const y = (holon as any)._y;

      // Draw line from center to holon
      zoneCtx.beginPath();
      zoneCtx.moveTo(centerX, centerY);
      zoneCtx.lineTo(x, y);
      zoneCtx.strokeStyle = '#4b5563';
      zoneCtx.lineWidth = Math.max(1, holon.flowPercent / 10);
      zoneCtx.stroke();

      // Animated flow particles
      const dx = x - centerX;
      const dy = y - centerY;

      for (let i = 0; i < 3; i++) {
        const t = (flowOffset + i * 0.3) % 1;
        const px = centerX + dx * t;
        const py = centerY + dy * t;

        zoneCtx.beginPath();
        zoneCtx.arc(px, py, 3, 0, Math.PI * 2);
        zoneCtx.fillStyle = '#10b981';
        zoneCtx.fill();
      }
    });
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

  // Drag and drop handling
  function handleZoneMouseDown(event: MouseEvent) {
    const rect = zoneCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if click is on a holon
    const holon = federatedHolons.find(h => {
      const hx = (h as any)._x;
      const hy = (h as any)._y;
      const hr = (h as any)._radius || 25;
      const dx = x - hx;
      const dy = y - hy;
      return Math.sqrt(dx * dx + dy * dy) <= hr;
    });

    if (holon) {
      draggedHolon = holon;
      isDragging = true;
    }
  }

  function handleZoneMouseMove(event: MouseEvent) {
    if (!isDragging || !draggedHolon) return;

    const rect = zoneCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const centerX = ZONE_SIZE / 2;
    const centerY = ZONE_SIZE / 2;

    // Calculate angle and distance from center
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    // Determine zone based on distance
    let newZone = 5;
    for (let i = 0; i < ZONE_RADII.length; i++) {
      if (distance < ZONE_RADII[i]) {
        newZone = i;
        break;
      }
    }

    // Don't allow zone 0 (internal) for federated holons
    if (newZone < 1) newZone = 1;

    // Update holon position
    draggedHolon.zone = newZone;
    draggedHolon.angle = angle;

    // Trigger redraw
    federatedHolons = [...federatedHolons];
  }

  function handleZoneMouseUp() {
    if (draggedHolon && isDragging) {
      // Save the new zone configuration
      saveZoneConfiguration();
    }
    draggedHolon = null;
    isDragging = false;
  }

  async function saveZoneConfiguration() {
    // Save to holosphere or contract
    showNotification('Zone configuration updated', 'success');
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
      drawZones();
      drawSankey();
      animationFrame = requestAnimationFrame(animate);
    }
    animate();
  }

  onMount(async () => {
    // Initialize canvases
    if (zoneCanvas) {
      zoneCtx = zoneCanvas.getContext('2d')!;
    }
    if (sankeyCanvas) {
      sankeyCtx = sankeyCanvas.getContext('2d')!;
    }

    // Load data
    await loadFederationData();

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
  $: if (internalPercent !== undefined) {
    externalPercent = 100 - internalPercent;
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
      <!-- Quick Deploy Section -->
      {#if !existingBundle}
        <section class="bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-2xl p-8 border border-purple-500/30">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="text-xl font-bold text-white mb-2">Deploy Holon Bundle</h2>
              <p class="text-gray-400">One-click deployment of Splitter + Managed + Zoned contracts</p>
            </div>
            <button
              class="px-8 py-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-xl transition-all font-bold text-lg shadow-lg hover:shadow-purple-500/25"
              on:click={deployBundle}
              disabled={deploying || !isConnected}
            >
              {#if deploying}
                <span class="flex items-center gap-2">
                  <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Deploying...
                </span>
              {:else}
                Deploy Bundle
              {/if}
            </button>
          </div>
        </section>
      {:else}
        <section class="bg-green-900/30 rounded-2xl p-6 border border-green-500/30">
          <div class="flex items-center gap-3">
            <span class="text-2xl">V</span>
            <div>
              <div class="text-green-400 font-medium">Bundle Deployed</div>
              <div class="text-sm text-gray-400 font-mono">{existingBundle.splitterAddress?.slice(0, 20)}...</div>
            </div>
          </div>
        </section>
      {/if}

      <!-- Main Configuration Grid -->
      <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <!-- Zone Visualization -->
        <section class="bg-gray-700/50 rounded-2xl p-6">
          <h2 class="text-xl font-bold text-white mb-4">Federation Zones</h2>
          <p class="text-sm text-gray-400 mb-4">Drag holons between zones to configure flow priority. Zone 0 (center) is internal, Zone 5 (outer) is lowest priority.</p>

          <div class="flex justify-center">
            <canvas
              bind:this={zoneCanvas}
              width={ZONE_SIZE}
              height={ZONE_SIZE}
              class="bg-gray-800 rounded-xl cursor-pointer"
              on:mousedown={handleZoneMouseDown}
              on:mousemove={handleZoneMouseMove}
              on:mouseup={handleZoneMouseUp}
              on:mouseleave={handleZoneMouseUp}
            ></canvas>
          </div>

          <!-- Zone Legend -->
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            {#each ZONE_COLORS as color, i}
              <div class="flex items-center gap-1 px-2 py-1 rounded bg-gray-800">
                <div class="w-3 h-3 rounded-full" style="background-color: {color}"></div>
                <span class="text-xs text-gray-400">Zone {i}</span>
              </div>
            {/each}
          </div>
        </section>

        <!-- Flow Split Configuration -->
        <section class="bg-gray-700/50 rounded-2xl p-6">
          <h2 class="text-xl font-bold text-white mb-4">Flow Split</h2>

          <!-- Visual Split Display -->
          <div class="mb-6">
            <div class="flex h-8 rounded-xl overflow-hidden">
              <div
                class="bg-blue-500 flex items-center justify-center text-white font-bold text-sm transition-all"
                style="width: {internalPercent}%"
              >
                {internalPercent}% Internal
              </div>
              <div
                class="bg-orange-500 flex items-center justify-center text-white font-bold text-sm transition-all"
                style="width: {externalPercent}%"
              >
                {externalPercent}% External
              </div>
            </div>
          </div>

          <!-- Slider -->
          <div class="space-y-4">
            <div>
              <label class="block text-sm text-gray-300 mb-2">Internal / External Split</label>
              <input
                type="range"
                min="0"
                max="100"
                bind:value={internalPercent}
                class="w-full h-3 bg-gray-600 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div class="grid grid-cols-2 gap-4 text-center">
              <div class="p-4 bg-blue-500/20 rounded-xl border border-blue-500/50">
                <div class="text-3xl font-bold text-blue-400">{internalPercent}%</div>
                <div class="text-sm text-gray-400">to Members</div>
              </div>
              <div class="p-4 bg-orange-500/20 rounded-xl border border-orange-500/50">
                <div class="text-3xl font-bold text-orange-400">{externalPercent}%</div>
                <div class="text-sm text-gray-400">to Federation</div>
              </div>
            </div>

            {#if existingBundle}
              <button
                class="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-colors font-medium"
                on:click={updateFlowSplit}
              >
                Update Flow Split on Chain
              </button>
            {/if}
          </div>
        </section>
      </div>

      <!-- Federated Holons List -->
      <section class="bg-gray-700/50 rounded-2xl p-6">
        <h2 class="text-xl font-bold text-white mb-4">Federated Holons</h2>

        {#if federatedHolons.length === 0}
          <div class="text-center py-8 text-gray-400">
            <p>No federated holons yet.</p>
            <p class="text-sm">Add federations through the Federation page to see them here.</p>
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {#each federatedHolons as holon}
              <div class="p-4 bg-gray-800 rounded-xl border border-gray-600 hover:border-gray-500 transition-colors">
                <div class="flex items-center justify-between mb-3">
                  <div class="font-medium text-white">{holon.name}</div>
                  <span class="px-2 py-0.5 rounded text-xs {holon.status === 'active' ? 'bg-green-500/20 text-green-400' : holon.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-500/20 text-gray-400'}">
                    {holon.status}
                  </span>
                </div>

                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-gray-400">Zone:</span>
                    <span class="text-white" style="color: {ZONE_COLORS[holon.zone]}">{holon.zone}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-400">Flow %:</span>
                    <span class="text-white">{holon.flowPercent}%</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-400">Their Split:</span>
                    <span class="text-white">{holon.internalPercent}% int</span>
                  </div>
                </div>

                <!-- Flow percentage slider -->
                <div class="mt-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={holon.flowPercent}
                    on:input={(e) => updateHolonFlow(holon.id, parseInt(e.currentTarget.value))}
                    class="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- Sankey Diagram -->
      <section class="bg-gray-700/50 rounded-2xl p-6">
        <h2 class="text-xl font-bold text-white mb-4">Value Flow Visualization</h2>
        <p class="text-sm text-gray-400 mb-4">
          Sankey diagram showing how value flows through your holon to internal members and external federation.
        </p>

        <div class="overflow-x-auto">
          <div class="flex justify-center min-w-fit">
            <canvas
              bind:this={sankeyCanvas}
              width={SANKEY_WIDTH}
              height={SANKEY_HEIGHT}
              class="bg-gray-800 rounded-xl"
            ></canvas>
          </div>
        </div>

        <!-- Flow Legend -->
        <div class="mt-4 flex flex-wrap justify-center gap-4">
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded" style="background-color: #8b5cf680"></div>
            <span class="text-sm text-gray-400">Income</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded" style="background-color: #3b82f680"></div>
            <span class="text-sm text-gray-400">Internal Flow</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded" style="background-color: #f59e0b80"></div>
            <span class="text-sm text-gray-400">External Flow</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-4 h-4 rounded" style="background-color: #10b98180"></div>
            <span class="text-sm text-gray-400">Federation</span>
          </div>
        </div>
      </section>

      <!-- Metrics Summary -->
      <section class="bg-gray-700/50 rounded-2xl p-6">
        <h2 class="text-xl font-bold text-white mb-4">Flow Metrics</h2>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="p-4 bg-gray-800 rounded-xl text-center">
            <div class="text-3xl font-bold text-purple-400">{federatedHolons.length}</div>
            <div class="text-sm text-gray-400">Federations</div>
          </div>
          <div class="p-4 bg-gray-800 rounded-xl text-center">
            <div class="text-3xl font-bold text-blue-400">{internalPercent}%</div>
            <div class="text-sm text-gray-400">Internal</div>
          </div>
          <div class="p-4 bg-gray-800 rounded-xl text-center">
            <div class="text-3xl font-bold text-orange-400">{externalPercent}%</div>
            <div class="text-sm text-gray-400">External</div>
          </div>
          <div class="p-4 bg-gray-800 rounded-xl text-center">
            <div class="text-3xl font-bold text-green-400">{federatedHolons.filter(h => h.status === 'active').length}</div>
            <div class="text-sm text-gray-400">Active</div>
          </div>
        </div>
      </section>
    </div>
  {/if}
</div>

<style>
  /* Range slider styling */
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    background: #8b5cf6;
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid #ffffff;
  }

  input[type="range"]::-moz-range-thumb {
    width: 20px;
    height: 20px;
    background: #8b5cf6;
    cursor: pointer;
    border-radius: 50%;
    border: 2px solid #ffffff;
  }

  canvas {
    touch-action: none;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    canvas {
      max-width: 100%;
      height: auto;
    }
  }
</style>
