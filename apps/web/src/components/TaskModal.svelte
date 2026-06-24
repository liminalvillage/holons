<script lang="ts">
    import { createEventDispatcher, getContext, onMount } from "svelte";
    import { fade, scale } from "svelte/transition";
    import { goto } from '$app/navigation';
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolvedInitials, resolveHologramSource, extractHolonIdFromSoul, buildHologramLink, resolveName } from '$lib/stores/nameResolver';
    import DisplayName from './shared/DisplayName.svelte';
    import SourceBadge from './shared/SourceBadge.svelte';
    import PublishToFederationButton from './shared/PublishToFederationButton.svelte';
    import { formatDate } from "../utils/date";
    import { resolveImage } from "../utils/imageServer";
    import { fileToDownscaledDataURL } from "../utils/imageCompression";
    import {
        type ScoreEquation,
        DEFAULT_EQUATION
    } from "../lib/scoring/ContributionScoring";
    import {
        getCachedEquation,
        getCachedUsersObject,
        preloadHolon,
        subscribeToHolon,
        isSubscribed
    } from "../lib/holonCache";
    import { nostrPublicKey } from "../lib/stores/nostr";
    import { telegramStore } from "../lib/stores/telegram";
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";
    import {
        CHECKLIST_TYPES,
        createChecklistObject,
    } from "@holons/core/checklists";
    import {
        toggleParticipant as coreToggleParticipant,
        applyTaskCompletion,
        planTaskCompletion,
        executeCompletionPlan,
        deleteTaskWithCascade,
        wouldCreateDependencyCycle,
    } from "@holons/core/tasks";
    import { getEventStore } from "../lib/rea/eventStore";
    import { queryManager } from "$lib/holosphere/QueryManager";
    import { reflectMembership } from "../utils/reflectMembership";

    export let quest: any;
    export let questId: string;
    export let holonId: string;
    // When the modal was opened from a specific recurring-task instance, this holds
    // that occurrence's ISO `when`. Completion toggles apply only to that occurrence.
    export let occurrenceWhen: string | undefined = undefined;

    // True when we're editing a single occurrence of a recurring series.
    $: isOccurrenceView = !!occurrenceWhen && !!quest?.frequency;
    $: isOccurrenceCompleted = isOccurrenceView
        && Array.isArray(quest?.completedOccurrences)
        && quest.completedOccurrences.includes(occurrenceWhen);

    interface User {
        id: string;
        first_name: string;
        last_name?: string;
        picture?: string;
        username: string;
        actions?: Array<any>;
        initiated?: Array<string>;
        completed?: Array<string>;
    }

    interface UserStore {
        [key: string]: User;
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    // Logged-in viewer is folded in by the shared `mergeSelfIntoUsers` helper
    // (see $lib/util/usersWithSelf). The cached store from holonCache already
    // applies it; re-applying here keeps things consistent after store mutations.

    // Use cached data immediately for instant display
    let userStore: UserStore = getCachedUsersObject(holonId) as UserStore;
    let equation: ScoreEquation = getCachedEquation(holonId);

    let showDatePicker = false;
    let selectedDate = quest.when ? new Date(quest.when) : new Date();
    let selectedTime = quest.when
        ? new Date(quest.when).toTimeString().slice(0, 5)
        : "12:00";

    // Dependency management
    let showDependencyEditor = false;
    let availableTasks: Array<{id: string, title: string, dependencies: string[]}> = [];
    let dependencyError = '';

    // Recurring task management
    let showRecurringEditor = false;
    let recurringTaskId = quest.recurringTaskId || '';
    let recurringStatus = quest.status || 'ongoing';
    let frequency: string | null = quest.frequency ?? null;

    type FrequencyOption = { value: string | null; label: string };
    const frequencyOptions: FrequencyOption[] = [
        { value: null, label: 'Never' },
        { value: 'daily', label: 'Daily' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'yearly', label: 'Yearly' },
    ];

    async function updateFrequency(newFrequency: string | null) {
        if ((frequency ?? null) === (newFrequency ?? null)) return;
        frequency = newFrequency;
        const updates: any = { frequency: newFrequency };
        // When clearing frequency, also drop the recurringTaskId so the scheduler stops it.
        if (newFrequency === null && quest.recurringTaskId) {
            updates.recurringTaskId = null;
        }
        await updateQuest(updates);
    }

    let editingTitle = false;
    let editedTitle = quest.title;

    let editingDescription = false;
    let tempDescription = quest.description || "";

    let pictureInput: HTMLInputElement | null = null;
    let pictureUploading = false;

    let touchedCard: { key: string; quest: any; x: number; y: number } | null =
        null;
    let touchStartX = 0;
    let touchStartY = 0;

    let tempTitle = quest.title;
    let questCards: Array<{ key: string; quest: any; x: number; y: number }> =
        [];
    let canvas: HTMLCanvasElement | undefined;
    let viewContainer: HTMLElement | undefined;
    let isPanning = false;
    let startPan = { x: 0, y: 0 };
    let pan = { x: 0, y: 0 };
    let zoom = 1;
    const CANVAS_WIDTH = 2000;
    const CANVAS_HEIGHT = 1500;

    // Function to get hologram source name from reactive nameMap
    function getHologramSource(soul: string | undefined): string {
        if (!soul) return '';

        resolveHologramSource(soul);
        const holonId = extractHolonIdFromSoul(soul);
        return resolvedName(holonId, $nameMap, null, 'External Source');
    }

    // Navigate to hologram source — deep links to the specific task on the source holon
    function navigateToHologramSource() {
        if (!quest._hologram) return;
        goto(buildHologramLink(quest._hologram));
    }

    onMount(() => {
        let unsubscribeQuests: (() => void) | undefined;
        let holonUnsub: (() => void) | undefined;

        if (holosphere && holonId) {
            // If we have cached users, mark as loaded immediately
            if (Object.keys(userStore).length > 0) {
                usersLoading = false;
            }

            // Subscribe to holon if not already subscribed at parent level
            // This keeps users and settings cache fresh
            if (!isSubscribed(holonId)) {
                holonUnsub = subscribeToHolon(holosphere, holonId);
            }

            // Preload in background (will refresh cache if stale)
            preloadHolon(holosphere, holonId).then(() => {
                // Update local state from refreshed cache, ensuring current user is included
                userStore = getCachedUsersObject(holonId) as UserStore;
                equation = getCachedEquation(holonId);
                usersLoading = false;
            });

            // Subscribe to quests for dependency tracking
            try {
                const questOff = holosphere.subscribe(holonId, "quests", (updatedQuest: any) => {
                    if (updatedQuest?.id && updatedQuest.id !== questId) {
                        const existingIndex = availableTasks.findIndex(t => t.id === updatedQuest.id);
                        const newTask = { id: updatedQuest.id, title: updatedQuest.title || 'Untitled Task', dependencies: (updatedQuest.dependencies ?? []).map(String) };
                        if (existingIndex >= 0) {
                            availableTasks[existingIndex] = newTask;
                            availableTasks = availableTasks;
                        } else {
                            availableTasks = [...availableTasks, newTask];
                        }
                    }
                });
                if (typeof questOff === 'function') {
                    unsubscribeQuests = questOff;
                }
            } catch (e) {
                console.error("Error subscribing to quests in TaskModal:", e);
            }

            // Fetch quests for dependencies (getAll resolves to Array<T>).
            holosphere.getAll(holonId, "quests").then((quests: any[]) => {
                availableTasks = (quests ?? [])
                    .filter((q: any) => q?.id && q.id !== questId)
                    .map((q: any) => ({ id: q.id, title: q.title || 'Untitled Task', dependencies: (q.dependencies ?? []).map(String) }));
            }).catch(() => {});
        }

        return () => {
            if (holonUnsub) holonUnsub();
            if (unsubscribeQuests) unsubscribeQuests();
        };
    });

    const dispatch = createEventDispatcher();
    let usersLoading = true;
    let userSearchQuery = '';

    // Toggle participant fully optimistically. The original flow did three
    // sequential awaits (get users → put users → put quest) before showing
    // any visual change — on mobile that read as broken. Now the local
    // `quest` is mutated synchronously so the checkbox flips on tap, and the
    // network writes propagate in the background.
    function toggleUserParticipation(userKey: string, user: User) {
        const userIdStr = String(user.id);
        const isSelected = participantIds.has(userIdStr);
        const base = { ...quest, participants: quest.participants || [] };

        // Core owns the participants membership logic (add/remove by id).
        const newParticipant = {
            id: user.id,
            firstName: user.first_name,
            lastName: user.last_name,
            username: user.username,
        };
        let updatedQuest: any = coreToggleParticipant(base, newParticipant);

        // Dropping a participant also drops their time-tracking entry (a UI
        // concern not owned by core).
        if (isSelected) {
            const newTime = { ...(quest.timeTracking || {}) };
            if (newTime[user.id] != null) delete newTime[user.id];
            updatedQuest = { ...updatedQuest, timeTracking: newTime };
        }

        const previousQuest = quest;
        quest = updatedQuest;

        // Sync quest in background — roll back on failure.
        holosphere.put(holonId, "quests", updatedQuest).catch((error: any) => {
            quest = previousQuest;
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("[TaskModal.svelte] Error syncing participant:", error);
            }
        });

        // Log user-actions in background (only on add). Pure bookkeeping for
        // scoring — never block the participant toggle on it.
        if (!isSelected) {
            recordUserJoinAction(user, quest.title, quest.category || '').catch((err) => {
                console.warn("[TaskModal.svelte] User action log failed:", err);
            });
        }

        // Mirror into the member's personal holon + (re)send the linked DM.
        // `isSelected` is the pre-toggle state, so joined === !isSelected.
        void reflectMembership({
            holosphere,
            holonId,
            questId: String(updatedQuest.id),
            userId: user.id,
            joined: !isSelected,
        });
    }

    async function recordUserJoinAction(user: User, action: string, category: string) {
        const canonicalUserId = user.id || user.username;
        let existing: any = null;
        try {
            existing = await holosphere.get(holonId, "users", canonicalUserId);
        } catch {
            // Treat as new user record.
        }

        const userData = {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name || '',
            username: user.username,
            ...(existing || {}),
            actions: [
                ...(Array.isArray(existing?.actions) ? existing.actions : []),
                {
                    type: "joined",
                    action,
                    category,
                    amount: 1,
                    timestamp: Date.now(),
                },
            ],
        };

        await holosphere.put(holonId, "users", userData);
    }

    async function updateQuest(updates: any, shouldClose = false) {
        if (!holosphere) {
            console.error("[TaskModal.svelte] Cannot update quest: holosphere is not available");
            return;
        }

        const updatedQuest = { ...quest, ...updates };

        try {
            // holosphere.put() is optimistic - caches locally and returns immediately
            // For holograms, holosphere automatically routes writes to the source holon
            await holosphere.put(holonId, "quests", updatedQuest);
            quest = updatedQuest;

            if (shouldClose) {
                dispatch("close");
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("[TaskModal.svelte] Error updating quest:", error);
            }
        }
    }

    async function deleteQuest() {
        if (!questId || !holonId) {
            console.error("Cannot delete quest: missing parameters", {
                questId,
                holonId,
            });
            return;
        }

        if (confirm("Are you sure you want to delete this task?")) {
            try {
                // Cascade-delete every published forward of this task too,
                // so dangling holograms don't sit in users' personal holons
                // emitting "did not resolve" warnings on every getAll.
                const result = await deleteTaskWithCascade(
                    holosphere as any,
                    holonId,
                    questId,
                );
                if (!result.sourceDeleted) {
                    throw new Error("Source delete failed");
                }
                // Synchronously drop from the shared cache so the next
                // snapshot emission doesn't flash the deleted card back
                // into any list view that hasn't received Gun's null
                // tombstone yet.
                queryManager.evict(holonId, "quests", questId);

                dispatch("close", { deleted: true, questId });
            } catch (error: any) {
                if (error?.name === 'AuthorizationError') {
                    notifyWriteDenied('Unable to delete - no write permission for this holon');
                } else {
                    console.error("Error deleting quest:", error);
                }
            }
        }
    }

    function closeModal() {
        dispatch("close");
    }


    function isUserParticipant(userId: string | number): boolean {
        if (!quest.participants || quest.participants.length === 0) return false;
        const target = String(userId);
        return quest.participants.some((p: { id: string | number }) => String(p.id) === target);
    }

    // Reactive Set of participant IDs for Svelte template reactivity.
    // Ids can arrive as number (Telegram-native) or string (MCP/web writes), so
    // normalize to string before comparing in the template.
    $: participantIds = new Set((quest.participants || []).map((p: any) => String(p.id)));

    // Filter + sort the team list. Selected users float to the top so the
    // current participants are always visible without scrolling; the rest
    // follow the search filter.
    $: filteredUserEntries = (() => {
        const q = userSearchQuery.trim().toLowerCase();
        const entries = Object.entries(userStore);
        const matches = entries.filter(([_, u]: any) => {
            if (!q) return true;
            const hay = `${u.first_name || ''} ${u.last_name || ''} ${u.username || ''}`.toLowerCase();
            return hay.includes(q);
        });
        return matches.sort(([_a, a]: any, [_b, b]: any) => {
            const aSel = participantIds.has(String(a.id)) ? 0 : 1;
            const bSel = participantIds.has(String(b.id)) ? 0 : 1;
            if (aSel !== bSel) return aSel - bSel;
            const an = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
            const bn = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase();
            return an.localeCompare(bn);
        });
    })();

    // Toggle completion. For recurring occurrences, only this occurrence is
    // toggled; otherwise we flip the series status using the participants
    // already on the quest (no extra participant-picker step).
    function handleCompleteClick() {
        if (isOccurrenceView) {
            toggleOccurrenceCompleted();
            return;
        }
        completeQuest();
    }

    async function toggleOccurrenceCompleted() {
        if (!occurrenceWhen) return;
        const current: string[] = Array.isArray(quest.completedOccurrences) ? quest.completedOccurrences : [];
        const has = current.includes(occurrenceWhen);
        const next = has
            ? current.filter((d) => d !== occurrenceWhen)
            : [...current, occurrenceWhen];
        await updateQuest({ completedOccurrences: next });
        if (!has) {
            dispatch("taskCompleted", { questId, occurrenceWhen });
        }
    }

    async function completeQuest() {
        const newStatus =
            quest.status === "completed" ? "ongoing" : "completed";

        if (newStatus === "completed") {
            // Completer = current logged-in user, falling back to initiator.
            const telegramUser = telegramStore.getState().user;
            const pubKey = $nostrPublicKey;
            const completerId =
                (telegramUser && String(telegramUser.id))
                || pubKey
                || (quest.initiator?.id ? String(quest.initiator.id) : '');

            // isAdmin=true mirrors web pre-unify behaviour — the modal already
            // gates this UI on having access.
            const result = applyTaskCompletion(quest, completerId, { isAdmin: true });
            if (!result.ok) {
                console.warn('[TaskModal] applyTaskCompletion blocked:', result.reason);
                return;
            }

            const plan = planTaskCompletion(result.task, equation, {
                holonId,
                now: Date.now(),
            });
            const eventStore = getEventStore(holosphere);

            try {
                await executeCompletionPlan(holosphere as any, eventStore, holonId, plan);
            } catch (error: any) {
                if (error?.name === 'AuthorizationError') {
                    notifyWriteDenied('Unable to save - no write permission for this holon');
                    return;
                }
                console.error('[TaskModal] executeCompletionPlan failed:', error);
            }

            quest = result.task;
            dispatch("taskCompleted", { questId });
            dispatch("close");
        } else {
            await updateQuest({ status: newStatus, completed_at: null });
        }
    }

    async function scheduleTask() {
        const dateTime = new Date(selectedDate);
        const [hours, minutes] = selectedTime.split(":");
        dateTime.setHours(parseInt(hours), parseInt(minutes));

        await updateQuest({
            when: dateTime.toISOString(),
        });
        showDatePicker = false;
    }

    async function saveTitle() {
        if (tempTitle.trim() !== quest.title) {
            await updateQuest({ title: tempTitle.trim() });
        }
        editingTitle = false;
    }

    function handleTouchStart(event: TouchEvent) {
        event.preventDefault();

        // Get the card element that was touched (if any)
        const cardElement = (event.target as HTMLElement).closest(".task-card");
        if (cardElement) {
            // Find the card data that matches this element
            const cardId = cardElement.getAttribute("data-card-id");
            touchedCard =
                questCards.find(
                    (card: { key: string; quest: any; x: number; y: number }) =>
                        card.key === cardId,
                ) || null;

            if (touchedCard && canvas) { // Added canvas check
                const touch = event.touches[0];
                const rect = canvas.getBoundingClientRect();

                // Calculate touch offset relative to card position
                touchStartX =
                    (touch.clientX - rect.left - pan.x) / zoom - touchedCard.x;
                touchStartY =
                    (touch.clientY - rect.top - pan.y) / zoom - touchedCard.y;
                return;
            }
        }

        // If no card was touched, handle canvas panning
        if (event.touches.length === 1) {
            isPanning = true;
            const touch = event.touches[0];
            startPan = {
                x: touch.clientX - pan.x,
                y: touch.clientY - pan.y,
            };
        }
    }

    function handleTouchMove(event: TouchEvent) {
        event.preventDefault();

        if (touchedCard && canvas) { // Added canvas check
            // Move the touched card
            const touch = event.touches[0];
            const rect = canvas.getBoundingClientRect();
            const newX =
                (touch.clientX - rect.left - pan.x) / zoom - touchStartX;
            const newY =
                (touch.clientY - rect.top - pan.y) / zoom - touchStartY;

            questCards = questCards.map(
                (card: { key: string; quest: any; x: number; y: number }) =>
                    card.key === touchedCard?.key
                        ? {
                              ...card,
                              x: Math.min(
                                  Math.max(newX, 0),
                                  CANVAS_WIDTH - 300,
                              ),
                              y: Math.min(
                                  Math.max(newY, 0),
                                  CANVAS_HEIGHT - 200,
                              ),
                          }
                        : card,
            );
        } else if (isPanning && event.touches.length === 1) {
            // Handle canvas panning
            const touch = event.touches[0];
            pan = {
                x: Math.min(
                    Math.max(
                        touch.clientX - startPan.x,
                        viewContainer ? -CANVAS_WIDTH * zoom + viewContainer.clientWidth : -CANVAS_WIDTH * zoom, // Added viewContainer check
                    ),
                    0,
                ),
                y: Math.min(
                    Math.max(
                        touch.clientY - startPan.y,
                        viewContainer ? -CANVAS_HEIGHT * zoom + viewContainer.clientHeight : -CANVAS_HEIGHT * zoom, // Added viewContainer check
                    ),
                    0,
                ),
            };
        }
    }

    function handleTouchEnd(event: TouchEvent) {
        if (touchedCard) {
            // Save the card's new position
            const card = questCards.find(
                (c: { key: string; quest: any; x: number; y: number }) =>
                    c.key === touchedCard?.key,
            );
            if (card) {
                const updatedQuest = {
                    ...card.quest,
                    position: { x: card.x, y: card.y },
                };

                holosphere
                    .put(holonId, "quests", {
                        ...updatedQuest,
                        id: card.key,
                    })
                    .catch((error: any) => {
                        if (error?.name === 'AuthorizationError') {
                            notifyWriteDenied('Unable to save - no write permission for this holon');
                        } else {
                            console.error("Error updating quest position:", error);
                        }
                    });
            }
            touchedCard = null;
        }

        isPanning = false;
    }

    // Add this focus action
    function focusOnMount(node: HTMLElement) {
        node.focus();
    }

    // Add touch handling for buttons
    function handleButtonTouchStart(event: TouchEvent) {
        // Add visual feedback for touch
        const button = event.currentTarget as HTMLElement;
        button.style.transform = 'scale(0.95)';
        button.style.transition = 'transform 0.1s ease';
    }

    function handleButtonTouchEnd(event: TouchEvent) {
        // Remove visual feedback
        const button = event.currentTarget as HTMLElement;
        button.style.transform = 'scale(1)';
        
        // Prevent default to avoid double-triggering with click
        event.preventDefault();
        
        // Get the button's click handler and call it
        const buttonElement = event.currentTarget as HTMLButtonElement;
        if (buttonElement && !buttonElement.disabled) {
            // Trigger the click event programmatically
            buttonElement.click();
        }
    }

    function handleButtonTouchCancel(event: TouchEvent) {
        // Remove visual feedback if touch is cancelled
        const button = event.currentTarget as HTMLElement;
        button.style.transform = 'scale(1)';
    }

    function handleTitleEdit() {
        saveTitle();
    }

    function handleTitleKeydown(event: KeyboardEvent) {
        if (event.key === "Enter") {
            saveTitle();
        } else if (event.key === "Escape") {
            tempTitle = quest.title;
            editingTitle = false;
        }
    }

    async function saveDescription() {
        const newDescription = tempDescription.trim();
        const oldDescription = (quest.description || "").trim();

        if (newDescription !== oldDescription) {
            await updateQuest({ description: newDescription });
        }
        editingDescription = false;
    }

    function handleDescriptionKeydown(event: KeyboardEvent) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            saveDescription();
        } else if (event.key === "Escape") {
            tempDescription = quest.description || "";
            editingDescription = false;
        }
    }

    // Read a chosen image, downscale + re-encode as JPEG, and persist it on
    // the quest as a `data:image/jpeg;base64,…` URL. The compression step is
    // mandatory because the picture replicates through the Holosphere graph
    // to every peer — uncompressed phone-camera shots would bloat state for
    // the entire holon. Format stays compatible with telegram-ui inlined
    // pictures and the existing resolveImage() render path.
    async function handlePictureSelect(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        // Reset so the same file can be re-selected later.
        input.value = "";
        if (!file) return;
        if (!file.type.startsWith("image/")) {
            alert("Please choose an image file.");
            return;
        }
        pictureUploading = true;
        try {
            // Task thumbnails render at ~2rem in the card grid, so 1024px is
            // already overkill — but it keeps the picture usable in the modal
            // detail view. Always re-encode (even small inputs) so the wire
            // size on the federation graph is bounded.
            const processed = await fileToDownscaledDataURL(file, {
                maxDimension: 1024,
                quality: 0.8,
                alwaysReencode: true,
            });
            if (!processed) {
                alert("Failed to read this image. Try a different file.");
                return;
            }
            await updateQuest({ picture: processed.src });
        } catch (err) {
            console.error("[TaskModal.svelte] Failed to attach picture:", err);
            alert("Failed to attach picture.");
        } finally {
            pictureUploading = false;
        }
    }

    async function removePicture() {
        if (!confirm("Remove this picture from the task?")) return;
        await updateQuest({ picture: null });
    }



    // Add time tracking functionality
    async function updateTimeTracking(userId: string, hoursToAdd: number) {
        if (!userId) return;
        
        const currentTimeTracking = quest.timeTracking || {};
        const currentHours = currentTimeTracking[userId] || 0;
        const newHours = Math.max(0, currentHours + hoursToAdd); // Don't allow negative hours
        
        const updatedTimeTracking = {
            ...currentTimeTracking,
            [userId]: newHours
        };

        // Remove entries with 0 hours to keep the object clean
        if (newHours === 0) {
            delete updatedTimeTracking[userId];
        }

        await updateQuest({ timeTracking: updatedTimeTracking });
    }

    function formatTime(hours: number): string {
        if (hours === 0) return "0h";
        if (hours < 1) {
            const minutes = Math.round(hours * 60);
            return `${minutes}m`;
        }
        return `${hours.toFixed(2)}h`;
    }

    function getAllTimeTrackingParticipants() {
        const participants = [...(quest.participants || [])];
        
        // Add initiator if not already in participants
        if (quest.initiator && !participants.find(p => p.id === quest.initiator.id)) {
            participants.unshift({
                id: quest.initiator.id,
                firstName: quest.initiator.firstName || quest.initiator.first_name,
                lastName: quest.initiator.lastName || quest.initiator.last_name,
                username: quest.initiator.username
            });
        }
        
        return participants;
    }

    // Add checklist navigation function
    function navigateToChecklist() {
        if (quest && quest.checklistId) {
            goto(`/${holonId}/checklists?checklist=${quest.checklistId}`);
        }
    }

    // Dependency management functions
    async function addDependency(taskId: string) {
        if (!taskId) return;

        const currentDependencies = quest.dependencies || [];
        if (currentDependencies.includes(taskId)) return;

        // Keep the dependency graph acyclic so it stays a sequence (top→bottom).
        // Reject any edge whose target already depends on this task.
        const graph = [
            { id: String(quest.id), dependencies: currentDependencies },
            ...availableTasks.map((t) => ({ id: t.id, dependencies: t.dependencies })),
        ];
        if (wouldCreateDependencyCycle(graph as any, String(quest.id), taskId)) {
            const dep = availableTasks.find((t) => t.id === taskId);
            dependencyError = `Can't depend on "${dep?.title ?? taskId}" — it would create a cycle.`;
            return;
        }

        dependencyError = '';
        const updatedDependencies = [...currentDependencies, taskId];
        await updateQuest({ dependencies: updatedDependencies });
    }

    async function removeDependency(index: number) {
        const currentDependencies = quest.dependencies || [];
        const updatedDependencies = currentDependencies.filter((_, i) => i !== index);
        await updateQuest({ dependencies: updatedDependencies });
    }

    async function saveRecurringSettings() {
        const updates: any = {};
        
        if (recurringTaskId !== quest.recurringTaskId) {
            updates.recurringTaskId = recurringTaskId || null;
        }
        
        if (recurringStatus !== quest.status) {
            updates.status = recurringStatus;
        }
        
        if (Object.keys(updates).length > 0) {
            await updateQuest(updates);
        }
        
        showRecurringEditor = false;
    }

    // Canvas: navigate to an existing per-task canvas, or initialize one.
    function navigateToCanvas() {
        if (quest && quest.canvasId) {
            goto(`/${holonId}/canvas/${quest.canvasId}`);
        }
    }

    function createCanvasForTask() {
        if (!holosphere || !holonId || !questId) {
            console.error("Cannot create canvas: missing parameters");
            return;
        }
        if (quest.canvasId) {
            navigateToCanvas();
            return;
        }
        const canvasId = `task_${questId}_canvas`;
        const newCanvas = {
            id: canvasId,
            data: [],
            updatedAt: Date.now(),
        };
        const previousQuest = quest;
        quest = { ...quest, canvasId };

        Promise.all([
            holosphere.put(holonId, "canvases", newCanvas),
            holosphere.put(holonId, "quests", quest),
        ])
            .then(() => {
                goto(`/${holonId}/canvas/${canvasId}`);
            })
            .catch((error: any) => {
                quest = previousQuest;
                if (error?.name === 'AuthorizationError') {
                    notifyWriteDenied('Unable to save - no write permission for this holon');
                } else {
                    console.error("Error creating canvas for task:", error);
                }
            });
    }

    // Add function to create checklist for this task. Optimistic — flip the
    // button to "View Checklist" immediately and sync to HoloSphere in the
    // background. Without this, two sequential awaits (put checklist → put
    // quest) leave the button unchanged until both round-trips finish; on
    // mobile that looked like a hang.
    function createChecklistForTask() {
        if (!holosphere || !holonId || !questId) {
            console.error("Cannot create checklist: missing parameters");
            return;
        }
        if (quest.checklistId) return; // already has one

        const newChecklist = createChecklistObject(
            `task_${questId}_checklist`,
            CHECKLIST_TYPES.QUEST,
            {
                creator: "Dashboard User",
                questId,
                parentTitle: quest?.title,
                holonId,
            },
        );

        const previousQuest = quest;
        quest = { ...quest, checklistId: newChecklist.id };

        Promise.all([
            holosphere.put(holonId, "checklists", newChecklist),
            holosphere.put(holonId, "quests", quest),
        ]).catch((error: any) => {
            quest = previousQuest;
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Error creating checklist for task:", error);
            }
        });
    }

    // Function to open dependency modal
    function openDependencyModal(dependencyId: string) {
        // Close current modal first
        dispatch("close");
        
        // Dispatch a custom event to notify the Tasks component
        const event = new CustomEvent('openDependencyTask', {
            detail: { taskId: dependencyId },
            bubbles: true
        });
        window.dispatchEvent(event);
    }

    async function handlePublished(outcome: { publishedTo: number }) {
        await updateQuest({
            published: true,
            publishedAt: new Date().toISOString(),
            publishedTo: outcome.publishedTo
        });
    }
