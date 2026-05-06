<script lang="ts">
    import { onMount } from 'svelte';
    import * as d3 from 'd3';

    export let proposals: Array<{
        id: string;
        title: string;
        description: string;
        participants: string[];
        stoppers?: string[];
        creator: string;
    }>;
    export let quorum: number = 5; // Default quorum value, can be overridden
    
    let chart: HTMLDivElement;
    let width = 0;
    let height = 300;
    const margin = { top: 20, right: 10, bottom: 30, left: 350 }; // Increased left margin

    let selectedProposal: typeof proposals[0] | null = null;
    let showModal = false;

    $: if (chart) {
        renderChart();
    }

    $: if (proposals) {
        renderChart();
    }

    // New reactive statement to calculate bar height
    $: barHeight = Math.max(300, proposals.length * 50);

    function handleBarClick(proposal: typeof proposals[0]) {
        selectedProposal = proposal;
        showModal = true;
    }

    function wrapText(selection: d3.Selection<any, unknown, SVGGElement, unknown>, width: number) {
        selection.each(function() {
            const text = d3.select(this);
            const words = text.text().split(/\s+/).reverse();
            const lineHeight = 1.1; // ems
            const y = text.attr("y");
            const dy = parseFloat(text.attr("dy") || "0");
            
            let word: string | undefined;
            let line: string[] = [];
            let lineNumber = 0;
            let tspan = text.text(null).append("tspan")
                .attr("x", -5)
                .attr("y", y)
                .attr("dy", dy + "em");
            
            while ((word = words.pop()) && lineNumber < 2) {
                line.push(word);
                tspan.text(line.join(" "));
                if (tspan.node()!.getComputedTextLength() > width) {
                    line.pop();
                    tspan.text(line.join(" "));
                    line = [word];
                    lineNumber++;
                    if (lineNumber < 2) {
                        tspan = text.append("tspan")
                            .attr("x", -5)
                            .attr("y", y)
                            .attr("dy", `${lineNumber * lineHeight + dy}em`)
                            .text(word);
                    }
                }
            }

            if (words.length > 0) {
                tspan.text(tspan.text() + "...");
            }
        });
    }

    function renderChart() {
        if (!chart || !proposals) return;

        // Sort proposals by number of approvals (participants)
        const sortedProposals = [...proposals].sort((a, b) => (b.participants || []).length - (a.participants || []).length);

        // Clear previous chart
        d3.select(chart).selectAll("*").remove();

        // Update width based on container
        width = chart.clientWidth;

        const svg = d3.select(chart)
            .append("svg")
            .attr("width", width)
            .attr("height", height)
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;

        // Create scales - note the flipped scales for horizontal bars
        const y = d3.scaleBand()
            .domain(sortedProposals.map(d => d.title))
            .range([0, innerHeight])
            .padding(0.2);

        const x = d3.scaleLinear()
            .domain([0, Math.max(d3.max(sortedProposals, d => (d.participants || []).length) || 0, quorum * 2)])
            .range([0, innerWidth]);

        // Add bars - now horizontal
        svg.selectAll(".bar")
            .data(sortedProposals)
            .join("rect")
            .attr("class", "bar")
            .attr("y", d => y(d.title) || 0)
            .attr("x", 0)
            .attr("height", y.bandwidth())
            .attr("width", d => x((d.participants || []).length))
            .attr("fill", d => d.stoppers?.length ? "#ef4444" : "#4f46e5") // Red if blocked, indigo otherwise
            .attr("rx", 4) // Rounded corners
            .attr("ry", 4)
            .style("cursor", "pointer")
            .on("click", (event, d) => handleBarClick(d));

        // Add quorum line - now vertical
        svg.append("line")
            .attr("x1", x(quorum))
            .attr("x2", x(quorum))
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .attr("stroke", "#10b981") // Green color
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "4");

        // Add quorum label - repositioned for vertical line
        svg.append("text")
            .attr("x", x(quorum))
            .attr("y", -5)
            .attr("text-anchor", "middle")
            .attr("fill", "#10b981")
            .attr("font-size", "12px")
            .text("Quorum");

        // Add axes - note the switched positions
        const xAxis = d3.axisBottom(x)
            .ticks(5)
            .tickSize(-innerHeight);

        const yAxis = d3.axisLeft(y)
            .tickSize(0);

        // Add x-axis
        svg.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(xAxis)
            .selectAll("text")
            .attr("fill", "#9ca3af");

        // Add y-axis with clickable labels
        const yAxisGroup = svg.append("g")
            .attr("class", "y-axis")
            .call(yAxis);

        // Style y-axis text and make it clickable
        yAxisGroup.selectAll(".tick text")
            .attr("fill", "#9ca3af")
            .style("cursor", "pointer")
            .style("font-size", "0.85em") // Slightly smaller font
            .call(wrapText, margin.left - 10) // Tighter text wrapping
            .on("click", (event, d) => {
                const proposal = sortedProposals.find(p => p.title === d);
                if (proposal) handleBarClick(proposal);
            });

        // Style axes
        svg.selectAll(".x-axis line")
            .attr("stroke", "#374151")
            .attr("stroke-dasharray", "2");

        svg.selectAll(".x-axis path")
            .attr("stroke", "none");

        svg.selectAll(".y-axis path")
            .attr("stroke", "none");

        // Add clickable background for y-axis labels
        yAxisGroup.selectAll(".tick")
            .insert("rect", "text")
            .attr("x", -margin.left)
            .attr("y", -y.bandwidth() / 2)
            .attr("width", margin.left - 5)
            .attr("height", y.bandwidth())
            .attr("fill", "transparent")
            .style("cursor", "pointer")
            .on("click", (event, d) => {
                const proposal = sortedProposals.find(p => p.title === d);
                if (proposal) handleBarClick(proposal);
            });
    }
