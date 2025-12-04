<script lang="ts">
    import { createEventDispatcher,getContext, onMount, onDestroy } from 'svelte';
    import HoloSphere from 'holosphere';
    import { ID } from "../dashboard/store";
    import Timeline from './Timeline.svelte';
    import CalendarSettings from './CalendarSettings.svelte';
    import { formatDate } from "../utils/date";
    import * as d3 from "d3";
    import { fetchAndParseICalFeed, filterEventsByDateRange, type ExternalCalendarEvent } from '../lib/services/icalParser';

    interface CalendarEvents {
        dateSelect: { date: Date; events: any[] };
    }
    const dispatch = createEventDispatcher<CalendarEvents>();

    const holosphere = getContext("holosphere") as HoloSphere;

    // Calendar state
    let currentDate = new Date();
    let selectedDate: Date | null = null;
    let events: { [key: string]: any[] } = {};
    let tasks: Record<string, any> = {};
    let monthTasks: any[] = [];
    let monthProfiles: any[] = [];
    let showModal = false;
    let selectedTask: { id: string; task: any } | null = null;
    let tempDate: string;
    let tempTime: string;
    let tempEndTime: string;
    
    // View options: 'month', 'week', 'day', 'orbits'
    let viewMode: 'grid' | 'list' | 'canvas' | 'month' | 'week' | 'day' | 'orbits' = 'week';
    
    // Drag and drop state
    let draggedTask: { key: string; task: any } | null = null;
    let dragOverDate: Date | null = null;
    let dragOverTime: number | null = null; // Hour of day (0-23)
    
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
        loadProfiles();
        loadTasks();
        loadImportedCalendars();

        // Set up periodic sync for imported calendars
        syncInterval = setInterval(() => {
            syncAllCalendars();
        }, SYNC_INTERVAL_MS);

        // Add resize listener for orbital view
        window.addEventListener('resize', handleResize);

        return () => {
            clearInterval(currentTimeInterval);
        };
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
                   
                    // Load profile for this user
                    try {
                        const profile = await holosphere.get(userData.id, 'profile', userData.id );
                        console.log("profile found:",profile)
                        if (profile) {
                            profiles[canonicalKey] = profile;
                            profiles = profiles; // Trigger reactivity
                        }
                    } catch (error) {
                        console.error(`Error loading profile for user ${canonicalKey}:`, error);
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
        const dayExternalEvents = externalEvents
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
                color: '#10b981', // Green color for external events
                isExternalEvent: true,
                calendarName: event.calendarName
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

    function loadTasks() {
        if (!holosphere || !$ID) return;

        holosphere.subscribe($ID, 'quests', (newTask: any, key?: string) => {
            if (!key) return; // Skip if no key
            if (newTask) {
                const task = newTask;
                if (task.when) {
                    tasks[key] = task;
                    tasks = tasks;
                } else {
                    // If task exists but has no 'when' field, remove it from calendar display
                    delete tasks[key];
                    tasks = tasks;
                }
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
                // Sync calendars after loading
                await syncAllCalendars();
            }
        } catch (err) {
            console.error('Error loading imported calendars:', err);
        }
    }

    // Sync all enabled imported calendars
    async function syncAllCalendars() {
        if (importedCalendars.length === 0) return;

        const enabledCalendars = importedCalendars.filter(cal => cal.enabled);
        const allEvents: ExternalCalendarEvent[] = [];

        for (const calendar of enabledCalendars) {
            try {
                const parsed = await fetchAndParseICalFeed(calendar.url, calendar.name);
                // Add calendar info to each event
                const eventsWithCal = parsed.events.map(event => ({
                    ...event,
                    calendarName: calendar.name
                }));
                allEvents.push(...eventsWithCal);
            } catch (error) {
                console.error(`Error syncing calendar ${calendar.name}:`, error);
            }
        }

        externalEvents = allEvents;
    }

    // Handle calendar settings update
    function handleCalendarsUpdated() {
        loadImportedCalendars();
    }

    // Make monthTasks reactive to changes in tasks
    $: {
        const month = currentDate.getMonth();
        const year = currentDate.getFullYear();
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);

        // Filter tasks for current month - this will react to changes in tasks
        monthTasks = Object.entries(tasks)
            .filter(([_, task]) => {
                if (!task.when) return false;
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

    function handleTaskClick(key: string, task: any) {
        selectedTask = { id: key, task };
        const date = new Date(task.when);
        const endDate = task.ends ? new Date(task.ends) : new Date(date.getTime() + 60*60*1000);
        tempDate = date.toISOString().split('T')[0];
        tempTime = date.toTimeString().slice(0, 5);
        tempEndTime = endDate.toTimeString().slice(0, 5);
        showModal = true;
    }

    function updateDateTime() {
        if (!selectedTask || !$ID) return;
        
        const newDate = new Date(`${tempDate}T${tempTime}`);
        const endDate = new Date(`${tempDate}T${tempEndTime}`);
        const updatedTask = {
            ...selectedTask.task,
            when: newDate.toISOString(),
            ends: endDate.toISOString()
        };
        
        showModal = false;
        selectedTask = null;
        
        try {
            holosphere.put($ID, 'quests', updatedTask);
        } catch (error) {
            console.error('Error updating task:', error);
        }
    }

    function deleteSchedule() {
        if (!selectedTask || !$ID) return;

        try {
            const taskKey = selectedTask.id;
            const updatedTask = {
                ...selectedTask.task,
                when: null,
                status: 'ongoing'
            };
            
            // Immediately remove from local state for instant UI update
            delete tasks[taskKey];
            tasks = tasks; // Trigger reactivity
            
            showModal = false;
            selectedTask = null;
            
            holosphere.put($ID, 'quests', updatedTask);
        } catch (error) {
            console.error('Error removing schedule:', error);
            // On error, we might want to restore the task, but for now just log
        }
    }

    // Drag and drop handlers
    function handleDragStart(event: DragEvent, key: string, task: any) {
        if (!event.dataTransfer) return;
        
        draggedTask = { key, task };
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
    function getTaskPosition(task: any) {
        const startTime = new Date(task.when);
        const endTime = task.ends ? new Date(task.ends) : new Date(startTime.getTime() + 60*60*1000);
        
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
            
            // Find quests that have a recurringTaskID field or are recurring
            const recurringQuests = quests.filter((quest: any) => {
                const hasRecurringID = quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId;
                const isRecurring = quest.status === 'recurring' || quest.type === 'recurring' || quest.status === 'repeating';
                return hasRecurringID || isRecurring;
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
    function calculateOrbitalPosition(task: RecurringTask, time: Date): { x: number; y: number; angle: number; progress: number } {
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
        
        // Calculate progress through the current cycle
        // When timeToNext = periodMs (full cycle remaining), progress = 0 (at start/12 o'clock)
        // When timeToNext = 0 (no time remaining), progress = 1 (full circle completed)
        const progress = Math.max(0, Math.min(1, (periodMs - timeToNext) / periodMs));
        const angle = progress * 2 * Math.PI;
        
        // Adjust angle so 0 is at the top (12 o'clock) instead of right side (3 o'clock)
        const adjustedAngle = angle - Math.PI / 2;
        
        const x = centerX + task.orbitRadius * Math.cos(adjustedAngle);
        const y = centerY + task.orbitRadius * Math.sin(adjustedAngle);
        
        return { x, y, angle: adjustedAngle, progress };
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

        // Create SVG
        svg = d3.select(container)
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .style('background', 'radial-gradient(circle at center, #1e1b4b 0%, #0f0f23 50%, #000000 100%)'); // Mystical indigo gradient

        // Add orbital rings
        const uniqueRadii = [...new Set(Object.values(orbitStore).map(task => task.orbitRadius))].sort((a, b) => a - b);
        
        uniqueRadii.forEach(radius => {
            svg.append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', radius)
                .attr('fill', 'none')
                .attr('stroke', '#6366F1')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '5,5')
                .attr('opacity', 0.4)
                .style('filter', 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.3))');
        });

        // Add mystical center point
        svg.append('circle')
            .attr('cx', centerX)
            .attr('cy', centerY)
            .attr('r', 6)
            .attr('fill', '#6366F1')
            .attr('stroke', '#8B5CF6')
            .attr('stroke-width', 3)
            .style('filter', 'drop-shadow(0 0 12px rgba(99, 102, 241, 0.8))');

        // Add mystical "NOW" indicator line (from center to edge of visualization)
        const edgeY = Math.min(50, centerY - 50); // Go to edge or at least 50px from center
        svg.append('line')
            .attr('x1', centerX)
            .attr('y1', centerY)
            .attr('x2', centerX)
            .attr('y2', edgeY)
            .attr('stroke', '#8B5CF6') // Mystical violet
            .attr('stroke-width', 2.5)
            .attr('stroke-dasharray', '5,5')
            .style('filter', 'drop-shadow(0 0 6px rgba(139, 92, 246, 0.5))');

        // Add mystical "NOW" label at the end of the line
        svg.append('text')
            .attr('x', centerX)
            .attr('y', edgeY - 10)
            .attr('fill', '#A855F7')
            .attr('font-size', '12px')
            .attr('font-weight', '600')
            .attr('text-anchor', 'middle')
            .style('filter', 'drop-shadow(0 0 4px rgba(168, 85, 247, 0.6))')
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
            const timeToOccurrence = calculateTimeToOccurrence(task, visualizationTime);
            const categoryColor = categoryColors[task.category as keyof typeof categoryColors] || categoryColors.default;
            
            // Debug: Log unusual timer values (can be removed in production)
            if (timeToOccurrence < 60000) { // Less than 1 minute
                console.log(`Timer near zero for ${task.title}: ${Math.round(timeToOccurrence / 1000)}s remaining`);
            }
            
            // Add mystical orbit trail
            svg.append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', task.orbitRadius)
                .attr('fill', 'none')
                .attr('stroke', categoryColor)
                .attr('stroke-width', 2.5)
                .attr('opacity', 0.15)
                .attr('stroke-dasharray', '8,8')
                .classed('orbit-trail', true)
                .style('filter', 'drop-shadow(0 0 4px rgba(99, 102, 241, 0.2))');

            // Add planet
            const planetGroup = svg.append('g')
                .classed('planet', true)
                .attr('transform', `translate(${position.x}, ${position.y})`);

            // Mystical planet body
            planetGroup.append('circle')
                .attr('r', 12)
                .attr('fill', categoryColor)
                .attr('stroke', '#E0E7FF')
                .attr('stroke-width', 2)
                .attr('filter', 'drop-shadow(0 0 8px rgba(99, 102, 241, 0.6))');

            // Enhanced mystical glow effect
            planetGroup.append('circle')
                .attr('r', 20)
                .attr('fill', 'none')
                .attr('stroke', categoryColor)
                .attr('stroke-width', 1.5)
                .attr('opacity', 0.4)
                .style('filter', 'blur(2px)');

            // Task title
            planetGroup.append('text')
                .attr('x', 0)
                .attr('y', -20)
                .attr('fill', '#ffffff')
                .attr('font-size', '10px')
                .attr('text-anchor', 'middle')
                .attr('font-weight', '600')
                .text(task.title.length > 12 ? task.title.substring(0, 12) + '...' : task.title);

            // Time to occurrence indicator
            const timeText = formatDuration(timeToOccurrence);
            const timeColor = timeToOccurrence < 60000 ? '#ef4444' : '#94a3b8'; // Red when < 1 minute, gray otherwise
            
            planetGroup.append('text')
                .attr('x', 0)
                .attr('y', 30)
                .attr('fill', timeColor)
                .attr('font-size', '8px')
                .attr('text-anchor', 'middle')
                .attr('font-weight', timeToOccurrence < 60000 ? 'bold' : 'normal')
                .text(timeText);

            // Progress indicator
            const progressAngle = position.progress * 360;
            planetGroup.append('circle')
                .attr('r', 8)
                .attr('fill', 'none')
                .attr('stroke', '#ffffff')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', `${progressAngle / 360 * 50.24}, 50.24`)
                .attr('transform', 'rotate(90)'); // Start at 12 o'clock (top)

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

<Timeline 
    currentDate={currentDate}
    profiles={profiles}
    users={users}
    on:dateSelect={handleTimelineDateSelect}
/>

<div class="bg-gray-800 rounded-3xl p-6">
    <div class="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
        <div class="flex items-center gap-4">
            <div class="flex gap-2">
                <!-- svelte-ignore a11y_consider_explicit_label -->
                <button
                    class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                    on:click={() => handleNavigation(-1)}
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                    </svg>
                </button>
                <button
                    class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                    on:click={() => handleNavigation(1)}
                    aria-label="Next period"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </button>
            </div>
            <h2 class="text-xl sm:text-2xl font-bold text-white">
                {#if viewMode === 'month'}
                    {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
                {:else if viewMode === 'week'}
                    {weekData[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} -
                    {weekData[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                {:else}
                    {currentDate.toLocaleString('default', { month: 'long', day: 'numeric', year: 'numeric' })}
                {/if}
            </h2>
        </div>
        <div class="flex gap-2 flex-wrap items-center">
            <button
                class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                on:click={() => showCalendarSettings = true}
                aria-label="Calendar settings"
                title="Calendar Settings - Import/Export"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
            </button>
            <button 
                class="px-3 sm:px-4 py-2 rounded-lg {viewMode === 'day' ? 'bg-gray-600' : 'bg-gray-700'} text-white hover:bg-gray-600 transition-colors text-sm sm:text-base"
                on:click={() => handleViewModeChange('day')}
            >
                Day
            </button>
            <button 
                class="px-3 sm:px-4 py-2 rounded-lg {viewMode === 'week' ? 'bg-gray-600' : 'bg-gray-700'} text-white hover:bg-gray-600 transition-colors text-sm sm:text-base"
                on:click={() => handleViewModeChange('week')}
            >
                Week
            </button>
            <button 
                class="px-3 sm:px-4 py-2 rounded-lg {viewMode === 'month' ? 'bg-gray-600' : 'bg-gray-700'} text-white hover:bg-gray-600 transition-colors text-sm sm:text-base"
                on:click={() => handleViewModeChange('month')}
            >
                Month
            </button>
            <button 
                class="px-3 sm:px-4 py-2 rounded-lg {viewMode === 'orbits' ? 'bg-gray-600' : 'bg-gray-700'} text-white hover:bg-gray-600 transition-colors text-sm sm:text-base"
                on:click={() => handleViewModeChange('orbits')}
            >
                Orbits
            </button>
        </div>
    </div>

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
                    on:click={() => handleDateClick(date)}
                    on:dragover={(e) => handleDragOver(e, date)}
                    on:dragleave={handleDragLeave}
                    on:drop={(e) => handleDrop(e, date)}
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
                                    on:dragstart={(e) => handleDragStart(e, event.id, event)}
                                    on:dragend={handleDragEnd}
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
                                    on:dragover={(e) => handleDragOver(e, date, hour)}
                                    on:dragleave={handleDragLeave}
                                    on:drop={(e) => handleDrop(e, date, hour)}
                                >
                                    <div class="text-xs text-gray-500 group-hover:text-gray-400">
                                        {hour.toString().padStart(2, '0')}:00
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- Tasks for this day -->
                        {#each calculateEventColumns(Object.entries(tasks).filter(([key, task]) => task.when && new Date(task.when).toDateString() === date.toDateString()).map(([key, task]) => ({key, task}))) as {key, task, column, totalColumns}}
                            {@const position = getTaskPosition(task)}
                            {@const columnWidth = totalColumns > 1 ? `calc((100% - ${totalColumns * 2}px) / ${totalColumns})` : 'calc(100% - 0.5rem)'}
                            {@const leftOffset = totalColumns > 1 ? `calc(0.25rem + ${column} * ((100% - ${totalColumns * 2}px) / ${totalColumns}) + ${column * 2}px)` : '0.25rem'}
                            {@const startHour = new Date(task.when).getHours()}
                            {@const endHour = task.ends ? new Date(task.ends).getHours() : startHour + 1}
                            {@const isShortEvent = (position.gridRowEnd - position.gridRowStart) <= 2}
                            <div 
                                class="rounded bg-indigo-500 bg-opacity-90 text-white cursor-move hover:bg-indigo-400 transition-colors absolute z-10 overflow-hidden"
                                class:opacity-50={draggedTask?.key === key}
                                class:text-xs={!isShortEvent}
                                class:text-[10px]={isShortEvent}
                                class:p-1={isShortEvent}
                                class:p-2={!isShortEvent}
                                draggable="true"
                                on:dragstart={(e) => handleDragStart(e, key, task)}
                                on:dragend={handleDragEnd}
                                on:click|stopPropagation={() => handleTaskClick(key, task)}
                                on:keydown={(e) => e.key === 'Enter' && handleTaskClick(key, task)}
                                role="button"
                                tabindex="0"
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
                            on:click={() => {
                                const eventDate = new Date(currentDate);
                                eventDate.setHours(hour);
                                handleDateClick(eventDate);
                            }}
                            on:keydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    const eventDate = new Date(currentDate);
                                    eventDate.setHours(hour);
                                    handleDateClick(eventDate);
                                }
                            }}
                            on:dragover={(e) => handleDragOver(e, currentDate, hour)}
                            on:dragleave={handleDragLeave}
                            on:drop={(e) => handleDrop(e, currentDate, hour)}
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
                {#each calculateEventColumns(Object.entries(tasks).filter(([key, task]) => task.when && new Date(task.when).toDateString() === currentDate.toDateString()).map(([key, task]) => ({key, task}))) as {key, task, column, totalColumns}}
                    {@const position = getTaskPosition(task)}
                    {@const columnWidth = totalColumns > 1 ? `calc((100% - 0.5rem) / ${totalColumns})` : 'calc(100% - 0.5rem)'}
                    {@const leftOffset = totalColumns > 1 ? `calc(0.25rem + ${column} * (100% - 0.5rem) / ${totalColumns})` : '0.25rem'}
                    <div
                        class="text-xs p-2 rounded bg-indigo-500 bg-opacity-90 text-white cursor-move hover:bg-indigo-400 transition-colors absolute z-10"
                        class:opacity-50={draggedTask?.key === key}
                        draggable="true"
                        on:dragstart={(e) => handleDragStart(e, key, task)}
                        on:dragend={handleDragEnd}
                        on:click|stopPropagation={() => handleTaskClick(key, task)}
                        on:keydown={(e) => e.key === 'Enter' && handleTaskClick(key, task)}
                        role="button"
                        tabindex="0"
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
        <div class="flex flex-col items-center space-y-6">




            <!-- D3 Visualization Container -->
            <div 
                class="w-full max-w-7xl bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl mx-auto"
                style="min-height: calc(100vh - 400px); height: 600px;"
                bind:this={container}
            ></div>

            <!-- Dynamic Legend based on actual task categories -->
            {#if Object.keys(orbitStore).length > 0}
                {@const categories = [...new Set(Object.values(orbitStore).map(task => task.category).filter(Boolean))]}
                {#if categories.length > 0}
                    <div class="w-full max-w-4xl">
                        <div class="flex flex-wrap justify-center gap-6 p-4 bg-gradient-to-r from-indigo-900/80 to-purple-900/80 rounded-lg border border-indigo-500/30 backdrop-blur-sm">
                            {#each categories as category}
                                {#if category}
                                    <div class="flex items-center gap-2 text-sm text-white">
                                        <div class="w-4 h-4 rounded-full" style="background-color: {categoryColors[category] || categoryColors.default};"></div>
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
</div>

<!-- Orbital Task Details Modal -->
{#if showOrbitTaskDetails && selectedOrbitTask}
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50" style="backdrop-filter: blur(4px);">
        <div class="bg-gray-800 rounded-xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center p-6 border-b border-gray-700">
                <h2 class="text-2xl font-bold text-white">{selectedOrbitTask.title}</h2>
                <button 
                    class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                    on:click={closeOrbitTaskDetails}
                    aria-label="Close modal"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            
            <div class="p-6">
                <div class="space-y-4">
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Description:</span>
                        <span class="text-white text-right flex-1">{selectedOrbitTask.description || 'No description provided'}</span>
                    </div>
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Category:</span>
                        <span class="text-white text-right flex-1 flex items-center justify-end gap-2">
                            <div class="w-3 h-3 rounded-full" style="background-color: {categoryColors[selectedOrbitTask.category as keyof typeof categoryColors] || categoryColors.default};"></div>
                            {selectedOrbitTask.category || 'Uncategorized'}
                        </span>
                    </div>
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Frequency:</span>
                        <span class="text-white text-right flex-1 capitalize">{selectedOrbitTask.frequency}</span>
                    </div>
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Orbit Period:</span>
                        <span class="text-white text-right flex-1">{selectedOrbitTask.orbitPeriod} days</span>
                    </div>
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Last Occurrence:</span>
                        <span class="text-white text-right flex-1">{selectedOrbitTask.lastOccurrence.toLocaleDateString()}</span>
                    </div>
                    <div class="flex justify-between items-start py-3 border-b border-gray-700">
                        <span class="text-white font-medium min-w-[140px]">Next Occurrence:</span>
                        <span class="text-white text-right flex-1">{selectedOrbitTask.nextOccurrence.toLocaleDateString()}</span>
                    </div>
                    <div class="flex justify-between items-start py-3">
                        <span class="text-white font-medium min-w-[140px]">Time to Occurrence:</span>
                        <span class="text-blue-400 font-semibold text-right flex-1">
                            {formatDuration(calculateTimeToOccurrence(selectedOrbitTask, currentDate.toDateString() === new Date().toDateString() ? new Date() : currentDate))}
                            {#if currentDate.toDateString() !== new Date().toDateString()}
                                <span class="text-xs text-white/60 block mt-1">
                                    (from selected date)
                                </span>
                            {/if}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

{#if showModal}
    <dialog 
        class="fixed inset-0 bg-black/75 z-50"
        open
    >
        <div class="fixed inset-0 flex items-center justify-center">
            <form 
                method="dialog"
                class="bg-gray-800 p-6 rounded-xl schedule-modal border border-gray-700 shadow-xl max-w-md w-full"
                aria-labelledby="modal-title"
                aria-describedby="modal-description"
            >
                <div class="flex justify-between items-start mb-6">
                    <div>
                        <h3 id="modal-title" class="text-white text-lg font-medium">Update Schedule</h3>
                        {#if selectedTask?.task?.title}
                            <p class="text-indigo-300 text-sm mt-1 font-medium">{selectedTask.task.title}</p>
                        {/if}
                    </div>
                    <span id="modal-description" class="sr-only">Update schedule date and time</span>
                    <button 
                        class="text-gray-400 hover:text-white transition-colors"
                        on:click={() => {
                            showModal = false;
                            selectedTask = null;
                        }}
                        aria-label="Close modal"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label for="date-input" class="text-gray-300 text-sm font-medium block mb-2">Date</label>
                        <input 
                            id="date-input"
                            type="date" 
                            bind:value={tempDate}
                            class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                        >
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="time-input" class="text-gray-300 text-sm font-medium block mb-2">Start Time</label>
                            <input 
                                id="time-input"
                                type="time" 
                                bind:value={tempTime}
                                class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                            >
                        </div>
                        
                        <div>
                            <label for="end-time-input" class="text-gray-300 text-sm font-medium block mb-2">End Time</label>
                            <input 
                                id="end-time-input"
                                type="time" 
                                bind:value={tempEndTime}
                                class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                            >
                        </div>
                    </div>
                    
                    <div class="flex gap-3 justify-end pt-2">
                        <button 
                            type="button"
                            class="px-4 py-2 bg-gray-700 text-red-300 rounded-lg hover:bg-gray-600 border border-red-900/20 transition-colors text-sm font-medium"
                            on:click={deleteSchedule}
                            aria-label="Remove schedule"
                        >
                            Remove Schedule
                        </button>
                        <button 
                            type="button"
                            class="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 border border-gray-600 transition-colors text-sm font-medium"
                            on:click={() => {
                                showModal = false;
                                selectedTask = null;
                            }}
                            aria-label="Cancel changes"
                        >
                            Cancel
                        </button>
                        <button 
                            type="button"
                            class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors text-sm font-medium"
                            on:click={updateDateTime}
                            aria-label="Update schedule"
                        >
                            Update
                        </button>
                    </div>
                </div>
            </form>
        </div>
    </dialog>
{/if}

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