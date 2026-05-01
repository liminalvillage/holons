<script lang="ts">
    import { createEventDispatcher,getContext, onMount, onDestroy } from 'svelte';
    import type { HoloSphere } from "holosphere";
    import { ID } from "../dashboard/store";
    import Timeline from './Timeline.svelte';
    import CalendarSettings from './CalendarSettings.svelte';
    import { formatDate } from "../utils/date";
    import * as d3 from "d3";
    import { fetchAndParseICalFeed, filterEventsByDateRange, type ExternalCalendarEvent } from '../lib/services/icalParser';
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import TaskModal from './TaskModal.svelte';
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import { Plus } from 'svelte-feathers';
    import { loadFilters, saveFilters } from '$lib/util/persistedFilters';

    interface CalendarEvents {
        dateSelect: { date: Date; events: any[] };
    }
    const dispatch = createEventDispatcher<CalendarEvents>();

    const holosphere = getContext("holosphere") as HoloSphere;

    // Holon name for TitleBar
    $: holonName = resolvedName($ID, $nameMap, null, 'Calendar');

    // Calendar state
    let currentDate = new Date();
    let selectedDate: Date | null = null;
    let events: { [key: string]: any[] } = {};
    let tasks: Record<string, any> = {};
    let monthTasks: any[] = [];
    let monthProfiles: any[] = [];
    let selectedTask: { id: string; task: any; occurrenceWhen?: string } | null = null;
    
    // View options: 'month', 'week', 'day', 'orbits'
    let viewMode: 'grid' | 'list' | 'canvas' | 'month' | 'week' | 'day' | 'orbits' = 'day';

    // Shared toolbar state — same keys as every other feature.
    // The date-nav controls below stay Calendar-specific.
    let filters = loadFilters('calendar', {
        searchQuery: '',
        showFederated: false,
        showHolograms: true,
    });
    $: saveFilters('calendar', filters);
    
    // Drag and drop state
    let draggedTask: { key: string; task: any } | null = null;
    let dragOverDate: Date | null = null;
    let dragOverTime: number | null = null; // Hour of day (0-23)

    // Unassigned panel width (persisted across sessions)
    const PANEL_WIDTH_KEY = 'calendar_unassigned_width';
    const PANEL_OPEN_KEY = 'calendar_unassigned_open';
    const PANEL_WIDTH_MIN = 160;
    const PANEL_WIDTH_MAX = 480;
    const PANEL_WIDTH_DEFAULT = 192;
    let panelWidth = PANEL_WIDTH_DEFAULT;
    let panelOpen = false; // drawer closed by default
    let panelResizeState: { startX: number; startWidth: number; pointerId: number } | null = null;

    function togglePanel() {
        panelOpen = !panelOpen;
        try { localStorage.setItem(PANEL_OPEN_KEY, panelOpen ? '1' : '0'); } catch {}
    }

    // Event resize state (drag bottom edge to change end time)
    // previewEnd is displayed live during drag; task.ends is updated on pointerup.
    const HOUR_PX = 48; // matches min-h-[48px] on hour rows
    const RESIZE_SNAP_MIN = 15;
    let resizingEvent: {
        key: string;
        task: any;
        startY: number;
        startEndMs: number;
        startMs: number;
        pointerId: number;
        previewEnd: Date;
    } | null = null;

    function clampPanelWidth(w: number) {
        return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(w)));
    }

    // --- Recurring task expansion ---
    function advanceDate(date: Date, frequency: string): Date | null {
        const d = new Date(date);
        switch (String(frequency).toLowerCase()) {
            case 'daily':     d.setDate(d.getDate() + 1); return d;
            case 'weekly':    d.setDate(d.getDate() + 7); return d;
            case 'biweekly':  d.setDate(d.getDate() + 14); return d;
            case 'monthly':   d.setMonth(d.getMonth() + 1); return d;
            case 'quarterly': d.setMonth(d.getMonth() + 3); return d;
            case 'sixmonths': d.setMonth(d.getMonth() + 6); return d;
            case 'yearly':    d.setFullYear(d.getFullYear() + 1); return d;
        }
        return null;
    }

    type TaskEntry = { key: string; originalKey: string; task: any; isInstance: boolean };

    function expandTasks(tasksMap: Record<string, any>, windowStart: Date, windowEnd: Date): TaskEntry[] {
        const entries = Object.entries(tasksMap);
        // Fast path: no recurring tasks → identity mapping with no Date work.
        let anyRecurring = false;
        for (const [, task] of entries) {
            if (task?.frequency && task?.when) { anyRecurring = true; break; }
        }
        if (!anyRecurring) {
            return entries.map(([key, task]) => ({ key, originalKey: key, task, isInstance: false }));
        }

        const results: TaskEntry[] = [];
        for (const [key, task] of entries) {
            const hasDate = task?.when;
            const hasFrequency = !!task?.frequency;

            if (!hasDate || !hasFrequency) {
                // Non-recurring (or unscheduled): pass through unchanged.
                results.push({ key, originalKey: key, task, isInstance: false });
                continue;
            }

            const base = new Date(task.when);
            if (isNaN(base.getTime())) {
                results.push({ key, originalKey: key, task, isInstance: false });
                continue;
            }
            const durMs = task.ends ? Math.max(0, new Date(task.ends).getTime() - base.getTime()) : 60 * 60 * 1000;

            const completedSet: Set<string> = new Set(Array.isArray(task.completedOccurrences) ? task.completedOccurrences : []);

            let cur: Date | null = new Date(base);
            let safety = 0;
            while (cur && cur <= windowEnd && safety++ < 500) {
                if (cur >= windowStart) {
                    const iso = cur.toISOString();
                    const instanceCompleted = completedSet.has(iso);
                    results.push({
                        key: `${key}::${iso}`,
                        originalKey: key,
                        task: {
                            ...task,
                            _originalKey: key,
                            _isInstance: true,
                            _instanceCompleted: instanceCompleted,
                            when: iso,
                            ends: new Date(cur.getTime() + durMs).toISOString(),
                        },
                        isInstance: true,
                    });
                }
                const next = advanceDate(cur, task.frequency);
                if (!next || next.getTime() === cur.getTime()) break;
                cur = next;
            }

            // If no occurrences landed in the window (e.g., base in far future beyond windowEnd), fall back to the base.
            if (!results.some(r => r.originalKey === key)) {
                results.push({ key, originalKey: key, task, isInstance: false });
            }
        }
        return results;
    }

    // Expansion window: 3 months back → 18 months forward. Computed once at module init
    // so its identity is stable — otherwise the $: block would re-run on every reactive
    // tick and re-expand every task needlessly.
    const expansionWindow = (() => {
        const s = new Date(); s.setMonth(s.getMonth() - 3);
        const e = new Date(); e.setMonth(e.getMonth() + 18);
        return { start: s, end: e };
    })();
    $: expandedTaskEntries = expandTasks(tasks, expansionWindow.start, expansionWindow.end);
    $: expandedTasksRecord = Object.fromEntries(expandedTaskEntries.map(e => [e.key, e.task]));

    function resolveOriginalKey(keyOrInstance: string, task?: any): string {
        if (task?._originalKey) return task._originalKey;
        if (typeof keyOrInstance === 'string' && keyOrInstance.includes('::')) return keyOrInstance.split('::')[0];
        return keyOrInstance;
    }
    
    // Get calendar data for current month
    $: monthData = getMonthData(currentDate);
    $: weekData = getWeekData(currentDate);

    let currentDayPercentage = 0;

    // Add these before the calendar state variables
    let users: Record<string, User> = {};
    let profiles: Record<string, Profile> = {};
    let unsubscribe: (() => void) | undefined;

    // Imported calendar state
    let showCalendarSettings = false;
    let importedCalendars: Array<{ id: string; url: string; name: string; enabled: boolean }> = [];
    let externalEvents: ExternalCalendarEvent[] = [];
    // Hidden imported calendars (persisted across sessions)
    const HIDDEN_CALENDARS_KEY = 'calendar_hidden_imports';
    let hiddenCalendarIds: Set<string> = new Set();
    $: visibleExternalEvents = externalEvents.filter(e => !hiddenCalendarIds.has(e.calendarId ?? ''));

    function toggleCalendarVisibility(id: string) {
        const next = new Set(hiddenCalendarIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        hiddenCalendarIds = next;
        try { localStorage.setItem(HIDDEN_CALENDARS_KEY, JSON.stringify([...next])); } catch {}
    }
    let syncInterval: NodeJS.Timeout | number | null = null;
    const SYNC_INTERVAL_MS = 10 * 60 * 1000; // Sync every 10 minutes

    // Orbital visualization variables
    interface RecurringTask {
        id: string;
        title: string;
        description?: string;
        frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
        lastOccurrence: Date;
        nextOccurrence: Date;
        orbitPeriod: number; // in days
        orbitRadius: number; // calculated from frequency
        status: 'active' | 'paused' | 'completed';
        category?: string;
        participants: Array<{ 
            id: string; 
            username: string;
            firstName?: string;
            lastName?: string;
        }>;
        appreciation: string[];
        created?: string;
        recurringTaskID?: string; // ID reference to the recurring task
    }

    interface OrbitStore {
        [key: string]: RecurringTask;
    }

    // D3 visualization variables
    let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    let container: HTMLDivElement;
    let width = 800; // Default width, will be updated when container is available
    let height = 600; // Default height, will be updated when container is available
    let centerX = width / 2;
    let centerY = height / 2;

    // Orbital state
    let orbitStore: OrbitStore = {};
    let selectedOrbitTask: RecurringTask | null = null;
    let showOrbitTaskDetails = false;
    let showEditModal = false;
    let editingTask: RecurringTask | null = null;
    let questsUnsubscribe: (() => void) | undefined;

    // Form data for editing orbital tasks
    let editForm = {
        title: '',
        description: '',
        category: '',
        frequency: 'weekly' as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom',
        startDate: '',
        startTime: ''
    };

    // Mystical indigo color scheme for task categories
    const categoryColors = {
        'work': '#6366F1',      // Indigo
        'personal': '#8B5CF6',  // Violet
        'health': '#A855F7',    // Purple
        'learning': '#7C3AED',  // Indigo
        'finance': '#5B21B6',   // Deep Indigo
        'social': '#4F46E5',    // Indigo
        'default': '#6366F1'    // Default Indigo
    };

    // Watch for month changes to update data
    $: {
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        updateMonthData(month, year);
    }

    function updateMonthData(month: number, year: number) {
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);

        // Filter tasks for current month
        monthTasks = Object.entries(tasks)
            .filter(([_, task]) => {
                const taskDate = new Date(task.when);
                return taskDate >= startDate && taskDate <= endDate;
            })
            .map(([key, task]) => ({ key, ...task }));

        // Filter profiles for current month
        monthProfiles = Object.entries(profiles)
            .filter(([_, profile]) => {
                if (!profile?.arrival || !profile?.departure) return false;
                const arrival = new Date(profile.arrival);
                const departure = new Date(profile.departure);
                return (arrival <= endDate && departure >= startDate);
            })
            .map(([userId, profile]) => ({
                userId,
                profile,
                user: users[userId] || { first_name: 'Loading...' }
            }));
    }

    onMount(() => {
        try {
            const stored = localStorage.getItem(PANEL_WIDTH_KEY);
            if (stored) panelWidth = clampPanelWidth(parseInt(stored, 10) || PANEL_WIDTH_DEFAULT);
            panelOpen = localStorage.getItem(PANEL_OPEN_KEY) === '1';

            const hidden = localStorage.getItem(HIDDEN_CALENDARS_KEY);
            if (hidden) {
                const arr = JSON.parse(hidden);
                if (Array.isArray(arr)) hiddenCalendarIds = new Set(arr);
            }
        } catch {}

        loadProfiles();
        loadTasks();
        loadImportedCalendars();

        // Resolve holon name reactively
        if ($ID) resolveName($ID);

        // Set up periodic sync for imported calendars
        syncInterval = setInterval(() => {
            syncAllCalendars();
        }, SYNC_INTERVAL_MS);

        // Add resize listener for orbital view
        window.addEventListener('resize', handleResize);

        // Note: resize listener is cleaned up in onDestroy
        // currentTimeInterval is handled in a separate onMount block
    });

    onDestroy(() => {
        // Remove resize listener
        window.removeEventListener('resize', handleResize);

        // Clear sync interval
        if (syncInterval) {
            clearInterval(syncInterval);
        }

        // Clean up HoloSphere subscriptions
        if (questsUnsubscribe) {
            questsUnsubscribe();
        }
        if (unsubscribe && typeof unsubscribe === 'function') {
            unsubscribe();
        }
    });

    // Function to reload data when view changes
    function reloadData() {
        loadProfiles();
        loadTasks();
    }

    // Update navigation functions to trigger data reload
    function handleNavigation(direction: 1 | -1) {
        switch (viewMode) {
            case 'month':
                navigateMonth(direction);
                break;
            case 'week':
                navigateWeek(direction);
                break;
            case 'day':
                navigateDay(direction);
                break;
            case 'orbits':
                // For orbits view, navigate by days to allow fine-grained control
                navigateDay(direction);
                break;
        }
        
        // Reload data for all views
        if (viewMode === 'orbits') {
            // For orbits, just update the visualization since data is already loaded
            if (svg) {
                updateVisualization();
            }
        } else {
            reloadData();
        }
    }

    function goToToday() {
        currentDate = new Date();
        if (viewMode === 'orbits') {
            if (svg) updateVisualization();
        } else {
            reloadData();
        }
    }

    // Update view mode changes to trigger data reload
    function handleViewModeChange(mode: 'month' | 'week' | 'day' | 'orbits') {
        viewMode = mode;
        if (mode === 'orbits') {
            loadOrbitData();
        } else {
            reloadData();
        }
    }

    // Load profiles
    function loadProfiles() {
        if (!holosphere || !$ID) return;
        
        try {
            // Subscribe to users
            holosphere.subscribe($ID, "users", async (newUser: any, key?: string) => {
                if (!key) return; // Skip if no key
                if (newUser) {
                    const userData = newUser;
                    if (!userData?.id) return; // Skip if no user ID
                    
                    // Use user.id as the canonical key if available
                    const canonicalKey = userData.id || key;
                    
                    if (userData.id && key !== userData.id) {
                        // Remove the old key if it's different from the canonical key
                        const { [key]: _, ...rest } = users;
                        users = { ...rest, [canonicalKey]: userData };
                    } else {
                        // Use the key directly
                        users[key] = userData;
                    }
                    users = users; // Trigger reactivity
                   
                    // Load profile for this user from the current holon's profiles lens
                    // Only attempt if we have a valid holon ID
                    if ($ID && typeof $ID === 'string' && $ID.length > 0) {
                        try {
                            const profile = await holosphere.get($ID, 'profiles', String(canonicalKey));
                            if (profile) {
                                profiles[canonicalKey] = profile;
                                profiles = profiles; // Trigger reactivity
                            }
                        } catch (error) {
                            // Silent - profile may not exist
                        }
                    }
                } else {
                    delete users[key];
                    delete profiles[key];
                    users = users;
                    profiles = profiles;
                }
            });
        } catch (error) {
            console.error('Error loading users and profiles:', error);
            users = {};
            profiles = {};
        }
    }

    function getMonthData(date: Date) {
        const year = date.getFullYear();
        const month = date.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        const startOffset = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        
        // Get previous month's spillover days
        const prevMonthDays: Date[] = [];
        const prevLastDay = new Date(year, month, 0).getDate();
        for (let i = startOffset - 1; i >= 0; i--) {
            prevMonthDays.push(new Date(year, month - 1, prevLastDay - i));
        }
        
        // Get current month's days
        const currentMonthDays: Date[] = [];
        for (let i = 1; i <= daysInMonth; i++) {
            currentMonthDays.push(new Date(year, month, i));
        }
        
        // Get next month's spillover days
        const nextMonthDays: Date[] = [];
        const remainingCells = 42 - (prevMonthDays.length + currentMonthDays.length);
        for (let i = 1; i <= remainingCells; i++) {
            nextMonthDays.push(new Date(year, month + 1, i));
        }
        
        return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
    }

    function getWeekData(date: Date) {
        const week: Date[] = [];
        const firstDayOfWeek = new Date(date);
        firstDayOfWeek.setDate(date.getDate() - date.getDay());
        
        for (let i = 0; i < 7; i++) {
            const day = new Date(firstDayOfWeek);
            day.setDate(firstDayOfWeek.getDate() + i);
            week.push(day);
        }
        
        return week;
    }

    function handleDateClick(date: Date) {
        currentDate = date;
        selectedDate = date;
        dispatch('dateSelect', { 
            date, 
            events: events[date.toDateString()] || [] 
        });
    }

    function navigateMonth(direction: 1 | -1) {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + direction);
        currentDate = newDate;
    }

    function navigateWeek(direction: 1 | -1) {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + (direction * 7));
        currentDate = newDate;
    }

    function navigateDay(direction: 1 | -1) {
        const newDate = new Date(currentDate);
        newDate.setDate(currentDate.getDate() + direction);
        currentDate = newDate;
    }

    function isToday(date: Date): boolean {
        const today = new Date();
        return date.toDateString() === today.toDateString();
    }

    function isSelected(date: Date): boolean {
        return selectedDate?.toDateString() === date.toDateString();
    }

    function isCurrentMonth(date: Date): boolean {
        return date.getMonth() === currentDate.getMonth();
    }

    function getDayEvents(date: Date) {
        const dateStr = date.toDateString();
        const dayTasks = monthTasks
            .filter(task => new Date(task.when).toDateString() === dateStr)
            .map(task => ({
                ...task,
                color: '#6366f1',
                isHolonEvent: true
            }));

        // Get external events for this day
        const dayExternalEvents = visibleExternalEvents
            .filter(event => {
                const eventStart = new Date(event.start);
                const eventEnd = new Date(event.end);
                const checkDate = new Date(dateStr);
                return eventStart.toDateString() === dateStr ||
                       (eventStart <= checkDate && eventEnd >= checkDate);
            })
            .map(event => ({
                id: event.id,
                title: event.title,
                description: event.description,
                location: event.location,
                when: event.start.toISOString(),
                ends: event.end.toISOString(),
                color: event.calendarColor || '#10b981',
                isExternalEvent: true,
                calendarName: event.calendarName,
                calendarId: event.calendarId,
            }));

        return [...(events[dateStr] || []), ...dayTasks, ...dayExternalEvents];
    }

    function handleTimelineDateSelect(event: CustomEvent<{date: Date, dayOfYear: number}>) {
        currentDate = event.detail.date;
        selectedDate = currentDate;
        currentDayPercentage = (event.detail.dayOfYear / 365) * 100;
        
        dispatch('dateSelect', { 
            date: currentDate, 
            events: events[currentDate.toDateString()] || [] 
        });
    }

    function getStaysForDay(date: Date) {
        const dateStr = date.toDateString();
        return monthProfiles
            .filter(({ profile }) => {
                const arrivalDate = new Date(profile.arrival);
                const departureDate = new Date(profile.departure);
                const checkDate = new Date(dateStr);
                return checkDate >= arrivalDate && checkDate <= departureDate;
            })
            .map(stay => ({
                ...stay,
                isArrival: new Date(stay.profile.arrival).toDateString() === dateStr,
                isDeparture: new Date(stay.profile.departure).toDateString() === dateStr
            }));
    }

    // Add interfaces for Profile type
    interface Profile {
        arrival: string;
        departure: string;
        // ... other profile fields ...
    }

    // Add interface for User type
    interface User {
        id: string;
        first_name: string;
        last_name?: string;
        username?: string;
        // ... other user fields
    }

    // Add this helper function at the script level
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

    // Update getStayStyle to use the user color
    function getStayStyle(date: Date, profile: Profile, userId: string): string {
        const arrivalDate = new Date(profile.arrival);
        const departureDate = new Date(profile.departure);
        const checkDate = new Date(date.toDateString());
        
        let style = `bg-opacity-90 `;
        style += `style="background-color: ${getUserColor(userId)};" `;
        
        // First day of stay
        if (checkDate.getTime() === arrivalDate.setHours(0,0,0,0)) {
            style += "rounded-l ";
        }
        
        // Last day of stay
        if (checkDate.getTime() === departureDate.setHours(0,0,0,0)) {
            style += "rounded-r ";
        }
        
        // Middle days
        if (checkDate > arrivalDate && checkDate < departureDate) {
            style += "-mx-[1px] "; // Negative margin to connect bars
        }
        
        return style;
    }

    async function loadTasks() {
        if (!holosphere || !$ID) return;

        // First, load initial data (subscription only gets updates, not existing data)
        try {
            const initialData = await holosphere.getAll($ID, 'quests');
            if (initialData) {
                // Handle both array and object formats
                const items = Array.isArray(initialData) ? initialData : Object.values(initialData);
                const newTasks: Record<string, any> = {};

                items.forEach((task: any) => {
                    if (task && task.id) {
                        // Include all tasks — those with 'when' show on calendar, those without show as unassigned
                        newTasks[task.id] = task;
                    }
                });

                tasks = newTasks;
                console.log(`[Calendar] Loaded ${Object.keys(tasks).length} items (${Object.values(tasks).filter(t => !t.when).length} unassigned)`);
            }
        } catch (error) {
            console.error('[Calendar] Error loading initial tasks:', error);
        }

        // Then subscribe for real-time updates
        holosphere.subscribe($ID, 'quests', (newTask: any, key?: string) => {
            if (!key) return;
            if (newTask) {
                tasks[key] = newTask;
                tasks = tasks;
            } else {
                delete tasks[key];
                tasks = tasks;
            }
        });
    }

    // Load imported calendars configuration
    async function loadImportedCalendars() {
        if (!holosphere || !$ID) return;

        try {
            const calendarData = await holosphere.get($ID, 'settings', 'imported_calendars');
            if (calendarData && Array.isArray(calendarData.calendars)) {
                importedCalendars = calendarData.calendars;
                // Defer until idle so internal tasks paint first.
                deferSync();
            }
        } catch (err) {
            console.error('Error loading imported calendars:', err);
        }
    }

    // Deterministic per-calendar color (HSL, keyed by calendar id)
    function getCalendarColor(id: string): string {
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = ((hash % 360) + 360) % 360;
        return `hsl(${hue}, 60%, 55%)`;
    }

    // Sync all enabled imported calendars (parallel, scoped to the visible year)
    let lastSyncedYear: number | null = null;
    async function syncAllCalendars(year?: number) {
        if (importedCalendars.length === 0) return;

        const enabledCalendars = importedCalendars.filter(cal => cal.enabled);
        if (enabledCalendars.length === 0) { externalEvents = []; lastSyncedYear = null; return; }

        const targetYear = year ?? currentDate.getFullYear();
        const parseWindow = {
            start: new Date(targetYear, 0, 1),
            end: new Date(targetYear, 11, 31, 23, 59, 59),
        };
        lastSyncedYear = targetYear;

        const results = await Promise.all(
            enabledCalendars.map(async (calendar) => {
                try {
                    const parsed = await fetchAndParseICalFeed(calendar.url, calendar.name, parseWindow);
                    const color = getCalendarColor(calendar.id);
                    return parsed.events.map(event => ({
                        ...event,
                        calendarName: calendar.name,
                        calendarId: calendar.id,
                        calendarColor: color,
                    }));
                } catch (error) {
                    console.error(`Error syncing calendar ${calendar.name}:`, error);
                    return [] as ExternalCalendarEvent[];
                }
            })
        );

        externalEvents = results.flat();
    }

    // Defer a sync until the browser is idle so initial task rendering isn't blocked.
    function deferSync(year?: number) {
        const run = () => syncAllCalendars(year).catch(err => console.error('Background sync failed:', err));
        if (typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
            (window as any).requestIdleCallback(run, { timeout: 2000 });
        } else {
            setTimeout(run, 0);
        }
    }

    // Re-sync when the user navigates to a different year (only after the initial sync).
    $: if (lastSyncedYear !== null && currentDate.getFullYear() !== lastSyncedYear) {
        deferSync(currentDate.getFullYear());
    }

    // Handle calendar settings update
    function handleCalendarsUpdated() {
        loadImportedCalendars();
    }

    // Make monthTasks reactive to changes in tasks (expanded for recurring)
    $: {
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);

        monthTasks = expandedTaskEntries
            .filter(entry => {
                if (!entry.task.when) return false;
                const d = new Date(entry.task.when);
                return d >= startDate && d <= endDate;
            })
            .map(entry => ({ key: entry.key, ...entry.task }));

        // Filter profiles for current month
        monthProfiles = Object.entries(profiles)
            .filter(([_, profile]) => {
                if (!profile?.arrival || !profile?.departure) return false;
                const arrival = new Date(profile.arrival);
                const departure = new Date(profile.departure);
                return (arrival <= endDate && departure >= startDate);
            })
            .map(([userId, profile]) => ({
                userId,
                profile,
                user: users[userId] || { first_name: 'Loading...' }
            }));
    }

    // Unscheduled tasks (no 'when' date) — available for drag/drop onto calendar
    $: unassignedTasks = Object.entries(tasks)
        .filter(([_, task]) => !task.when)
        .map(([key, task]) => ({ key, ...task }));

    function handleTaskClick(key: string, task: any) {
        // For expanded recurring-task instances, open the base series but remember which
        // occurrence was clicked so "Mark Complete" can target just that one.
        const originalKey = resolveOriginalKey(key, task);
        const originalTask = tasks[originalKey] ?? task;
        const isInstance = task?._isInstance === true;
        selectedTask = {
            id: originalKey,
            task: originalTask,
            occurrenceWhen: isInstance ? task.when : undefined,
        };
    }

    function closeTaskModal(event?: CustomEvent<{ deleted?: boolean; questId?: string }>) {
        const detail = event?.detail;
        if (detail?.deleted && detail?.questId) {
            // Evict immediately so the UI doesn't wait for the holosphere subscription callback.
            const { [detail.questId]: _removed, ...rest } = tasks;
            tasks = rest;
        }
        selectedTask = null;
    }

    async function addNewEvent() {
        if (!$ID) return;
        const now = selectedDate || new Date();
        const startDate = new Date(now);
        startDate.setHours(9, 0, 0, 0);
        const endDate = new Date(startDate);
        endDate.setHours(10, 0, 0, 0);

        const newEvent = {
            id: `event-${Date.now()}`,
            title: 'New Event',
            type: 'event',
            status: 'ongoing',
            when: startDate.toISOString(),
            ends: endDate.toISOString(),
            participants: [],
            appreciation: []
        };

        await holosphere.put($ID, 'quests', newEvent);
        selectedTask = { id: newEvent.id, task: newEvent };
    }

    async function addNewTask() {
        if (!$ID) return;

        const newTask = {
            id: `task-${Date.now()}`,
            title: 'New Task',
            type: 'task',
            status: 'ongoing',
            participants: [],
            appreciation: []
        };

        await holosphere.put($ID, 'quests', newTask);
        if (!panelOpen) {
            panelOpen = true;
            try { localStorage.setItem(PANEL_OPEN_KEY, '1'); } catch {}
        }
        selectedTask = { id: newTask.id, task: newTask };
    }

    // Drag and drop handlers
    function handleDragStart(event: DragEvent, key: string, task: any) {
        if (!event.dataTransfer) return;

        // For recurring-instance rows, drag moves the underlying base series.
        const originalKey = resolveOriginalKey(key, task);
        const originalTask = tasks[originalKey] ?? task;
        draggedTask = { key: originalKey, task: originalTask };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', ''); // Required for some browsers
        
        // Add visual feedback
        if (event.target instanceof HTMLElement) {
            event.target.style.opacity = '0.5';
        }
    }

    function handleDragEnd(event: DragEvent) {
        // Reset visual state
        if (event.target instanceof HTMLElement) {
            event.target.style.opacity = '1';
        }
        
        // Clear drag state if not dropped successfully
        setTimeout(() => {
            if (draggedTask) {
                draggedTask = null;
                dragOverDate = null;
                dragOverTime = null;
            }
        }, 100);
    }

    function handleDragOver(event: DragEvent, date: Date, hour?: number) {
        event.preventDefault();
        if (!draggedTask) return;

        event.dataTransfer!.dropEffect = 'move';
        dragOverDate = date;
        dragOverTime = hour !== undefined ? hour : null;
    }

    // --- Unassigned panel resize (mouse + touch via pointer events) ---
    function handlePanelResizeStart(e: PointerEvent) {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        try { target.setPointerCapture(e.pointerId); } catch {}
        panelResizeState = { startX: e.clientX, startWidth: panelWidth, pointerId: e.pointerId };
        document.body.style.userSelect = 'none';
    }

    function handlePanelResizeMove(e: PointerEvent) {
        if (!panelResizeState || e.pointerId !== panelResizeState.pointerId) return;
        panelWidth = clampPanelWidth(panelResizeState.startWidth + (e.clientX - panelResizeState.startX));
    }

    function handlePanelResizeEnd(e: PointerEvent) {
        if (!panelResizeState || e.pointerId !== panelResizeState.pointerId) return;
        const target = e.currentTarget as HTMLElement;
        try { target.releasePointerCapture(e.pointerId); } catch {}
        panelResizeState = null;
        document.body.style.userSelect = '';
        try { localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch {}
    }

    // --- Event bottom-edge resize (change end time) ---
    function handleEventResizeStart(e: PointerEvent, key: string, task: any) {
        e.preventDefault();
        e.stopPropagation();
        if (!task.when) return;
        const target = e.currentTarget as HTMLElement;
        try { target.setPointerCapture(e.pointerId); } catch {}
        // Keep the rendered key so the live preview binds to this row;
        // saving will resolve back to the base series if this is a recurring instance.
        const startMs = new Date(task.when).getTime();
        const startEndMs = task.ends ? new Date(task.ends).getTime() : startMs + 60 * 60 * 1000;
        resizingEvent = {
            key,
            task,
            startY: e.clientY,
            startEndMs,
            startMs,
            pointerId: e.pointerId,
            previewEnd: new Date(startEndMs),
        };
        document.body.style.userSelect = 'none';
    }

    function handleEventResizeMove(e: PointerEvent) {
        if (!resizingEvent || e.pointerId !== resizingEvent.pointerId) return;
        const deltaPx = e.clientY - resizingEvent.startY;
        // 48px = 1 hour → px-to-minute conversion, then snap to RESIZE_SNAP_MIN.
        const deltaMin = Math.round((deltaPx / HOUR_PX) * 60 / RESIZE_SNAP_MIN) * RESIZE_SNAP_MIN;
        let newEndMs = resizingEvent.startEndMs + deltaMin * 60 * 1000;
        // Constraint: end >= start + one snap increment
        const minEnd = resizingEvent.startMs + RESIZE_SNAP_MIN * 60 * 1000;
        if (newEndMs < minEnd) newEndMs = minEnd;
        // Constraint: clamp to end of same day (grid ends at 24:00)
        const endOfDay = new Date(resizingEvent.startMs);
        endOfDay.setHours(24, 0, 0, 0);
        if (newEndMs > endOfDay.getTime()) newEndMs = endOfDay.getTime();
        resizingEvent = { ...resizingEvent, previewEnd: new Date(newEndMs) };
    }

    async function handleEventResizeEnd(e: PointerEvent) {
        if (!resizingEvent || e.pointerId !== resizingEvent.pointerId) return;
        const target = e.currentTarget as HTMLElement;
        try { target.releasePointerCapture(e.pointerId); } catch {}
        const { key, task, previewEnd, startEndMs } = resizingEvent;
        resizingEvent = null;
        document.body.style.userSelect = '';
        if (previewEnd.getTime() === startEndMs) return; // no change
        if (!holosphere || !$ID) return;

        // For a recurring instance, translate the delta onto the base series' end time.
        const originalKey = resolveOriginalKey(key, task);
        const originalTask = tasks[originalKey] ?? task;
        const deltaMs = previewEnd.getTime() - startEndMs;
        const baseEndMs = originalTask.ends
            ? new Date(originalTask.ends).getTime() + deltaMs
            : new Date(originalTask.when).getTime() + 60 * 60 * 1000 + deltaMs;
        const updatedTask = { ...originalTask, ends: new Date(baseEndMs).toISOString() };

        try {
            await holosphere.put($ID, 'quests', updatedTask);
            tasks = { ...tasks, [originalKey]: updatedTask };
        } catch (err) {
            console.error('[Calendar] Failed to update task end time:', err);
        }
    }

    function handleEventResizeCancel(e: PointerEvent) {
        if (!resizingEvent || e.pointerId !== resizingEvent.pointerId) return;
        resizingEvent = null;
        document.body.style.userSelect = '';
    }

    function handleDragLeave() {
        dragOverDate = null;
        dragOverTime = null;
    }

    async function handleDrop(event: DragEvent, date: Date, hour?: number) {
        event.preventDefault();
        
        if (!draggedTask || !$ID) {
            draggedTask = null;
            dragOverDate = null;
            dragOverTime = null;
            return;
        }

        try {
            // Calculate new date and time
            const newDate = new Date(date);
            
            // If hour is specified (week/day view), set specific time
            if (hour !== undefined) {
                newDate.setHours(hour, 0, 0, 0);
            } else {
                // For month view, keep original time or set to current time
                const originalDate = new Date(draggedTask.task.when);
                if (isNaN(originalDate.getTime())) {
                    // If no valid original time, set to current time
                    const now = new Date();
                    newDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
                } else {
                    // Keep original time
                    newDate.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);
                }
            }

            // Calculate end time (preserve duration if exists)
            let endDate = new Date(newDate);
            if (draggedTask.task.ends) {
                const originalStart = new Date(draggedTask.task.when);
                const originalEnd = new Date(draggedTask.task.ends);
                const duration = originalEnd.getTime() - originalStart.getTime();
                endDate = new Date(newDate.getTime() + duration);
            } else {
                // Default 1 hour duration
                endDate.setHours(endDate.getHours() + 1);
            }

            // Update the task
            const updatedTask = {
                ...draggedTask.task,
                when: newDate.toISOString(),
                ends: endDate.toISOString()
            };

            // Update local state immediately for better UX
            tasks[draggedTask.key] = updatedTask;
            tasks = tasks; // Trigger reactivity

            // Update in holosphere
            await holosphere.put($ID, 'quests', updatedTask);
            
            console.log('Task moved successfully:', {
                task: draggedTask.task.title,
                from: draggedTask.task.when,
                to: newDate.toISOString()
            });

        } catch (error) {
            console.error('Error moving task:', error);
            // Revert local state on error
            if (draggedTask) {
                tasks[draggedTask.key] = draggedTask.task;
                tasks = tasks;
            }
        } finally {
            // Clear drag state
            draggedTask = null;
            dragOverDate = null;
            dragOverTime = null;
        }
    }

    // Add this helper function to calculate grid positions
    function getTaskPosition(task: any, endsOverride?: Date) {
        const startTime = new Date(task.when);
        const endTime = endsOverride
            ? endsOverride
            : (task.ends ? new Date(task.ends) : new Date(startTime.getTime() + 60*60*1000));
        
        const startHour = startTime.getHours() - 6; // Adjust for 6 AM start
        const startMinutes = startTime.getMinutes();
        const endHour = endTime.getHours() - 6;
        const endMinutes = endTime.getMinutes();
        
        const startRow = startHour + (startMinutes / 60); // Convert to decimal hours
        const endRow = endHour + (endMinutes / 60);
        
        return {
            gridRowStart: Math.max(Math.floor(startRow) + 1, 1),
            gridRowEnd: Math.min(Math.ceil(endRow) + 1, 19),
            startTime: `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')}`,
            endTime: `${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`
        };
    }

    // Function to detect overlapping events and calculate column layout
    function calculateEventColumns(tasksForDay: Array<{key: string, task: any}>) {
        // Sort events by start time, then by duration (longer events first)
        const sortedTasks = tasksForDay.sort((a, b) => {
            const aStart = new Date(a.task.when).getTime();
            const bStart = new Date(b.task.when).getTime();
            if (aStart !== bStart) return aStart - bStart;
            
            // If same start time, longer events first
            const aDuration = a.task.ends ? new Date(a.task.ends).getTime() - aStart : 60*60*1000;
            const bDuration = b.task.ends ? new Date(b.task.ends).getTime() - bStart : 60*60*1000;
            return bDuration - aDuration;
        });

        const columns: Array<{key: string, task: any, column: number, totalColumns: number}> = [];
        const activeEvents: Array<{key: string, task: any, column: number, endTime: number}> = [];

        for (const taskItem of sortedTasks) {
            const startTime = new Date(taskItem.task.when).getTime();
            const endTime = taskItem.task.ends ? new Date(taskItem.task.ends).getTime() : startTime + 60*60*1000;

            // Remove events that have ended
            for (let i = activeEvents.length - 1; i >= 0; i--) {
                if (activeEvents[i].endTime <= startTime) {
                    activeEvents.splice(i, 1);
                }
            }

            // Find the first available column
            let column = 0;
            const usedColumns = activeEvents.map(e => e.column).sort((a, b) => a - b);
            for (const usedColumn of usedColumns) {
                if (column === usedColumn) {
                    column++;
                } else {
                    break;
                }
            }

            // Add to active events
            activeEvents.push({
                key: taskItem.key,
                task: taskItem.task,
                column,
                endTime
            });

            // Calculate total columns for all overlapping events
            const totalColumns = Math.max(1, activeEvents.length);

            // Update total columns for all active events
            for (let i = 0; i < columns.length; i++) {
                const existingEvent = columns[i];
                const existingEndTime = existingEvent.task.ends ? new Date(existingEvent.task.ends).getTime() : new Date(existingEvent.task.when).getTime() + 60*60*1000;
                
                // If this existing event overlaps with current time range, update its total columns
                if (existingEndTime > startTime) {
                    const activeAtThisTime = activeEvents.filter(ae => {
                        const aeStart = new Date(ae.task.when).getTime();
                        return aeStart <= startTime && ae.endTime > startTime;
                    });
                    existingEvent.totalColumns = Math.max(existingEvent.totalColumns, activeAtThisTime.length);
                }
            }

            columns.push({
                key: taskItem.key,
                task: taskItem.task,
                column,
                totalColumns
            });
        }

        return columns;
    }

    // Add to script section at the top
    let now = new Date();
    let currentTimeInterval: NodeJS.Timeout | number;

    // Update current time every minute
    onMount(() => {
        currentTimeInterval = setInterval(() => {
            now = new Date();
        }, 60000);

        return () => {
            clearInterval(currentTimeInterval);
        };
    });

    // First, update the current time calculation to include minutes for smoother positioning
    function getCurrentTimePosition() {
        const hours = now.getHours() - 6; // Adjust for 6 AM start
        const minutes = now.getMinutes();
        const position = hours + (minutes / 60);
        return {
            position: Math.max(0, Math.min(position, 18)) * 48, // Multiply by row height (48px)
            isVisible: now.getHours() >= 6 && now.getHours() < 24
        };
    }

    // ORBITAL VISUALIZATION FUNCTIONS
    
    // Reactive statement to reinitialize visualization when switching to orbits view
    $: if (viewMode === 'orbits' && container) {
        setTimeout(() => {
            // Ensure container is visible before initializing
            const containerRect = container.getBoundingClientRect();
            if (containerRect.width > 0 && containerRect.height > 0) {
                // Update dimensions before initializing
                width = containerRect.width;
                height = containerRect.height;
                centerX = width / 2;
                centerY = height / 2;
                initializeVisualization();
            } else {
                // If container not ready, try again after a short delay
                setTimeout(() => {
                    const rect = container.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        width = rect.width;
                        height = rect.height;
                        centerX = width / 2;
                        centerY = height / 2;
                        initializeVisualization();
                    }
                }, 200);
            }
        }, 100); // Small delay to ensure DOM is ready
    }
    
    // Reactive statement to update visualization when store changes
    $: if (svg && Object.keys(orbitStore).length > 0) {
        updateVisualization();
    }
    
    // Reactive statement to update orbital visualization when currentDate changes
    $: if (viewMode === 'orbits' && svg && currentDate) {
        updateVisualization();
    }

    // Load orbital data
    async function loadOrbitData() {
        if (!holosphere || !$ID) {
            console.log('Holosphere or ID not available');
            return;
        }
        
        console.log('Loading orbital data...');
        
        try {
            // Get all quests from the current holon
            const quests = await holosphere.getAll($ID, "quests");
            console.log('Found quests:', quests?.length || 0);
            
            if (!quests || quests.length === 0) {
                console.log('No quests found, trying fallback approach...');
                await loadFallbackRecurringTasks();
                return;
            }
            
            // Find quests that have a recurringTaskID, a frequency field, or a recurring status/type
            const recurringQuests = quests.filter((quest: any) => {
                const hasRecurringID = quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId;
                const hasFrequency = !!quest.frequency;
                const isRecurring = quest.status === 'recurring' || quest.type === 'recurring' || quest.status === 'repeating';
                return hasRecurringID || hasFrequency || isRecurring;
            });
            
            console.log('Found recurring quests:', recurringQuests.length);
            
            const convertedTasks: OrbitStore = {};
            
            for (const quest of recurringQuests) {
                const recurringTaskID = quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId;
                
                if (recurringTaskID) {
                    try {
                        // Try to get the recurring task from the global recurring table
                        const recurringTask = await holosphere.getGlobal("recurring", recurringTaskID);
                        
                        if (recurringTask) {
                            const convertedTask = convertRecurringTaskToOrbitFormat(recurringTask, quest);
                            if (convertedTask) {
                                convertedTasks[quest.id] = convertedTask;
                            }
                        } else {
                            const fallbackTask = createFallbackRecurringTask(quest);
                            if (fallbackTask) {
                                convertedTasks[quest.id] = fallbackTask;
                            }
                        }
                    } catch (error) {
                        console.error(`Error looking up recurring task ${recurringTaskID}:`, error);
                        const fallbackTask = createFallbackRecurringTask(quest);
                        if (fallbackTask) {
                            convertedTasks[quest.id] = fallbackTask;
                        }
                    }
                } else {
                    // Create fallback for recurring tasks without specific ID
                    const fallbackTask = createFallbackRecurringTask(quest);
                    if (fallbackTask) {
                        convertedTasks[quest.id] = fallbackTask;
                    }
                }
            }
            
            // Update the store
            orbitStore = { ...orbitStore, ...convertedTasks };
            console.log('Loaded orbital tasks:', Object.keys(convertedTasks).length);
            
            // Force visualization update
            if (svg) {
                updateVisualization();
            }
            
        } catch (error) {
            console.error('Error loading orbital data:', error);
            await loadFallbackRecurringTasks();
        }
    }

    // Fallback approach: load recurring tasks from other sources
    async function loadFallbackRecurringTasks() {
        try {
            console.log('Attempting fallback recurring task loading...');
            
            if (!$ID) return;
            const allQuests = await holosphere.getAll($ID, "quests");
            if (allQuests && allQuests.length > 0) {
                const recurringQuests = allQuests.filter((quest: any) =>
                    !!quest.frequency ||
                    quest.status === 'recurring' ||
                    quest.type === 'recurring' ||
                    quest.status === 'repeating'
                );
                
                console.log('Found recurring quests by status/type:', recurringQuests.length);
                
                const convertedTasks: OrbitStore = {};
                recurringQuests.forEach((quest: any) => {
                    const fallbackTask = createFallbackRecurringTask(quest);
                    if (fallbackTask) {
                        convertedTasks[quest.id] = fallbackTask;
                    }
                });
                
                // Update the store
                orbitStore = { ...orbitStore, ...convertedTasks };
                console.log('Fallback loaded tasks:', Object.keys(convertedTasks).length);
                
                // Force visualization update
                if (svg) {
                    updateVisualization();
                }
            }
        } catch (error) {
            console.error('Error in fallback loading:', error);
        }
    }

    // Create a fallback recurring task from quest data
    function createFallbackRecurringTask(quest: any): RecurringTask | null {
        try {
            const frequency = determineFrequencyFromQuest(quest);
            if (!frequency) return null;
            
            const now = new Date();
            const lastOccurrence = quest.when || quest.created || now;
            const nextOccurrence = calculateNextOccurrence(lastOccurrence, frequency);
            const orbitPeriod = getOrbitPeriod(frequency);
            const orbitRadius = getOrbitRadius(frequency);
            
            return {
                id: quest.id,
                title: quest.title || 'Untitled Task',
                description: quest.description || '',
                frequency,
                lastOccurrence: new Date(lastOccurrence),
                nextOccurrence,
                orbitPeriod,
                orbitRadius,
                status: 'active',
                category: quest.category || 'work',
                participants: quest.participants || [],
                appreciation: quest.appreciation || [],
                created: quest.created || quest.when,
                recurringTaskID: quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId
            };
        } catch (error) {
            console.error('Error creating fallback recurring task:', error);
            return null;
        }
    }

    // Determine frequency from quest data
    function determineFrequencyFromQuest(quest: any): 'daily' | 'weekly' | 'monthly' | 'yearly' | null {
        // Explicit frequency field (set via TaskModal) is authoritative
        if (quest.frequency) {
            const f = String(quest.frequency).toLowerCase();
            if (f === 'daily' || f === 'weekly' || f === 'monthly' || f === 'yearly') return f;
            if (f === 'quarterly' || f === 'sixmonths' || f === 'biweekly') return 'monthly'; // closest orbit bucket
        }

        if (quest.status === 'recurring' || quest.type === 'recurring') {
            return 'weekly';
        }

        const recurringKeywords = ['daily', 'weekly', 'monthly', 'yearly', 'every', 'recurring', 'repeat'];
        const text = `${quest.title} ${quest.description || ''}`.toLowerCase();
        
        if (text.includes('daily') || text.includes('every day')) return 'daily';
        if (text.includes('weekly') || text.includes('every week')) return 'weekly';
        if (text.includes('monthly') || text.includes('every month')) return 'monthly';
        if (text.includes('yearly') || text.includes('every year') || text.includes('annual')) return 'yearly';
        
        if (quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId) {
            return 'weekly';
        }
        
        return null;
    }

    // Convert recurring task from Scheduler format to Orbits format
    function convertRecurringTaskToOrbitFormat(schedulerTask: any, originalQuest: any): RecurringTask | null {
        try {
            const frequency = schedulerTask.frequency?.toLowerCase();
            if (!frequency) {
                return createFallbackRecurringTask(originalQuest);
            }
            
            let mappedFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
            switch (frequency) {
                case 'daily':
                    mappedFrequency = 'daily';
                    break;
                case 'weekly':
                    mappedFrequency = 'weekly';
                    break;
                case 'monthly':
                case 'quarterly':
                    mappedFrequency = 'monthly';
                    break;
                case 'yearly':
                    mappedFrequency = 'yearly';
                    break;
                default:
                    return createFallbackRecurringTask(originalQuest);
            }
            
            const now = new Date();
            const lastOccurrence = schedulerTask.when || schedulerTask.createdAt || originalQuest.when || now;
            const nextOccurrence = calculateNextOccurrence(lastOccurrence, mappedFrequency);
            const orbitPeriod = getOrbitPeriod(mappedFrequency);
            const orbitRadius = getOrbitRadius(mappedFrequency);
            
            return {
                id: originalQuest.id,
                title: originalQuest.title || (Array.isArray(schedulerTask.title) ? schedulerTask.title.join(' ') : schedulerTask.title),
                description: originalQuest.description || schedulerTask.description || '',
                frequency: mappedFrequency,
                lastOccurrence: new Date(lastOccurrence),
                nextOccurrence,
                orbitPeriod,
                orbitRadius,
                status: 'active',
                category: originalQuest.category || 'work',
                participants: originalQuest.participants || (schedulerTask.initiator ? [schedulerTask.initiator] : []),
                appreciation: originalQuest.appreciation || [],
                created: schedulerTask.createdAt || originalQuest.created || originalQuest.when,
                recurringTaskID: originalQuest.recurringTaskID || originalQuest.recurring_task_id || originalQuest.recurringTaskId
            };
        } catch (error) {
            console.error('Error converting recurring task:', error);
            return createFallbackRecurringTask(originalQuest);
        }
    }

    // Calculate orbital position based on time and period
    function calculateOrbitalPosition(task: RecurringTask, time: Date): { x: number; y: number; angle: number; progress: number; visible: boolean } {
        // Calculate the actual next occurrence (same logic as calculateTimeToOccurrence)
        let nextOccurrence = new Date(task.nextOccurrence);
        
        // If the scheduled time has passed, calculate the next occurrence
        while (nextOccurrence.getTime() <= time.getTime()) {
            switch (task.frequency) {
                case 'daily':
                    nextOccurrence.setDate(nextOccurrence.getDate() + 1);
                    break;
                case 'weekly':
                    nextOccurrence.setDate(nextOccurrence.getDate() + 7);
                    break;
                case 'monthly':
                    nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
                    break;
                case 'yearly':
                    nextOccurrence.setFullYear(nextOccurrence.getFullYear() + 1);
                    break;
            }
        }
        
        const timeToNext = Math.max(0, nextOccurrence.getTime() - time.getTime());
        const periodMs = task.orbitPeriod * 24 * 60 * 60 * 1000;

        // Future task hasn't entered its orbit yet. Stay off-field until within the approach window,
        // then glide in tangentially from the right toward the 12 o'clock entry point.
        if (timeToNext > periodMs) {
            const approachWindowMs = periodMs * 0.25; // visible during last 25% before entering orbit
            const excess = timeToNext - periodMs;
            if (excess > approachWindowMs) {
                return { x: -10000, y: -10000, angle: -Math.PI / 2, progress: 0, visible: false };
            }
            const approachProgress = excess / approachWindowMs; // 1 = just appeared, 0 = landing on orbit
            // Enter from the left (counter to clockwise travel) so motion reads as "arriving" at 12 o'clock.
            const offsetX = -task.orbitRadius * 0.9 * approachProgress;
            return {
                x: centerX + offsetX,
                y: centerY - task.orbitRadius,
                angle: -Math.PI / 2,
                progress: 0,
                visible: true,
            };
        }

        // Calculate progress through the current cycle
        // When timeToNext = periodMs (full cycle remaining), progress = 0 (at start/12 o'clock)
        // When timeToNext = 0 (no time remaining), progress = 1 (full circle completed)
        const progress = Math.max(0, Math.min(1, (periodMs - timeToNext) / periodMs));
        const angle = progress * 2 * Math.PI;

        // Adjust angle so 0 is at the top (12 o'clock) instead of right side (3 o'clock)
        const adjustedAngle = angle - Math.PI / 2;

        const x = centerX + task.orbitRadius * Math.cos(adjustedAngle);
        const y = centerY + task.orbitRadius * Math.sin(adjustedAngle);

        return { x, y, angle: adjustedAngle, progress, visible: true };
    }

    // Calculate time to occurrence (next time the task should happen)
    function calculateTimeToOccurrence(task: RecurringTask, time: Date): number {
        let nextOccurrence = new Date(task.nextOccurrence);
        
        // If the scheduled time has passed, calculate the next occurrence
        while (nextOccurrence.getTime() <= time.getTime()) {
            switch (task.frequency) {
                case 'daily':
                    nextOccurrence.setDate(nextOccurrence.getDate() + 1);
                    break;
                case 'weekly':
                    nextOccurrence.setDate(nextOccurrence.getDate() + 7);
                    break;
                case 'monthly':
                    nextOccurrence.setMonth(nextOccurrence.getMonth() + 1);
                    break;
                case 'yearly':
                    nextOccurrence.setFullYear(nextOccurrence.getFullYear() + 1);
                    break;
            }
        }
        
        const timeDiff = nextOccurrence.getTime() - time.getTime();
        return Math.max(0, timeDiff);
    }

    // Format time duration
    function formatDuration(ms: number): string {
        const days = Math.floor(ms / (24 * 60 * 60 * 1000));
        const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
        
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
    
    // Get orbit period in days based on frequency
    function getOrbitPeriod(frequency: string): number {
        switch (frequency) {
            case 'daily': return 1;
            case 'weekly': return 7;
            case 'monthly': return 30;
            case 'yearly': return 365;
            default: return 7;
        }
    }
    
    // Get orbit radius based on frequency (closer = faster)
    function getOrbitRadius(frequency: string): number {
        switch (frequency) {
            case 'daily': return 80;
            case 'weekly': return 120;
            case 'monthly': return 180;
            case 'yearly': return 250;
            default: return 120;
        }
    }
    
    // Calculate next occurrence based on frequency
    function calculateNextOccurrence(lastOccurrence: Date, frequency: string): Date {
        const now = new Date();
        const last = new Date(lastOccurrence);
        let next = new Date(last);
        
        // Add one period from the last occurrence
        switch (frequency) {
            case 'daily':
                next.setDate(next.getDate() + 1);
                break;
            case 'weekly':
                next.setDate(next.getDate() + 7);
                break;
            case 'monthly':
                next.setMonth(next.getMonth() + 1);
                break;
            case 'yearly':
                next.setFullYear(next.getFullYear() + 1);
                break;
        }
        
        // If next occurrence is in the past, keep adding periods until it's in the future
        while (next <= now) {
            switch (frequency) {
                case 'daily':
                    next.setDate(next.getDate() + 1);
                    break;
                case 'weekly':
                    next.setDate(next.getDate() + 7);
                    break;
                case 'monthly':
                    next.setMonth(next.getMonth() + 1);
                    break;
                case 'yearly':
                    next.setFullYear(next.getFullYear() + 1);
                    break;
            }
        }
        
        return next;
    }

    // Handle window resize to make visualization responsive
    function handleResize() {
        if (container) {
            const containerRect = container.getBoundingClientRect();
            width = containerRect.width || 800;
            height = containerRect.height || 600;
            centerX = width / 2;
            centerY = height / 2;
            
            if (svg) {
                initializeVisualization();
            }
        }
    }

    // Draw a deterministic starfield + a few constellation lines on the SVG background.
    function drawStarfield(svgEl: any, w: number, h: number) {
        // Tiny seeded PRNG so the pattern is stable across re-renders.
        let seed = 0xdeadbeef;
        const rand = () => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return ((seed >>> 0) % 10000) / 10000;
        };

        const starLayer = svgEl.append('g').attr('class', 'starfield').attr('pointer-events', 'none');

        // Stars
        const starCount = Math.max(60, Math.min(180, Math.floor((w * h) / 9000)));
        const stars: Array<{ x: number; y: number; r: number; opacity: number }> = [];
        for (let i = 0; i < starCount; i++) {
            const x = rand() * w;
            const y = rand() * h;
            const r = 0.5 + rand() * 1.3;
            const opacity = 0.3 + rand() * 0.5;
            stars.push({ x, y, r, opacity });
            starLayer.append('circle')
                .attr('cx', x)
                .attr('cy', y)
                .attr('r', r)
                .attr('fill', '#e0e7ff')
                .attr('opacity', opacity);
        }

        // A few brighter "accent" stars with a subtle twinkle via drop-shadow
        for (let i = 0; i < 6; i++) {
            const s = stars[Math.floor(rand() * stars.length)];
            starLayer.append('circle')
                .attr('cx', s.x)
                .attr('cy', s.y)
                .attr('r', s.r + 0.8)
                .attr('fill', '#ffffff')
                .attr('opacity', 0.9)
                .style('filter', 'drop-shadow(0 0 2px rgba(224, 231, 255, 0.9))');
        }
    }

    // Initialize D3 visualization
    function initializeVisualization() {
        if (!container) return;
        
        // Get actual container dimensions instead of window dimensions
        const containerRect = container.getBoundingClientRect();
        width = containerRect.width || 800; // fallback width
        height = containerRect.height || 600; // fallback height
        centerX = width / 2;
        centerY = height / 2;

        // Clear existing SVG
        d3.select(container).selectAll('*').remove();

        // Create SVG (match calendar's flat gray-800 surface)
        svg = d3.select(container)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .style('background', '#1f2937');

        // Starfield + constellations (deterministic so stars don't jitter between renders)
        drawStarfield(svg, width, height);

        // Add orbital rings
        const uniqueRadii = [...new Set(Object.values(orbitStore).map(task => task.orbitRadius))].sort((a, b) => a - b);

        uniqueRadii.forEach(radius => {
            svg.append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', radius)
                .attr('fill', 'none')
                .attr('stroke', '#374151') // gray-700
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4,4')
                .attr('opacity', 0.8);
        });

        // Sun at the center — radial gradient core + layered halos + rays
        const defs = svg.append('defs');
        const gradId = 'sun-core-gradient';
        const grad = defs.append('radialGradient')
            .attr('id', gradId)
            .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
        grad.append('stop').attr('offset', '0%').attr('stop-color', '#fff8dc');
        grad.append('stop').attr('offset', '55%').attr('stop-color', '#fbbf24'); // amber-400
        grad.append('stop').attr('offset', '100%').attr('stop-color', '#f59e0b'); // amber-500

        const sun = svg.append('g').attr('class', 'sun').attr('pointer-events', 'none');

        // Outer soft halo
        sun.append('circle')
            .attr('cx', centerX).attr('cy', centerY).attr('r', 28)
            .attr('fill', '#fbbf24').attr('opacity', 0.08);
        sun.append('circle')
            .attr('cx', centerX).attr('cy', centerY).attr('r', 20)
            .attr('fill', '#fbbf24').attr('opacity', 0.18);
        sun.append('circle')
            .attr('cx', centerX).attr('cy', centerY).attr('r', 14)
            .attr('fill', '#fbbf24').attr('opacity', 0.28);

        // Corona rays
        const rayCount = 12;
        for (let i = 0; i < rayCount; i++) {
            const angle = (i / rayCount) * 2 * Math.PI;
            const inner = 11;
            const outer = 18;
            sun.append('line')
                .attr('x1', centerX + inner * Math.cos(angle))
                .attr('y1', centerY + inner * Math.sin(angle))
                .attr('x2', centerX + outer * Math.cos(angle))
                .attr('y2', centerY + outer * Math.sin(angle))
                .attr('stroke', '#fbbf24')
                .attr('stroke-width', 1.2)
                .attr('stroke-linecap', 'round')
                .attr('opacity', 0.7);
        }

        // Core with gradient + subtle glow
        sun.append('circle')
            .attr('cx', centerX).attr('cy', centerY).attr('r', 9)
            .attr('fill', `url(#${gradId})`)
            .style('filter', 'drop-shadow(0 0 6px rgba(251, 191, 36, 0.6))');

        // "NOW" indicator line — matches the red current-time line in day/week views
        const edgeY = Math.min(50, centerY - 50);
        svg.append('line')
            .attr('x1', centerX)
            .attr('y1', centerY)
            .attr('x2', centerX)
            .attr('y2', edgeY)
            .attr('stroke', '#ef4444') // red-500
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4')
            .attr('opacity', 0.8);

        svg.append('text')
            .attr('x', centerX)
            .attr('y', edgeY - 8)
            .attr('fill', '#ef4444')
            .attr('font-size', '11px')
            .attr('font-weight', '500')
            .attr('text-anchor', 'middle')
            .text('NOW');



        updateVisualization();
    }

    // Update visualization with current task positions
    function updateVisualization() {
        if (!svg) return;

        // Remove existing planets
        svg.selectAll('.planet').remove();
        svg.selectAll('.orbit-trail').remove();

        // Use the selected calendar date for orbital calculations
        const visualizationTime = new Date(currentDate);
        // If we're looking at today, use current time for more accurate positioning
        if (currentDate.toDateString() === new Date().toDateString()) {
            visualizationTime.setHours(new Date().getHours());
            visualizationTime.setMinutes(new Date().getMinutes());
            visualizationTime.setSeconds(new Date().getSeconds());
        }

        // Add planets for each task
        Object.values(orbitStore).forEach(task => {
            const position = calculateOrbitalPosition(task, visualizationTime);
            if (!position.visible) return; // off-field (scheduled too far in the future)

            const timeToOccurrence = calculateTimeToOccurrence(task, visualizationTime);
            const categoryColor = categoryColors[task.category as keyof typeof categoryColors] || categoryColors.default;

            // Orbit trail (subtle category tint)
            svg.append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', task.orbitRadius)
                .attr('fill', 'none')
                .attr('stroke', categoryColor)
                .attr('stroke-width', 1.5)
                .attr('opacity', 0.25)
                .attr('stroke-dasharray', '6,6')
                .classed('orbit-trail', true);

            // Detect "incoming from outer space" (future task in the approach window).
            const distFromCenter = Math.hypot(position.x - centerX, position.y - centerY);
            const isIncoming = distFromCenter > task.orbitRadius + 0.5;

            // Planet group
            const planetGroup = svg.append('g')
                .classed('planet', true)
                .attr('transform', `translate(${position.x}, ${position.y})`)
                .attr('opacity', isIncoming ? 0.7 : 1);

            // Planet body
            planetGroup.append('circle')
                .attr('r', 10)
                .attr('fill', categoryColor)
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 1.5);

            // Task title
            planetGroup.append('text')
                .attr('x', 0)
                .attr('y', -16)
                .attr('fill', '#ffffff')
                .attr('font-size', '10px')
                .attr('text-anchor', 'middle')
                .attr('font-weight', '500')
                .text(task.title.length > 12 ? task.title.substring(0, 12) + '...' : task.title);

            // Time to occurrence indicator (muted gray, red near zero — mirrors day view "now" treatment)
            const timeText = formatDuration(timeToOccurrence);
            const timeColor = timeToOccurrence < 60000 ? '#ef4444' : '#9ca3af'; // gray-400

            planetGroup.append('text')
                .attr('x', 0)
                .attr('y', 26)
                .attr('fill', timeColor)
                .attr('font-size', '9px')
                .attr('text-anchor', 'middle')
                .attr('font-weight', timeToOccurrence < 60000 ? '600' : '400')
                .text(timeText);

            // Progress indicator (ring outside planet body)
            const progressRadius = 14;
            const circumference = 2 * Math.PI * progressRadius;
            const progressAngle = position.progress * 360;
            planetGroup.append('circle')
                .attr('r', progressRadius)
                .attr('fill', 'none')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 1)
                .attr('opacity', 0.6)
                .attr('stroke-dasharray', `${progressAngle / 360 * circumference}, ${circumference}`)
                .attr('transform', 'rotate(-90)'); // Start at 12 o'clock (top)

            // Add click event
            planetGroup.style('cursor', 'pointer')
                .on('click', () => selectOrbitTask(task));
        });
    }

    // Select an orbital task for detailed view
    function selectOrbitTask(task: RecurringTask) {
        selectedOrbitTask = task;
        showOrbitTaskDetails = true;
    }

    // Close orbital task details
    function closeOrbitTaskDetails() {
        showOrbitTaskDetails = false;
        selectedOrbitTask = null;
    }
