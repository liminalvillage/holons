<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import * as d3 from 'd3';
  import type { InteriorMember, ZonedHolon } from './types';
  import { calculateZonePercentages, ZONE_COLORS, COLOR_PALETTE } from './types';

  export let interiorMembers: InteriorMember[] = [];
  export let federatedHolons: ZonedHolon[] = [];
  export let nzones: number = 6;
  export let steepness: number = 50;
  export let interiorPercent: number = 50;

  const dispatch = createEventDispatcher<{
    holonDropped: { holonId: string; zone: number; angle?: number };
    holonClicked: { holonId: string };
    zoneClicked: { zone: number };
    holonMoved: { holonId: string; angle: number };
  }>();

  let container: HTMLDivElement;
  let svgElement: SVGSVGElement;
  let width = 500;
  let height = 500;
  let resizeObserver: ResizeObserver;

  // Drag state
  let dropTargetZone: number | null = null;
  let selectedHolonId: string | null = null;

  // SVG Drag state for holons
  let draggingHolon: string | null = null;
  let dragOffset = { x: 0, y: 0 };

  // Custom positions for holons (stored by ID -> angle)
  let customAngles = new Map<string, number>();

  // Tooltip state
  let tooltip: { visible: boolean; x: number; y: number; content: any; type: 'member' | 'holon' } = {
    visible: false,
    x: 0,
    y: 0,
    content: null,
    type: 'member'
  };

  // SVG layout constants
  const CENTER = 250;
  const PIE_RADIUS = 80;
  const OUTER_PADDING = 30;
  const RING_GAP = 4;

  // Computed values
  $: exteriorPercent = 100 - interiorPercent;
  $: zonePercentages = calculateZonePercentages(steepness, nzones);
  $: ringWidth = nzones > 0 ? (CENTER - PIE_RADIUS - OUTER_PADDING - (nzones - 1) * RING_GAP) / nzones : 0;

  // Process interior members for pie chart
  $: processedMembers = interiorMembers.map((member, i) => ({
    ...member,
    color: member.color || COLOR_PALETTE[i % COLOR_PALETTE.length]
  }));

  // Group holons by zone and compute positions
  $: assignedHolons = federatedHolons.filter(h => h.zone >= 1 && h.zone <= nzones);

  // Compute holon positions - use custom angles if available
  $: holonPositions = computeHolonPositions(assignedHolons, nzones, customAngles);

  function computeHolonPositions(
    holons: ZonedHolon[],
    numZones: number,
    customAngleMap: Map<string, number>
  ): Map<string, { x: number; y: number; angle: number }> {
    const positions = new Map<string, { x: number; y: number; angle: number }>();

    // Group by zone
    const byZone = new Map<number, ZonedHolon[]>();
    for (let z = 1; z <= numZones; z++) {
      byZone.set(z, []);
    }
    holons.forEach(h => {
      const list = byZone.get(h.zone);
      if (list) list.push(h);
    });

    // Calculate positions for each holon
    byZone.forEach((zoneHolons, zone) => {
      if (zoneHolons.length === 0) return;

      const { inner, outer } = getZoneRadii(zone);
      const radius = (inner + outer) / 2;
      const defaultAngleStep = (2 * Math.PI) / zoneHolons.length;

      zoneHolons.forEach((h, i) => {
        // Use custom angle if available, otherwise compute default
        const angle = customAngleMap.get(h.id) ?? (h.angle !== undefined && h.angle !== 0 ? h.angle : i * defaultAngleStep - Math.PI / 2);
        positions.set(h.id, {
          x: CENTER + radius * Math.cos(angle),
          y: CENTER + radius * Math.sin(angle),
          angle
        });
      });
    });

    return positions;
  }

  function getZoneRadii(zone: number): { inner: number; outer: number } {
    const inner = PIE_RADIUS + (zone - 1) * (ringWidth + RING_GAP);
    const outer = inner + ringWidth;
    return { inner, outer };
  }

  // Get zone from position (returns zone number or -1 if outside)
  function getZoneFromPosition(x: number, y: number): number {
    const dx = x - CENTER;
    const dy = y - CENTER;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Check if inside pie chart
    if (distance < PIE_RADIUS) return -1;

    // Check each zone
    for (let z = 1; z <= nzones; z++) {
      const { inner, outer } = getZoneRadii(z);
      if (distance >= inner && distance <= outer) {
        return z;
      }
    }

    return -1;
  }

  // SVG drag handlers for holons
  function handleHolonDragStart(e: MouseEvent | TouchEvent, holonId: string) {
    e.preventDefault();
    e.stopPropagation();
    draggingHolon = holonId;
    hideTooltip();

    const pos = holonPositions.get(holonId);
    if (pos) {
      const clientPos = getClientPosition(e);
      const svgPoint = screenToSvg(clientPos.x, clientPos.y);
      dragOffset = { x: svgPoint.x - pos.x, y: svgPoint.y - pos.y };
    }

    // Add global listeners
    window.addEventListener('mousemove', handleHolonDrag);
    window.addEventListener('mouseup', handleHolonDragEnd);
    window.addEventListener('touchmove', handleHolonDrag);
    window.addEventListener('touchend', handleHolonDragEnd);
  }

  function handleHolonDrag(e: MouseEvent | TouchEvent) {
    if (!draggingHolon) return;
    e.preventDefault();

    const clientPos = getClientPosition(e);
    const svgPoint = screenToSvg(clientPos.x, clientPos.y);
    const x = svgPoint.x - dragOffset.x;
    const y = svgPoint.y - dragOffset.y;

    // Calculate angle from center
    const angle = Math.atan2(y - CENTER, x - CENTER);

    // Update custom angle
    customAngles.set(draggingHolon, angle);
    customAngles = new Map(customAngles); // Trigger reactivity

    // Check what zone we're over
    const zone = getZoneFromPosition(x, y);
    dropTargetZone = zone > 0 ? zone : null;
  }

  function handleHolonDragEnd(e: MouseEvent | TouchEvent) {
    if (!draggingHolon) return;

    const holon = federatedHolons.find(h => h.id === draggingHolon);
    const newAngle = customAngles.get(draggingHolon);

    if (holon && dropTargetZone !== null && dropTargetZone !== holon.zone) {
      // Moved to a different zone
      dispatch('holonDropped', { holonId: draggingHolon, zone: dropTargetZone, angle: newAngle });
    } else if (newAngle !== undefined) {
      // Just moved position within same zone
      dispatch('holonMoved', { holonId: draggingHolon, angle: newAngle });
    }

    // Cleanup
    draggingHolon = null;
    dropTargetZone = null;
    window.removeEventListener('mousemove', handleHolonDrag);
    window.removeEventListener('mouseup', handleHolonDragEnd);
    window.removeEventListener('touchmove', handleHolonDrag);
    window.removeEventListener('touchend', handleHolonDragEnd);
  }

  function getClientPosition(e: MouseEvent | TouchEvent): { x: number; y: number } {
    if ('touches' in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  }

  function screenToSvg(clientX: number, clientY: number): { x: number; y: number } {
    if (!svgElement) return { x: clientX, y: clientY };

    const rect = svgElement.getBoundingClientRect();
    const scaleX = 500 / rect.width;
    const scaleY = 500 / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  // D3 arc generators
  function createArcPath(innerRadius: number, outerRadius: number): string {
    const arc = d3.arc()
      .innerRadius(innerRadius)
      .outerRadius(outerRadius)
      .startAngle(0)
      .endAngle(2 * Math.PI);
    return arc({} as any) || '';
  }

  function createPieArc(startAngle: number, endAngle: number): string {
    const arc = d3.arc()
      .innerRadius(PIE_RADIUS * 0.35)
      .outerRadius(PIE_RADIUS)
      .startAngle(startAngle)
      .endAngle(endAngle);
    return arc({} as any) || '';
  }

  // Calculate pie slices
  $: pieData = (() => {
    const pie = d3.pie<InteriorMember>()
      .value(d => d.percentage)
      .sort(null);
    return pie(processedMembers);
  })();

  // Tooltip handlers
  function showMemberTooltip(e: MouseEvent, member: InteriorMember) {
    const rect = container.getBoundingClientRect();
    tooltip = {
      visible: true,
      x: e.clientX - rect.left + 10,
      y: e.clientY - rect.top + 10,
      content: member,
      type: 'member'
    };
  }

  function showHolonTooltip(e: MouseEvent, holon: ZonedHolon) {
    const rect = container.getBoundingClientRect();
    tooltip = {
      visible: true,
      x: e.clientX - rect.left + 10,
      y: e.clientY - rect.top + 10,
      content: holon,
      type: 'holon'
    };
  }

  function hideTooltip() {
    tooltip = { ...tooltip, visible: false };
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent, zone: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dropTargetZone = zone;
  }

  function handleDragLeave() {
    dropTargetZone = null;
  }

  function handleDrop(e: DragEvent, zone: number) {
    e.preventDefault();
    const holonId = e.dataTransfer?.getData('holonId');
    if (holonId) {
      dispatch('holonDropped', { holonId, zone });
    }
    dropTargetZone = null;
  }

  function handleZoneClick(zone: number) {
    if (selectedHolonId) {
      dispatch('holonDropped', { holonId: selectedHolonId, zone });
      selectedHolonId = null;
    } else {
      dispatch('zoneClicked', { zone });
    }
  }

  function handleHolonClick(holonId: string) {
    if (selectedHolonId === holonId) {
      selectedHolonId = null;
    } else {
      selectedHolonId = holonId;
    }
    dispatch('holonClicked', { holonId });
  }

  onMount(() => {
    if (container) {
      resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          width = Math.min(w, h, 600);
          height = width;
        }
      });
      resizeObserver.observe(container);
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
  });
