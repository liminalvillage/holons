<script lang="ts">
    import { createEventDispatcher, getContext, onMount } from "svelte";
    import { fade, scale } from "svelte/transition";
    import { goto } from '$app/navigation';
    import type { HoloSphere } from "holosphere";
    import { getHologramSourceName } from "../utils/holonNames";
    import { formatDate } from "../utils/date";
    import {
        calculateTaskCompletionScores,
        getActionScore,
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

    export let quest: any;
    export let questId: string;
    export let holonId: string;

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

    // Function to add current logged-in user to userStore if not already present
    function ensureCurrentUserInStore(store: UserStore): UserStore {
        const telegramState = telegramStore.getState();
        const telegramUser = telegramState.user;
        const pubKey = $nostrPublicKey;

        // Check if Telegram user is logged in
        if (telegramUser) {
            const telegramId = String(telegramUser.id);
            // Check if user already exists in store (by telegram ID)
            const existsById = Object.values(store).some(u => String(u.id) === telegramId);
            if (!existsById) {
                // Add telegram user to store
                const userKey = telegramUser.username || telegramId;
                store[userKey] = {
                    id: telegramId,
                    first_name: telegramUser.first_name,
                    last_name: telegramUser.last_name,
                    username: telegramUser.username || telegramId,
                    picture: telegramUser.photo_url
                };
            }
        }
        // Check if Nostr user is logged in (and not already covered by telegram)
        else if (pubKey) {
            // Check if user already exists in store (by pubKey)
            const existsByPubKey = Object.values(store).some(u => u.id === pubKey);
            if (!existsByPubKey) {
                // Add nostr user to store with pubKey as ID
                const shortKey = `${pubKey.slice(0, 8)}...${pubKey.slice(-6)}`;
                store[pubKey] = {
                    id: pubKey,
                    first_name: 'You',
                    last_name: '',
                    username: shortKey
                };
            }
        }

        return store;
    }

    // Use cached data immediately for instant display
    let userStore: UserStore = ensureCurrentUserInStore(getCachedUsersObject(holonId));
    let equation: ScoreEquation = getCachedEquation(holonId);

    let showDatePicker = false;
    let selectedDate = quest.when ? new Date(quest.when) : new Date();
    let selectedTime = quest.when
        ? new Date(quest.when).toTimeString().slice(0, 5)
        : "12:00";

    // Dependency management
    let showDependencyEditor = false;
    let availableTasks: Array<{id: string, title: string}> = [];

    // Recurring task management
    let showRecurringEditor = false;
    let recurringTaskId = quest.recurringTaskId || '';
    let recurringStatus = quest.status || 'ongoing';

    let editingTitle = false;
    let editedTitle = quest.title;

    let editingDescription = false;
    let tempDescription = quest.description || "";

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

    // Function to get hologram source name using centralized service
    function getHologramSource(soul: string | undefined): string {
        if (!soul) return '';

        // Use the centralized service to get hologram source name
        // Don't use callback to avoid reactive loops - just return cached value
        return getHologramSourceName(holosphere, soul);
    }

    // Add function to navigate to hologram source
    function navigateToHologramSource() {
        if (!quest._hologram?.sourceHolon) return;

        // Navigate to the source holon using sourceHolon directly
        goto(`/${quest._hologram.sourceHolon}/dashboard`);
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
                userStore = ensureCurrentUserInStore(getCachedUsersObject(holonId));
                equation = getCachedEquation(holonId);
                usersLoading = false;
            });

            // Subscribe to quests for dependency tracking
            try {
                const questOff = holosphere.subscribe(holonId, "quests", (updatedQuest: any) => {
                    if (updatedQuest?.id && updatedQuest.id !== questId) {
                        const existingIndex = availableTasks.findIndex(t => t.id === updatedQuest.id);
                        const newTask = { id: updatedQuest.id, title: updatedQuest.title || 'Untitled Task' };
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

            // Fetch quests for dependencies
            holosphere.getAll(holonId, "quests").then((questsData: any) => {
                const quests = Array.isArray(questsData) ? questsData : Object.values(questsData || {});
                availableTasks = quests
                    .filter((q: any) => q?.id && q.id !== questId)
                    .map((q: any) => ({ id: q.id, title: q.title || 'Untitled Task' }));
            }).catch(() => {});
        }

        return () => {
            if (holonUnsub) holonUnsub();
            if (unsubscribeQuests) unsubscribeQuests();
        };
    });

    const dispatch = createEventDispatcher();
    let usersLoading = true;
    let pendingUserUpdates = new Set<string>(); // Track pending updates for optimistic UI

    // Completion modal state
    let showCompletionModal = false;
    let completionSelectedUsers = new Set<string>(); // Track selected user IDs for completion
    $: completionSelectedUserIds = completionSelectedUsers; // Reactive for template

    // Optimistic toggle for snappy UI
    async function toggleUserParticipation(userKey: string, user: User) {
        if (pendingUserUpdates.has(userKey)) return; // Prevent double-clicks

        pendingUserUpdates.add(userKey);
        pendingUserUpdates = pendingUserUpdates; // Trigger reactivity

        try {
            if (isUserParticipant(user.id)) {
                await removeParticipant(user.id);
            } else {
                await toggleParticipant(userKey);
            }
        } finally {
            pendingUserUpdates.delete(userKey);
            pendingUserUpdates = pendingUserUpdates;
        }
    }

    async function updateQuest(updates: any, shouldClose = false) {
        if (!holosphere) {
            console.error("[TaskModal.svelte] Cannot update quest: holosphere is not available");
            return;
        }

        const updatedQuest = { ...quest, ...updates };

        // holosphere.put() is optimistic - caches locally and returns immediately
        await holosphere.put(holonId, "quests", updatedQuest);
        quest = updatedQuest;

        if (shouldClose) {
            dispatch("close");
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
                await holosphere.delete(holonId, "quests", questId);
                dispatch("close", { deleted: true, questId });
            } catch (error) {
                console.error("Error deleting quest:", error);
            }
        }
    }

    function closeModal() {
        dispatch("close");
    }

    async function removeParticipant(participantId: string) {
        const participants = (quest.participants || []).filter(
            (p: { id: string }) => p.id !== participantId
        );

        // Also reset time tracking for the removed participant
        const updatedTimeTracking = { ...quest.timeTracking };
        if (updatedTimeTracking[participantId]) {
            delete updatedTimeTracking[participantId];
        }

        await updateQuest({
            participants,
            timeTracking: updatedTimeTracking
        });
    }

    function isUserParticipant(userId: string): boolean {
        if (!quest.participants || quest.participants.length === 0) return false;
        return quest.participants.some((p: { id: string }) => p.id === userId);
    }

    // Reactive Set of participant IDs for Svelte template reactivity
    $: participantIds = new Set((quest.participants || []).map((p: any) => p.id));

    // Open completion modal and initialize with current participants
    function openCompletionModal() {
        // If already completed, just toggle back to ongoing
        if (quest.status === "completed") {
            completeQuest();
            return;
        }
        // Initialize with current participants
        completionSelectedUsers = new Set((quest.participants || []).map((p: any) => p.id));
        showCompletionModal = true;
    }

    // Toggle user selection in completion modal
    function toggleCompletionUser(userId: string) {
        const newSet = new Set(completionSelectedUsers);
        if (newSet.has(userId)) {
            newSet.delete(userId);
        } else {
            newSet.add(userId);
        }
        completionSelectedUsers = newSet; // Trigger reactivity with new Set
    }

    async function completeQuest() {
        const newStatus =
            quest.status === "completed" ? "ongoing" : "completed";

        if (newStatus === "completed") {
            // Get selected participants from completion modal (or current participants if modal not used)
            const selectedParticipantIds = showCompletionModal
                ? Array.from(completionSelectedUsers)
                : (quest.participants || []).map((p: any) => p.id);

            // Build the participants array from selected user IDs
            const selectedParticipants = selectedParticipantIds
                .map(id => {
                    // First check if already in quest.participants
                    const existing = (quest.participants || []).find((p: any) => p.id === id);
                    if (existing) return existing;
                    // Otherwise find in userStore
                    const user = Object.values(userStore).find(u => u.id === id);
                    if (user) {
                        return {
                            id: user.id,
                            firstName: user.first_name,
                            lastName: user.last_name,
                            username: user.username
                        };
                    }
                    return null;
                })
                .filter(Boolean);

            // Update quest participants to match selection
            if (showCompletionModal) {
                await updateQuest({ participants: selectedParticipants });
            }

            // Calculate scores using the same computation as Holonsbot
            const completionScores = calculateTaskCompletionScores(
                quest.initiator?.id || null,
                selectedParticipantIds,
                quest.timeTracking || {},
                equation
            );

            // Track initiator action with equation-based scoring
            if (quest.initiator) {
                const initiatorData = await holosphere.get(
                    holonId,
                    "users",
                    quest.initiator.id,
                );
                if (initiatorData) {
                    const initiatorScore = completionScores.get(quest.initiator.id);
                    const initiatedPoints = getActionScore('initiated', 1, equation).points;

                    await holosphere.put(holonId, "users", {
                        ...initiatorData,
                        initiated: [
                            ...(Array.isArray(initiatorData.initiated) ? initiatorData.initiated : []),
                            quest.title,
                        ],
                        actions: [
                            ...(Array.isArray(initiatorData.actions) ? initiatorData.actions : []),
                            {
                                type: "initiated",
                                action: quest.title,
                                amount: initiatedPoints, // Use equation weight
                                questId: questId,
                                timestamp: new Date(),
                            },
                        ],
                    });
                }
            }

            // Track participant completions with equation-based scoring
            for (const participant of selectedParticipants) {
                const userData = await holosphere.get(
                    holonId,
                    "users",
                    participant.id,
                );
                if (!userData) {
                    console.error(`User data not found for participant ID: ${participant.id}`);
                    continue;
                }

                const participantScore = completionScores.get(participant.id);
                const completedPoints = getActionScore('completed', 1, equation).points;
                const hoursTracked = (quest.timeTracking?.[participant.id] || 0) as number;

                // Build updated user data
                const updatedUser: any = {
                    ...userData,
                    completed: [...(Array.isArray(userData.completed) ? userData.completed : []), quest.title],
                    actions: [
                        ...(Array.isArray(userData.actions) ? userData.actions : []),
                        {
                            type: "completed",
                            action: quest.title,
                            amount: completedPoints, // Use equation weight
                            questId: questId,
                            timestamp: new Date(),
                        },
                    ],
                };

                // If they tracked hours, update hours and collaboration (same as Holonsbot)
                if (hoursTracked > 0) {
                    const hoursPoints = getActionScore('hours', hoursTracked, equation).points;
                    const collabPoints = equation.collaboration; // 1 per time log event

                    updatedUser.hours = (userData.hours || 0) + hoursTracked;
                    updatedUser.collaboration = (userData.collaboration || 0) + 1;
                    updatedUser.actions.push({
                        type: "collaborated",
                        action: quest.title,
                        amount: hoursPoints + collabPoints, // Combined hours + collaboration score
                        hours: hoursTracked,
                        questId: questId,
                        timestamp: new Date(),
                    });
                }

                await holosphere.put(holonId, "users", updatedUser);
            }

            // Create expense entries for all time tracked
            if (quest.timeTracking) {
                for (const [userID, hours] of Object.entries(quest.timeTracking)) {
                    const hoursAsNumber = hours as number;
                    if (hoursAsNumber > 0) {
                        // Create expense entry for the time logged, using chatID for splitWith
                        try {
                            const messageID = `${questId}_time_${userID}_${Date.now()}`; // Unique ID for this expense
                            await holosphere.put(holonId, "expenses", {
                                id: messageID,
                                chatID: holonId,
                                amount: hoursAsNumber, // Total hours logged
                                unit: 'hour',
                                description: quest.title,
                                paidBy: userID,
                                splitWith: [holonId], // Split with the current holon (chatID)
                                timestamp: new Date().toISOString(),
                                fromTimeTracking: true, // Flag to identify expenses from time tracking
                                questId: questId
                            });
                        } catch (error) {
                            console.error(`Error adding time tracking expense for user ${userID}:`, error);
                        }
                    }
                }
            }

            await updateQuest({ status: newStatus, completed_at: new Date().toISOString() });
            showCompletionModal = false;
            dispatch("taskCompleted", { questId });
            dispatch("close");
        } else {
            await updateQuest({ status: newStatus, completed_at: null });
        }
    }

    async function toggleParticipant(userKey: string) {
        // userKey is a key from userStore (username)
        const user = userStore[userKey];
        if (!user || !user.id) {
            console.error("User not found in userStore or user.id is missing:", userKey);
            return;
        }

        // Check if user is already a participant by ID
        if (isUserParticipant(user.id)) {
            return;
        }

        const newParticipant = {
            id: user.id, // Store the actual user ID
            firstName: user.first_name, // Map to firstName
            lastName: user.last_name,   // Map to lastName
            username: user.username, 
        };

        const newParticipantsArray = [...(quest.participants || []), newParticipant];

        // When updating user data (actions), use the canonical ID that holosphere.get/put expects for users.
        // This might be user.id (the original UUID-like ID) if it exists and is different from username.
        const canonicalUserIdForHolosphere = user.id || user.username; // Choose appropriately
        const userData = (await holosphere.get(holonId, "users", canonicalUserIdForHolosphere)) || {
            id: user.id,
            actions: [],
        };

        await holosphere.put(holonId, "users", {
            ...userData,
            id: user.id,
            actions: [
                ...(Array.isArray(userData.actions) ? userData.actions : []),
                {
                    type: "joined",
                    action: quest.title,
                    category: quest.category || "",
                    amount: 1,
                    timestamp: Date.now(),
                },
            ],
        });

            // Update quest with new participants
    await updateQuest({ participants: newParticipantsArray });
    
    // Create a hologram of the task in the participant's personal holon (if they have one)
    // Only attempt if user.id is a valid holon ID (non-empty string)
    if (user.id && typeof user.id === 'string' && user.id.trim() !== '' && user.id !== holonId) {
        try {
            const hologram = holosphere.createHologram(holonId, 'quests', quest);
            await holosphere.put(user.id, 'quests', hologram);
        } catch (error) {
            // Silently ignore - user may not have a personal holon
            console.debug(`[TaskModal.svelte] Could not create hologram in participant's holon (${user.id}):`, error);
        }
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
                    .catch((error) =>
                        console.error("Error updating quest position:", error),
                    );
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
        
        const currentDependencies = quest.dependsOn || [];
        if (!currentDependencies.includes(taskId)) {
            const updatedDependencies = [...currentDependencies, taskId];
            await updateQuest({ dependsOn: updatedDependencies });
        }
    }

    async function removeDependency(index: number) {
        const currentDependencies = quest.dependsOn || [];
        const updatedDependencies = currentDependencies.filter((_, i) => i !== index);
        await updateQuest({ dependsOn: updatedDependencies });
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

    // Add function to create checklist for this task
    async function createChecklistForTask() {
        if (!holosphere || !holonId || !questId) {
            console.error("Cannot create checklist: missing parameters");
            return;
        }

        try {
            const newChecklist = {
                id: `task_${questId}_checklist`,
                items: [],
                creator: "Dashboard User",
                created: new Date().toISOString(),
                questId: questId // Link to this task
            };

            await holosphere.put(holonId, "checklists", newChecklist);
            
            // Update the quest to include the checklist ID
            await updateQuest({ checklistId: newChecklist.id });
            
            console.log(`Created checklist for task ${questId}: ${newChecklist.id}`);
        } catch (error) {
            console.error("Error creating checklist for task:", error);
        }
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

    // Add publish functionality
    let isPublishing = false;
    let publishStatus = '';

    async function publishToFederatedChats() {
        if (!holosphere || !holonId || !questId) {
            console.error("Cannot publish: missing holosphere, holonId, or questId");
            return;
        }

        isPublishing = true;
        publishStatus = 'Checking federation...';

        try {
            // Get settings to check for hex configuration
            let settingsHex: string | null = null;
            try {
                const settingsResult = await holosphere.get(holonId, 'settings', holonId);
                const settings = settingsResult;
                if (settings && settings.hex) {
                    settingsHex = settings.hex;
                    console.log('[TaskModal] Found settings hex:', settingsHex);
                }
            } catch (e) {
                console.log('[TaskModal] No settings hex found:', e);
            }

            // First check if there are any federated chats available
            const fedInfo = await holosphere.getFederation(holonId);

            // Check if we have federated holons
            const hasFederatedHolons = fedInfo && fedInfo.outbound && fedInfo.outbound.length > 0;

            // If we have neither federation nor settings hex, show error
            if (!hasFederatedHolons && !settingsHex) {
                publishStatus = 'No federated holons found. Please set up federation or configure a hex in settings.';
                setTimeout(() => {
                    publishStatus = '';
                }, 5000);
                return;
            }

            publishStatus = 'Publishing...';

            // Create a hologram for the quest to propagate
            // Use the full quest data instead of just the ID reference
            const hologram = holosphere.createHologram(holonId, 'quests', quest);

            // Determine if this is an H3 holon by checking if it's a valid H3 cell
            let isH3Holon = false;
            try {
                // Use holosphere's isValidH3 method (type assertion needed as types aren't available)
                isH3Holon = (holosphere as any).isValidH3(holonId);
            } catch (e) {
                // If check fails, assume it's not H3
                isH3Holon = false;
            }

            let totalPublished = 0;
            const publishErrors: string[] = [];

            // First, publish to settings hex if configured
            if (settingsHex) {
                try {
                    console.log('[TaskModal] Publishing to settings hex:', settingsHex);
                    await holosphere.put(settingsHex, 'quests', hologram);
                    totalPublished++;
                    console.log('[TaskModal] Successfully published to settings hex');
                } catch (error) {
                    console.error('[TaskModal] Failed to publish to settings hex:', error);
                    publishErrors.push(`Settings hex: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Then use federation propagation to publish to federated spaces
            // Only enable parent propagation for H3-based holons
            if (hasFederatedHolons) {
                const propagationResult = await holosphere.propagate(holonId, 'quests', hologram, {
                    useHolograms: true,
                    propagateToParents: isH3Holon,  // Only propagate to parents if this is an H3 holon
                    maxParentLevels: isH3Holon ? 1 : 0  // Only propagate to immediate parent (1 level up) for H3 holons
                });

                console.log('[TaskModal] Propagation result:', propagationResult);

                totalPublished += (propagationResult.success || 0) + (propagationResult.parentPropagation?.success || 0);

                // Collect any propagation errors
                if (propagationResult.failed > 0) {
                    if (propagationResult.messages && Array.isArray(propagationResult.messages)) {
                        publishErrors.push(...propagationResult.messages);
                    }
                    if (propagationResult.parentPropagation?.messages && propagationResult.parentPropagation.messages.length > 0) {
                        publishErrors.push(...propagationResult.parentPropagation.messages);
                    }
                }
            }

            if (totalPublished > 0) {
                const locations = settingsHex && hasFederatedHolons
                    ? `${totalPublished} location(s) (settings hex + federation)`
                    : settingsHex
                        ? `settings hex`
                        : `${totalPublished} federated holon(s)`;
                // Add warning if there were partial errors
                if (publishErrors.length > 0) {
                    publishStatus = `Published to ${locations} (with some errors)`;
                    console.warn('[TaskModal] Publish errors:', publishErrors);
                } else {
                    publishStatus = `Published to ${locations}`;
                }

                // Update the quest to show it's been published
                await updateQuest({
                    published: true,
                    publishedAt: new Date().toISOString(),
                    publishedTo: totalPublished
                });

                // Show success message briefly
                setTimeout(() => {
                    publishStatus = '';
                }, 3000);
            } else {
                // All publish attempts failed
                let errorMessage = 'Failed to publish to all targets';

                if (publishErrors.length > 0) {
                    errorMessage = publishErrors.join('; ');
                }

                console.error('[TaskModal] Publishing failed:', errorMessage);
                publishStatus = `Failed to publish: ${errorMessage}`;

                // Show error message briefly
                setTimeout(() => {
                    publishStatus = '';
                }, 5000);
            }
        } catch (error) {
            console.error("[TaskModal.svelte] Error publishing quest:", error);
            publishStatus = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;

            // Show error message briefly
            setTimeout(() => {
                publishStatus = '';
            }, 5000);
        } finally {
            isPublishing = false;
        }
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
                    {#if quest._hologram?.isHologram}
                        <button
                            class="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded text-xs hover:bg-blue-500/30 transition-colors"
                            on:click={navigateToHologramSource}
                            title="Navigate to source holon: {getHologramSource(quest._hologram.soul)}"
                            type="button"
                        >
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            </svg>
                            Hologram
                        </button>
                    {/if}
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
        background: #374151;
        border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb {
        background: #6B7280;
        border-radius: 3px;
    }
    
    ::-webkit-scrollbar-thumb:hover {
        background: #9CA3AF;
    }

    /* Modal content scrollbar styling */
    .modal-content::-webkit-scrollbar {
        width: 8px;
    }
    
    .modal-content::-webkit-scrollbar-track {
        background: #374151;
        border-radius: 4px;
    }
    
    .modal-content::-webkit-scrollbar-thumb {
        background: #6B7280;
        border-radius: 4px;
    }
    
    .modal-content::-webkit-scrollbar-thumb:hover {
        background: #9CA3AF;
    }
</style>

            <!-- Main content grid -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 text-gray-300 min-h-0">
                <!-- Left column -->
                <div class="space-y-3 min-h-0">
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
                                        {#each availableTasks.filter(task => !quest.dependsOn?.includes(task.id)) as task}
                                            <option value={task.id}>{task.title}</option>
                                        {/each}
                                    </select>
                                </div>
                        {/if}
                            
                            {#if quest.dependsOn && quest.dependsOn.length > 0}
                            <div class="space-y-1">
                                        {#each quest.dependsOn as depId, index}
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

                        <!-- Always visible, scrollable user list with multi-select -->
                        <div class="max-h-48 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                            {#if usersLoading}
                                <div class="flex items-center justify-center py-4">
                                    <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span class="text-gray-400 text-xs ml-2">Loading team...</span>
                                </div>
                            {:else if Object.keys(userStore).length === 0}
                                <p class="text-gray-500 text-xs py-2 text-center">No users in this holon</p>
                            {:else}
                                {#each Object.entries(userStore) as [userKey, user] (user.id)}
                                    {@const isPending = pendingUserUpdates.has(userKey)}
                                    {@const isSelected = participantIds.has(user.id)}
                                    {@const currentTime = isSelected ? (quest.timeTracking?.[user.id] || 0) : 0}
                                    <button
                                        class="w-full flex items-center justify-between p-2.5 rounded-lg text-sm transition-all touch-manipulation select-none active:scale-[0.98] {isSelected ? 'bg-indigo-500/20 border border-indigo-500/40' : 'bg-gray-800 hover:bg-gray-700 active:bg-gray-600 border border-transparent'} {isPending ? 'opacity-60 pointer-events-none' : ''}"
                                        on:click|stopPropagation={() => toggleUserParticipation(userKey, user)}
                                        type="button"
                                        disabled={isPending}
                                    >
                                        <div class="flex items-center gap-2.5">
                                            <!-- Checkbox indicator -->
                                            <div class="w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors {isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-500'}">
                                                {#if isPending}
                                                    <div class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                                {:else if isSelected}
                                                    <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                                    </svg>
                                                {/if}
                                            </div>
                                            <img
                                                src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
                                                alt={user.first_name}
                                                class="w-7 h-7 rounded-full"
                                                loading="lazy"
                                            />
                                            <div class="text-left">
                                                <div class="text-gray-200 font-medium">
                                                    {user.first_name} {user.last_name || ""}
                                                </div>
                                                {#if currentTime > 0}
                                                    <div class="text-xs text-indigo-300">{formatTime(currentTime)}</div>
                                                {/if}
                                            </div>
                                        </div>

                                        <!-- Time tracking button (only for selected users) -->
                                        {#if isSelected && !isPending}
                                            <button
                                                class="px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs hover:bg-green-500/30 active:bg-green-500/40 flex-shrink-0 touch-manipulation min-h-[32px] min-w-[44px]"
                                                on:click|stopPropagation={() => updateTimeTracking(user.id, 0.25)}
                                                title="Add 15 minutes"
                                                type="button"
                                            >
                                                +15m
                                            </button>
                                        {/if}
                                    </button>
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
                    </div>
                </div>

                    <!-- Recurring Task Info -->
                    {#if quest.recurringTaskId || quest.status === 'recurring' || quest.status === 'repeating'}
                        <div class="bg-gray-700/30 p-3 rounded-lg">
                            <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                                </svg>
                                Recurring
                            </h4>
                            <div class="space-y-1 text-xs text-gray-400">
                                {#if quest.recurringTaskId}
                                    <div>ID: {quest.recurringTaskId}</div>
                                {/if}
                                <div>Status: {quest.status}</div>
                            </div>
                        </div>
                    {/if}
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
                    <button
                            class="px-4 py-2 bg-purple-500/10 text-purple-400 rounded hover:bg-purple-500/20 border border-purple-500/30 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        on:click={publishToFederatedChats}
                        disabled={isPublishing}
                        type="button"
                        title="Publish this task as a hologram to all federated holons"
                    >
                        {#if isPublishing}
                            <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                            </svg>
                        {:else}
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
                            </svg>
                        {/if}
                        Publish to Federation
                    </button>
                    <button
                            class="px-4 py-2 {quest.status === 'completed'
                                ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
                                : 'bg-green-500/10 text-green-400 border-green-500/30'} rounded border hover:bg-opacity-20 transition-colors text-sm font-medium"
                        on:click={openCompletionModal}
                        type="button"
                    >
                            {quest.status === "completed" ? "Mark Ongoing" : "Mark Complete"}
                    </button>
                    </div>
                </div>

                {#if publishStatus}
                    <div class="mt-2 px-3 py-2 rounded text-sm {publishStatus.includes('Published') ? 'bg-green-500/10 text-green-400 border border-green-500/30' : publishStatus.includes('Failed') || publishStatus.includes('Error') ? 'bg-red-500/10 text-red-400 border border-red-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'}">
                        {publishStatus}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<!-- Completion Modal -->
{#if showCompletionModal}
    <div
        class="fixed inset-0 bg-black bg-opacity-70 z-[60] flex items-center justify-center p-4"
        on:click|self={() => showCompletionModal = false}
        on:keydown={(e) => e.key === "Escape" && (showCompletionModal = false)}
        role="presentation"
        transition:fade
    >
        <div
            class="bg-gray-800 rounded-xl max-w-md w-full shadow-2xl border border-gray-700"
            transition:scale={{ duration: 200, start: 0.95 }}
            role="dialog"
            aria-modal="true"
            on:click|stopPropagation
            on:keydown|stopPropagation
        >
            <!-- Header -->
            <div class="p-4 border-b border-gray-700">
                <h3 class="text-lg font-bold text-white flex items-center gap-2">
                    <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    Complete Task
                </h3>
                <p class="text-sm text-gray-400 mt-1">Select who completed this task</p>
            </div>

            <!-- User Selection -->
            <div class="p-4 max-h-64 overflow-y-auto">
                {#if Object.keys(userStore).length === 0}
                    <p class="text-gray-500 text-sm text-center py-4">No users available</p>
                {:else}
                    <div class="space-y-1">
                        {#each Object.entries(userStore) as [userId, user] (user.id)}
                            {@const isSelected = completionSelectedUserIds.has(user.id)}
                            <button
                                class="w-full flex items-center gap-3 p-2.5 rounded-lg text-sm transition-all touch-manipulation {isSelected ? 'bg-green-500/20 border border-green-500/40' : 'bg-gray-700 hover:bg-gray-600 border border-transparent'}"
                                on:click={() => toggleCompletionUser(user.id)}
                                type="button"
                            >
                                <div class="w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors {isSelected ? 'bg-green-500 border-green-500' : 'border-gray-500'}">
                                    {#if isSelected}
                                        <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                        </svg>
                                    {/if}
                                </div>
                                <img
                                    src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
                                    alt={user.first_name}
                                    class="w-7 h-7 rounded-full"
                                    loading="lazy"
                                />
                                <span class="text-gray-200 font-medium">
                                    {user.first_name} {user.last_name || ""}
                                </span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            <div class="p-4 border-t border-gray-700 flex justify-between gap-2">
                <button
                    class="px-3 py-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 border border-red-500/30 transition-colors text-sm flex items-center gap-2"
                    on:click={() => { showCompletionModal = false; deleteQuest(); }}
                    type="button"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete
                </button>

                <div class="flex gap-2">
                    <button
                        class="px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors text-sm"
                        on:click={() => showCompletionModal = false}
                        type="button"
                    >
                        Cancel
                    </button>
                    <button
                        class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm font-medium flex items-center gap-2"
                        on:click={completeQuest}
                        type="button"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                        </svg>
                        Complete ({completionSelectedUserIds.size})
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