</script>

<div
    data-component="TaskModal"
    class="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-3"
    on:click|self={closeModal}
    on:keydown={(e) => e.key === "Escape" && closeModal()}
    role="presentation"
    transition:fade
>
    <div
        class="bg-gray-800 rounded-xl max-w-3xl w-full max-h-[95vh] shadow-2xl relative flex flex-col border border-gray-700 mx-auto lg:mx-0"
        transition:scale={{ duration: 200, start: 0.95 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation
    >
        <button
            class="absolute top-4 right-4 text-gray-400 hover:text-white z-10 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center p-2"
            on:click={closeModal}
            on:touchstart={handleButtonTouchStart}
            on:touchend={handleButtonTouchEnd}
            on:touchcancel={handleButtonTouchCancel}
            aria-label="Close modal"
            type="button"
        >
            <svg
                class="w-6 h-6"
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
        </button>

            <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-700">
            <div class="flex-1 mr-4">
                    {#if editingTitle}
                        <input
                            type="text"
                            bind:value={tempTitle}
                        class="text-xl font-bold text-white bg-transparent border-b border-gray-500 focus:border-blue-400 px-1 py-1 w-full outline-none"
                            on:blur={handleTitleEdit}
                            on:keydown={handleTitleKeydown}
                            use:focusOnMount
                        />
                    {:else}
                        <button
                            type="button"
                            id="modal-title"
                        class="text-xl font-bold text-white text-left hover:text-gray-300 transition-colors w-full text-left"
                            on:click={() => {
                                tempTitle = quest.title;
                                editingTitle = true;
                            }}
                            on:touchstart={handleButtonTouchStart}
                            on:touchend={handleButtonTouchEnd}
                            on:touchcancel={handleButtonTouchCancel}
                        >
                            {quest.title}
                        </button>
                    {/if}
                
                <!-- Compact metadata -->
                <div class="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    {#if quest.created}
                        <span class="flex items-center gap-1">
                                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                                </svg>
                            {formatDate(quest.created)}
                            </span>
                        {/if}
                    {#if quest.category}
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M11.03 8h-6.06l-3 8h6.06l3-8zm1.94 0l3 8h6.06l-3-8h-6.06z"/>
                            </svg>
                            {quest.category}
                        </span>
                    {/if}
                    <SourceBadge item={quest} currentHolonId={holonId} lensRoute="tasks" />
                            </div>
    </div>
</div>

        <div class="p-4 overflow-y-auto flex-1 modal-content scrollbar-thin">

<style>
    /* Custom scrollbar for webkit browsers */
    ::-webkit-scrollbar {
        width: 6px;
    }
    
    ::-webkit-scrollbar-track {
        background: var(--color-bg-tertiary);
        border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb {
        background: #6b7280;
        border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
        background: #6b7280;
    }

    /* Modal content scrollbar styling */
    .modal-content::-webkit-scrollbar {
        width: 8px;
    }
    
    .modal-content::-webkit-scrollbar-track {
        background: var(--color-bg-tertiary);
        border-radius: 4px;
    }
    
    .modal-content::-webkit-scrollbar-thumb {
        background: #6b7280;
        border-radius: 4px;
    }
    
    .modal-content::-webkit-scrollbar-thumb:hover {
        background: #6b7280;
    }

    /* Team selector */
    .team-search {
        position: relative;
        margin-bottom: 0.5rem;
    }

    .team-search__input {
        width: 100%;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-bg-tertiary);
        border-radius: 0.5rem;
        color: #f9fafb;
        font-size: 0.875rem;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
        line-height: 1.2;
        -webkit-appearance: none;
        appearance: none;
    }

    .team-search__input:focus {
        outline: none;
        border-color: var(--color-accent-light);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }

    .team-search__input::placeholder {
        color: var(--color-text-muted);
    }

    .team-search__clear {
        position: absolute;
        right: 0.4rem;
        top: 50%;
        transform: translateY(-50%);
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        font-size: 1.1rem;
        line-height: 1;
        cursor: pointer;
    }

    .team-search__clear:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
    }

    .user-row {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.625rem 0.625rem;
        border-radius: 0.5rem;
        background: var(--color-bg-secondary);
        border: 1px solid transparent;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: background-color 120ms ease, border-color 120ms ease;
        min-height: 48px; /* WCAG 2.2 touch target */
    }

    .user-row:hover {
        background: var(--color-bg-tertiary);
    }

    .user-row:active {
        background: var(--color-border-light);
    }

    .user-row--selected,
    .user-row--selected:hover {
        background: rgba(99, 102, 241, 0.18);
        border-color: rgba(99, 102, 241, 0.5);
    }

    .user-row__check {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        border: 2px solid #6b7280;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background-color 120ms ease, border-color 120ms ease;
    }

    .user-row__check--on {
        background: var(--color-accent-light);
        border-color: var(--color-accent-light);
    }
</style>

            <!-- Main content grid: two columns from sm: up (tablet + desktop);
                 phone widths (<640px) collapse to a single stacked column. -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-300 min-h-0">
                <!-- Left column -->
                <div class="space-y-3 min-h-0">
                <!-- Picture: upload / display / remove. Stored on the quest
                     as a `data:image/*;base64,…` URL, matching telegram-ui. -->
                <input
                    type="file"
                    accept="image/*"
                    bind:this={pictureInput}
                    on:change={handlePictureSelect}
                    class="hidden"
                />
                {#if quest.picture}
                    <div class="relative rounded-lg overflow-hidden bg-gray-700/30 group">
                        <img
                            src={resolveImage(quest.picture)}
                            alt={quest.title}
                            class="w-full max-h-64 object-cover"
                            loading="lazy"
                            on:error={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div class="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                                class="px-2 py-1 bg-gray-900/80 text-gray-100 rounded hover:bg-gray-800 text-xs disabled:opacity-50"
                                on:click={() => pictureInput?.click()}
                                type="button"
                                disabled={pictureUploading}
                            >
                                {pictureUploading ? "Uploading…" : "Change"}
                            </button>
                            <button
                                class="px-2 py-1 bg-gray-900/80 text-red-300 rounded hover:bg-gray-800 text-xs disabled:opacity-50"
                                on:click={removePicture}
                                type="button"
                                disabled={pictureUploading}
                            >
                                Remove
                            </button>
                        </div>
                    </div>
                {:else}
                    <button
                        class="w-full text-sm text-gray-400 hover:text-white p-2 rounded bg-gray-700/30 hover:bg-gray-700/50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                        on:click={() => pictureInput?.click()}
                        type="button"
                        disabled={pictureUploading}
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                        </svg>
                        {pictureUploading ? "Uploading picture…" : "+ Add picture"}
                    </button>
                {/if}
                <!-- Description -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/>
                            </svg>
                            Description
                        </h4>
                    {#if editingDescription}
                        <textarea
                            bind:value={tempDescription}
                                class="text-sm text-white bg-gray-800 rounded px-2 py-2 w-full resize-none border border-gray-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                rows="3"
                            placeholder="Add a description..."
                            on:blur={saveDescription}
                            on:keydown={handleDescriptionKeydown}
                            use:focusOnMount
                        ></textarea>
                    {:else}
                        {#if quest.description}
                            <button  
                                    class="text-sm whitespace-pre-wrap text-left w-full hover:bg-gray-700/50 p-2 rounded transition-colors" 
                                on:click={() => {
                                    tempDescription = quest.description || '';
                                    editingDescription = true;
                                }}
                                type="button"
                            >
                                {quest.description}
                            </button>
                        {:else}
                            <button 
                                    class="text-sm text-gray-400 hover:text-white p-2 rounded hover:bg-gray-700/50 w-full text-left transition-colors"
                                on:click={() => {
                                        tempDescription = '';
                                    editingDescription = true;
                                }}
                                type="button">
                                + Add description
                            </button>
                        {/if}
                    {/if}
                </div>

                    <!-- Dependencies -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="text-sm font-medium text-gray-300 flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                            </svg>
                            Dependencies
                            </h4>
                        <button
                                class="px-2 py-1 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-xs transition-colors"
                            on:click={() => showDependencyEditor = !showDependencyEditor}
                            type="button"
                        >
                                {showDependencyEditor ? 'Cancel' : 'Edit'}
                        </button>
                    </div>

                    {#if showDependencyEditor}
                            <div class="space-y-2">
                                    <select
                                    class="w-full bg-gray-800 text-white rounded border border-gray-600 p-2 text-sm"
                                        on:change={(e) => {
                                            const selectedId = e.target.value;
                                            if (selectedId && selectedId !== 'default') {
                                                addDependency(selectedId);
                                            e.target.value = 'default';
                                            }
                                        }}
                                    >
                                    <option value="default">+ Add dependency...</option>
                                        {#each availableTasks.filter(task => !quest.dependencies?.includes(task.id)) as task}
                                            <option value={task.id}>{task.title}</option>
                                        {/each}
                                    </select>
                                    {#if dependencyError}
                                        <p class="text-red-400 text-xs mt-1">{dependencyError}</p>
                                    {/if}
                                </div>
                        {/if}
                            
                            {#if quest.dependencies && quest.dependencies.length > 0}
                            <div class="space-y-1">
                                        {#each quest.dependencies as depId, index}
                                            {@const depTask = availableTasks.find(t => t.id === depId)}
                                    <div class="flex items-center justify-between bg-gray-800 p-2 rounded text-sm">
                                                <button
                                            class="flex-1 text-left text-gray-300 hover:text-white transition-colors"
                                                    on:click={() => openDependencyModal(depId)}
                                                    type="button"
                                                >
                                                        {depTask ? depTask.title : depId}
                                                </button>
                                        {#if showDependencyEditor}
                                                <button
                                                class="text-red-400 hover:text-red-300 ml-2 p-1"
                                                    on:click={() => removeDependency(index)}
                                                    type="button"
                                                    aria-label="Remove dependency"
                                                >
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                                    </svg>
                                                </button>
                            {/if}
                        </div>
                                {/each}
                        </div>
                    {:else}
                            <p class="text-gray-500 text-xs">No dependencies</p>
                    {/if}
                </div>

                    <!-- Schedule -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <div class="flex justify-between items-center mb-2">
                            <h4 class="text-sm font-medium text-gray-300 flex items-center gap-2">
                                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            Schedule
                            </h4>
                        <button
                                class="px-2 py-1 bg-gray-700 text-gray-200 rounded hover:bg-gray-600 text-xs transition-colors"
                            on:click={() => (showDatePicker = !showDatePicker)}
                            type="button"
                        >
                                {quest.when ? "Edit" : "Set"}
                        </button>
                    </div>

                    {#if showDatePicker}
                                <div class="space-y-2">
                                <div class="grid grid-cols-2 gap-2">
                                    <input
                                        type="date"
                                        class="bg-gray-800 text-white rounded border border-gray-600 p-2 text-sm"
                                        bind:value={selectedDate}
                                    />
                                    <input
                                        type="time"
                                        class="bg-gray-800 text-white rounded border border-gray-600 p-2 text-sm"
                                        bind:value={selectedTime}
                                    />
                                </div>
                                <div class="flex justify-end gap-2">
                                <button
                                        class="px-2 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 text-xs"
                                    on:click={() => (showDatePicker = false)}
                                    type="button"
                                >
                                    Cancel
                                </button>
                                <button
                                        class="px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-xs"
                                    on:click={scheduleTask}
                                    type="button"
                                >
                                        Save
                                </button>
                            </div>
                        </div>
                        {:else if quest.when}
                            <div class="bg-gray-800 p-2 rounded text-sm">
                            <div class="flex items-center justify-between">
                                    <span class="text-gray-300">
                                        {new Date(quest.when).toLocaleDateString()} at {new Date(quest.when).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                <button
                                        class="text-gray-400 hover:text-red-400 p-1"
                                        on:click={() => updateQuest({ when: null, status: "ongoing" })}
                                    type="button"
                                        aria-label="Remove schedule"
                                    >
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        {:else}
                            <p class="text-gray-500 text-xs">Not scheduled</p>
                    {/if}
                    </div>
                </div>

                <!-- Right column -->
                <div class="space-y-3 min-h-0">
                    <!-- Team Selection -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                            </svg>
                            Team
                            {#if quest.participants?.length}
                                <span class="text-xs text-indigo-400">({quest.participants.length} selected)</span>
                            {/if}
                        </h4>

                        {#if !usersLoading && Object.keys(userStore).length > 4}
                            <div class="team-search">
                                <input
                                    type="search"
                                    class="team-search__input"
                                    placeholder="Search team…"
                                    bind:value={userSearchQuery}
                                    autocomplete="off"
                                    autocorrect="off"
                                    autocapitalize="off"
                                    spellcheck="false"
                                />
                                {#if userSearchQuery}
                                    <button
                                        type="button"
                                        class="team-search__clear"
                                        on:click|stopPropagation={() => (userSearchQuery = '')}
                                        aria-label="Clear search"
                                    >&times;</button>
                                {/if}
                            </div>
                        {/if}

                        <!-- Always visible, scrollable user list with multi-select -->
                        <div class="max-h-48 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                            {#if usersLoading}
                                <div class="flex items-center justify-center py-4">
                                    <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span class="text-gray-400 text-xs ml-2">Loading team...</span>
                                </div>
                            {:else if Object.keys(userStore).length === 0}
                                <p class="text-gray-500 text-xs py-2 text-center">No users in this holon</p>
                            {:else if filteredUserEntries.length === 0}
                                <p class="text-gray-500 text-xs py-2 text-center">No matching users</p>
                            {:else}
                                {#each filteredUserEntries as [userKey, user] (user.id)}
                                    {@const isSelected = participantIds.has(String(user.id))}
                                    {@const currentTime = isSelected ? (quest.timeTracking?.[user.id] || 0) : 0}
                                    <!-- Row is a div, not a button, so the +15m action button inside is valid HTML. -->
                                    <div
                                        class="user-row {isSelected ? 'user-row--selected' : ''}"
                                        role="button"
                                        tabindex="0"
                                        aria-pressed={isSelected}
                                        on:click|stopPropagation={() => toggleUserParticipation(userKey, user)}
                                        on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleUserParticipation(userKey, user); } }}
                                    >
                                        <div class="flex items-center gap-2.5 min-w-0">
                                            <!-- Checkbox indicator -->
                                            <div class="user-row__check {isSelected ? 'user-row__check--on' : ''}">
                                                {#if isSelected}
                                                    <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                                    </svg>
                                                {/if}
                                            </div>
                                            <img
                                                src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
                                                alt={resolvedName(user.id, $nameMap, user)}
                                                class="w-7 h-7 rounded-full"
                                                loading="lazy"
                                            />
                                            <div class="text-left min-w-0">
                                                <div class="text-gray-200 font-medium truncate">
                                                    <DisplayName id={user.id} {user} />
                                                </div>
                                                {#if currentTime > 0}
                                                    <div class="text-xs text-indigo-300">{formatTime(currentTime)}</div>
                                                {/if}
                                            </div>
                                        </div>

                                        <!-- Time tracking button (only for selected users) -->
                                        {#if isSelected}
                                            <button
                                                class="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 active:bg-green-500/40 flex-shrink-0 touch-manipulation min-h-[32px] min-w-[44px]"
                                                on:click|stopPropagation={() => updateTimeTracking(user.id, 0.25)}
                                                title="Add 15 minutes"
                                                type="button"
                                            >
                                                +15m
                                            </button>
                                        {/if}
                                    </div>
                                {/each}
                            {/if}
                        </div>

                        <!-- Time summary -->
                        {#if quest.timeTracking && Object.keys(quest.timeTracking).length > 0}
                            {@const totalHours = Object.values(quest.timeTracking).reduce((sum: number, hours: any) => sum + (hours as number), 0)}
                            {#if totalHours > 0}
                                <div class="bg-gray-800 p-2 rounded text-xs text-center border-t border-gray-600 mt-2">
                                    <span class="text-gray-400">Total: </span>
                                    <span class="text-white font-medium">{formatTime(totalHours as number)}</span>
                                </div>
                            {/if}
                        {/if}
                </div>

                    <!-- Quick Actions -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                            </svg>
                            Actions
                        </h4>
                        <div class="space-y-1">
                        {#if quest.checklistId}
                            <button
                                    class="w-full px-2 py-1 bg-teal-500/20 text-teal-300 rounded text-xs hover:bg-teal-500/30 transition-colors flex items-center gap-2"
                                on:click={navigateToChecklist}
                                type="button"
                            >
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                </svg>
                                View Checklist
                            </button>
                        {:else}
                            <button
                                    class="w-full px-2 py-1 bg-gray-600 text-gray-300 rounded text-xs hover:bg-gray-500 transition-colors flex items-center gap-2"
                                on:click={createChecklistForTask}
                                type="button"
                            >
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                    </svg>
                                    Create Checklist
                            </button>
                        {/if}

                        {#if quest.canvasId}
                            <button
                                class="w-full px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs hover:bg-purple-500/30 transition-colors flex items-center gap-2"
                                on:click={navigateToCanvas}
                                type="button"
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                                </svg>
                                Open Canvas
                            </button>
                        {:else}
                            <button
                                class="w-full px-2 py-1 bg-gray-600 text-gray-300 rounded text-xs hover:bg-gray-500 transition-colors flex items-center gap-2"
                                on:click={createCanvasForTask}
                                type="button"
                            >
                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                </svg>
                                Create Canvas
                            </button>
                        {/if}
                    </div>
                </div>

                    <!-- Recurring Task Selector -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                            </svg>
                            Recurring
                        </h4>
                        <div class="flex flex-wrap gap-1.5">
                            {#each frequencyOptions as option}
                                {@const isSelected = (frequency ?? null) === option.value}
                                <button
                                    type="button"
                                    class="px-2.5 py-1 text-xs rounded border transition-colors {isSelected
                                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200'}"
                                    on:click={() => updateFrequency(option.value)}
                                    aria-pressed={isSelected}
                                >
                                    {#if isSelected}✓ {/if}{option.label}
                                </button>
                            {/each}
                        </div>
                        {#if quest.recurringTaskId}
                            <div class="mt-2 text-[11px] text-gray-500">ID: {quest.recurringTaskId}</div>
                        {/if}
                    </div>
                </div>
            </div>

            <!-- Footer Actions -->
            <div class="border-t border-gray-700 p-4">
                <div class="flex gap-2 justify-between">
                    <button
                        class="px-3 py-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 border border-red-500/30 transition-colors text-sm flex items-center gap-2"
                        on:click={deleteQuest}
                        type="button"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                        Delete
                    </button>

                    <div class="flex gap-2">
                    <PublishToFederationButton
                        {holonId}
                        lens="quests"
                        item={quest}
                        onPublished={handlePublished}
                    />
                    <button
                            class="px-4 py-2 {(isOccurrenceView ? isOccurrenceCompleted : quest.status === 'completed')
                                ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                                : 'bg-green-500/10 text-green-400 border-green-500/30'} rounded border hover:bg-opacity-20 transition-colors text-sm font-medium"
                        on:click={handleCompleteClick}
                        type="button"
                        title={isOccurrenceView ? 'Completes only this occurrence of the recurring series' : undefined}
                    >
                            {#if isOccurrenceView}
                                {isOccurrenceCompleted ? 'Mark Ongoing (this occurrence)' : 'Mark Complete (this occurrence)'}
                            {:else}
                                {quest.status === 'completed' ? 'Mark Ongoing' : 'Mark Complete'}
                            {/if}
                    </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

