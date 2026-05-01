<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { phase } from 'lune';
    import type { ExternalCalendarEvent } from '../lib/services/icalParser';

    // Type definitions
    interface Profile {
        arrival?: string;
        departure?: string;
        [key: string]: any;
    }

    interface User {
        name?: string;
        [key: string]: any;
    }

    const dispatch = createEventDispatcher();

    // Add the getUserColor function
    function getUserColor(userId: string): string {
        // Generate a hash from the userId
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = userId.charCodeAt(i) + ((hash << 5) - hash);
        }
        // Convert to HSL color with fixed saturation and lightness
        const hue = hash % 360;
        return `hsl(${hue}, 70%, 60%)`;
    }

    // Props
    export let currentDate: Date;
    export let profiles: Record<string, Profile> = {};
    export let users: Record<string, User> = {};
    export let tasks: Record<string, any> = {};
    export let externalEvents: ExternalCalendarEvent[] = [];

    // Layout constants — keep in sync with the {#each} square-stacking styles below.
    const MIN_HEIGHT_PX = 128; // matches the original h-32
    const TASK_ROW_PX = 10;
    const EXTERNAL_ROW_PX = 10;

    // Group external events by day for the current year.
    type ExternalDay = { date: Date; items: Array<{ id: string; event: ExternalCalendarEvent }> };
    $: externalByDay = (() => {
        const year = currentDate.getFullYear();
        const yearStart = new Date(year, 0, 1).getTime();
        const yearEnd = new Date(year + 1, 0, 1).getTime();
        const groups = new Map<string, ExternalDay>();
        for (const ev of externalEvents) {
            const start = new Date(ev.start);
            const t = start.getTime();
            if (isNaN(t) || t < yearStart || t >= yearEnd) continue;
            const dayKey = start.toDateString();
            let group = groups.get(dayKey);
            if (!group) {
                const anchor = new Date(start);
                anchor.setHours(0, 0, 0, 0);
                group = { date: anchor, items: [] };
                groups.set(dayKey, group);
            }
            group.items.push({ id: ev.id, event: ev });
        }
        for (const group of groups.values()) {
            group.items.sort((a, b) => new Date(a.event.start).getTime() - new Date(b.event.start).getTime());
        }
        return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    })();

    // Group tasks by day for the current year.
    // Returns an array of { date, items: [{key, task, ...}] } per day that has tasks.
    type TaskDay = { date: Date; items: Array<{ key: string; task: any; status: 'completed' | 'ongoing-future' | 'ongoing-past' }> };
    $: tasksByDay = (() => {
        const year = currentDate.getFullYear();
        const yearStart = new Date(year, 0, 1).getTime();
        const yearEnd = new Date(year + 1, 0, 1).getTime();
        const now = Date.now();
        const groups = new Map<string, TaskDay>();
        for (const [key, task] of Object.entries(tasks)) {
            if (!task?.when) continue;
            const when = new Date(task.when);
            const t = when.getTime();
            if (isNaN(t) || t < yearStart || t >= yearEnd) continue;
            const dayKey = when.toDateString();
            let group = groups.get(dayKey);
            if (!group) {
                // Anchor each group to the start of the day for positioning.
                const anchor = new Date(when);
                anchor.setHours(0, 0, 0, 0);
                group = { date: anchor, items: [] };
                groups.set(dayKey, group);
            }
            const status: TaskDay['items'][number]['status'] =
                (task._instanceCompleted === true || task.status === 'completed')
                    ? 'completed'
                    : t < now
                        ? 'ongoing-past'
                        : 'ongoing-future';
            group.items.push({ key, task, status });
        }
        // Sort items within a day by start time so the stacking order is stable.
        for (const group of groups.values()) {
            group.items.sort((a, b) => new Date(a.task.when).getTime() - new Date(b.task.when).getTime());
        }
        return Array.from(groups.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    })();

    const TASK_SQUARE_COLOR = {
        'completed': 'bg-emerald-400',
        'ongoing-future': 'bg-blue-500',
        'ongoing-past': 'bg-blue-400/60',
    } as const;

    // Auto-scale the timeline height so dense days don't overflow.
    // Tasks stack from ~20% of container height downward; externals from ~55%.
    // We compute the pixel space each stack needs and grow the container.
    $: maxTaskItems = tasksByDay.reduce((m, d) => Math.max(m, d.items.length), 0);
    $: maxExternalItems = externalByDay.reduce((m, d) => Math.max(m, d.items.length), 0);
    // The task stack lives in the 20%→50% band (30% of height). Externals live in 55%→85% (30%).
    // Required total height for each stack: (itemCount-1) * rowPx + padding, mapped to 30% of container.
    $: timelineHeight = (() => {
        const taskPx = Math.max(0, maxTaskItems - 1) * TASK_ROW_PX + 24;
        const extPx = Math.max(0, maxExternalItems - 1) * EXTERNAL_ROW_PX + 24;
        // Each stack occupies ~30% of container, so required container height is stackPx / 0.30.
        const needed = Math.max(taskPx, extPx) / 0.30;
        return Math.max(MIN_HEIGHT_PX, Math.ceil(needed));
    })();
    
    // Get all stays for the current year
    $: yearStays = Object.entries(profiles)
        .filter(([_, profile]) => {
            if (!profile.arrival || !profile.departure) return false;
            const arrival = new Date(profile.arrival);
            const departure = new Date(profile.departure);
            const yearStart = new Date(currentDate.getFullYear(), 0, 1);
            const yearEnd = new Date(currentDate.getFullYear(), 11, 31);
            return arrival <= yearEnd && departure >= yearStart;
        })
        .map(([userId, profile]) => ({
            userId,
            profile,
            user: users[userId]
        }));

    // Timeline state
    let timelineContainer: HTMLElement;
    let timelineWidth = 2000; // Width for the year
    
    function handleTimelineClick(event: MouseEvent) {
        const rect = timelineContainer.getBoundingClientRect();
        const x = event.clientX - rect.left;
        
        // Calculate position within the year (0 to 1)
        const positionInYear = x / rect.width;
        
        // Calculate the exact date
        const yearStart = new Date(currentDate.getFullYear(), 0, 1);
        const yearEnd = new Date(currentDate.getFullYear() + 1, 0, 1);
        const timestamp = yearStart.getTime() + (yearEnd.getTime() - yearStart.getTime()) * positionInYear;
        const newDate = new Date(timestamp);
        
        // Calculate day of year
        const startOfYear = new Date(newDate.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((newDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        
        dispatch('dateSelect', { 
            date: newDate,
            dayOfYear 
        });
    }

    function changeYear(offset: number) {
        const newDate = new Date(currentDate);
        newDate.setFullYear(currentDate.getFullYear() + offset);
        dispatch('dateSelect', { date: newDate });
    }

    function formatDateDisplay(date: Date): string {
        return date.toLocaleDateString(undefined, { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    }

    function getMoonPhaseIcon(phaseValue: number) {
        if (phaseValue < 0.125) return '🌑';
        if (phaseValue < 0.25) return '🌒';
        if (phaseValue < 0.375) return '🌓';
        if (phaseValue < 0.5) return '🌔';
        if (phaseValue < 0.625) return '🌕';
        if (phaseValue < 0.75) return '🌖';
        if (phaseValue < 0.875) return '🌗';
        return '🌘';
    }

    // Calculate marker position as percentage of year
    $: markerPosition = ((currentDate.getTime() - new Date(currentDate.getFullYear(), 0, 1).getTime()) / 
        (new Date(currentDate.getFullYear() + 1, 0, 1).getTime() - new Date(currentDate.getFullYear(), 0, 1).getTime())) * 100;

    function getSolarEvents(year: number) {
        return {
            springEquinox: new Date(year, 2, 20),
            summerSolstice: new Date(year, 5, 21),
            autumnEquinox: new Date(year, 8, 22),
            winterSolstice: new Date(year, 11, 21)
        };
    }

    function getMoonPhases(year: number) {
        const phases: Array<{date: Date, isNew: boolean}> = [];
        const startDate = new Date(year, 0, 1);
        const endDate = new Date(year + 1, 0, 1);
        
        let currentDate = new Date(startDate);
        
        while (currentDate < endDate) {
            const phaseInfo = phase(currentDate);
            
            if (phaseInfo.phase < 0.025 || (phaseInfo.phase > 0.475 && phaseInfo.phase < 0.525)) {
                const isDuplicate = phases.some(p => 
                    Math.abs(p.date.getTime() - currentDate.getTime()) < 10 * 24 * 60 * 60 * 1000
                );
                
                if (!isDuplicate) {
                    phases.push({
                        date: new Date(currentDate),
                        isNew: phaseInfo.phase < 0.025
                    });
                }
            }
            
            currentDate = new Date(currentDate.getTime() + 6 * 60 * 60 * 1000);
        }
        
        return phases;
    }

    // Calculate phases for current year
    $: moonPhases = getMoonPhases(currentDate.getFullYear());
    $: solarEvents = getSolarEvents(currentDate.getFullYear());

    // Helper function to calculate position as percentage of year
    function getPositionInYear(date: Date): number {
        const yearStart = new Date(date.getFullYear(), 0, 1);
        const yearEnd = new Date(date.getFullYear() + 1, 0, 1);
        return ((date.getTime() - yearStart.getTime()) / (yearEnd.getTime() - yearStart.getTime())) * 100;
    }
</script>

<div class="bg-gray-800 rounded-3xl p-6 mb-6">
    <div class="flex justify-between items-center mb-4">
        <button 
            class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
            on:click={() => changeYear(-1)}
            aria-label="Previous year"
        >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
        </button>
        
        <h3 class="text-base sm:text-lg font-medium text-white text-center whitespace-nowrap flex items-center gap-2">
            <span>{formatDateDisplay(currentDate)}</span>
            <span class="text-base" title="Current moon phase">
                {getMoonPhaseIcon(phase(currentDate).phase)}
            </span>
        </h3>
        
        <button 
            class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
            on:click={() => changeYear(1)}
            aria-label="Next year"
        >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
        </button>
    </div>
    
    <div
        class="relative select-none"
        style="height: {timelineHeight}px;"
        bind:this={timelineContainer}
        on:click={handleTimelineClick}
        on:keydown={handleTimelineClick}
        role="button"
        tabindex="0"
    >
        <!-- Base timeline -->
        <div class="absolute w-full h-px bg-gray-600 top-1/2"></div>
        
        <!-- Month grid lines -->
        {#each Array(12) as _, i}
            <div 
                class="absolute h-full"
                style="left: {(i / 12) * 100}%"
            >
                <div class="h-full w-px bg-gray-700 opacity-50"></div>
                <div class="absolute -top-1 left-0 w-1 h-2 bg-gray-600"></div>
                <div class="absolute -bottom-1 left-0 w-1 h-2 bg-gray-600"></div>
                <div 
                    class="absolute text-xs text-gray-400"
                    style="top: 8px; transform: translateX(-50%)"
                >
                    {new Date(currentDate.getFullYear(), i, 1).toLocaleString('default', { month: 'short' })}
                </div>
            </div>
        {/each}

        <!-- Solar events -->
        {#each Object.entries(solarEvents) as [name, date]}
            <div
                class="absolute top-1/2 transform -translate-y-1/2 group"
                style="left: {getPositionInYear(date)}%"
            >
                {#if name === 'summerSolstice'}
                    <!-- Longest day: full bright sun -->
                    <div class="w-3 h-3 rounded-full bg-yellow-400"></div>
                {:else if name === 'winterSolstice'}
                    <!-- Longest night: muted/dark -->
                    <div class="w-3 h-3 rounded-full bg-slate-400"></div>
                {:else}
                    <!-- Equinox: half day, half night. Spring = dark→light, Autumn = light→dark -->
                    <div class="w-3 h-3 rounded-full overflow-hidden relative">
                        <div class="absolute top-0 left-0 w-1/2 h-full {name === 'springEquinox' ? 'bg-slate-500' : 'bg-yellow-400'}"></div>
                        <div class="absolute top-0 right-0 w-1/2 h-full {name === 'springEquinox' ? 'bg-yellow-400' : 'bg-slate-500'}"></div>
                    </div>
                {/if}

                <!-- Tooltip -->
                <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {name.replace(/([A-Z])/g, ' $1').trim()}: {date.toLocaleDateString()}
                </div>
            </div>
        {/each}

        <!-- Moon phases -->
        {#each moonPhases as { date, isNew }}
            <div 
                class="absolute top-1/2 transform -translate-y-1/2 group"
                style="left: {getPositionInYear(date)}%"
            >
                <div 
                    class="w-2 h-2 rounded-full border border-gray-400"
                    class:bg-gray-800={isNew}
                    class:bg-gray-300={!isNew}
                ></div>
                <!-- Tooltip -->
                <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {isNew ? '🌑 New Moon' : '🌕 Full Moon'}: {date.toLocaleDateString()}
                </div>
            </div>
        {/each}

        <!-- Profile stays -->
        {#each yearStays as stay}
            {@const arrival = new Date(stay.profile.arrival || Date.now())}
            {@const departure = new Date(stay.profile.departure || Date.now())}
            {@const startPos = Math.max(0, getPositionInYear(arrival))}
            {@const endPos = Math.min(100, getPositionInYear(departure))}
            <div 
                class="absolute h-1.5 group cursor-pointer transition-all hover:h-2"
                style="
                    left: {startPos}%;
                    width: {endPos - startPos}%;
                    top: 75%;
                    background-color: {getUserColor(stay.userId)};
                "
            >
                <!-- Tooltip -->
                <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 
                    bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap 
                    opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50"
                >
                    <div class="font-bold">{stay.user.first_name} {stay.user.last_name || ''}</div>
                    <div>Arrival: {arrival.toLocaleDateString()}</div>
                    <div>Departure: {departure.toLocaleDateString()}</div>
                    {#if stay.profile.origin}
                        <div>From: {stay.profile.origin}</div>
                    {/if}
                    {#if stay.profile.purpose}
                        <div>Purpose: {stay.profile.purpose}</div>
                    {/if}
                </div>
            </div>
        {/each}

        <!-- Task day overlay: dashed vertical line + stacked squares per day -->
        {#each tasksByDay as day (day.date.toISOString())}
            {@const leftPct = getPositionInYear(day.date)}
            <div class="absolute h-full pointer-events-none" style="left: {leftPct}%;">
                <div class="absolute top-[18%] bottom-[52%] left-0 w-0 border-l border-dashed border-gray-400/40"></div>
                {#each day.items as item, i (item.key)}
                    <button
                        type="button"
                        class="absolute w-2 h-2 rounded-sm -translate-x-1/2 pointer-events-auto group hover:scale-150 transition-transform {item.task.color ? '' : TASK_SQUARE_COLOR[item.status]}"
                        style="top: calc(20% + {i * 10}px);{item.task.color ? ` background-color: ${item.task.color};` : ''}"
                        on:click|stopPropagation={() => dispatch('taskClick', { key: item.key, task: item.task })}
                        aria-label={item.task.title || 'Untitled task'}
                    >
                        <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40">
                            <div class="font-semibold">{item.task.title || 'Untitled task'}</div>
                            <div class="opacity-75 text-[10px]">
                                {new Date(item.task.when).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {#if item.status === 'completed'} · ✓ completed{/if}
                            </div>
                        </div>
                    </button>
                {/each}
            </div>
        {/each}

        <!-- Imported calendar events: stacked squares below the base line, in calendar color -->
        {#each externalByDay as day (day.date.toISOString())}
            {@const leftPct = getPositionInYear(day.date)}
            <div class="absolute h-full pointer-events-none" style="left: {leftPct}%;">
                {#each day.items as item, i (item.id)}
                    <div
                        class="absolute w-2 h-2 rounded-sm -translate-x-1/2 pointer-events-auto group hover:scale-150 transition-transform"
                        style="top: calc(55% + {i * 10}px); background-color: {item.event.calendarColor || '#10b981'};"
                        aria-label={item.event.title}
                    >
                        <div class="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40">
                            <div class="font-semibold">{item.event.title}</div>
                            <div class="opacity-75 text-[10px]">
                                {new Date(item.event.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                {#if item.event.calendarName} · {item.event.calendarName}{/if}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/each}

        <!-- Current date indicator -->
        <div
            class="absolute h-full w-px bg-white top-0 z-10"
            style="left: {markerPosition}%"
        >
            <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full"></div>
        </div>
    </div>
</div>

<style>
    .select-none {
        user-select: none;
        -webkit-user-select: none;
    }
</style>