</script>

<div 
    bind:this={chart} 
    class="w-full h-[{barHeight}px] bg-gray-800 rounded-lg p-1 overflow-y-auto"
>
</div>

{#if showModal && selectedProposal}
    <dialog
        class="fixed inset-0 bg-black bg-opacity-50 z-50"
        open
    >
        <div class="fixed inset-0 flex items-center justify-center">
            <div class="bg-gray-800 p-6 rounded-lg shadow-lg w-[600px] max-h-[80vh] overflow-y-auto">
                <div class="relative">
                    <div 
                        class="absolute -top-2 -right-2 text-gray-400 hover:text-white cursor-pointer"
                        on:click={() => showModal = false}
                        on:keydown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                showModal = false;
                            }
                        }}
                        role="button"
                        tabindex="0"
                        aria-label="Close modal"
                    >
                        <svg
                            class="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </div>
                    <h3 class="text-white text-xl font-bold mb-4">{selectedProposal.title}</h3>
                </div>
                
                <div class="space-y-6">
                    <div>
                        <p class="text-gray-300 mb-2">{selectedProposal.description}</p>
                        <p class="text-sm text-gray-400">Created by {selectedProposal.creator}</p>
                    </div>

                    <div class="space-y-4">
                        <div>
                            <h4 class="text-white font-semibold mb-2">Participants ({(selectedProposal.participants || []).length})</h4>
                            <div class="flex flex-wrap gap-2">
                                {#each selectedProposal.participants || [] as participant}
                                    <span class="px-2 py-1 bg-green-600 text-white text-sm rounded-full">
                                        {participant}
                                    </span>
                                {/each}
                            </div>
                        </div>

                        {#if selectedProposal.stoppers?.length}
                            <div>
                                <h4 class="text-white font-semibold mb-2">Blockers ({selectedProposal.stoppers.length})</h4>
                                <div class="flex flex-wrap gap-2">
                                    {#each selectedProposal.stoppers as stopper}
                                        <span class="px-2 py-1 bg-red-600 text-white text-sm rounded-full">
                                            {stopper}
                                        </span>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </dialog>
{/if}

<style>
    .bar {
        transition: opacity 0.2s;
    }
    
    .bar:hover {
        opacity: 0.8;
    }
</style> 