</script>

<div class="space-y-4">
    <TitleBar {holonName} title="Calendar" />

    <FeatureToolbar
        onAdd={addNewEvent}
        addLabel="Add Event"
        bind:searchQuery={filters.searchQuery}
        searchPlaceholder="Search events…"
        bind:showFederated={filters.showFederated}
        bind:showHolograms={filters.showHolograms}
    />

    <Timeline
        currentDate={currentDate}
        profiles={profiles}
        users={users}
        tasks={expandedTasksRecord}
        externalEvents={visibleExternalEvents}
        on:dateSelect={handleTimelineDateSelect}
        on:taskClick={(e) => handleTaskClick(e.detail.key, e.detail.task)}
    />

    <div class="bg-gray-800 rounded-2xl p-4 sm:p-6">
    <div class="flex items-center gap-2 mb-4 flex-wrap">
        <!-- Left: Today + Settings -->
        <div class="flex-1 flex items-center gap-2 min-w-0">
            <button
                class="px-3 py-1.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-600 transition-colors"
                onclick={goToToday}
                aria-label="Jump to today"
            >
                Today
            </button>
            <button
                class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                onclick={() => showCalendarSettings = true}
                aria-label="Calendar settings"
                title="Calendar Settings - Import/Export"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
        </div>

        <!-- Center: arrows + date -->
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
                class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                onclick={() => handleNavigation(-1)}
                aria-label="Previous period"
            >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <h2 class="text-base sm:text-xl font-semibold text-white text-center whitespace-nowrap">
                {#if viewMode === 'month'}
                    <span class="sm:hidden">{currentDate.toLocaleString('default', { month: 'short', year: 'numeric' })}</span>
                    <span class="hidden sm:inline">{currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                {:else if viewMode === 'week'}
                    <span class="sm:hidden">{weekData[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {weekData[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    <span class="hidden sm:inline">{weekData[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – {weekData[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                {:else}
                    <span class="sm:hidden">{currentDate.toLocaleString('default', { month: 'short', day: 'numeric' })}</span>
                    <span class="hidden sm:inline">{currentDate.toLocaleString('default', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                {/if}
            </h2>
            <button
                class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                onclick={() => handleNavigation(1)}
                aria-label="Next period"
            >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <!-- Right: View switcher + Add -->
        <div class="flex-1 flex items-center gap-2 justify-end">
            <div class="inline-flex items-center rounded-lg bg-gray-700 p-0.5" role="tablist" aria-label="Calendar view">
                <span class="hidden sm:inline px-2 text-[11px] uppercase tracking-wider text-gray-400 font-medium">View</span>
                {#each [
                    { value: 'day', label: 'Day' },
                    { value: 'week', label: 'Week' },
                    { value: 'month', label: 'Month' },
                    { value: 'orbits', label: 'Orbits' },
                ] as option}
                    {@const isActive = viewMode === option.value}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        class="px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors {isActive ? 'bg-gray-900 text-white shadow' : 'text-gray-300 hover:text-white'}"
                        onclick={() => handleViewModeChange(option.value as 'day' | 'week' | 'month' | 'orbits')}
                    >
                        {option.label}
                    </button>
                {/each}
            </div>
        </div>
    </div>

    <!-- Imported calendar visibility chips -->
    {#if importedCalendars.filter(c => c.enabled).length > 0}
        <div class="flex items-center flex-wrap gap-1.5 mb-3">
            <span class="text-[11px] uppercase tracking-wider text-gray-400 font-medium mr-1">Calendars</span>
            {#each importedCalendars.filter(c => c.enabled) as cal (cal.id)}
                {@const hidden = hiddenCalendarIds.has(cal.id)}
                {@const color = getCalendarColor(cal.id)}
                <button
                    type="button"
                    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs transition-opacity {hidden ? 'opacity-40' : 'opacity-100'} border-gray-700 hover:border-gray-500"
                    style="background-color: color-mix(in srgb, {color} 20%, transparent);"
                    onclick={() => toggleCalendarVisibility(cal.id)}
                    aria-pressed={!hidden}
                    title={hidden ? `Show ${cal.name}` : `Hide ${cal.name}`}
                >
                    <span class="inline-block w-2 h-2 rounded-sm" style="background-color: {color};"></span>
                    <span class="text-gray-200 {hidden ? 'line-through' : ''}">{cal.name}</span>
                </button>
            {/each}
        </div>
    {/if}

    <!-- Unassigned tasks panel + calendar in flex layout -->
    <div class="flex gap-2 items-stretch">
    <!-- Unassigned tasks drawer -->
    {#if !panelOpen}
        <!-- Collapsed rail: click to open -->
        <button
            type="button"
            class="shrink-0 self-stretch w-8 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors flex flex-col items-center justify-start py-2 gap-2 sticky top-2 h-[calc(100vh-180px)]"
            onclick={togglePanel}
            aria-label="Open unscheduled tasks drawer"
            title="Unscheduled tasks ({unassignedTasks.length})"
        >
            <span class="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-indigo-500 text-white text-[10px] font-semibold">{unassignedTasks.length}</span>
            <span class="text-gray-400 text-[10px] font-medium uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">Unscheduled</span>
        </button>
    {:else}
        <div
            class="shrink-0 bg-gray-800 rounded-lg relative flex flex-col sticky top-2 self-start h-[calc(100vh-180px)]"
            style="width: {panelWidth}px;"
        >
            <div class="bg-gray-800 flex items-center justify-between px-2 pt-2 pb-1 rounded-t-lg shrink-0">
                <div class="text-xs text-gray-400 font-medium uppercase">Unscheduled ({unassignedTasks.length})</div>
                <button
                    type="button"
                    class="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                    onclick={togglePanel}
                    aria-label="Close unscheduled tasks drawer"
                    title="Close"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                {#each unassignedTasks as task (task.key)}
                    <div
                        class="text-xs p-2 mb-1 rounded bg-gray-700 text-white cursor-move hover:bg-indigo-600 transition-colors"
                        class:opacity-50={draggedTask?.key === task.key}
                        draggable="true"
                        ondragstart={(e) => handleDragStart(e, task.key, task)}
                        ondragend={handleDragEnd}
                        onclick={() => handleTaskClick(task.key, task)}
                        onkeydown={(e) => e.key === 'Enter' && handleTaskClick(task.key, task)}
                        role="button"
                        tabindex="0"
                    >
                        <div class="font-bold truncate">{task.title || 'Untitled'}</div>
                        {#if task.type}
                            <div class="text-gray-400 mt-0.5">{task.type}</div>
                        {/if}
                    </div>
                {/each}
                {#if unassignedTasks.length === 0}
                    <div class="text-xs text-gray-500 text-center py-4">No unscheduled tasks</div>
                {/if}
            </div>
            <button
                type="button"
                class="shrink-0 mx-2 mb-2 mt-1 px-2 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors"
                onclick={addNewTask}
                title="Add task"
            >
                <Plus size="14" />
                Add Task
            </button>
        </div>
        <div
            class="w-1 shrink-0 self-stretch cursor-col-resize bg-transparent hover:bg-indigo-500/50 transition-colors touch-none"
            class:bg-indigo-500={panelResizeState}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize unassigned tasks panel"
            onpointerdown={handlePanelResizeStart}
            onpointermove={handlePanelResizeMove}
            onpointerup={handlePanelResizeEnd}
            onpointercancel={handlePanelResizeEnd}
    ></div>
    {/if}
    <!-- Calendar views -->
    <div class="flex-1 min-w-0">

    {#if viewMode === 'month'}
        <div class="grid grid-cols-7 gap-px bg-gray-700">
            {#each ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as day}
                <div class="p-2 text-center text-gray-400 font-medium bg-gray-800">
                    {day}
                </div>
            {/each}
            
            {#each monthData as date}
                {@const dateEvents = getDayEvents(date)}
                {@const stays = getStaysForDay(date)}
                <button 
                    class="p-2 min-h-[100px] text-left bg-gray-800 relative group transition-colors hover:bg-gray-700"
                    class:opacity-50={!isCurrentMonth(date)}
                    class:ring-2={isSelected(date)}
                    class:ring-white={isSelected(date)}
                    class:bg-indigo-900={dragOverDate?.toDateString() === date.toDateString()}
                    class:bg-opacity-50={dragOverDate?.toDateString() === date.toDateString()}
                    onclick={() => handleDateClick(date)}
                    ondragover={(e) => handleDragOver(e, date)}
                    ondragleave={handleDragLeave}
                    ondrop={(e) => handleDrop(e, date)}
                >
                    <span 
                        class="inline-flex w-8 h-8 items-center justify-center rounded-full text-white
                        {isToday(date) ? 'bg-indigo-500' : ''}"
                    >
                        {date.getDate()}
                    </span>
                    
                    <div class="mt-1 space-y-1">
                        {#each stays as stay}
                            <div 
                                class="text-xs p-1 truncate flex items-center gap-1 relative {getStayStyle(date, stay.profile, stay.userId)}"
                                class:mt-px={!stay.isArrival}
                                class:mb-px={!stay.isDeparture}
                                class:z-10={stay.isArrival || stay.isDeparture}
                                class:z-0={!stay.isArrival && !stay.isDeparture}
                                style="background-color: {getUserColor(stay.userId)};"
                            >
                                {#if stay.isArrival}
                                    <span>🛬</span>
                                {/if}
                                <span class="truncate">{stay.user.first_name}</span>
                                {#if stay.isDeparture}
                                    <span>🛫</span>
                                {/if}
                            </div>
                        {/each}
                        
                        {#each dateEvents.slice(0, 3) as event}
                            {#if event.id && tasks[event.id]}
                                <!-- This is a task, make it draggable -->
                                <div
                                    class="text-xs p-1 rounded bg-opacity-90 truncate cursor-move"
                                    class:opacity-50={draggedTask?.key === event.id}
                                    style="background-color: {event.color || '#4B5563'}"
                                    draggable="true"
                                    ondragstart={(e) => handleDragStart(e, event.id, event)}
                                    ondragend={handleDragEnd}
                                    role="listitem"
                                    aria-label="Drag task: {event.title}"
                                >
                                    {event.title}
                                </div>
                            {:else}
                                <!-- Regular event, not draggable -->
                                <div 
                                    class="text-xs p-1 rounded bg-opacity-90 truncate"
                                    style="background-color: {event.color || '#4B5563'}"
                                >
                                    {event.title}
                                </div>
                            {/if}
                        {/each}
                        {#if dateEvents.length > 3}
                            <div class="text-xs text-gray-400">
                                +{dateEvents.length - 3} more
                            </div>
                        {/if}
                    </div>
                </button>
            {/each}
        </div>
    {:else if viewMode === 'week'}
        <div class="grid grid-cols-7 gap-px bg-gray-700">
            {#each weekData as date}
                <div class="bg-gray-800 relative">
                    <div class="p-2 text-center border-b border-gray-700">
                        <div class="text-gray-400 font-medium">
                            {date.toLocaleString('default', { weekday: 'short' })}
                        </div>
                        <div 
                            class="inline-flex w-8 h-8 items-center justify-center rounded-full text-white mt-1
                            {isToday(date) ? 'bg-indigo-500' : ''}"
                        >
                            {date.getDate()}
                        </div>
                    </div>
                    
                    <div class="relative">
                        <div class="divide-y divide-gray-700">
                            {#each Array(18) as _, i}
                                {@const hour = i + 6}
                                <div
                                    class="p-1 min-h-[48px] group hover:bg-gray-700 transition-colors relative"
                                    class:bg-indigo-100={dragOverDate?.toDateString() === date.toDateString() && dragOverTime === hour}
                                    class:bg-opacity-10={dragOverDate?.toDateString() === date.toDateString() && dragOverTime === hour}
                                    ondragover={(e) => handleDragOver(e, date, hour)}
                                    ondragleave={handleDragLeave}
                                    ondrop={(e) => handleDrop(e, date, hour)}
                                    role="gridcell"
                                    aria-label="Time slot {hour}:00"
                                    tabindex="0"
                                >
                                    <div class="text-xs text-gray-500 group-hover:text-gray-400">
                                        {hour.toString().padStart(2, '0')}:00
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- Tasks for this day -->
                        {#each calculateEventColumns(expandedTaskEntries.filter(e => e.task.when && new Date(e.task.when).toDateString() === date.toDateString()).map(e => ({key: e.key, task: e.task}))) as {key, task, column, totalColumns} (key)}
                            {@const overrideEnd = resizingEvent?.key === key ? resizingEvent.previewEnd : undefined}
                            {@const position = getTaskPosition(task, overrideEnd)}
                            {@const columnWidth = totalColumns > 1 ? `calc((100% - ${totalColumns * 2}px) / ${totalColumns})` : 'calc(100% - 0.5rem)'}
                            {@const leftOffset = totalColumns > 1 ? `calc(0.25rem + ${column} * ((100% - ${totalColumns * 2}px) / ${totalColumns}) + ${column * 2}px)` : '0.25rem'}
                            {@const startHour = new Date(task.when).getHours()}
                            {@const endHour = (overrideEnd ?? (task.ends ? new Date(task.ends) : null))?.getHours() ?? startHour + 1}
                            {@const isShortEvent = (position.gridRowEnd - position.gridRowStart) <= 2}
                            <div
                                class="rounded bg-indigo-500 bg-opacity-90 text-white cursor-move hover:bg-indigo-400 transition-colors absolute z-10 overflow-hidden"
                                class:opacity-50={draggedTask?.key === key}
                                class:ring-2={resizingEvent?.key === key}
                                class:ring-white={resizingEvent?.key === key}
                                class:text-xs={!isShortEvent}
                                class:text-[10px]={isShortEvent}
                                class:p-1={isShortEvent}
                                class:p-2={!isShortEvent}
                                draggable="true"
                                ondragstart={(e) => handleDragStart(e, key, task)}
                                ondragend={handleDragEnd}
                                onclick={(e) => { e.stopPropagation(); handleTaskClick(key, task); }}
                                onkeydown={(e) => e.key === 'Enter' && handleTaskClick(key, task)}
                                role="button"
                                tabindex="0"
                                title={task.title || 'Untitled'}
                                style="top: {(position.gridRowStart - 1) * 48}px; height: {(position.gridRowEnd - position.gridRowStart) * 48}px; left: {leftOffset}; width: {columnWidth};"
                            >
                                <div class="font-bold truncate leading-tight">
                                    {#if totalColumns > 2 && task.title.length > 15}
                                        {task.title.substring(0, 12)}...
                                    {:else if totalColumns > 1 && task.title.length > 20}
                                        {task.title.substring(0, 17)}...
                                    {:else}
                                        {task.title}
                                    {/if}
                                </div>
                                {#if !isShortEvent}
                                    <div class="opacity-75 leading-tight" class:text-[9px]={totalColumns > 2}>
                                        {startHour}:00{endHour !== startHour ? ` - ${endHour}:00` : ''}
                                    </div>
                                    {#if task.location && !isShortEvent && totalColumns <= 2}
                                        <div class="opacity-75 truncate leading-tight" class:text-[9px]={totalColumns > 1}>
                                            📍 {task.location.length > 15 ? task.location.substring(0, 12) + '...' : task.location}
                                        </div>
                                    {/if}
                                {:else}
                                    <!-- For short events, show only time on the same line -->
                                    <div class="opacity-75 text-[9px] leading-none">
                                        {startHour}:00
                                    </div>
                                {/if}
                                {#if totalColumns > 3}
                                    <!-- For very crowded layouts, add a subtle indicator -->
                                    <div class="absolute top-0 right-0 w-2 h-2 bg-white bg-opacity-30 rounded-bl-md"></div>
                                {/if}
                                <div
                                    class="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize touch-none hover:bg-white/40"
                                    role="separator"
                                    aria-orientation="horizontal"
                                    aria-label="Resize event end time"
                                    onpointerdown={(e) => handleEventResizeStart(e, key, task)}
                                    onpointermove={handleEventResizeMove}
                                    onpointerup={handleEventResizeEnd}
                                    onpointercancel={handleEventResizeCancel}
                                ></div>
                            </div>
                        {/each}

                        <!-- Imported calendar events for this day -->
                        {#each visibleExternalEvents.filter(ev => new Date(ev.start).toDateString() === date.toDateString()) as ev (ev.id)}
                            {@const extTask = { when: new Date(ev.start).toISOString(), ends: new Date(ev.end).toISOString() }}
                            {@const position = getTaskPosition(extTask)}
                            <div
                                class="absolute right-0 rounded text-white text-[9px] leading-tight p-0.5 overflow-hidden z-20 cursor-default shadow"
                                style="top: {(position.gridRowStart - 1) * 48}px; height: {(position.gridRowEnd - position.gridRowStart) * 48}px; width: 3.5rem; background-color: {ev.calendarColor || '#10b981'};"
                                title={`${ev.title}${ev.calendarName ? ' · ' + ev.calendarName : ''}`}
                                aria-label={ev.title}
                            >
                                <div class="truncate font-medium">{ev.title}</div>
                            </div>
                        {/each}

                        {#if now.toDateString() === date.toDateString()}
                            {@const timePosition = getCurrentTimePosition()}
                            {#if timePosition.isVisible}
                                <div 
                                    class="absolute inset-x-0 z-30 pointer-events-none"
                                    style="top: {timePosition.position}px;"
                                >
                                    <div class="relative flex items-center">
                                        <div class="absolute right-full pr-2">
                                            <span class="text-red-500 text-xs font-medium bg-gray-800 px-1 rounded">
                                                {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
                                            </span>
                                        </div>
                                        <div class="absolute -left-1 w-2 h-2 bg-red-500 rounded-full"></div>
                                        <div class="w-full h-px bg-gradient-to-r from-red-500 via-red-500/50 to-transparent"></div>
                                    </div>
                                </div>
                            {/if}
                        {/if}

                        {#each events[date.toDateString()] || [] as event}
                            <div 
                                class="text-xs p-1 rounded bg-opacity-90 truncate mt-1"
                                style="background-color: {event.color || '#4B5563'}"
                            >
                                {event.title}
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        </div>
    {:else if viewMode === 'day'}
        <div class="bg-gray-800">
            <div class="p-2 text-center border-b border-gray-700">
                <div class="text-gray-400 font-medium">
                    {currentDate.toLocaleString('default', { weekday: 'long' })}
                </div>
                <div 
                    class="inline-flex w-8 h-8 items-center justify-center rounded-full text-white mt-1
                    {isToday(currentDate) ? 'bg-indigo-500' : ''}"
                >
                    {currentDate.getDate()}
                </div>
            </div>
            
            <div class="relative">
                <div class="divide-y divide-gray-700">
                    {#each Array(18) as _, i}
                        {@const hour = i + 6}
                        <div 
                            class="p-1 min-h-[48px] group hover:bg-gray-700 transition-colors relative"
                            class:bg-indigo-100={dragOverDate?.toDateString() === currentDate.toDateString() && dragOverTime === hour}
                            class:bg-opacity-10={dragOverDate?.toDateString() === currentDate.toDateString() && dragOverTime === hour}
                            onclick={() => {
                                const eventDate = new Date(currentDate);
                                eventDate.setHours(hour);
                                handleDateClick(eventDate);
                            }}
                            onkeydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    const eventDate = new Date(currentDate);
                                    eventDate.setHours(hour);
                                    handleDateClick(eventDate);
                                }
                            }}
                            ondragover={(e) => handleDragOver(e, currentDate, hour)}
                            ondragleave={handleDragLeave}
                            ondrop={(e) => handleDrop(e, currentDate, hour)}
                            role="button"
                            tabindex="0"
                        >
                            <div class="text-xs text-gray-500 group-hover:text-gray-400">
                                {hour.toString().padStart(2, '0')}:00
                            </div>
                        </div>
                    {/each}
                </div>

                <!-- Tasks for this day -->
                {#each calculateEventColumns(expandedTaskEntries.filter(e => e.task.when && new Date(e.task.when).toDateString() === currentDate.toDateString()).map(e => ({key: e.key, task: e.task}))) as {key, task, column, totalColumns} (key)}
                    {@const overrideEnd = resizingEvent?.key === key ? resizingEvent.previewEnd : undefined}
                    {@const position = getTaskPosition(task, overrideEnd)}
                    {@const columnWidth = totalColumns > 1 ? `calc((100% - ${totalColumns * 2}px - 0.5rem) / ${totalColumns})` : 'calc(100% - 0.5rem)'}
                    {@const leftOffset = totalColumns > 1 ? `calc(0.25rem + ${column} * ((100% - ${totalColumns * 2}px - 0.5rem) / ${totalColumns} + 2px))` : '0.25rem'}
                    <div
                        class="text-xs p-2 rounded bg-indigo-500 bg-opacity-90 text-white cursor-move hover:bg-indigo-400 transition-colors absolute z-10 overflow-hidden"
                        class:opacity-50={draggedTask?.key === key}
                        class:ring-2={resizingEvent?.key === key}
                        class:ring-white={resizingEvent?.key === key}
                        draggable="true"
                        ondragstart={(e) => handleDragStart(e, key, task)}
                        ondragend={handleDragEnd}
                        onclick={(e) => { e.stopPropagation(); handleTaskClick(key, task); }}
                        onkeydown={(e) => e.key === 'Enter' && handleTaskClick(key, task)}
                        role="button"
                        tabindex="0"
                        title={task.title || 'Untitled'}
                        style="top: {(position.gridRowStart - 1) * 48}px; height: {(position.gridRowEnd - position.gridRowStart) * 48}px; left: {leftOffset}; width: {columnWidth};"
                    >
                        <div class="font-bold truncate">{task.title}</div>
                        <div class="text-xs opacity-75">
                            {position.startTime} - {position.endTime}
                        </div>
                        {#if task.location}
                            <div class="text-xs opacity-75 truncate">{task.location}</div>
                        {/if}
                        {#if task.participants?.length}
                            <div class="text-xs mt-1">
                                🙋‍♂️ {task.participants.length}
                            </div>
                        {/if}
                        <div
                            class="absolute left-0 right-0 bottom-0 h-2 cursor-ns-resize touch-none hover:bg-white/40"
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label="Resize event end time"
                            draggable="false"
                            onmousedown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                            ontouchstart={(e) => e.stopPropagation()}
                            onclick={(e) => e.stopPropagation()}
                            onpointerdown={(e) => handleEventResizeStart(e, key, task)}
                            onpointermove={handleEventResizeMove}
                            onpointerup={handleEventResizeEnd}
                            onpointercancel={handleEventResizeCancel}
                        ></div>
                    </div>
                {/each}

                <!-- Imported calendar events for this day (fixed-width column on the right edge, above tasks) -->
                {#each visibleExternalEvents.filter(ev => new Date(ev.start).toDateString() === currentDate.toDateString()) as ev (ev.id)}
                    {@const extTask = { when: new Date(ev.start).toISOString(), ends: new Date(ev.end).toISOString() }}
                    {@const position = getTaskPosition(extTask)}
                    <div
                        class="absolute right-1 rounded text-white text-[10px] leading-tight p-1 overflow-hidden z-20 cursor-default shadow"
                        style="top: {(position.gridRowStart - 1) * 48}px; height: {(position.gridRowEnd - position.gridRowStart) * 48}px; width: 7rem; background-color: {ev.calendarColor || '#10b981'};"
                        title={`${ev.title}${ev.calendarName ? ' · ' + ev.calendarName : ''}`}
                        aria-label={ev.title}
                    >
                        <div class="truncate font-medium">{ev.title}</div>
                        {#if ev.calendarName}
                            <div class="truncate opacity-80 text-[9px]">{ev.calendarName}</div>
                        {/if}
                    </div>
                {/each}

                <!-- Show arrivals/departures at noon -->
                <div 
                    style="grid-row: 13"
                    class="relative z-20"
                >
                    {#each Object.entries(profiles) as [userId, profile]}
                        {@const arrival = new Date(profile.arrival)}
                        {@const departure = new Date(profile.departure)}
                        {@const isToday = arrival.toDateString() === currentDate.toDateString() || 
                                                departure.toDateString() === currentDate.toDateString()}
                        {#if isToday}
                            <div
                                class="text-xs p-1 rounded text-white mt-1"
                                style="background-color: {getUserColor(userId)};"
                            >
                                <div class="font-bold">
                                    {#if arrival.toDateString() === currentDate.toDateString() && users[userId]}
                                        🛬 {users[userId]?.first_name || 'Loading...'} arrives
                                    {:else}
                                        🛫 {users[userId]?.first_name || 'Loading...'} departs
                                    {/if}
                                </div>
                            </div>
                        {/if}
                    {/each}
                </div>

                <!-- Add current time indicator -->
                {#if now.toDateString() === currentDate.toDateString()}
                    {@const timePosition = getCurrentTimePosition()}
                    {#if timePosition.isVisible}
                        <div 
                            class="absolute inset-x-0 z-30 pointer-events-none"
                            style="top: {timePosition.position}px;"
                        >
                            <div class="relative flex items-center">
                                <div class="absolute right-full pr-2">
                                    <span class="text-red-500 text-xs font-medium bg-gray-800 px-1 rounded">
                                        {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
                                    </span>
                                </div>
                                <div class="absolute -left-1 w-2 h-2 bg-red-500 rounded-full"></div>
                                <div class="w-full h-px bg-gradient-to-r from-red-500 via-red-500/50 to-transparent"></div>
                            </div>
                        </div>
                    {/if}
                {/if}
            </div>
        </div>
    {:else if viewMode === 'orbits'}
        <!-- Orbital Visualization View -->
        <div class="bg-gray-800">
            <div
                class="w-full"
                style="min-height: calc(100vh - 400px); height: 600px;"
                bind:this={container}
            ></div>

            <!-- Dynamic Legend based on actual task categories -->
            {#if Object.keys(orbitStore).length > 0}
                {@const categories = [...new Set(Object.values(orbitStore).map(task => task.category).filter(Boolean))]}
                {#if categories.length > 0}
                    <div class="mt-2 bg-gray-800 rounded-lg p-2 border-t border-gray-700">
                        <div class="text-xs text-gray-400 font-medium mb-2 uppercase">Categories</div>
                        <div class="flex flex-wrap gap-4">
                            {#each categories as category}
                                {#if category}
                                    <div class="flex items-center gap-2 text-xs text-white">
                                        <div class="w-3 h-3 rounded-full" style="background-color: {categoryColors[category] || categoryColors.default};"></div>
                                        <span class="capitalize">{category}</span>
                                    </div>
                                {/if}
                            {/each}
                        </div>
                    </div>
                {/if}
            {/if}
        </div>
    {/if}

    </div><!-- end calendar views -->
    </div><!-- end flex layout -->
</div>

<!-- Orbital Task Details Modal -->
{#if showOrbitTaskDetails && selectedOrbitTask}
    <div class="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
        <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-start p-4 border-b border-gray-700">
                <div class="flex-1 mr-4">
                    <h2 class="text-lg font-medium text-white">{selectedOrbitTask.title}</h2>
                    <p class="text-gray-400 text-xs mt-1 uppercase">Recurring task</p>
                </div>
                <button
                    class="text-gray-400 hover:text-white transition-colors"
                    onclick={closeOrbitTaskDetails}
                    aria-label="Close modal"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="p-4 space-y-3 text-sm">
                {#if selectedOrbitTask.description}
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Description</div>
                        <div class="text-white">{selectedOrbitTask.description}</div>
                    </div>
                {/if}
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Category</div>
                        <div class="text-white flex items-center gap-2">
                            <div class="w-3 h-3 rounded-full" style="background-color: {categoryColors[selectedOrbitTask.category as keyof typeof categoryColors] || categoryColors.default};"></div>
                            <span class="capitalize">{selectedOrbitTask.category || 'Uncategorized'}</span>
                        </div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Frequency</div>
                        <div class="text-white capitalize">{selectedOrbitTask.frequency}</div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Orbit period</div>
                        <div class="text-white">{selectedOrbitTask.orbitPeriod} days</div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Time to next</div>
                        <div class="text-indigo-400 font-medium">
                            {formatDuration(calculateTimeToOccurrence(selectedOrbitTask, currentDate.toDateString() === new Date().toDateString() ? new Date() : currentDate))}
                            {#if currentDate.toDateString() !== new Date().toDateString()}
                                <span class="text-xs text-gray-400 block">(from selected date)</span>
                            {/if}
                        </div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Last occurrence</div>
                        <div class="text-white">{selectedOrbitTask.lastOccurrence.toLocaleDateString()}</div>
                    </div>
                    <div>
                        <div class="text-xs text-gray-400 uppercase mb-1">Next occurrence</div>
                        <div class="text-white">{selectedOrbitTask.nextOccurrence.toLocaleDateString()}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

{#if selectedTask?.id && selectedTask?.task && $ID}
    <TaskModal
        quest={selectedTask.task}
        questId={selectedTask.id}
        holonId={$ID}
        occurrenceWhen={selectedTask.occurrenceWhen}
        on:close={closeTaskModal}
    />
{/if}

</div>

<!-- Calendar Settings Modal -->
<CalendarSettings
    bind:show={showCalendarSettings}
    on:calendarsUpdated={handleCalendarsUpdated}
/>

<style>
    button {
        transition: all 0.2s ease;
    }

    /* Add these new styles */
    .mt-px {
        margin-top: 1px;
    }
    
    .mb-px {
        margin-bottom: 1px;
    }
    
    /* Ensure the calendar grid has no gaps */
    :global(.grid.grid-cols-7) {
        gap: 1px;
        margin: -1px;
        padding: 1px;
    }

    .scheduleContainer {
        display: grid;
        grid-template-columns: 5rem 1fr;
        grid-template-rows: repeat(32, minmax(3rem, auto));
        gap: 1px;
        position: relative;
    }

    .event {
        position: relative;
        overflow: hidden;
        z-index: 1;
    }

    .divide-y > div {
        position: relative;
        height: 48px;
    }
    
    .divide-y {
        display: grid;
        grid-template-rows: repeat(18, 48px);
        position: relative;
        height: 864px; /* 18 rows * 48px */
        overflow-y: auto;
    }

    /* Responsive improvements for split events */
    @media (max-width: 768px) {
        .divide-y {
            grid-template-rows: repeat(18, 40px);
            height: 720px; /* 18 rows * 40px */
        }
    }

    /* Ensure proper text truncation in narrow columns */
    .truncate {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    /* Better spacing for split events */
    .leading-tight {
        line-height: 1.1;
    }
</style> 