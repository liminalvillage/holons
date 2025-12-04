<script lang="ts">
    import { onMount, onDestroy } from 'svelte';
    import * as d3 from 'd3';

    interface UserData {
        id: string;
        name: string;
        score: number;
        percentage: number;
        color: string;
        breakdown: {
            initiated: number;
            completed: number;
            sent: number;
            received: number;
            hours: number;
            collaboration: number;
            wants: number;
            offers: number;
            currencies: Record<string, number>;
        };
        avatarUrl?: string;
    }

    export let users: UserData[] = [];

    let chartContainer: HTMLDivElement;
    let tooltip: HTMLDivElement;
    let width = 600;
    let height = 400;
    const depth = 30; // 3D depth
    const innerRadiusRatio = 0.3; // Donut hole ratio

    // Beautiful color palette
    const colorPalette = [
        '#3B82F6', // Blue
        '#8B5CF6', // Purple
        '#EC4899', // Pink
        '#F59E0B', // Amber
        '#10B981', // Emerald
        '#06B6D4', // Cyan
        '#EF4444', // Red
        '#84CC16', // Lime
        '#F97316', // Orange
        '#6366F1', // Indigo
        '#14B8A6', // Teal
        '#A855F7', // Violet
    ];

    $: processedUsers = users.map((user, i) => ({
        ...user,
        color: user.color || colorPalette[i % colorPalette.length]
    }));

    $: if (chartContainer && processedUsers.length > 0) {
        renderChart();
    }

    function darkenColor(color: string, amount: number): string {
        const d3Color = d3.color(color);
        if (d3Color) {
            return d3.rgb(d3Color).darker(amount).toString();
        }
        return color;
    }

    function lightenColor(color: string, amount: number): string {
        const d3Color = d3.color(color);
        if (d3Color) {
            return d3.rgb(d3Color).brighter(amount).toString();
        }
        return color;
    }

    function renderChart() {
        if (!chartContainer || processedUsers.length === 0) return;

        // Clear previous chart
        d3.select(chartContainer).selectAll("svg").remove();

        // Get container dimensions
        const containerRect = chartContainer.getBoundingClientRect();
        width = Math.max(containerRect.width, 400);
        height = 400;

        const centerX = width / 2;
        const centerY = height / 2 - depth / 2;
        const outerRadius = Math.min(width, height) / 2 - 60;
        const innerRadius = outerRadius * innerRadiusRatio;

        const svg = d3.select(chartContainer)
            .append("svg")
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .style("overflow", "visible");

        // Create pie layout
        const pie = d3.pie<UserData>()
            .value(d => d.percentage)
            .sort(null)
            .padAngle(0.02);

        const pieData = pie(processedUsers);

        // Create arc generators
        const arc = d3.arc<d3.PieArcDatum<UserData>>()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius);

        // Create group for the chart
        const chartGroup = svg.append("g")
            .attr("transform", `translate(${centerX}, ${centerY})`);

        // Create defs for gradients
        const defs = svg.append("defs");

        // Add drop shadow filter
        const filter = defs.append("filter")
            .attr("id", "dropshadow")
            .attr("height", "130%");

        filter.append("feGaussianBlur")
            .attr("in", "SourceAlpha")
            .attr("stdDeviation", 3);

        filter.append("feOffset")
            .attr("dx", 2)
            .attr("dy", 4)
            .attr("result", "offsetblur");

        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode")
            .attr("in", "offsetblur");
        feMerge.append("feMergeNode")
            .attr("in", "SourceGraphic");

        // Create gradients for each slice
        processedUsers.forEach((user, i) => {
            const gradient = defs.append("linearGradient")
                .attr("id", `gradient-${i}`)
                .attr("x1", "0%")
                .attr("y1", "0%")
                .attr("x2", "100%")
                .attr("y2", "100%");

            gradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", lightenColor(user.color, 0.3));

            gradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", user.color);
        });

        // Draw 3D sides (depth effect)
        const sidesGroup = chartGroup.append("g").attr("class", "sides");

        pieData.forEach((d, i) => {
            // Only draw sides for visible portions
            const startAngle = d.startAngle - Math.PI / 2;
            const endAngle = d.endAngle - Math.PI / 2;

            // Draw outer curved side
            const outerSide = sidesGroup.append("path")
                .attr("d", () => {
                    const steps = 30;
                    const angleStep = (endAngle - startAngle) / steps;
                    let path = "";

                    for (let j = 0; j <= steps; j++) {
                        const angle = startAngle + j * angleStep;
                        const x = outerRadius * Math.cos(angle);
                        const y = outerRadius * Math.sin(angle);

                        if (j === 0) {
                            path += `M ${x} ${y}`;
                        } else {
                            path += ` L ${x} ${y}`;
                        }
                    }

                    // Move down for depth
                    for (let j = steps; j >= 0; j--) {
                        const angle = startAngle + j * angleStep;
                        const x = outerRadius * Math.cos(angle);
                        const y = outerRadius * Math.sin(angle) + depth;
                        path += ` L ${x} ${y}`;
                    }

                    path += " Z";
                    return path;
                })
                .attr("fill", darkenColor(d.data.color, 0.8))
                .attr("stroke", darkenColor(d.data.color, 1.2))
                .attr("stroke-width", 0.5);

            // Draw inner curved side (for donut)
            if (innerRadius > 0) {
                sidesGroup.append("path")
                    .attr("d", () => {
                        const steps = 30;
                        const angleStep = (endAngle - startAngle) / steps;
                        let path = "";

                        for (let j = 0; j <= steps; j++) {
                            const angle = startAngle + j * angleStep;
                            const x = innerRadius * Math.cos(angle);
                            const y = innerRadius * Math.sin(angle);

                            if (j === 0) {
                                path += `M ${x} ${y}`;
                            } else {
                                path += ` L ${x} ${y}`;
                            }
                        }

                        for (let j = steps; j >= 0; j--) {
                            const angle = startAngle + j * angleStep;
                            const x = innerRadius * Math.cos(angle);
                            const y = innerRadius * Math.sin(angle) + depth;
                            path += ` L ${x} ${y}`;
                        }

                        path += " Z";
                        return path;
                    })
                    .attr("fill", darkenColor(d.data.color, 0.5))
                    .attr("stroke", darkenColor(d.data.color, 0.8))
                    .attr("stroke-width", 0.5);
            }
        });

        // Draw bottom ring for depth
        const bottomGroup = chartGroup.append("g")
            .attr("transform", `translate(0, ${depth})`);

        bottomGroup.selectAll(".bottom-slice")
            .data(pieData)
            .join("path")
            .attr("class", "bottom-slice")
            .attr("d", arc)
            .attr("fill", d => darkenColor(d.data.color, 1))
            .attr("stroke", d => darkenColor(d.data.color, 1.5))
            .attr("stroke-width", 1);

        // Draw top slices with gradient
        const topGroup = chartGroup.append("g").attr("class", "top-slices");

        topGroup.selectAll(".slice")
            .data(pieData)
            .join("path")
            .attr("class", "slice")
            .attr("d", arc)
            .attr("fill", (d, i) => `url(#gradient-${i})`)
            .attr("stroke", d => darkenColor(d.data.color, 0.3))
            .attr("stroke-width", 2)
            .style("filter", "url(#dropshadow)")
            .style("cursor", "pointer")
            .on("mouseenter", function(event, d) {
                // Highlight effect
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr("transform", () => {
                        const [x, y] = arc.centroid(d);
                        const angle = Math.atan2(y, x);
                        const offsetX = Math.cos(angle) * 10;
                        const offsetY = Math.sin(angle) * 10;
                        return `translate(${offsetX}, ${offsetY})`;
                    });

                showTooltip(event, d.data);
            })
            .on("mousemove", (event, d) => {
                moveTooltip(event);
            })
            .on("mouseleave", function(event, d) {
                d3.select(this)
                    .transition()
                    .duration(200)
                    .attr("transform", "translate(0, 0)");

                hideTooltip();
            });

        // Add percentage labels on slices
        topGroup.selectAll(".slice-label")
            .data(pieData.filter(d => d.data.percentage >= 5)) // Only show labels for slices >= 5%
            .join("text")
            .attr("class", "slice-label")
            .attr("transform", d => {
                const [x, y] = arc.centroid(d);
                return `translate(${x}, ${y})`;
            })
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("fill", "white")
            .attr("font-size", "14px")
            .attr("font-weight", "bold")
            .style("text-shadow", "0 1px 3px rgba(0,0,0,0.5)")
            .style("pointer-events", "none")
            .text(d => `${d.data.percentage.toFixed(1)}%`);

        // Add center text
        const centerGroup = chartGroup.append("g").attr("class", "center-text");

        centerGroup.append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("y", -10)
            .attr("fill", "white")
            .attr("font-size", "24px")
            .attr("font-weight", "bold")
            .text(processedUsers.length);

        centerGroup.append("text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("y", 15)
            .attr("fill", "#9CA3AF")
            .attr("font-size", "12px")
            .text("Users");
    }

    function showTooltip(event: MouseEvent, user: UserData) {
        if (!tooltip) return;

        tooltip.innerHTML = `
            <div class="p-4 bg-gray-800 rounded-xl shadow-2xl border border-gray-600 min-w-[280px]">
                <div class="flex items-center gap-3 mb-3 pb-3 border-b border-gray-600">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                         style="background: ${user.color}">
                        ${user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div class="font-bold text-white text-lg">${user.name}</div>
                        <div class="text-gray-400 text-sm">Score: ${user.score.toFixed(1)}</div>
                    </div>
                </div>

                <div class="mb-3">
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-gray-300">Share</span>
                        <span class="text-2xl font-bold" style="color: ${user.color}">${user.percentage.toFixed(2)}%</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="h-2 rounded-full" style="width: ${user.percentage}%; background: ${user.color}"></div>
                    </div>
                </div>

                <div class="space-y-2 text-sm">
                    <div class="text-gray-400 font-semibold mb-2">Breakdown:</div>
                    ${user.breakdown.initiated > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Tasks Initiated</span>
                            <span class="text-blue-400">${user.breakdown.initiated}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.completed > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Tasks Completed</span>
                            <span class="text-green-400">${user.breakdown.completed}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.sent > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Appreciation Sent</span>
                            <span class="text-purple-400">${user.breakdown.sent}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.received > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Appreciation Received</span>
                            <span class="text-orange-400">${user.breakdown.received}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.hours > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Hours</span>
                            <span class="text-yellow-400">${user.breakdown.hours}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.collaboration > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Collaboration</span>
                            <span class="text-teal-400">${user.breakdown.collaboration}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.wants > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Wants</span>
                            <span class="text-pink-400">${user.breakdown.wants}</span>
                        </div>
                    ` : ''}
                    ${user.breakdown.offers > 0 ? `
                        <div class="flex justify-between">
                            <span class="text-gray-400">Offers</span>
                            <span class="text-indigo-400">${user.breakdown.offers}</span>
                        </div>
                    ` : ''}
                    ${Object.entries(user.breakdown.currencies || {}).filter(([_, v]) => v !== 0).map(([currency, value]) => `
                        <div class="flex justify-between">
                            <span class="text-gray-400">${currency.toUpperCase()}</span>
                            <span class="${value > 0 ? 'text-emerald-400' : 'text-red-400'}">${value.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        tooltip.style.opacity = '1';
        tooltip.style.visibility = 'visible';
        moveTooltip(event);
    }

    function moveTooltip(event: MouseEvent) {
        if (!tooltip) return;

        const padding = 15;
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = event.clientX + padding;
        let top = event.clientY + padding;

        // Adjust if tooltip goes off screen
        if (left + tooltipRect.width > viewportWidth) {
            left = event.clientX - tooltipRect.width - padding;
        }
        if (top + tooltipRect.height > viewportHeight) {
            top = event.clientY - tooltipRect.height - padding;
        }

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function hideTooltip() {
        if (!tooltip) return;
        tooltip.style.opacity = '0';
        tooltip.style.visibility = 'hidden';
    }

    // Handle resize
    let resizeObserver: ResizeObserver;

    onMount(() => {
        if (chartContainer) {
            resizeObserver = new ResizeObserver(() => {
                renderChart();
            });
            resizeObserver.observe(chartContainer);
        }
    });

    onDestroy(() => {
        if (resizeObserver) {
            resizeObserver.disconnect();
        }
    });
</script>

<div class="relative w-full">
    <div
        bind:this={chartContainer}
        class="w-full min-h-[400px] flex items-center justify-center"
    ></div>

    <!-- Tooltip -->
    <div
        bind:this={tooltip}
        class="fixed z-50 pointer-events-none transition-opacity duration-200"
        style="opacity: 0; visibility: hidden;"
    ></div>
</div>

<!-- Legend -->
{#if processedUsers.length > 0}
    <div class="mt-6 flex flex-wrap justify-center gap-3">
        {#each processedUsers as user}
            <div class="flex items-center gap-2 px-3 py-2 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors">
                <div
                    class="w-4 h-4 rounded-full flex-shrink-0"
                    style="background: {user.color}"
                ></div>
                <span class="text-sm text-white font-medium">{user.name}</span>
                <span class="text-xs text-gray-400">({user.percentage.toFixed(1)}%)</span>
            </div>
        {/each}
    </div>
{/if}

<style>
    :global(.slice) {
        transition: transform 0.2s ease-out;
    }
</style>
