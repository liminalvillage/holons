
<script lang="ts">
    import { onMount, onDestroy, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import { ID } from "../dashboard/store";
    import type { HoloSphere } from "holosphere";
    import MyHolonsIcon from "../dashboard/sidebar/icons/MyHolonsIcon.svelte";
    import { goto } from "$app/navigation";
    import { fetchHolonName } from "../utils/holonNames";

    import { taskSortStore, sortTasks, type TaskSortState } from "../dashboard/store";

    // Props
    export let isVisible = false;

    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    
    // Current time state
    let currentTime = new Date();
    let timeInterval: ReturnType<typeof setInterval>;
    let weatherRefreshInterval: ReturnType<typeof setInterval>;
    
    // Holon data state
    $: holonID = $ID;

    // Holon name state
    let holonName = '';
    let isLoadingHolonName = false;
    
    // Events and tasks data
    let todaysEvents: Array<{
        id: string;
        title: string;
        time: string;
        description?: string;
        type: string;
        priority?: string;
    }> = [];
    let topTasks: Array<{
        id: string;
        title: string;
        priority?: string;
        dueDate?: string;
        status: string;
    }> = [];
    let isLoadingEvents = false;
    let isLoadingTasks = false;

    // Weather data state
    let isLoadingWeather = false;
    let weatherData: {
        temperature: number;
        weatherCode: number;
        windSpeed: number;
        unit: string;
        city: string;
        country: string;
        lastUpdated: Date;
    } | null = null;

    // Time formatting
    function formatTime(date: Date) {
        return date.toLocaleTimeString('en-US', {
            hour12: true,
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatTimeSeconds(date: Date) {
        return date.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    function formatDate(date: Date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function formatDay(date: Date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long'
        });
    }

    function formatDateShort(date: Date) {
        return date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }

    // Get city name from coordinates using reverse geocoding
    async function getCityFromCoords(latitude: number, longitude: number): Promise<{city: string, country: string}> {
        try {
            // Use BigDataCloud reverse geocoding API (free, no API key required)
            const response = await fetch(
                `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
            );
            
            if (response.ok) {
                const data = await response.json();
                
                // Clean up country name
                let country = data.countryName || 'Unknown Country';
                if (country.includes('(the)')) {
                    country = country.replace(' (the)', '');
                }
                
                return {
                    city: data.city || data.locality || data.principalSubdivision || 'Unknown City',
                    country: country
                };
            }
        } catch (error) {
            // Silent fail, try fallback
        }
        
        // Fallback using OpenStreetMap Nominatim
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`
            );
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.address) {
                    return {
                        city: data.address.city || data.address.town || data.address.village || data.display_name?.split(',')[0] || 'Unknown City',
                        country: data.address.country || 'Unknown Country'
                    };
                }
            }
        } catch (error) {
            // Silent fail
        }
        
        // Final fallback
        return {
            city: 'Unknown City',
            country: 'Unknown Country'
        };
    }

    // Fetch weather data
    async function fetchWeather() {
        isLoadingWeather = true;
        
        try {
            // Get user's location - automatically request permission
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(async (position) => {
                    const { latitude, longitude } = position.coords;
                    
                    try {
                        // Using Open-Meteo API (free, no API key required)
                        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
                        
                        const response = await fetch(url);
                        
                        if (response.ok) {
                            const data = await response.json();
                            
                            if (data.current) {
                                // Get city name from coordinates
                                const location = await getCityFromCoords(latitude, longitude);
                                
                                weatherData = {
                                    temperature: Math.round(data.current.temperature_2m),
                                    weatherCode: data.current.weather_code,
                                    windSpeed: Math.round(data.current.wind_speed_10m),
                                    unit: data.current_units?.temperature_2m || '°C',
                                    city: location.city,
                                    country: location.country,
                                    lastUpdated: new Date()
                                };
                            }
                        }
                    } catch (error) {
                        // Silent fail - no weather display if location fails
                    } finally {
                        isLoadingWeather = false;
                    }
                }, (error) => {
                    // No fallback - just don't show weather if location is denied
                    isLoadingWeather = false;
                }, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutes
                });
            } else {
                // No geolocation support - don't show weather
                isLoadingWeather = false;
            }
        } catch (error) {
            isLoadingWeather = false;
        }
    }



    // Get weather icon based on weather code
    function getWeatherIcon(code: number) {
        if (code === 0) return "☀️"; // Clear sky
        if (code <= 3) return "⛅"; // Partly cloudy
        if (code <= 48) return "🌫️"; // Fog
        if (code <= 67) return "🌧️"; // Rain
        if (code <= 77) return "❄️"; // Snow
        if (code <= 82) return "🌦️"; // Rain showers
        if (code <= 86) return "🌨️"; // Snow showers
        if (code <= 99) return "⛈️"; // Thunderstorm
        return "🌤️"; // Default
    }

    // Load today's events and scheduled tasks
    async function loadTodaysEvents() {
        if (!holosphere || !holonID) return;
        
        isLoadingEvents = true;
        try {
            const today = new Date();
            const todayStr = today.toISOString().split('T')[0];
            
            // Load calendar events
            const eventsData = await holosphere.getAll(holonID, "calendar");
            let events: any[] = [];
            if (Array.isArray(eventsData)) {
                events = eventsData;
            } else if (eventsData && typeof eventsData === 'object') {
                events = Object.values(eventsData);
            }
            
            // Load scheduled tasks (use same logic as Calendar: tasks with `when`)
            const tasksData = await holosphere.getAll(holonID, "quests");
            let taskEntries: [string, any][] = [];
            if (Array.isArray(tasksData)) {
                taskEntries = tasksData.map((task: any, index: number) => [task?.id || index.toString(), task]);
            } else if (tasksData && typeof tasksData === 'object') {
                taskEntries = Object.entries(tasksData);
            }
            
            // Filter for today's events (upcoming only)
            const nowMs = Date.now();
            const todayEvents = events.filter((event: any) => {
                if (!event.date && !event.startDate) return false;
                const eventDate = new Date(event.date || event.startDate);
                return eventDate.toISOString().split('T')[0] === todayStr && eventDate.getTime() >= nowMs;
            }).map((event: any) => ({
                id: event.id || Math.random().toString(),
                title: event.title || event.name || 'Untitled Event',
                time: new Date(event.date || event.startDate).getTime(),
                displayTime: new Date(event.date || event.startDate).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                }),
                description: event.description || event.details,
                type: 'event',
                priority: undefined
            }));
            
            // Filter for today's scheduled tasks using `when` (upcoming only)
            const todayScheduledTasks = taskEntries.filter(([_, task]: [string, any]) => {
                if (!task?.when) return false;
                const whenDate = new Date(task.when);
                return whenDate.toISOString().split('T')[0] === todayStr && whenDate.getTime() >= nowMs;
            }).map(([key, task]: [string, any]) => {
                const whenDate = new Date(task.when);
                return {
                    id: key || task.id || Math.random().toString(),
                    title: task.title || task.name || 'Untitled Task',
                    time: whenDate.getTime(),
                    displayTime: whenDate.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    }),
                    description: task.description || task.details,
                    type: 'task',
                    priority: task.priority
                };
            });
            
            // Debug logging
            console.log('ClockOverlay Debug:', {
                todayStr,
                eventsCount: events.length,
                tasksCount: taskEntries.length,
                todayEventsCount: todayEvents.length,
                todayScheduledTasksCount: todayScheduledTasks.length,
                sampleTask: taskEntries[0]?.[1],
                sampleEvent: events[0]
            });
            
            // Combine and sort all items chronologically
            const allItems = [...todayEvents, ...todayScheduledTasks].sort((a, b) => a.time - b.time);
            
            // Show all items after sorting (not limited to 3)
            todaysEvents = allItems.map(item => ({
                id: item.id,
                title: item.title,
                time: item.displayTime,
                description: item.description,
                type: item.type,
                priority: item.priority
            }));
            
        } catch (error) {
            console.error("Dashboard: Error loading events:", error);
        } finally {
            isLoadingEvents = false;
        }
    }

    // Load top tasks using the same sorting as Tasks.svelte
    async function loadTopTasks() {
        if (!holosphere || !holonID) return;
        
        isLoadingTasks = true;
        try {
            const tasksData = await holosphere.getAll(holonID, "quests");
            let tasks: any[] = [];
            
            if (Array.isArray(tasksData)) {
                // Convert array to entries for consistent processing
                tasks = tasksData.map((task, index) => [task.id || index.toString(), task]);
            } else if (tasksData && typeof tasksData === 'object') {
                tasks = Object.entries(tasksData);
            }
            
            // Filter active tasks first
            const activeTasks = tasks.filter(([_, task]: [string, any]) => 
                task.status !== 'completed' && task.status !== 'cancelled'
            );
            
            // Get current sort state and apply the same sorting as Tasks.svelte
            const currentSortState = $taskSortStore;
            const sortedTasks = sortTasks(activeTasks, currentSortState);
            
            // Show all sorted tasks (not limited to 3)
            const topTaskEntries = sortedTasks;
            
            topTasks = topTaskEntries.map(([key, task]: [string, any]) => ({
                id: key,
                title: task.title || task.name || 'Untitled Task',
                priority: task.priority,
                dueDate: task.dueDate,
                status: task.status || 'pending',
                created: task.created,
                orderIndex: task.orderIndex,
                position: task.position
            }));
            
        } catch (error) {
            console.error("Dashboard: Error loading tasks:", error);
        } finally {
            isLoadingTasks = false;
        }
    }



    // Watch for holon ID changes
    $: if (holonID && isVisible) {
        loadTodaysEvents();
        loadTopTasks();
    }
    
    // Watch for sort changes to reload tasks
    $: if ($taskSortStore && isVisible && holonID) {
        loadTopTasks();
    }

    onMount(() => {
        // Update time every second
        timeInterval = setInterval(() => {
            currentTime = new Date();
        }, 1000);

        // Always fetch weather on component mount (regardless of visibility)
        fetchWeather();

        // Set up periodic weather refresh (every 15 minutes)
        weatherRefreshInterval = setInterval(() => {
            fetchWeather();
        }, 15 * 60 * 1000); // 15 minutes

        // Load initial data if visible
        if (isVisible) {
            if (holonID) {
                loadTodaysEvents();
                loadTopTasks();
            }
        }
    });

    onDestroy(() => {
        if (timeInterval) {
            clearInterval(timeInterval);
        }
        if (weatherRefreshInterval) {
            clearInterval(weatherRefreshInterval);
        }
    });

    // Close overlay on escape key
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            isVisible = false;
        }
    }


