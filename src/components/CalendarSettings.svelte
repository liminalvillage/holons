<script lang="ts">
    import { getContext, createEventDispatcher } from 'svelte';
    import type HoloSphere from 'holosphere';
    import { ID } from '../dashboard/store';
    import { isValidICalUrl } from '$lib/services/icalParser';

    const dispatch = createEventDispatcher();
    const holosphere = getContext('holosphere') as HoloSphere;

    export let show = false;

    // State
    let importedCalendars: Array<{ id: string; url: string; name: string; enabled: boolean }> = [];
    let newCalendarUrl = '';
    let newCalendarName = '';
    let loading = false;
    let error = '';
    let successMessage = '';
    let showExportSection = false;

    // Get the export URL for this holon's calendar
    $: exportUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/${$ID}/calendar/feed.ics`
        : '';

    // Load imported calendars from holon data
    async function loadImportedCalendars() {
        if (!$ID) return;

        try {
            const calendarData = await holosphere.get($ID, 'settings', 'imported_calendars');
            if (calendarData && Array.isArray(calendarData.calendars)) {
                importedCalendars = calendarData.calendars;
            }
        } catch (err) {
            console.error('Error loading imported calendars:', err);
        }
    }

    // Save imported calendars to holon data
    async function saveImportedCalendars() {
        if (!$ID) return;

        try {
            await holosphere.put($ID, 'settings', {
                id: 'imported_calendars',
                calendars: importedCalendars,
                updated: new Date().toISOString()
            });
        } catch (err) {
            console.error('Error saving imported calendars:', err);
            throw err;
        }
    }

    // Add a new calendar
    async function addCalendar() {
        error = '';
        successMessage = '';

        if (!newCalendarUrl.trim()) {
            error = 'Please enter a calendar URL';
            return;
        }

        if (!isValidICalUrl(newCalendarUrl)) {
            error = 'Please enter a valid calendar URL (http://, https://, or webcal://)';
            return;
        }

        loading = true;

        try {
            const calendarId = `cal_${Date.now()}`;
            const newCalendar = {
                id: calendarId,
                url: newCalendarUrl.trim(),
                name: newCalendarName.trim() || 'Imported Calendar',
                enabled: true
            };

            importedCalendars = [...importedCalendars, newCalendar];
            await saveImportedCalendars();

            // Clear form
            newCalendarUrl = '';
            newCalendarName = '';
            successMessage = 'Calendar added successfully!';

            // Notify parent component to refresh
            dispatch('calendarsUpdated');

            setTimeout(() => {
                successMessage = '';
            }, 3000);
        } catch (err) {
            error = 'Failed to add calendar. Please try again.';
            console.error(err);
        } finally {
            loading = false;
        }
    }

    // Remove a calendar
    async function removeCalendar(calendarId: string) {
        if (!confirm('Are you sure you want to remove this calendar?')) {
            return;
        }

        loading = true;
        error = '';

        try {
            importedCalendars = importedCalendars.filter(cal => cal.id !== calendarId);
            await saveImportedCalendars();
            successMessage = 'Calendar removed successfully!';

            // Notify parent component to refresh
            dispatch('calendarsUpdated');

            setTimeout(() => {
                successMessage = '';
            }, 3000);
        } catch (err) {
            error = 'Failed to remove calendar. Please try again.';
            console.error(err);
        } finally {
            loading = false;
        }
    }

    // Toggle calendar enabled state
    async function toggleCalendar(calendarId: string) {
        loading = true;
        error = '';

        try {
            importedCalendars = importedCalendars.map(cal =>
                cal.id === calendarId ? { ...cal, enabled: !cal.enabled } : cal
            );
            await saveImportedCalendars();

            // Notify parent component to refresh
            dispatch('calendarsUpdated');
        } catch (err) {
            error = 'Failed to update calendar. Please try again.';
            console.error(err);
        } finally {
            loading = false;
        }
    }

    // Copy export URL to clipboard
    async function copyExportUrl() {
        try {
            await navigator.clipboard.writeText(exportUrl);
            successMessage = 'Calendar link copied to clipboard!';
            setTimeout(() => {
                successMessage = '';
            }, 3000);
        } catch (err) {
            error = 'Failed to copy to clipboard';
        }
    }

    // Load calendars when modal opens
    $: if (show) {
        loadImportedCalendars();
    }
</script>

{#if show}
    <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50" style="backdrop-filter: blur(4px);">
        <div class="bg-gray-800 rounded-xl border border-gray-700 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <!-- Header -->
            <div class="flex justify-between items-center p-6 border-b border-gray-700 sticky top-0 bg-gray-800 z-10">
                <h2 class="text-2xl font-bold text-white">Calendar Settings</h2>
                <button
                    class="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                    on:click={() => show = false}
                    aria-label="Close modal"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="p-6 space-y-8">
                <!-- Error/Success Messages -->
                {#if error}
                    <div class="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg">
                        {error}
                    </div>
                {/if}

                {#if successMessage}
                    <div class="bg-green-900/50 border border-green-700 text-green-200 px-4 py-3 rounded-lg">
                        {successMessage}
                    </div>
                {/if}

                <!-- Export Section -->
                <div class="space-y-4">
                    <button
                        class="flex items-center justify-between w-full text-left"
                        on:click={() => showExportSection = !showExportSection}
                    >
                        <h3 class="text-xl font-semibold text-white">Subscribe to This Holon's Calendar</h3>
                        <svg
                            class="w-5 h-5 text-gray-400 transition-transform {showExportSection ? 'rotate-180' : ''}"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>

                    {#if showExportSection}
                        <div class="bg-gray-900 rounded-lg p-4 space-y-3">
                            <p class="text-gray-300 text-sm">
                                Copy this link and add it to your calendar app (Google Calendar, Apple Calendar, Outlook, etc.) to subscribe to this holon's events:
                            </p>
                            <div class="flex gap-2">
                                <input
                                    type="text"
                                    readonly
                                    value={exportUrl}
                                    class="flex-1 bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 text-sm font-mono"
                                />
                                <button
                                    class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors whitespace-nowrap"
                                    on:click={copyExportUrl}
                                >
                                    Copy Link
                                </button>
                            </div>
                            <p class="text-gray-400 text-xs">
                                📝 This calendar updates automatically. Any changes to scheduled events in this holon will appear in your subscribed calendar.
                            </p>
                        </div>
                    {/if}
                </div>

                <!-- Import Section -->
                <div class="space-y-4">
                    <h3 class="text-xl font-semibold text-white">Import External Calendars</h3>
                    <p class="text-gray-300 text-sm">
                        Import events from external calendars (Google Calendar, Apple Calendar, etc.) to display them in this holon's calendar.
                    </p>

                    <!-- Add New Calendar Form -->
                    <div class="bg-gray-900 rounded-lg p-4 space-y-4">
                        <div>
                            <label for="calendar-url" class="text-gray-300 text-sm font-medium block mb-2">
                                Calendar URL (iCal/webcal link)
                            </label>
                            <input
                                id="calendar-url"
                                type="url"
                                bind:value={newCalendarUrl}
                                placeholder="https://calendar.google.com/calendar/ical/..."
                                class="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                            <p class="text-gray-400 text-xs mt-1">
                                To get a Google Calendar link: Calendar Settings → Integrate Calendar → Secret address in iCal format
                            </p>
                        </div>

                        <div>
                            <label for="calendar-name" class="text-gray-300 text-sm font-medium block mb-2">
                                Calendar Name (optional)
                            </label>
                            <input
                                id="calendar-name"
                                type="text"
                                bind:value={newCalendarName}
                                placeholder="My Google Calendar"
                                class="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                            />
                        </div>

                        <button
                            class="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            on:click={addCalendar}
                            disabled={loading}
                        >
                            {loading ? 'Adding...' : 'Add Calendar'}
                        </button>
                    </div>

                    <!-- Imported Calendars List -->
                    {#if importedCalendars.length > 0}
                        <div class="space-y-2">
                            <h4 class="text-sm font-medium text-gray-400">Imported Calendars</h4>
                            {#each importedCalendars as calendar (calendar.id)}
                                <div class="bg-gray-900 rounded-lg p-4 flex items-center justify-between">
                                    <div class="flex items-center gap-3 flex-1 min-w-0">
                                        <button
                                            class="flex-shrink-0"
                                            on:click={() => toggleCalendar(calendar.id)}
                                            aria-label={calendar.enabled ? 'Disable calendar' : 'Enable calendar'}
                                        >
                                            <div class="w-5 h-5 rounded border-2 {calendar.enabled ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600'} flex items-center justify-center">
                                                {#if calendar.enabled}
                                                    <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                        <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"/>
                                                    </svg>
                                                {/if}
                                            </div>
                                        </button>
                                        <div class="flex-1 min-w-0">
                                            <div class="text-white font-medium truncate">{calendar.name}</div>
                                            <div class="text-gray-400 text-xs truncate">{calendar.url}</div>
                                        </div>
                                    </div>
                                    <button
                                        class="flex-shrink-0 ml-4 p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors"
                                        on:click={() => removeCalendar(calendar.id)}
                                        aria-label="Remove calendar"
                                    >
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div class="text-center py-8 text-gray-400">
                            <svg class="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p>No imported calendars yet</p>
                            <p class="text-sm mt-1">Add your first calendar above</p>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Ensure smooth transitions */
    button {
        transition: all 0.2s ease;
    }
</style>
