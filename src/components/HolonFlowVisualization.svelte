<script lang="ts">
  import { onMount, onDestroy, getContext } from 'svelte';
  import { HolonsManager } from '../lib/holons/HolonsManager.js';
  import type { FlowVisualizationData, FlowNode, FlowEdge, FlowMetrics } from '../lib/holons/FlowSettings.js';
  import type { HoloSphere } from "holosphere";

  export let holonId: string;
  export let width: number = 800;
  export let height: number = 600;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let holonsManager: HolonsManager | undefined;
  let holosphere: HoloSphere;
  let visualizationData: FlowVisualizationData | null = null;
  let loading = true;
  let error: string | null = null;
  let selectedNode: FlowNode | null = null;
  let hoveredNode: FlowNode | null = null;

  // Animation state
  let animationFrame: number;
  let flowAnimation = 0;

  // Get holosphere context
  try {
    holosphere = getContext('holosphere');
  } catch (e) {
    console.error('HolonFlowVisualization: Failed to get holosphere context');
  }

  onMount(async () => {
    if (!holosphere) {
      error = 'HoloSphere connection not available';
      loading = false;
      return;
    }

    try {
      // Initialize canvas
      ctx = canvas.getContext('2d')!;
      canvas.width = width;
      canvas.height = height;

      // Initialize holons manager (would need proper provider)
      // holonsManager = new HolonsManager(provider, holosphere);

      // Load visualization data
      await loadVisualization();
      
      // Start animation loop
      startAnimation();
      
      loading = false;
    } catch (err) {
      console.error('Error initializing flow visualization:', err);
      error = err instanceof Error ? err.message : 'Unknown error';
      loading = false;
    }
  });

  onDestroy(() => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });

  async function loadVisualization() {
    if (!holonsManager) {
      // Mock data for development
      visualizationData = generateMockData();
      return;
    }

    try {
      visualizationData = await holonsManager.generateFlowVisualization(holonId);
    } catch (err) {
      console.error('Error loading visualization data:', err);
      visualizationData = generateMockData();
    }
  }

  function generateMockData(): FlowVisualizationData {
    const nodes: FlowNode[] = [
      {
        id: 'splitter',
        name: 'Flow Controller',
        type: 'holon',
        holonType: 'Splitter',
        position: { x: width/2, y: 100 },
        status: 'active',
        balance: 1000
      },
      {
        id: 'internal',
        name: 'Internal (Managed)',
        type: 'internal',
        holonType: 'Managed',
        position: { x: width/2 - 200, y: 300 },
        status: 'active',
        members: 15
      },
      {
        id: 'external',
        name: 'External (Zoned)',
        type: 'external',
        holonType: 'Zoned',
        position: { x: width/2 + 200, y: 300 },
        status: 'active',
        zones: ['Zone A', 'Zone B']
      }
    ];

    const edges: FlowEdge[] = [
      {
        id: 'split-internal',
        source: 'splitter',
        target: 'internal',
        type: 'payment',
        weight: 60,
        lenses: [],
        status: 'active'
      },
      {
        id: 'split-external',
        source: 'splitter',
        target: 'external',
        type: 'payment',
        weight: 40,
        lenses: [],
        status: 'active'
      }
    ];

    const metrics: FlowMetrics = {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      internalFlow: 60,
      externalFlow: 40,
      federationCount: 3,
      notificationCount: 5,
      activeMembers: 15,
      totalBalance: 1000
    };

    return { nodes, edges, metrics };
  }

  function startAnimation() {
    function animate() {
      flowAnimation += 0.02;
      draw();
      animationFrame = requestAnimationFrame(animate);
    }
    animate();
  }

  function draw() {
    if (!ctx || !visualizationData) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw edges first
    visualizationData.edges.forEach(edge => {
      drawEdge(edge);
    });

    // Draw nodes
    visualizationData.nodes.forEach(node => {
      drawNode(node);
    });

    // Draw selection highlight
    if (selectedNode) {
      drawNodeHighlight(selectedNode, '#3b82f6');
    }
    if (hoveredNode && hoveredNode !== selectedNode) {
      drawNodeHighlight(hoveredNode, '#6b7280');
    }
  }

  function drawNode(node: FlowNode) {
    if (!ctx || !node.position) return;

    const { x, y } = node.position;
    const radius = getNodeRadius(node);
    const color = getNodeColor(node);

    // Node circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = node.status === 'active' ? '#10b981' : '#6b7280';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Node icon/text
    ctx.fillStyle = '#ffffff';
    ctx.font = `${radius * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const icon = getNodeIcon(node);
    ctx.fillText(icon, x, y);

    // Node label
    ctx.fillStyle = '#374151';
    ctx.font = '12px Arial';
    ctx.fillText(node.name, x, y + radius + 20);

    // Additional info
    if (node.members) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px Arial';
      ctx.fillText(`${node.members} members`, x, y + radius + 35);
    }
    if (node.balance) {
      ctx.fillStyle = '#059669';
      ctx.font = '10px Arial';
      ctx.fillText(`${node.balance.toFixed(2)} tokens`, x, y + radius + 50);
    }
  }

  function drawEdge(edge: FlowEdge) {
    if (!ctx || !visualizationData) return;

    const sourceNode = visualizationData.nodes.find(n => n.id === edge.source);
    const targetNode = visualizationData.nodes.find(n => n.id === edge.target);

    if (!sourceNode?.position || !targetNode?.position) return;

    const color = getEdgeColor(edge);
    const width = Math.max(2, edge.weight / 10);

    ctx.beginPath();
    ctx.moveTo(sourceNode.position.x, sourceNode.position.y);
    ctx.lineTo(targetNode.position.x, targetNode.position.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    // Animated flow particles
    if (edge.status === 'active') {
      drawFlowParticles(sourceNode.position, targetNode.position, edge);
    }

    // Edge label
    const midX = (sourceNode.position.x + targetNode.position.x) / 2;
    const midY = (sourceNode.position.y + targetNode.position.y) / 2;
    
    ctx.fillStyle = '#374151';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(`${edge.weight}%`, midX, midY - 5);
  }

  function drawFlowParticles(source: {x: number, y: number}, target: {x: number, y: number}, edge: FlowEdge) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Multiple particles along the edge
    for (let i = 0; i < 3; i++) {
      const offset = (flowAnimation + i * 0.3) % 1;
      const x = source.x + dx * offset;
      const y = source.y + dy * offset;
      
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = edge.type === 'payment' ? '#10b981' : '#3b82f6';
      ctx.fill();
    }
  }

  function drawNodeHighlight(node: FlowNode, color: string) {
    if (!ctx || !node.position) return;

    const { x, y } = node.position;
    const radius = getNodeRadius(node) + 10;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function getNodeRadius(node: FlowNode): number {
    switch (node.type) {
      case 'holon':
        return node.holonType === 'Splitter' ? 40 : 35;
      case 'internal':
      case 'external':
        return 45;
      default:
        return 30;
    }
  }

  function getNodeColor(node: FlowNode): string {
    switch (node.type) {
      case 'internal':
        return '#3b82f6';
      case 'external':
        return '#f59e0b';
      case 'holon':
        return node.holonType === 'Splitter' ? '#8b5cf6' : '#10b981';
      default:
        return '#6b7280';
    }
  }

  function getNodeIcon(node: FlowNode): string {
    switch (node.holonType) {
      case 'Managed': return '🔹';
      case 'Zoned': return '🔶';
      case 'Splitter': return '💱';
      case 'Appreciative': return '💯';
      default:
        switch (node.type) {
          case 'internal': return '🏠';
          case 'external': return '🌐';
          default: return '⚙️';
        }
    }
  }

  function getEdgeColor(edge: FlowEdge): string {
    switch (edge.type) {
      case 'payment': return '#10b981';
      case 'federation': return '#3b82f6';
      case 'notification': return '#f59e0b';
      case 'governance': return '#8b5cf6';
      default: return '#6b7280';
    }
  }

  function handleCanvasClick(event: MouseEvent) {
    if (!visualizationData) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if click is on a node
    const clickedNode = visualizationData.nodes.find(node => {
      if (!node.position) return false;
      const dx = x - node.position.x;
      const dy = y - node.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= getNodeRadius(node);
    });

    selectedNode = clickedNode || null;
  }

  function handleCanvasMove(event: MouseEvent) {
    if (!visualizationData) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if hover is on a node
    const hoveredNodeCandidate = visualizationData.nodes.find(node => {
      if (!node.position) return false;
      const dx = x - node.position.x;
      const dy = y - node.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= getNodeRadius(node);
    });

    hoveredNode = hoveredNodeCandidate || null;
    canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
  }

  async function refreshVisualization() {
    loading = true;
    error = null;
    await loadVisualization();
    loading = false;
  }
</script>

<div class="flow-visualization">
  <div class="visualization-header">
    <h3>Flow Visualization - {holonId}</h3>
    <button on:click={refreshVisualization} class="refresh-btn" disabled={loading}>
      {loading ? '🔄' : '↻'} Refresh
    </button>
  </div>

  {#if error}
    <div class="error-message">
      <p>Error loading visualization: {error}</p>
    </div>
  {:else if loading}
    <div class="loading-message">
      <div class="spinner"></div>
      <p>Loading flow visualization...</p>
    </div>
  {:else}
    <div class="canvas-container">
      <canvas
        bind:this={canvas}
        {width}
        {height}
        on:click={handleCanvasClick}
        on:mousemove={handleCanvasMove}
      ></canvas>
    </div>

    {#if visualizationData}
      <div class="metrics-panel">
        <div class="metric">
          <span class="metric-label">Nodes:</span>
          <span class="metric-value">{visualizationData.metrics.totalNodes}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Internal Flow:</span>
          <span class="metric-value">{visualizationData.metrics.internalFlow}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">External Flow:</span>
          <span class="metric-value">{visualizationData.metrics.externalFlow}%</span>
        </div>
        <div class="metric">
          <span class="metric-label">Federations:</span>
          <span class="metric-value">{visualizationData.metrics.federationCount}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Members:</span>
          <span class="metric-value">{visualizationData.metrics.activeMembers}</span>
        </div>
        <div class="metric">
          <span class="metric-label">Balance:</span>
          <span class="metric-value">{visualizationData.metrics.totalBalance.toFixed(2)}</span>
        </div>
      </div>

      {#if selectedNode}
        <div class="node-info">
          <h4>{selectedNode.name}</h4>
          <p><strong>Type:</strong> {selectedNode.type}</p>
          {#if selectedNode.holonType}
            <p><strong>Holon Type:</strong> {selectedNode.holonType}</p>
          {/if}
          {#if selectedNode.address}
            <p><strong>Address:</strong> <code>{selectedNode.address.substring(0, 10)}...</code></p>
          {/if}
          {#if selectedNode.members}
            <p><strong>Members:</strong> {selectedNode.members}</p>
          {/if}
          {#if selectedNode.balance}
            <p><strong>Balance:</strong> {selectedNode.balance.toFixed(2)} tokens</p>
          {/if}
          {#if selectedNode.zones}
            <p><strong>Zones:</strong> {selectedNode.zones.join(', ')}</p>
          {/if}
          <p><strong>Status:</strong> <span class="status-{selectedNode.status}">{selectedNode.status}</span></p>
        </div>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .flow-visualization {
    background: #1f2937;
    border-radius: 12px;
    padding: 1.5rem;
    color: white;
  }

  .visualization-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #374151;
  }

  .visualization-header h3 {
    margin: 0;
    color: #f9fafb;
    font-size: 1.25rem;
  }

  .refresh-btn {
    background: #3b82f6;
    color: white;
    border: none;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: background 0.2s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #2563eb;
  }

  .refresh-btn:disabled {
    background: #6b7280;
    cursor: not-allowed;
  }

  .error-message, .loading-message {
    text-align: center;
    padding: 2rem;
    color: #9ca3af;
  }

  .error-message p {
    color: #ef4444;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #374151;
    border-top: 4px solid #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .canvas-container {
    border: 2px solid #374151;
    border-radius: 8px;
    background: #111827;
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;
  }

  canvas {
    border-radius: 6px;
  }

  .metrics-panel {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
    padding: 1rem;
    background: #111827;
    border-radius: 8px;
  }

  .metric {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .metric-label {
    color: #9ca3af;
    font-size: 0.875rem;
  }

  .metric-value {
    color: #f9fafb;
    font-weight: 600;
    font-size: 1rem;
  }

  .node-info {
    background: #111827;
    border: 1px solid #374151;
    border-radius: 8px;
    padding: 1rem;
  }

  .node-info h4 {
    margin: 0 0 0.75rem 0;
    color: #3b82f6;
    font-size: 1.1rem;
  }

  .node-info p {
    margin: 0.5rem 0;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .node-info code {
    background: #374151;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    font-size: 0.75rem;
  }

  .status-active {
    color: #10b981;
    font-weight: 600;
  }

  .status-inactive {
    color: #6b7280;
  }

  .status-pending {
    color: #f59e0b;
  }

  @media (max-width: 768px) {
    .flow-visualization {
      padding: 1rem;
    }

    .visualization-header {
      flex-direction: column;
      gap: 0.75rem;
      align-items: stretch;
    }

    .metrics-panel {
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    canvas {
      max-width: 100%;
      height: auto;
    }
  }
</style>