</script>

<svelte:window on:keydown={handleKeydown} />

{#if isVisible}
    <div 
        class="fixed inset-0 z-50 bg-gradient-to-br from-gray-800 via-gray-700 to-indigo-900 flex items-center justify-center p-4"
        on:click|self={() => isVisible = false}
        on:keydown={handleKeydown}
        transition:fade={{ duration: 300 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-title"
        tabindex="0"
    >
        <div 
            class="w-full max-w-6xl h-full max-h-[95vh] bg-black/30 backdrop-blur-lg rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
            transition:slide={{ duration: 400, axis: 'y' }}
        >
                        <!-- Close Button -->
                <button 
                class="absolute top-6 right-6 z-10 text-white/60 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
                    on:click={() => isVisible = false}
                aria-label="Close dashboard"
                >
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                

                
            <!-- Main Dashboard Content -->
            <div class="h-full p-8 pb-16 flex flex-col">
                <!-- Top Section: Date, Holons Logo, and Weather -->
                <div class="flex justify-between items-start mb-8">
                    <!-- Date Section -->
                    <div class="text-left">
                        <div class="text-6xl font-light text-white mb-2">
                            {formatDay(currentTime)}
                        </div>
                        <div class="text-2xl text-white/80 font-light">
                            {formatDateShort(currentTime)}
                        </div>
                    </div>

                    <!-- Holons Logo (same as TopBar) -->
                    <div class="flex items-center justify-center">
                        <div class="w-16 h-16 sm:w-20 sm:h-20">
                            <MyHolonsIcon />
                        </div>
                    </div>

                    <!-- Weather Section (only show if loading or data available) -->
                    {#if isLoadingWeather || weatherData}
                        <div class="text-right">
                            {#if isLoadingWeather}
                                <div class="flex items-center justify-end">
                                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white/50 mr-3"></div>
                                    <span class="text-white/60">Loading weather...</span>
                                </div>
                            {:else if weatherData}
                                <div class="flex items-center justify-end space-x-4">
                                    <div class="text-right">
                                        <div class="text-sm text-white/60 mb-1">
                                            {weatherData.city}, {weatherData.country}
                                        </div>
                                        <div class="text-4xl font-light text-white">
                                            {weatherData.temperature}°{weatherData.unit === '°C' ? 'C' : 'F'}
                                        </div>
                                        <div class="text-white/60">
                                            Wind: {weatherData.windSpeed} km/h
                                        </div>
                                        <div class="text-xs text-white/40 mt-1">
                                            Updated: {weatherData.lastUpdated.toLocaleTimeString('en-US', { 
                                                hour: 'numeric', 
                                                minute: '2-digit' 
                                            })}
                                        </div>
                                    </div>
                                    <div class="text-6xl">
                                        {getWeatherIcon(weatherData.weatherCode)}
                                    </div>
                                </div>
                            {/if}
                    </div>
                    {/if}
                </div>

                <!-- Center Section: Prominent Digital Clock -->
                <div class="flex-1 flex flex-col items-center justify-center">
                    <!-- Large Digital Clock -->
                    <div class="text-center mb-12">
                        <div class="text-8xl md:text-9xl lg:text-[10rem] font-light text-white tracking-wider mb-4 drop-shadow-2xl">
                            {formatTime(currentTime)}
                        </div>
                        <div class="text-lg text-white/50 font-mono tracking-wider">
                            {formatTimeSeconds(currentTime)}
                        </div>
                    </div>

                    <!-- Events, Scheduled Tasks, and Active Tasks Grid -->
                    <div class="w-full max-w-5xl grid md:grid-cols-2 gap-8 px-4">
                        <!-- Today's Earliest 3 Scheduled Items -->
                        <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 overflow-hidden">
                                <h3 class="text-xl font-semibold text-white mb-4 flex items-center">
                                <svg class="w-6 h-6 mr-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                Today's Schedule
                                </h3>
                                
                            {#if isLoadingEvents}
                                <div class="flex items-center py-4">
                                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white/50 mr-3"></div>
                                    <span class="text-white/60 text-sm">Loading next items...</span>
                                    </div>
                            {:else if todaysEvents.length > 0}
                                <div class="space-y-3 max-h-40 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar min-h-0 flex flex-col">
                                    {#each todaysEvents as event}
                                        <div class="bg-white/5 rounded-lg p-3 border border-white/10 flex-shrink-0">
                                            <div class="flex justify-between items-start mb-1">
                                                <div class="flex items-center flex-1 pr-2">
                                                    <!-- Event/Task type icon -->
                                                    {#if event.type === 'task'}
                                                        <svg class="w-4 h-4 mr-2 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                                        </svg>
                                                    {:else}
                                                        <svg class="w-4 h-4 mr-2 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                        </svg>
                                                    {/if}
                                                    <h4 class="font-medium text-white text-sm truncate">
                                                        {event.title}
                                                    </h4>
                                                </div>
                                                <div class="flex items-center space-x-2">
                                                    <!-- Priority badge for tasks -->
                                                    {#if event.type === 'task' && event.priority}
                                                        <span class="text-xs px-2 py-1 rounded-full {
                                                            event.priority.toLowerCase() === 'high' ? 'bg-red-500/20 text-red-300' :
                                                            event.priority.toLowerCase() === 'medium' ? 'bg-amber-500/20 text-amber-300' :
                                                            'bg-indigo-500/20 text-indigo-300'
                                                        }">
                                                            {event.priority}
                                                        </span>
                                                    {/if}
                                                    <span class="text-xs text-indigo-300 font-mono whitespace-nowrap">
                                                        {event.time}
                                                    </span>
                                                </div>
                                            </div>
                                            {#if event.description}
                                                <p class="text-xs text-white/60 truncate">
                                                    {event.description}
                                                </p>
                                            {/if}
                                        </div>
                                    {/each}
                                        </div>
                            {:else}
                                <div class="text-center py-6">
                                    <svg class="w-12 h-12 text-white/30 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <p class="text-white/50 text-sm">No scheduled items today</p>
                                </div>
                            {/if}
                            </div>

                        <!-- Top Tasks -->
                        <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 overflow-hidden">
                                <h3 class="text-xl font-semibold text-white mb-4 flex items-center">
                                <svg class="w-6 h-6 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                Top Tasks
                                </h3>
                                
                            {#if isLoadingTasks}
                                <div class="flex items-center py-4">
                                    <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white/50 mr-3"></div>
                                    <span class="text-white/60 text-sm">Loading tasks...</span>
                                        </div>
                            {:else if topTasks.length > 0}
                                <div class="space-y-3 max-h-40 overflow-y-auto overflow-x-hidden pr-2 custom-scrollbar min-h-0 flex flex-col">
                                    {#each topTasks as task}
                                        <div class="bg-white/5 rounded-lg p-3 border border-white/10 flex-shrink-0">
                                            <div class="flex justify-between items-start mb-1">
                                                <h4 class="font-medium text-white text-sm truncate flex-1 pr-2">
                                                    {task.title}
                                                    </h4>
                                                {#if task.priority}
                                                    <span class="text-xs px-2 py-1 rounded-full {
                                                        task.priority.toLowerCase() === 'high' ? 'bg-red-500/20 text-red-300' :
                                                        task.priority.toLowerCase() === 'medium' ? 'bg-amber-500/20 text-amber-300' :
                                                        'bg-indigo-500/20 text-indigo-300'
                                                    }">
                                                        {task.priority}
                                                            </span>
                                                        {/if}
                                                    </div>
                                            {#if task.dueDate}
                                                <p class="text-xs text-white/60">
                                                    Due: {new Date(task.dueDate).toLocaleDateString()}
                                                </p>
                                                {/if}
                                            </div>
                                        {/each}
                                </div>
                            {:else}
                                <div class="text-center py-6">
                                    <svg class="w-12 h-12 text-white/30 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                    <p class="text-white/50 text-sm">No active tasks</p>
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>
                                    
                

                <!-- Bottom Right: ESC hint and Badges button -->
                <div class="absolute bottom-6 right-6 flex items-center space-x-4">
                    <!-- Badges Button -->
                    <button 
                        class="bg-indigo-600/80 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg transition-all duration-200 hover:scale-105 flex items-center space-x-2 shadow-lg"
                        on:click={() => goto(`/${holonID}/badges`)}
                        aria-label="View community badges"
                    >
                        <span class="text-lg">🏆</span>
                        <span class="text-sm font-medium">Badges</span>
                    </button>
                    
                    <!-- ESC hint -->
                    <p class="text-white/40 text-sm flex items-center">
                        Press <kbd class="mx-2 px-2 py-1 bg-white/10 rounded text-xs border border-white/20">Esc</kbd> to close
                    </p>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    kbd {
        box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.1);
    }
    
    /* Custom scrollbar styles */
    .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 3px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.5);
    }
</style>