</script>

<div class="chart-container" bind:this={container}>
  <svg
    bind:this={svgElement}
    viewBox="0 0 500 500"
    class="concentric-chart"
    style="width: {width}px; height: {height}px;"
  >
    <defs>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
        <feMerge>
          <feMergeNode in="coloredBlur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.3"/>
      </filter>
    </defs>

    <!-- Zone rings (outer to inner for proper layering) -->
    <g class="zone-rings" transform="translate({CENTER}, {CENTER})">
      {#each Array(nzones) as _, i}
        {@const zone = nzones - i}
        {@const { inner, outer } = getZoneRadii(zone)}
        {@const percent = zonePercentages[zone - 1] || 0}
        {@const actualPercent = (exteriorPercent * percent / 100)}
        <g class="zone-group">
          <path
            d={createArcPath(inner, outer)}
            class="zone-ring"
            class:drop-target={dropTargetZone === zone}
            class:has-selection={selectedHolonId !== null}
            style="fill: {ZONE_COLORS[(zone - 1) % ZONE_COLORS.length]}20; stroke: {ZONE_COLORS[(zone - 1) % ZONE_COLORS.length]}60"
            on:dragover={(e) => handleDragOver(e, zone)}
            on:dragleave={handleDragLeave}
            on:drop={(e) => handleDrop(e, zone)}
            on:click={() => handleZoneClick(zone)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleZoneClick(zone); }}
            role="button"
            tabindex="0"
            aria-label="Zone {zone}: {actualPercent.toFixed(1)}%"
          />
          <text
            x={0}
            y={-((inner + outer) / 2)}
            class="zone-label"
            text-anchor="middle"
            dominant-baseline="middle"
          >
            {actualPercent.toFixed(1)}%
          </text>
          <text
            x={((inner + outer) / 2) * 0.707}
            y={-((inner + outer) / 2) * 0.707}
            class="zone-number"
            text-anchor="middle"
            dominant-baseline="middle"
          >
            Z{zone}
          </text>
        </g>
      {/each}
    </g>

    <!-- Center pie chart (Interior / Zone 0) -->
    <g class="interior-pie" transform="translate({CENTER}, {CENTER})">
      <circle r={PIE_RADIUS} class="pie-background" />

      {#if pieData.length > 0 && processedMembers.length > 0}
        {#each pieData as slice, i}
          {@const member = slice.data}
          <path
            d={createPieArc(slice.startAngle, slice.endAngle)}
            fill={member?.color || COLOR_PALETTE[i % COLOR_PALETTE.length]}
            class="pie-slice"
            on:mouseenter={(e) => showMemberTooltip(e, member)}
            on:mouseleave={hideTooltip}
            on:mousemove={(e) => showMemberTooltip(e, member)}
            role="img"
            aria-label="{(member as any)?.name || 'Member'}: {member?.percentage?.toFixed(1) || 0}%"
          />
        {/each}
        <text class="center-percent" text-anchor="middle" dominant-baseline="middle" y="-5">
          {interiorPercent}%
        </text>
        <text class="center-label" text-anchor="middle" dominant-baseline="middle" y="12">
          received
        </text>
      {:else}
        <text class="center-percent" text-anchor="middle" dominant-baseline="middle" y="-5">
          {interiorPercent}%
        </text>
        <text class="center-label" text-anchor="middle" dominant-baseline="middle" y="12">
          received
        </text>
      {/if}

      <text y={PIE_RADIUS + 20} class="interior-label" text-anchor="middle">
        Interior {interiorPercent}%
      </text>
    </g>

    <!-- Holon nodes in zones -->
    <g class="holon-nodes">
      {#each assignedHolons as holon (holon.id)}
        {@const pos = holonPositions.get(holon.id) || { x: CENTER, y: CENTER }}
        <g
          class="holon-node"
          class:selected={selectedHolonId === holon.id}
          class:dragging={draggingHolon === holon.id}
          transform="translate({pos.x}, {pos.y})"
          on:mousedown={(e) => handleHolonDragStart(e, holon.id)}
          on:touchstart={(e) => handleHolonDragStart(e, holon.id)}
          on:mouseenter={(e) => !draggingHolon && showHolonTooltip(e, holon)}
          on:mouseleave={hideTooltip}
          role="button"
          tabindex="0"
          aria-label="{holon.name} in zone {holon.zone}"
        >
          <circle r="20" class="holon-circle" filter="url(#dropShadow)" />
          <circle
            r="5"
            cx="14"
            cy="-14"
            class="status-dot"
            class:active={holon.status === 'active'}
            class:pending={holon.status === 'pending'}
            class:inactive={holon.status === 'inactive'}
          />
          <text class="holon-name" text-anchor="middle" dominant-baseline="middle">
            {holon.name.slice(0, 2).toUpperCase()}
          </text>
        </g>
      {/each}
    </g>
  </svg>

  <!-- Tooltip -->
  {#if tooltip.visible && tooltip.content}
    <div
      class="tooltip"
      style="left: {tooltip.x}px; top: {tooltip.y}px;"
    >
      {#if tooltip.type === 'member'}
        {@const member = tooltip.content}
        <div class="tooltip-header">
          <div class="tooltip-avatar" style="background: {member.color}">
            {member.username?.slice(0, 1).toUpperCase() || '?'}
          </div>
          <div class="tooltip-title">
            <span class="tooltip-name">{member.username || member.userId}</span>
            <span class="tooltip-score">{member.percentage?.toFixed(1)}% share</span>
          </div>
        </div>
        {#if member.breakdown}
          <div class="tooltip-breakdown">
            <div class="breakdown-row">
              <span>Tasks initiated:</span>
              <span>{member.breakdown.initiated}</span>
            </div>
            <div class="breakdown-row">
              <span>Tasks completed:</span>
              <span>{member.breakdown.completed}</span>
            </div>
            <div class="breakdown-row">
              <span>Appreciation sent:</span>
              <span>{member.breakdown.sent}</span>
            </div>
            <div class="breakdown-row">
              <span>Appreciation received:</span>
              <span>{member.breakdown.received}</span>
            </div>
            <div class="breakdown-row">
              <span>Hours contributed:</span>
              <span>{member.breakdown.hours}</span>
            </div>
            <div class="breakdown-row">
              <span>Collaboration:</span>
              <span>{member.breakdown.collaboration}</span>
            </div>
            <div class="breakdown-row">
              <span>Wants:</span>
              <span>{member.breakdown.wants}</span>
            </div>
            <div class="breakdown-row">
              <span>Offers:</span>
              <span>{member.breakdown.offers}</span>
            </div>
          </div>
        {/if}
        <div class="tooltip-footer">
          Score: {member.score?.toFixed(0) || 0} points
        </div>
      {:else}
        {@const holon = tooltip.content}
        <div class="tooltip-header">
          <div class="tooltip-avatar holon-avatar">
            {holon.name?.slice(0, 2).toUpperCase() || '??'}
          </div>
          <div class="tooltip-title">
            <span class="tooltip-name">{holon.name}</span>
            <span class="tooltip-zone">Zone {holon.zone}</span>
          </div>
        </div>
        <div class="tooltip-breakdown">
          <div class="breakdown-row">
            <span>Status:</span>
            <span class="status-{holon.status}">{holon.status}</span>
          </div>
          <div class="breakdown-row">
            <span>ID:</span>
            <span class="tooltip-id">{holon.id.slice(0, 12)}...</span>
          </div>
          {#if holon.splitterAddress}
            <div class="breakdown-row">
              <span>Contract:</span>
              <span class="tooltip-id">{holon.splitterAddress.slice(0, 10)}...</span>
            </div>
          {/if}
        </div>
        <div class="tooltip-footer">
          Click to select, then click a zone to move
        </div>
      {/if}
    </div>
  {/if}

  {#if selectedHolonId}
    <div class="selection-hint">
      Click a zone to move the selected holon
    </div>
  {/if}
</div>

<style>
  .chart-container {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 400px;
  }

  .concentric-chart {
    max-width: 100%;
    height: auto;
  }

  .zone-ring {
    stroke-width: 2;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .zone-ring:hover {
    filter: brightness(1.3);
  }

  .zone-ring.drop-target {
    filter: brightness(1.5) url(#glow);
    stroke-width: 3;
  }

  .zone-ring.has-selection {
    cursor: crosshair;
  }

  .zone-label {
    font-size: 12px;
    font-weight: 600;
    fill: #e2e8f0;
    pointer-events: none;
  }

  .zone-number {
    font-size: 10px;
    font-weight: 500;
    fill: #94a3b8;
    pointer-events: none;
  }

  .pie-background {
    fill: rgba(30, 41, 59, 0.8);
    stroke: #475569;
    stroke-width: 2;
  }

  .pie-slice {
    stroke: #1e293b;
    stroke-width: 1;
    cursor: pointer;
    transition: transform 0.2s ease, filter 0.2s ease;
    transform-origin: center;
  }

  .pie-slice:hover {
    filter: brightness(1.2);
  }

  .empty-text {
    fill: #64748b;
    font-size: 12px;
  }

  .empty-hint {
    fill: #475569;
    font-size: 10px;
  }

  .center-percent {
    fill: #e2e8f0;
    font-size: 22px;
    font-weight: 700;
  }

  .center-label {
    fill: #94a3b8;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .interior-label {
    font-size: 11px;
    fill: #94a3b8;
  }

  .holon-node {
    cursor: grab;
    touch-action: none;
  }

  .holon-node:active, .holon-node.dragging {
    cursor: grabbing;
  }

  .holon-node.selected .holon-circle {
    stroke: #fbbf24;
    stroke-width: 3;
  }

  .holon-node.dragging .holon-circle {
    stroke: #60a5fa;
    stroke-width: 3;
    filter: url(#glow);
  }

  .holon-circle {
    fill: #334155;
    stroke: #64748b;
    stroke-width: 2;
    transition: fill 0.2s, stroke 0.2s;
  }

  .holon-node:hover .holon-circle {
    fill: #475569;
    stroke: #94a3b8;
  }

  .holon-name {
    font-size: 10px;
    font-weight: 600;
    fill: #e2e8f0;
    pointer-events: none;
  }

  .status-dot {
    stroke: #1e293b;
    stroke-width: 1;
  }

  .status-dot.active {
    fill: #22c55e;
  }

  .status-dot.pending {
    fill: #f59e0b;
  }

  .status-dot.inactive {
    fill: #64748b;
  }

  /* Tooltip styles */
  .tooltip {
    position: absolute;
    z-index: 100;
    background: rgba(15, 23, 42, 0.95);
    border: 1px solid #334155;
    border-radius: 0.5rem;
    padding: 0.75rem;
    min-width: 200px;
    max-width: 280px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }

  .tooltip-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #334155;
  }

  .tooltip-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    color: white;
    flex-shrink: 0;
  }

  .tooltip-avatar.holon-avatar {
    background: #475569;
    border: 2px solid #64748b;
  }

  .tooltip-title {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tooltip-name {
    font-weight: 600;
    color: #e2e8f0;
    font-size: 0.875rem;
  }

  .tooltip-score, .tooltip-zone {
    font-size: 0.75rem;
    color: #60a5fa;
  }

  .tooltip-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .breakdown-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
  }

  .breakdown-row span:first-child {
    color: #94a3b8;
  }

  .breakdown-row span:last-child {
    color: #e2e8f0;
    font-weight: 500;
  }

  .status-active {
    color: #22c55e !important;
  }

  .status-pending {
    color: #f59e0b !important;
  }

  .status-inactive {
    color: #64748b !important;
  }

  .tooltip-id {
    font-family: monospace;
    font-size: 0.7rem;
  }

  .tooltip-footer {
    margin-top: 0.75rem;
    padding-top: 0.5rem;
    border-top: 1px solid #334155;
    font-size: 0.75rem;
    color: #64748b;
    text-align: center;
  }

  .selection-hint {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.5rem 1rem;
    background: rgba(30, 41, 59, 0.9);
    border: 1px solid #475569;
    border-radius: 0.375rem;
    font-size: 0.75rem;
    color: #94a3b8;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .zone-label {
      font-size: 10px;
    }

    .zone-number {
      font-size: 8px;
    }

    .tooltip {
      min-width: 180px;
      max-width: 240px;
    }
  }
</style>
