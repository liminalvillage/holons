<script lang="ts">
    import { createEventDispatcher, getContext, onMount, onDestroy } from 'svelte';
    import { goto } from '$app/navigation';
    import type { HoloSphere } from "holosphere";
    import * as d3 from 'd3';
    import { ID } from "../dashboard/store";
    import { awaitName } from '$lib/stores/nameResolver';
    import { addClickedHolon, addVisitedHolon, getWalletAddress } from "../utils/localStorage";

    interface Holon {
        name: string;
        members?: string[];
        color?: string;
        description?: string;
        value?: number;
        key?: string;
        children?: Holon[];
        parent?: string;
        isFederated?: boolean; // Flag to indicate if this is a federated child
        federatedFrom?: string; // The holon that this is federated from
    }

    interface HolonData {
        name: string;
        children: Holon[];
    }

    const holosphere = getContext("holosphere") as HoloSphere;
    const dispatch = createEventDispatcher();

    // Canvas and interaction state
    let svg: SVGElement;
    let viewContainer: HTMLElement;
    let width = 900;
    let height = 600;

    // D3 visualization state
    let root: d3.HierarchyCircularNode<Holon>;
    let focus: d3.HierarchyCircularNode<Holon>;
    let view: [number, number, number];
    let isInitialized = false;

    // Color scale for different depths
    const color = d3.scaleLinear<string>()
        .domain([0, 5])
        .range(['#4B5563', '#1E40AF'])
        .interpolate(d3.interpolateHcl);

    // Add zoom behavior variable
    let zoomBehavior: d3.ZoomBehavior<SVGElement, unknown>;
    let mainGroup: d3.Selection<SVGGElement, unknown, null, undefined>;

    // Debouncing variables
    let updateTimeout: any;
    let pendingUpdate = false;

    // Track visit function


    function updateStatCirclesPosition() {
        d3.select(svg).selectAll('.stat-circle').each(function() {
            const circle = d3.select(this);
            const parentX = parseFloat(circle.attr('data-parent-x'));
            const parentY = parseFloat(circle.attr('data-parent-y'));
            const parentR = parseFloat(circle.attr('data-parent-r'));
            const index = parseInt(circle.attr('data-index'));
            const spacing = parseFloat(circle.attr('data-spacing'));
            const totalWidth = parseFloat(circle.attr('data-total-width'));
            
            // Calculate new position relative to parent
            const startX = parentX - totalWidth / 2;
            const y = parentY + parentR + 15;
            const x = startX + index * spacing;
            
            circle.attr('cx', x).attr('cy', y);
        });
        
        d3.select(svg).selectAll('.stat-text').each(function() {
            const text = d3.select(this);
            const parentX = parseFloat(text.attr('data-parent-x'));
            const parentY = parseFloat(text.attr('data-parent-y'));
            const parentR = parseFloat(text.attr('data-parent-r'));
            const index = parseInt(text.attr('data-index'));
            const spacing = parseFloat(text.attr('data-spacing'));
            const totalWidth = parseFloat(text.attr('data-total-width'));
            
            // Calculate new position relative to parent
            const startX = parentX - totalWidth / 2;
            const y = parentY + parentR + 15;
            const x = startX + index * spacing;
            
            text.attr('x', x).attr('y', y + 8 + 15); // 8 is circle radius, 15 is text offset
        });
    }

    function handleZoom(event: d3.D3ZoomEvent<SVGElement, unknown>) {
        mainGroup.attr('transform', event.transform.toString());
        updateStatCirclesPosition();
    }

    function initializeZoom() {
        zoomBehavior = d3.zoom<SVGElement, unknown>()
            .scaleExtent([0.1, 10])
            .on('zoom', handleZoom);

        mainGroup = d3.select(svg).select('g');
        d3.select(svg)
            .call(zoomBehavior)
            .call(zoomBehavior.transform, d3.zoomIdentity);

        // Prevent default touch behaviors
        d3.select(svg)
            .on('touchstart', (event) => event.preventDefault())
            .on('touchmove', (event) => event.preventDefault());
    }

    function pack(data: HolonData) {
        return d3.pack<Holon>()
            .size([width, height])
            .padding(3)
            (d3.hierarchy<Holon>(data)
                .sum(d => {
                    // Make federated children smaller (max half diameter of parent)
                    if (d.isFederated) {
                        // For diameter to be 1/2, area should be 1/4 (since area = πr²)
                        return Math.min((d.value || 0) * 0.25, 15); // Max 15 for federated
                    }
                    return d.value || 0;
                })
                .sort((a, b) => {
                    // Stable sorting to prevent shuffling - use key as secondary sort
                    const valueDiff = (b.value || 0) - (a.value || 0);
                    if (valueDiff !== 0) return valueDiff;
                    // If values are equal, sort by key to maintain stable order
                    return (a.data.key || '').localeCompare(b.data.key || '');
                }));
    }

    function zoomTo(v: [number, number, number]) {
        const k = width / v[2];
        view = v;

        const node = d3.select(svg).select<SVGGElement>('g');
        node.attr("transform", `translate(${width/2},${height/2}) scale(${k}) translate(${-v[0]},${-v[1]})`);
    }

    function zoom(event: d3.D3ZoomEvent<SVGElement, unknown>, d: d3.HierarchyCircularNode<Holon>) {
        focus = d;

        const transition = d3.select(svg)
            .select('g')
            .transition()
            .duration(event.sourceEvent?.altKey ? 7500 : 750)
            .tween("zoom", () => {
                const i = d3.interpolateZoom(view, [focus.x, focus.y, focus.r * 2]);
                return (t: number) => {
                    zoomTo(i(t));
                    updateStatCirclesPosition();
                };
            });
    }

    function truncateText(text: string, maxLength: number): string {
        return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
    }

    function calculateTextParams(d: d3.HierarchyCircularNode<Holon>) {
        const depthScaling = Math.max(0.5, 1 - d.depth * 0.2);
        const textSize = Math.min(d.r / 5 * depthScaling, 12);
        const charLimit = Math.max(3, Math.floor(d.r * 3.0 / textSize));
        return { textSize, charLimit };
    }

    // Type-safe wrapper around zoomBehavior.transform
    function safeDSetTransform(selection: any, transform: any) {
        // This is a safer way to call the transform method
        if (selection && transform && zoomBehavior) {
            try {
                // Use as any to bypass type checking
                (selection as any).call(zoomBehavior.transform, transform);
            } catch (e) {
                console.error("Error applying zoom transform:", e);
            }
        }
    }

    function zoomToNode(d: d3.HierarchyCircularNode<Holon>) {
        const scale = Math.min(width, height) / (d.r * 2.2);
        const x = width / 2 - (d.x * scale);
        const y = height / 2 - (d.y * scale);

        safeDSetTransform(
            d3.select(svg).transition().duration(750),
            d3.zoomIdentity.translate(x, y).scale(scale)
        );
    }

    function updateVisualization(holonsData: HolonData, applyInitialZoom = false) {
        try {
            root = pack(holonsData);
            if (!focus) focus = root;
            
            const svg = d3.select('svg g');
            
            // Clear existing circles
            svg.selectAll('circle').remove();
            svg.selectAll('text').remove();

            // Add circles
            const node = svg
                .selectAll<SVGCircleElement, d3.HierarchyCircularNode<Holon>>('circle')
                .data(root.descendants())
                .join('circle')
                .each(function(d) {
                    // Custom positioning for single federated children
                    if (d.data.isFederated && d.parent && d.parent.children && d.parent.children.length === 1) {
                        // Position single federated child at bottom of parent
                        const parent = d.parent;
                        const angle = Math.PI / 2; // Bottom position (90 degrees)
                        const distance = parent.r - d.r - 5; // 5px gap
                        
                        d.x = parent.x + Math.cos(angle) * distance;
                        d.y = parent.y + Math.sin(angle) * distance;
                    }
                })
                .attr('fill', d => {
                    if (d.children) {
                        return color(d.depth);
                    } else {
                        return d.data.color || '#4B5563';
                    }
                })
                .attr('fill-opacity', 0.8)
                .attr('pointer-events', 'all')
                .attr('cx', d => d.x)
                .attr('cy', d => d.y)
                .attr('r', d => d.data.key === $ID ? d.r * 1.1 : d.r)
                .attr('stroke', d => {
                    if (d.data.key === $ID) return '#ffffff';
                    return '#ffffff';
                })
                .attr('stroke-width', d => {
                    if (d.data.key === $ID) return '2';
                    return '0.5';
                })
                .on('mouseover', function(this: SVGCircleElement) { 
                    const d = d3.select(this).datum() as d3.HierarchyCircularNode<Holon>;
                    if (d.data.key !== $ID) {
                        d3.select(this)
                            .attr('stroke-width', '1');
                    }
                    const text = svg.select(`text[data-key="${d.data.key}"]`);
                    text
                        .text(d.data.name)
                        .attr('fill', '#ffffff')
                        .style('text-shadow', '0 0 3px rgba(0,0,0,0.5)');
                })
                .on('mouseout', function(this: SVGCircleElement) { 
                    const d = d3.select(this).datum() as d3.HierarchyCircularNode<Holon>;
                    if (d.data.key !== $ID) {
                        d3.select(this)
                            .attr('stroke-width', '0.5');
                    }
                    const text = svg.select(`text[data-key="${d.data.key}"]`);
                    text
                        .attr('fill', 'white')
                        .style('text-shadow', 'none');
                    const { textSize, charLimit } = calculateTextParams(d);
                    text.text(truncateText(d.data.name, charLimit));
                })
                .on('click', (event: MouseEvent, d: d3.HierarchyCircularNode<Holon>) => handleHolonClick(d));

            // Add labels
            svg.selectAll<SVGTextElement, d3.HierarchyCircularNode<Holon>>('text')
                .data(root.descendants())
                .join('text')
                .attr('text-anchor', 'middle')
                .attr('data-key', d => d.data.key || '')
                .attr('dominant-baseline', 'middle')
                .attr('fill', 'white')
                .attr('pointer-events', 'none')
                .attr('x', d => d.x)
                .attr('y', d => d.y - d.r * 0.25) // Position text 1/4 up from center
                .style('font-family', 'system-ui, -apple-system, sans-serif')
                .style('font-weight', '500')
                .style('user-select', 'none')
                .each(function(d) {
                    const node = d3.select(this);
                    const { textSize, charLimit } = calculateTextParams(d);
                    node.style('font-size', `${textSize}px`);
                    node.text(truncateText(d.data.name, charLimit));
                });

            // Only apply initial zoom on first load or when explicitly requested
            if (applyInitialZoom && zoomBehavior) {
                const scale = width / (root.r * 2.2);
                const x = width / 2 - (root.x * scale);
                const y = height / 2 - (root.y * scale);
                
                try {
                    const svgNode = svg.node();
                    if (svgNode) {
                        const ownerSVG = (svgNode as SVGElement).ownerSVGElement;
                        if (ownerSVG) {
                            d3.select(ownerSVG)
                                .call(zoomBehavior.transform as any, 
                                    d3.zoomIdentity.translate(x, y).scale(scale));
                        } else {
                            d3.select('svg')
                                .call(zoomBehavior.transform as any, 
                                    d3.zoomIdentity.translate(x, y).scale(scale));
                        }
                    }
                } catch (e) {
                    console.error("Error applying initial transform:", e);
                }
            }
        } catch (error) {
            console.error("Error in updateVisualization:", error);
        }
    }

    function updateSelectedHolonText(text: string) {
        if (root) {
            const selectedNode = root.descendants().find(node => node.data.key === $ID);
            if (selectedNode) {
                const textElement = d3.select(svg).select(`text[data-key="${$ID}"]`);
                if (!textElement.empty()) {
                    textElement.text(text);
                }
            }
        }
    }

    function createStatCircles(holonNode: d3.HierarchyCircularNode<Holon>, stats: any) {
        // Remove existing stat circles and loading elements
        d3.select(svg).selectAll('.stat-circle').remove();
        d3.select(svg).selectAll('.stat-text').remove();
        
        if (!stats) return;
        
        const statData = [
            { key: 'users', value: stats.userCount, icon: '👥', color: '#3B82F6', lens: 'users' },
            { key: 'tasks', value: stats.actualTasks, icon: '📋', color: '#10B981', lens: 'tasks' },
            { key: 'shopping', value: stats.shoppingCount, icon: '🛒', color: '#8B5CF6', lens: 'shopping' },
            { key: 'offers', value: stats.offersCount, icon: '🤝', color: '#F59E0B', lens: 'offers' }
        ].filter(stat => stat.value > 0);
        
        if (statData.length === 0) return;
        
        const radius = 8;
        const spacing = 20;
        const totalWidth = (statData.length - 1) * spacing;
        const startX = holonNode.x - totalWidth / 2;
        const y = holonNode.y + holonNode.r + 15; // Position below the circle
        
        // Create stat circles with data attributes for positioning
        const statCircles = d3.select(svg).selectAll('.stat-circle')
            .data(statData)
            .join('circle')
            .attr('class', 'stat-circle')
            .attr('data-parent-x', holonNode.x)
            .attr('data-parent-y', holonNode.y)
            .attr('data-parent-r', holonNode.r)
            .attr('data-index', (d, i) => i)
            .attr('data-spacing', spacing)
            .attr('data-total-width', totalWidth)
            .attr('cx', (d, i) => startX + i * spacing)
            .attr('cy', y)
            .attr('r', radius)
            .attr('fill', d => d.color)
            .attr('stroke', '#ffffff')
            .attr('stroke-width', '1')
            .attr('cursor', 'pointer')
            .on('click', function(event, d) {
                event.stopPropagation();
                const holonId = $ID;
                if (holonId) {
                    // Navigate to the specific lens
                    goto(`/${holonId}/${d.lens}`);
                }
            })
            .on('mouseover', function() {
                d3.select(this)
                    .attr('stroke-width', '2')
                    .attr('r', radius + 2);
            })
            .on('mouseout', function() {
                d3.select(this)
                    .attr('stroke-width', '1')
                    .attr('r', radius);
            });
        
        // Create stat text labels with data attributes for positioning
        d3.select(svg).selectAll('.stat-text')
            .data(statData)
            .join('text')
            .attr('class', 'stat-text')
            .attr('data-parent-x', holonNode.x)
            .attr('data-parent-y', holonNode.y)
            .attr('data-parent-r', holonNode.r)
            .attr('data-index', (d, i) => i)
            .attr('data-spacing', spacing)
            .attr('data-total-width', totalWidth)
            .attr('x', (d, i) => startX + i * spacing)
            .attr('y', y + radius + 15)
            .attr('text-anchor', 'middle')
            .attr('fill', '#ffffff')
            .style('font-size', '10px')
            .style('font-weight', '500')
            .text(d => `${d.icon} ${d.value}`);
    }

    async function handleHolonClick(d: d3.HierarchyCircularNode<Holon>, event?: Event) {
        // Use proper event handling
        if (event) {
            event.stopPropagation();
        }
        focus = d;
        zoomToNode(d);
        
        // Load statistics for the selected holon
        const holonId = d.data.isFederated ? d.data.federatedFrom : d.data.key;
        if (holonId) {
            isLoadingStats = true;
            selectedHolonStats = null;
            
            // Clear any existing stat circles
            d3.select(svg).selectAll('.stat-circle').remove();
            d3.select(svg).selectAll('.stat-text').remove();
            
            // Show loading indicator
            const loadingCircle = d3.select(svg).append('circle')
                .attr('class', 'stat-circle loading')
                .attr('data-parent-x', d.x)
                .attr('data-parent-y', d.y)
                .attr('data-parent-r', d.r)
                .attr('data-index', 0)
                .attr('data-spacing', 0)
                .attr('data-total-width', 0)
                .attr('cx', d.x)
                .attr('cy', d.y + d.r + 15)
                .attr('r', 8)
                .attr('fill', '#6B7280')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', '1');
            
            const loadingText = d3.select(svg).append('text')
                .attr('class', 'stat-text loading')
                .attr('data-parent-x', d.x)
                .attr('data-parent-y', d.y)
                .attr('data-parent-r', d.r)
                .attr('data-index', 0)
                .attr('data-spacing', 0)
                .attr('data-total-width', 0)
                .attr('x', d.x)
                .attr('y', d.y + d.r + 30)
                .attr('text-anchor', 'middle')
                .attr('fill', '#ffffff')
                .style('font-size', '10px')
                .text('⏳ Loading...');
            
            try {
                const stats = await getStatsDirectly(holonId);
                selectedHolonStats = stats;
                
                // Create stat circles for the selected holon
                createStatCircles(d, stats);
            } catch (error) {
                console.error('Failed to load stats for selected holon:', error);
                selectedHolonStats = null;
            } finally {
                isLoadingStats = false;
            }
        }
        
        // If this is a federated holon, navigate to the original holon
        if (d.data.isFederated && d.data.federatedFrom) {
            ID.set(d.data.federatedFrom);
            dispatch('holonSelect', { key: d.data.federatedFrom, holon: d.data });
            
            // Track this click and visit (with or without wallet)
            const walletAddr = getWalletAddress();
            try {
                const holonName = await awaitName(d.data.federatedFrom);
                
                // Track as clicked holon (from navigator view)
                addClickedHolon(walletAddr, d.data.federatedFrom, holonName, 'navigator');
                
                // Also track as visited holon
                addVisitedHolon(walletAddr, d.data.federatedFrom, holonName, 'navigator');
                
                console.log(`Tracked federated holon click from navigator: ${d.data.federatedFrom}`);
            } catch (err) {
                console.warn('Failed to track federated holon click:', err);
            }
            
            // Navigate to the dashboard
            goto(`/${d.data.federatedFrom}/dashboard`);
        } else if (d.data.key) {
            // Switch to the clicked holon by updating the ID store
            ID.set(d.data.key);
            dispatch('holonSelect', { key: d.data.key, holon: d.data });
            
            // Track this click and visit (with or without wallet)
            const walletAddr = getWalletAddress();
            try {
                const holonName = await awaitName(d.data.key);
                
                // Track as clicked holon (from navigator view)
                addClickedHolon(walletAddr, d.data.key, holonName, 'navigator');
                
                // Also track as visited holon
                addVisitedHolon(walletAddr, d.data.key, holonName, 'navigator');
                
                console.log(`Tracked holon click from navigator: ${d.data.key}`);
            } catch (err) {
                console.warn('Failed to track holon click:', err);
            }
            
            // Navigate to the dashboard
            goto(`/${d.data.key}/dashboard`);
        }
    }

    // Debounced update function
    function debouncedUpdate(holonsData: HolonData, applyInitialZoom = false) {
        if (updateTimeout) {
            clearTimeout(updateTimeout);
        }
        
        pendingUpdate = true;
        updateTimeout = setTimeout(() => {
            if (pendingUpdate) {
                updateVisualization(holonsData, applyInitialZoom || !isInitialized);
                if (!isInitialized) {
                    isInitialized = true;
                }
                pendingUpdate = false;
            }
        }, 100); // 100ms debounce
    }


    // Direct holosphere access for faster stats computation
    async function getStatsDirectly(holonId: string) {
        return new Promise<{
            userCount: number;
            actualTasks: number;
            completedTasks: number;
            openTasks: number;
            shoppingCount: number;
            offersCount: number;
            needs: number;
        }>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Direct stats fetch timeout'));
            }, 8000); // Increased timeout for more reliable data

            try {
                // Try HoloSphere getAll first for accurate data
                const tryHoloSphereGetAll = async () => {
                    try {
                        const [users, quests, shopping, offers] = await Promise.allSettled([
                            holosphere.getAll(holonId, "users"),
                            holosphere.getAll(holonId, "quests"),
                            holosphere.getAll(holonId, "shopping"),
                            holosphere.getAll(holonId, "offers")
                        ]);
                        
                        // holosphere.getAll is guaranteed to resolve to Array<T>.
                        const userCount = (users.status === 'fulfilled' ? users.value : []).length;
                        const questsArray: any[] = quests.status === 'fulfilled' ? quests.value : [];
                        const shoppingCount = (shopping.status === 'fulfilled' ? shopping.value : []).length;
                        const offersCount = (offers.status === 'fulfilled' ? offers.value : []).length;
                        
                        // Process quests safely
                        const actualTasks = questsArray.filter((item: any) => item && (!item.type || item.type === "task"));
                        const completedTasks = actualTasks.filter((task: any) => task && task.status === "completed").length;
                        const openTasks = actualTasks.filter((task: any) => task && task.status !== "completed").length;
                        const needs = questsArray.filter((item: any) => item && (item.type === "need" || item.type === "want")).length;
                        
                        return {
                            userCount,
                            actualTasks: actualTasks.length,
                            completedTasks,
                            openTasks,
                            shoppingCount,
                            offersCount,
                            needs
                        };
                    } catch (error) {
                        throw new Error('HoloSphere getAll failed, falling back to direct access');
                    }
                };
                
                // Use HoloSphere API to get stats
                tryHoloSphereGetAll()
                    .then(stats => {
                        clearTimeout(timeout);
                        resolve(stats);
                    })
                    .catch((error) => {
                        // If HoloSphere fails, return empty stats
                        console.warn('Failed to fetch holon stats:', error);
                        clearTimeout(timeout);
                        resolve({
                            userCount: 0,
                            actualTasks: 0,
                            completedTasks: 0,
                            openTasks: 0,
                            shoppingCount: 0,
                            offersCount: 0,
                            needs: 0
                        });
                    });
                
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    // Async function to compute stats in parallel for all holons
    async function computeStatsForHolons(holonIds: string[]) {
        console.log(`Starting parallel stats computation for ${holonIds.length} holons in Navigator`);
        
        // Process all holons in parallel with concurrency limit
        const concurrencyLimit = 10; // Process 10 holons simultaneously
        let completedCount = 0;
        
        // Create all promises but limit concurrency
        const allPromises = holonIds.map(async (holonId, index) => {
            // Add a small delay based on index to stagger requests
            await new Promise(resolve => setTimeout(resolve, (index % concurrencyLimit) * 100));
            
            try {
                // Add timeout to prevent hanging
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), 8000)
                );
                
                const statsPromise = (async () => {
                    // Fetch stats using holosphere API
                    const stats = await getStatsDirectly(holonId);
                    return { holonId, stats };
                })();
                
                // Race between stats computation and timeout
                const result = await Promise.race([statsPromise, timeoutPromise]) as {
                    holonId: string;
                    stats: {
                        userCount: number;
                        actualTasks: number;
                        completedTasks: number;
                        openTasks: number;
                        shoppingCount: number;
                        offersCount: number;
                        needs: number;
                    };
                };
                
                // Update holon value based on stats (for visualization)
                const totalActivity = result.stats.userCount + result.stats.actualTasks + 
                                   result.stats.shoppingCount + result.stats.offersCount;
                
                // Find and update the holon in the map
                // Note: This would need to be integrated with the existing holonMap structure
                console.log(`✓ Updated stats for ${result.holonId}: ${result.stats.userCount} users, ${result.stats.actualTasks} tasks, ${result.stats.shoppingCount} shopping, ${result.stats.offersCount} offers (${completedCount}/${holonIds.length})`);
                
                completedCount++;
                return { ...result, totalActivity };
                
            } catch (error) {
                console.warn(`✗ Failed to compute stats for holon ${holonId}:`, error);
                completedCount++;
                return { holonId, error: (error as Error).message };
            }
        });
        
        // Wait for all promises to complete
        const results = await Promise.allSettled(allPromises);
        
        // Log summary
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        console.log(`Completed parallel stats computation in Navigator: ${successful} successful, ${failed} failed out of ${holonIds.length} total`);
        
        return results;
    }

    // Add reactive statement to handle ID changes - but don't re-zoom constantly
    let lastIDZoom = '';
    $: if ($ID && $ID !== lastIDZoom && root) {
        const holon = root.descendants().find(d => d.data.key === $ID);
        if (holon && focus !== holon) {
            focus = holon;
            zoomToNode(holon);
            lastIDZoom = $ID;
            
            // Clear stat circles when ID changes
            d3.select(svg).selectAll('.stat-circle').remove();
            d3.select(svg).selectAll('.stat-text').remove();
        }
    }
    


    // Store subscription functions directly
    let holonsSubscription: any;
    let settingsSubscriptions: Map<string, any> = new Map();
    
    // Statistics state
    let selectedHolonStats: {
        userCount: number;
        actualTasks: number;
        completedTasks: number;
        openTasks: number;
        shoppingCount: number;
        offersCount: number;
        needs: number;
    } | null = null;
    let isLoadingStats = false;
    
    // Create a function to clean up all subscriptions
    function cleanupSubscriptions() {
        console.log("Cleaning up Navigator subscriptions");
        
        // Clean up holons subscription
        if (holonsSubscription && typeof holonsSubscription.off === 'function') {
            try {
                holonsSubscription.off();
                holonsSubscription = null;
            } catch (e) {
                console.error("Error cleaning up holons subscription:", e);
            }
        }
        
        // Clean up settings subscriptions
        if (settingsSubscriptions.size > 0) {
            settingsSubscriptions.forEach((sub, key) => {
                if (sub && typeof sub.off === 'function') {
                    try {
                        sub.off();
                    } catch (e) {
                        console.error(`Error cleaning up settings subscription for ${key}:`, e);
                    }
                }
            });
            settingsSubscriptions.clear();
        }

        // Clear any pending timeouts
        if (updateTimeout) {
            clearTimeout(updateTimeout);
            updateTimeout = null;
        }
    }

    onMount(async () => {
        initializeZoom();
        if (holosphere) {
            // Start with clean subscriptions
            cleanupSubscriptions();
            
            // Create fresh data structures
            const holonsData: HolonData = { name: "", children: [] };
            const holonMap = new Map<string, Holon>();
            
            // Use holosphere API to discover holons
            console.log("Fetching all holons for Navigator...");

            // Create a set to collect all unique holon IDs
            const holonIds = new Set<string>();

            try {
                const registry = await holosphere.getAllGlobal('holons_registry');
                if (registry && typeof registry === 'object') {
                    Object.keys(registry).forEach(key => {
                        if (key && !key.startsWith('_')) {
                            holonIds.add(key);
                        }
                    });
                }

                // Legacy fallback for installs that still have data in the
                // `communities` global table (no current code writes to it).
                const communities = await holosphere.getAllGlobal('communities');
                if (communities && typeof communities === 'object') {
                    Object.keys(communities).forEach(key => {
                        if (key && !key.startsWith('_')) {
                            holonIds.add(key);
                        }
                    });
                }
            } catch (error) {
                console.warn('Error fetching holons registry:', error);
            }

            console.log(`Navigator collection complete. Found ${holonIds.size} potential holons.`);
            
            // Add current holon if not already included
            if ($ID && !holonIds.has($ID)) {
                holonIds.add($ID);
            }
            
            // Filter out invalid IDs - same filtering as GlobalHolons
            const validHolonIds = Array.from(holonIds).filter(id => {
                if (!id || typeof id !== 'string') return false;
                const trimmed = id.trim();
                
                // Skip empty, undefined, or malformed IDs
                if (trimmed === '' || trimmed === 'undefined' || trimmed === '-' || trimmed.includes('\n')) return false;
                
                // Skip known metadata/system entries (exact matches only)
                const systemEntries = [
                    'federation', 'federationMeta', 'federation_messages', 'fedInfo2',
                    'chats', 'checklists', 'expenses', 'quests', 'shopping', 'users', 'roles',
                    'announcements', 'recurring', 'recurringlookup', 'reminders', 'reminderslookup',
                    'settings', 'tags', 'user_private_quest_messages', 'hubs', 'library',
                    'quest', 'Holons', '/federate'
                ];
                if (systemEntries.includes(trimmed)) return false;
                
                // Skip shopping items and other path-like entries
                if (trimmed.includes('/')) return false;
                
                // Skip very long hex-like strings that are clearly Gun internal IDs (more than 15 chars)
                if (trimmed.length > 15 && /^[0-9a-f]+$/i.test(trimmed)) return false;
                
                // Skip Gun-specific hex patterns but be more specific
                if (trimmed.match(/^8[0-9a-f]{15,}$/i)) return false;
                
                return true; // Keep everything else for now
            });
            
            console.log(`Navigator found ${validHolonIds.length} valid holons after filtering`);
            
            // Phase 1: Create basic holon entries immediately
            console.log(`Creating basic holon entries for Navigator...`);
            
            // Create basic holon entries with default values
            const basicHolons = validHolonIds.map(holonId => ({
                key: holonId,
                name: holonId, // Will be updated with real name later
                value: 30, // Default size
                color: '#4B5563',
                description: '',
                children: [],
                parent: undefined,
                isFederated: false
            }));
            
            // Add basic holons to map
            basicHolons.forEach(holon => {
                holonMap.set(holon.key, holon);
            });
            
            // Show initial visualization with basic data
            holonsData.children = Array.from(holonMap.values());
            debouncedUpdate(holonsData, true); // Apply initial zoom
            
            // Phase 2: Fetch all holon names in parallel
            console.log(`Fetching names for all ${validHolonIds.length} holons in Navigator...`);
            
            const namePromises = validHolonIds.map(async (holonId) => {
                try {
                    const settingsResult = await holosphere.get(holonId, "settings", holonId);
                    const settings = settingsResult;
                    const holonName = settings?.name || holonId;
                    return { holonId, name: holonName };
                } catch (error) {
                    console.warn(`Failed to fetch name for holon ${holonId}:`, error);
                    return { holonId, name: holonId }; // Fallback to ID
                }
            });
            
            // Wait for all names to be fetched
            const nameResults = await Promise.all(namePromises);
            
            // Update all holons with their names
            nameResults.forEach(({ holonId, name }) => {
                const holon = holonMap.get(holonId);
                if (holon) {
                    holon.name = name;
                }
            });
            
            // Update visualization with names
            holonsData.children = Array.from(holonMap.values());
            debouncedUpdate(holonsData);
            
            console.log(`Updated all ${holonMap.size} holons with names in Navigator`);
            
            // Phase 3: Fetch federation data in parallel
            console.log(`Fetching federation data for all holons in Navigator...`);
            
            const federationPromises = validHolonIds.map(async (holonId) => {
                try {
                    const federationInfo = await holosphere.getFederation(holonId);
                    return { holonId, federationInfo };
                } catch (error) {
                    console.warn(`Failed to fetch federation for holon ${holonId}:`, error);
                    return { holonId, federationInfo: null };
                }
            });
            
            const federationResults = await Promise.all(federationPromises);
            
            // Process federation results and add federated children
            for (const { holonId, federationInfo } of federationResults) {
                const holon = holonMap.get(holonId);
                if (holon && federationInfo && federationInfo.inbound) {
                    // Ensure children array exists
                    if (!holon.children) {
                        holon.children = [];
                    }

                    // Add federated holons as children (from inbound - holons we receive from)
                    for (const federatedHolonId of federationInfo.inbound) {
                        if (federatedHolonId && federatedHolonId !== holonId) {
                            // Create a federated child holon
                            const federatedChildKey = `${holonId}_fed_${federatedHolonId}`;
                            
                            // Get the name of the federated holon
                            let federatedHolonName = federatedHolonId;
                            try {
                                const federatedSettingsResult = await holosphere.get(federatedHolonId, 'settings', federatedHolonId);
                                const federatedSettings = federatedSettingsResult;
                                if (federatedSettings && federatedSettings.name) {
                                    federatedHolonName = federatedSettings.name;
                                }
                            } catch (e) {
                                console.warn(`Could not fetch name for federated holon ${federatedHolonId}:`, e);
                            }
                            
                            const federatedChild: Holon = {
                                key: federatedChildKey,
                                name: `🔗 ${federatedHolonName}`,
                                value: 15, // Smaller value for federated children
                                color: '#3B82F6', // Blue color for federated holons
                                description: `Federated from ${federatedHolonId}`,
                                children: [],
                                parent: holonId,
                                isFederated: true,
                                federatedFrom: federatedHolonId
                            };
                            
                            // Add to the parent's children if not already there
                            if (!holon.children.find(child => child.key === federatedChildKey)) {
                                holon.children.push(federatedChild);
                            }
                        }
                    }
                }
            }
            
            // Rebuild the tree structure with federation data
            holonsData.children = Array.from(holonMap.values())
                .filter(holon => !holon.parent);
            
            // Assign parent-child relationships (non-federated)
            holonMap.forEach((holon) => {
                if (holon.parent && !holon.isFederated && holonMap.has(holon.parent)) {
                    const parentHolon = holonMap.get(holon.parent);
                    if (parentHolon) {
                        parentHolon.children = parentHolon.children || [];
                        if (!parentHolon.children.find(child => child.key === holon.key)) {
                            parentHolon.children.push(holon);
                        }
                    }
                }
            });
            
            // Update visualization with federation data
            debouncedUpdate(holonsData);
            
            console.log(`Updated Navigator with federation data`);
            
            // Phase 4: Compute stats in parallel (optional - for better visualization)
            console.log(`Starting parallel stats computation for Navigator...`);
            
            // Start stats computation without blocking the UI
            computeStatsForHolons(validHolonIds).then((results) => {
                // Update holon values based on computed stats
                results.forEach((result) => {
                    if (result.status === 'fulfilled' && result.value && 'stats' in result.value) {
                        const { holonId, stats, totalActivity } = result.value as {
                            holonId: string;
                            stats: {
                                userCount: number;
                                actualTasks: number;
                                completedTasks: number;
                                openTasks: number;
                                shoppingCount: number;
                                offersCount: number;
                                needs: number;
                            };
                            totalActivity: number;
                        };
                        const holon = holonMap.get(holonId);
                        if (holon) {
                            // Update the holon's value for visualization
                            holon.value = Math.max(30, totalActivity); // Minimum size of 30
                            
                            // Rebuild and update visualization
                            holonsData.children = Array.from(holonMap.values())
                                .filter(holon => !holon.parent);
                            
                            // Reassign parent-child relationships
                            holonMap.forEach((holon) => {
                                if (holon.parent && !holon.isFederated && holonMap.has(holon.parent)) {
                                    const parentHolon = holonMap.get(holon.parent);
                                    if (parentHolon) {
                                        parentHolon.children = parentHolon.children || [];
                                        if (!parentHolon.children.find(child => child.key === holon.key)) {
                                            parentHolon.children.push(holon);
                                        }
                                    }
                                }
                            });

                            // Update visualization with new stats
                            debouncedUpdate(holonsData);
                        }
                        }
                    });
            });
        }
    });

    // Add onDestroy to clean up all subscriptions and D3 resources
    onDestroy(() => {
        // Clean up Gun subscriptions
        cleanupSubscriptions();
        
        // Clean up D3 resources
        if (svg) {
            try {
                // Remove event listeners
                d3.select(svg)
                    .on('touchstart', null)
                    .on('touchmove', null);
                
                // Clean up zoom behavior - check if it exists first
                if (typeof zoomBehavior !== 'undefined') {
                    try {
                        // Remove zoom listeners
                        d3.select(svg).on('.zoom', null);
                    } catch (e) {
                        console.error("Error removing zoom listeners:", e);
                    }
                }
                
                // Clear all SVG elements
                d3.select(svg).selectAll('*').remove();
                
                console.log('D3 resources cleaned up');
            } catch (e) {
                console.error('Error cleaning up D3 resources:', e);
            }
        }
    });
</script>

<div 
    class="w-full h-full relative overflow-hidden bg-gray-900 rounded-lg"
    bind:this={viewContainer}
    bind:clientWidth={width}
    bind:clientHeight={height}
>
    <svg 
        bind:this={svg}
        viewBox="0 0 {width} {height}"
        class="w-full h-full"
        style="cursor: pointer; touch-action: none;"
    >
        <g />
    </svg>
    

</div>

<style>
</style> 