<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, scale } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { browser } from "$app/environment";
    import type { HoloSphere } from "holosphere";
    import { ID, walletAddress } from "../dashboard/store";
    import { nostrPublicKey } from "$lib/stores/nostr";
    import { 
        savePersonalHolons, 
        loadPersonalHolons, 
        loadVisitedHolons, 
        saveVisitedHolons, 
        addVisitedHolon,
        mergeHolonLists,
        type PersonalHolon,
        type VisitedHolon
    } from "../utils/localStorage";
    import { fetchHolonName, clearHolonNameCache, clearFallbackNames, forceRefreshHolonName } from "../utils/holonNames";
    import MyHolonsIcon from "../dashboard/sidebar/icons/MyHolonsIcon.svelte";
    import QRScanner from "./QRScanner.svelte";

    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    const dispatch = createEventDispatcher();

    interface MyHolon {
        id: string;
        name: string;
        lastVisited: number;
        isPinned: boolean;
        isPersonal: boolean; // true for manually added, false for federated
        order: number;
        color?: string;
        description?: string;
        stats?: {
            users: number;
            tasks: number;
            offers: number;
            lastActivity: number;
        };
    }

    interface FederatedHolon {
        id: string;
        name: string;
        lensConfig: {
            inbound: string[];
            outbound: string[];
        };
    }

    interface VisitedHolon {
        id: string;
        name: string;
        lastVisited: number;
        visitCount: number;
        stats?: {
            users: number;
            tasks: number;
            offers: number;
            lastActivity: number;
        };
    }

    // State
    let isLoading = true;
    let loadingMessage = 'Loading holons...';
    let connectionReady = false;
    let myHolons: MyHolon[] = [];
    let visitedHolons: VisitedHolon[] = [];
    let federatedHolons: FederatedHolon[] = [];
    let showAddDialog = false;
    let showQRScanner = false;
    let showMyQR = false;
    let newHolonId = '';
    let newHolonName = '';
    let error = '';
    let success = '';
    let draggedHolon: MyHolon | null = null;
    let dragOverIndex = -1;
    let searchQuery = '';
    let sortBy: 'name' | 'lastVisited' | 'order' = 'order';
    let sortDirection: 'asc' | 'desc' = 'asc';
    let currentHolonId: string = '';
    let activeTab: 'personal' | 'visited' = 'personal';
    let showHolonIdInfo = false;
    
    // Progress tracking for name fetching
    let nameFetchProgress = {
        total: 0,
        completed: 0,
        current: ''
    };

    // Add a function to refresh visited holon names that can be called externally
    async function refreshVisitedHolonNames() {
        if (!holosphere || !connectionReady) return;
        
        try {
            // Load fresh visited holons from localStorage
            const freshVisitedHolons = loadVisitedHolons($walletAddress);
            visitedHolons = freshVisitedHolons;
            
            // Update the names synchronously - wait for ALL names to be fetched
            await updateVisitedHolonDetails();
            
        } catch (err) {
            console.error('Error refreshing visited holon names:', err);
        }
    }

    // Add a function to refresh personal holon names
    async function refreshPersonalHolonNames() {
        if (!holosphere || !connectionReady) return;
        
        try {
            // Re-fetch names for all personal holons synchronously - wait for ALL names to be fetched
            await updateNamesSync();
        } catch (err) {
            console.error('Error refreshing personal holon names:', err);
        }
    }

    // Add a comprehensive refresh function that updates ALL names before displaying
    async function refreshAllHolonNames() {
        if (!holosphere || !connectionReady) return;
        
        try {
            // Reset progress tracking
            nameFetchProgress = {
                total: 0,
                completed: 0,
                current: ''
            };
            
            // Clear ALL fallback names from cache to force re-fetching
            clearFallbackNames();
            
            // Load fresh data from localStorage
            loadPersonalHolonsFromStorage();
            const freshVisitedHolons = loadVisitedHolons($walletAddress);
            visitedHolons = freshVisitedHolons;
            
            // Update ALL names synchronously using Promise.all to wait for completion
            const updatePromises = [
                updateNamesSync(),
                updateVisitedHolonDetails()
            ];
            
            // Wait for ALL name updates to complete before continuing
            await Promise.all(updatePromises);
            
            // Save the updated data
            savePersonalHolonsToStorage();
            if ($walletAddress) {
                saveVisitedHolons($walletAddress, visitedHolons);
            }
        } catch (err) {
            console.error('Error in comprehensive refresh of holon names:', err);
        }
    }

    // Expose the refresh functions through custom events
    function handleRefreshVisitedRequest() {
        refreshVisitedHolonNames();
    }

    function handleRefreshPersonalRequest() {
        refreshPersonalHolonNames();
    }

    // Add handler for comprehensive refresh
    function handleRefreshAllRequest() {
        refreshAllHolonNames();
    }

    // Handle holon name update event from Settings
    function handleHolonNameUpdated(event: CustomEvent) {
        const { holonId, newName } = event.detail;
        if (holonId && newName) {
            // Update the name in personal holons
            const personalIndex = myHolons.findIndex(h => h.id === holonId);
            if (personalIndex !== -1) {
                myHolons[personalIndex].name = newName;
                myHolons = [...myHolons];
                savePersonalHolonsToStorage();
            }

            // Update the name in visited holons
            const visitedIndex = visitedHolons.findIndex(h => h.id === holonId);
            if (visitedIndex !== -1) {
                visitedHolons[visitedIndex].name = newName;
                visitedHolons = [...visitedHolons];
                if ($walletAddress) {
                    saveVisitedHolons($walletAddress, visitedHolons);
                }
            }

            // Update the name in federated holons
            const federatedIndex = federatedHolons.findIndex(h => h.id === holonId);
            if (federatedIndex !== -1) {
                federatedHolons[federatedIndex].name = newName;
                federatedHolons = [...federatedHolons];
            }
        }
    }

    // Filtered holons - ensure names are properly displayed
    $: filteredHolons = myHolons.filter(holon =>
        holon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        holon.id.toLowerCase().includes(searchQuery.toLowerCase())
    ).sort((a, b) => {
        let aVal: any = a[sortBy];
        let bVal: any = b[sortBy];

        if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }

        const multiplier = sortDirection === 'asc' ? 1 : -1;
        return aVal > bVal ? multiplier : -multiplier;
    });

    // Subscribe to current holon ID
    let idStoreUnsubscribe: (() => void) | undefined;
    let lastProcessedId = '';
    let updateTimeout: NodeJS.Timeout | null = null;

    onMount(async () => {
        try {
            // Check if holosphere is available and wait for it to be ready
            if (holosphere) {
                // Wait a bit for holosphere to initialize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Test the connection by trying to access a simple property
                try {
                    // Try to access a simple property to test connection
                    const testResult = await holosphere.get('test', 'test', 'test').catch(() => null);
                    connectionReady = true;
                } catch (connErr) {
                    connectionReady = true; // Still mark as ready to avoid blocking
                }
            } else {
                throw new Error('Holosphere not available');
            }
        } catch (err) {
            console.error('Failed to establish holosphere connection:', err);
            error = 'Failed to connect to holosphere. Please check your connection and try again.';
            return;
        }
        
        // Subscribe to ID store changes
        idStoreUnsubscribe = ID.subscribe((id) => {
            if (id && id !== 'undefined' && id !== 'null' && id.trim() !== '') {
                currentHolonId = id;
            }
        });
        
        // Load data after connection is ready
        await loadData();
        
        // Add event listeners for refresh requests from TopBar
        if (browser) {
            window.addEventListener('refreshVisitedHolonNames', handleRefreshVisitedRequest);
            window.addEventListener('refreshPersonalHolonNames', handleRefreshPersonalRequest);
            window.addEventListener('refreshAllHolonNames', handleRefreshAllRequest);
            window.addEventListener('holonNameUpdated', handleHolonNameUpdated);
            window.addEventListener('holonCreated', handleHolonCreated);
        }
    });

    // Handle new holon creation - reload data
    function handleHolonCreated() {
        loadData();
    }

    onDestroy(() => {
        if (idStoreUnsubscribe) {
            idStoreUnsubscribe();
        }

        // Remove event listeners
        if (browser) {
            window.removeEventListener('refreshVisitedHolonNames', handleRefreshVisitedRequest);
            window.removeEventListener('refreshPersonalHolonNames', handleRefreshPersonalRequest);
            window.removeEventListener('refreshAllHolonNames', handleRefreshAllRequest);
            window.removeEventListener('holonNameUpdated', handleHolonNameUpdated);
            window.removeEventListener('holonCreated', handleHolonCreated);
        }
    });

    // Helper to validate holon ID
    const isValidHolonId = (id: string | undefined | null): id is string =>
        !!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

    // Reactive block: when page ID changes (different holon), reload federated holons
    $: if ($page.params.id && $page.params.id !== currentHolonId && isValidHolonId($page.params.id) && holosphere && connectionReady) {
        currentHolonId = $page.params.id;
        ID.set(currentHolonId);
        loadFederatedHolons();
    }

    async function loadData() {
        if (!holosphere || !connectionReady) return;
        
        isLoading = true;
        loadingMessage = 'Loading holons...';
        error = '';
        
        // Reset progress tracking
        nameFetchProgress = {
            total: 0,
            completed: 0,
            current: ''
        };
        
        try {
            // Load personal holons from localStorage
            loadingMessage = 'Loading personal holons...';
            loadPersonalHolonsFromStorage();
            
            // Load visited holons from localStorage (with or without wallet)
            loadingMessage = 'Loading visited holons...';
            const visitedHolonsData = loadVisitedHolons($walletAddress);
            visitedHolons = visitedHolonsData;
            
            // Load federated holons with timeout
            loadingMessage = 'Loading federated holons...';
            const federatedPromise = loadFederatedHolons();
            const federatedTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Federated holons timeout')), 5000);
            });
            await Promise.race([federatedPromise, federatedTimeout]);
            
            // Update ALL holon names comprehensively - wait for ALL names to be fetched
            loadingMessage = 'Updating ALL holon names...';
            const updatePromises = [
                updateNamesSync(),
                updateVisitedHolonDetails()
            ];
            
            // Wait for ALL name updates to complete before continuing
            const updateTimeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Update details timeout')), 15000); // Increased timeout
            });
            await Promise.race([Promise.all(updatePromises), updateTimeout]);
            
            // Note: Removed the duplicate call to addVisitedHolonToSeparateList here
            // as it's already handled by TopBar component
            
            // Save once at the end of all loading and updates
            savePersonalHolonsToStorage();
            if ($walletAddress) {
                saveVisitedHolons($walletAddress, visitedHolons);
            }
            
        } catch (err) {
            console.error('Error loading data:', err);
            error = err instanceof Error ? err.message : 'Failed to load data';
        } finally {
            isLoading = false;
        }
    }

    function loadPersonalHolonsFromStorage() {
        try {
            const loadedHolons = loadPersonalHolons();
            myHolons = loadedHolons;
        } catch (err) {
            console.warn('Failed to load personal holons from localStorage:', err);
        }
    }

    async function loadFederatedHolons() {
        // Skip federated holons loading if no current holon ID
        if (!currentHolonId || currentHolonId === '') {
            federatedHolons = [];
            return;
        }
        
        try {
            const federationInfo = await holosphere?.getFederation(currentHolonId);
            federatedHolons = [];
            
            if (federationInfo) {
                // Process inbound list (holons we receive data from)
                for (const holonId of (federationInfo as any).inbound || []) {
                    const lensConfig = (federationInfo as any).lensConfig?.[holonId] || {
                        inbound: [],
                        outbound: []
                    };

                    const holonName = await fetchHolonName(holosphere, holonId);

                    federatedHolons.push({
                        id: holonId,
                        name: holonName,
                        lensConfig
                    });
                }
                
                // Add federated holons to my holons if not already there
                for (const fedHolon of federatedHolons) {
                    if (!myHolons.find(h => h.id === fedHolon.id)) {
                        myHolons.push({
                            id: fedHolon.id,
                            name: fedHolon.name,
                            lastVisited: 0,
                            isPinned: false,
                            isPersonal: false,
                            order: myHolons.length,
                            color: '#4F46E5'
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('Failed to load federated holons:', err);
        }
    }

    async function updateHolonDetails() {
        // First, update names synchronously using the same pattern as stats
        await updateNamesSync();
        
        // Then update stats asynchronously without blocking
        updateStatsAsync();
    }

    async function updateNamesSync() {
        // Update names synchronously in the same pattern as stats
        const totalHolons = myHolons.length;
        nameFetchProgress.total = totalHolons;
        nameFetchProgress.completed = 0;
        nameFetchProgress.current = '';

        const namePromises = myHolons.map(async (holon, index) => {
            try {
                // Update progress
                nameFetchProgress.current = `Fetching name for ${holon.id}...`;

                // Use force refresh to ensure we get fresh data
                const name = await forceRefreshHolonName(holosphere, holon.id);

                // Only update if we got a real name (not a fallback)
                if (name && name.trim() !== '' && name !== `Holon ${holon.id}`) {
                    // Update the specific holon with new name (same pattern as stats)
                    const updatedHolon = { ...holon, name };
                    const holonIndex = myHolons.findIndex(h => h.id === holon.id);
                    if (holonIndex !== -1) {
                        myHolons[holonIndex] = updatedHolon;
                    }

                    // Update progress
                    nameFetchProgress.current = `Updated ${holon.id}: ${name}`;
                } else {
                    // Keep the existing name if we didn't get a better one
                    nameFetchProgress.current = `Keeping existing name for ${holon.id}`;
                }

                nameFetchProgress.completed++;
            } catch (err) {
                console.warn(`Failed to update name for holon ${holon.id}:`, err);
                // Still count as completed even if it failed
                nameFetchProgress.completed++;
            }
        });

        // Await all name updates to complete before continuing
        await Promise.allSettled(namePromises);

        // Reset progress
        nameFetchProgress.current = 'All names updated successfully!';

        // Trigger reactivity
        myHolons = [...myHolons];
    }

    async function updateVisitedHolonDetails() {
        if (!visitedHolons || visitedHolons.length === 0) return;

        // Update visited holon names using the same pattern as personal holons
        const totalVisited = visitedHolons.length;
        nameFetchProgress.total += totalVisited;

        const namePromises = visitedHolons.map(async (holon) => {
            try {
                // Update progress
                nameFetchProgress.current = `Fetching name for visited holon ${holon.id}...`;

                // Use force refresh to ensure we get fresh data
                const name = await forceRefreshHolonName(holosphere, holon.id);

                // Only update if we got a real name (not a fallback)
                if (name && name.trim() !== '' && name !== `Holon ${holon.id}`) {
                    // Update the specific holon with new name (same pattern as stats)
                    const updatedHolon = { ...holon, name };
                    const index = visitedHolons.findIndex(h => h.id === holon.id);
                    if (index !== -1) {
                        visitedHolons[index] = updatedHolon;
                    }

                    // Update progress
                    nameFetchProgress.current = `Updated visited ${holon.id}: ${name}`;
                } else {
                    // Keep the existing name if we didn't get a better one
                    nameFetchProgress.current = `Keeping existing name for visited ${holon.id}`;
                }

                nameFetchProgress.completed++;
            } catch (err) {
                console.warn(`Failed to update name for visited holon ${holon.id}:`, err);
                // Still count as completed even if it failed
                nameFetchProgress.completed++;
            }
        });

        // Await all name updates to complete before continuing
        await Promise.allSettled(namePromises);

        // Trigger reactivity and save
        visitedHolons = [...visitedHolons];
        if ($walletAddress) {
            saveVisitedHolons($walletAddress, visitedHolons);
        }
    }

    async function updateStatsAsync() {
        // Update stats in the background without blocking the UI for personal holons
        const statsPromises = myHolons.map(async (holon) => {
            try {
                const [users, tasks, offers] = await Promise.allSettled([
                    holosphere?.getAll(holon.id, "users").catch(() => ({})),
                    holosphere?.getAll(holon.id, "quests").catch(() => ({})),
                    holosphere?.getAll(holon.id, "offers").catch(() => ({}))
                ]);
                
                const stats = {
                    users: Object.keys(users.status === 'fulfilled' ? users.value : {}).length,
                    tasks: Object.keys(tasks.status === 'fulfilled' ? tasks.value : {}).length,
                    offers: Object.keys(offers.status === 'fulfilled' ? offers.value : {}).length,
                    lastActivity: Date.now()
                };
                
                // Update the specific holon with new stats
                const updatedHolon = { ...holon, stats };
                const index = myHolons.findIndex(h => h.id === holon.id);
                if (index !== -1) {
                    myHolons[index] = updatedHolon as MyHolon;
                }
            } catch (err) {
                console.warn(`Failed to update stats for holon ${holon.id}:`, err);
            }
        });
        
        // Don't await this - let it run in the background
        Promise.allSettled(statsPromises).then(() => {
            // Save after stats are updated
            savePersonalHolonsToStorage();
        }).catch(err => {
            console.error(`Some stats updates failed:`, err);
            // Save even if some stats failed
            savePersonalHolonsToStorage();
        });
    }

    async function addVisitedHolonToPersonalList(holonId: string) {
        if (!holonId) return;
        
        const existingIndex = myHolons.findIndex(h => h.id === holonId);
        
        if (existingIndex >= 0) {
            // Update last visited
            myHolons[existingIndex].lastVisited = Date.now();
        } else {
            // Add new holon
            const name = await fetchHolonName(holosphere, holonId);
            myHolons.push({
                id: holonId,
                name,
                lastVisited: Date.now(),
                isPinned: false,
                isPersonal: true,
                order: myHolons.length,
                color: '#10B981'
            });
        }
        
        savePersonalHolonsToStorage();
    }

    function savePersonalHolonsToStorage() {
        try {
            const personalHolons = myHolons.filter(h => h.isPersonal);
            savePersonalHolons(personalHolons);
        } catch (err) {
            console.warn('Failed to save personal holons:', err);
        }
    }

    function restoreFromBackup() {
        try {
            const backupData = localStorage.getItem('myHolons_backup');
            if (backupData) {
                const backup = JSON.parse(backupData);
                if (backup.data && Array.isArray(backup.data)) {
                    myHolons = backup.data.map((holon: any, index: number) => ({
                        ...holon,
                        order: holon.order ?? index,
                        isPersonal: true
                    }));
                    savePersonalHolonsToStorage();
                    success = 'Holograms restored from backup successfully';
                    setTimeout(() => success = '', 5000);
                    return true;
                }
            }
        } catch (err) {
            console.error('Failed to restore from backup:', err);
        }
        return false;
    }

    async function addVisitedHolonToSeparateList(holonId: string) {
        if (!$walletAddress) return;
        
        try {
            const holonName = await fetchHolonName(holosphere, holonId);
            
            // Use the centralized function to add visited holon
            addVisitedHolon($walletAddress, holonId, holonName, 'personal');
            
        } catch (err) {
            console.warn('Failed to add visited holon:', err);
        }
    }

    async function addNewHolon() {
        if (!newHolonId.trim()) {
            error = 'Please enter a holon ID';
            return;
        }
        
        if (myHolons.find(h => h.id === newHolonId)) {
            error = 'Holon already exists in your list';
            return;
        }
        
        try {
            const name = newHolonName.trim() || await fetchHolonName(holosphere, newHolonId);
            
            const newHolon = {
                id: newHolonId,
                name,
                lastVisited: Date.now(),
                isPinned: false,
                isPersonal: true,
                order: myHolons.length,
                color: '#3B82F6'
            };
            
            myHolons = [...myHolons, newHolon];
            
            savePersonalHolonsToStorage();
            showAddDialog = false;
            newHolonId = '';
            newHolonName = '';
            error = '';
            success = 'Holon added successfully';
            showHolonIdInfo = false;
            setTimeout(() => success = '', 3000);
        } catch (err) {
            console.error('Error adding holon:', err);
            error = err instanceof Error ? err.message : 'Failed to add holon';
        }
    }

    function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
        const { decodedText } = event.detail;
        
        // Extract holon ID from the scanned text
        let holonId = decodedText;
        
        try {
            // If it's a URL, try to extract the holon ID from it
            if (decodedText.includes('://') || decodedText.startsWith('http')) {
                // It's a full URL, try to parse it
                const url = new URL(decodedText);
                const pathParts = url.pathname.split('/').filter(part => part.trim() !== '');

                // Common path endings that are not holon IDs
                const excludedPaths = ['dashboard', 'qr', 'settings', 'admin', 'holons', 'tasks', 'offers', 'map', 'council', 'proposals'];

                // Look for holon ID in the path - find the first numeric or alphanumeric ID
                for (const part of pathParts) {
                    // Skip common path endings
                    if (excludedPaths.includes(part.toLowerCase())) {
                        continue;
                    }

                    // If it's all numeric or looks like a holon ID, use it
                    if (/^[a-zA-Z0-9\-_]+$/.test(part) && part.length > 3) {
                        holonId = part;
                        break;
                    }
                }

                // If no suitable holon ID found, fall back to first path part
                if (holonId === decodedText && pathParts.length > 0) {
                    holonId = pathParts[0];
                }
            } else if (decodedText.includes('/')) {
                // It's a relative path, split by '/' and use smarter logic
                const pathParts = decodedText.split('/').filter(part => part.trim() !== '');
                const excludedPaths = ['dashboard', 'qr', 'settings', 'admin', 'holons', 'tasks', 'offers', 'map', 'council', 'proposals'];

                // Find the first part that looks like a holon ID
                for (const part of pathParts) {
                    if (excludedPaths.includes(part.toLowerCase())) {
                        continue;
                    }

                    if (/^[a-zA-Z0-9\-_]+$/.test(part) && part.length > 3) {
                        holonId = part;
                        break;
                    }
                }

                // Fall back to first part if nothing found
                if (holonId === decodedText && pathParts.length > 0) {
                    holonId = pathParts[0];
                }
            }
            
            // Clean up the holon ID
            holonId = holonId.split('?')[0]; // Remove query parameters
            holonId = holonId.split('#')[0]; // Remove hash fragments
            holonId = holonId.replace(/\.(html|htm|php|asp|aspx|jsp|jspx)$/i, ''); // Remove file extensions
            
            // Validate that it looks like a holon ID (alphanumeric and some special chars)
            const holonIdPattern = /^[a-zA-Z0-9\-_]+$/;
            
            if (holonId && holonId.trim() && holonIdPattern.test(holonId.trim())) {
                newHolonId = holonId.trim();
                success = `QR code scanned successfully! Extracted holon ID: ${holonId.trim()}`;
                setTimeout(() => success = '', 3000);
            } else {
                error = `Invalid holon ID format: "${holonId}". Please scan a valid holon QR code.`;
                setTimeout(() => error = '', 5000);
            }
        } catch (err) {
            console.error('Error parsing QR code:', err);
            error = 'Error parsing QR code. Please try again.';
            setTimeout(() => error = '', 5000);
        }
        
        showQRScanner = false;
    }

    function handleQRScanError(event: CustomEvent<{ message: string }>) {
        const { message } = event.detail;
        error = `QR scan error: ${message}`;
        setTimeout(() => error = '', 5000);
        showQRScanner = false;
    }

    function removeHolon(holonId: string, isVisited = false) {
        if (isVisited) {
            visitedHolons = visitedHolons.filter(h => h.id !== holonId);
            // Save the updated visited holons list
            const walletAddr = $walletAddress;
            saveVisitedHolons(walletAddr, visitedHolons);
        } else {
            if (confirm('Are you sure you want to remove this holon from your list?')) {
                myHolons = myHolons.filter(h => h.id !== holonId);
                savePersonalHolonsToStorage();
            } else {
                return; // Don't proceed if cancelled
            }
        }
    }

    function addToPersonalHolons(visitedHolon: VisitedHolon) {
        // Check if already in personal holons
        const existingHolon = myHolons.find(h => h.id === visitedHolon.id);
        if (existingHolon) {
            success = 'Holon is already in your personal list';
            setTimeout(() => success = '', 3000);
            return;
        }

        // Add to personal holons with stats preserved
        const newPersonalHolon: MyHolon = {
            id: visitedHolon.id,
            name: visitedHolon.name,
            lastVisited: visitedHolon.lastVisited,
            isPinned: false,
            isPersonal: true,
            order: myHolons.length,
            color: undefined,
            description: undefined,
            stats: visitedHolon.stats // Preserve stats from visited holon
        };

        myHolons = [...myHolons, newPersonalHolon];
        savePersonalHolonsToStorage();
        
        success = 'Holon added to personal list successfully';
        setTimeout(() => success = '', 3000);
    }

    function togglePin(holonId: string) {
        const holon = myHolons.find(h => h.id === holonId);
        if (holon) {
            holon.isPinned = !holon.isPinned;
            savePersonalHolonsToStorage();
        }
    }

    function navigateToHolon(holonId: string) {
        console.log('[MyHolons] navigateToHolon called with:', holonId);

        if (!holonId || holonId === 'undefined' || holonId === 'null') {
            console.error('[MyHolons] Invalid holon ID:', holonId);
            return;
        }

        ID.set(holonId);

        // Find the holon name from our loaded holons
        let holonName: string | undefined;
        const foundHolon = [...myHolons, ...visitedHolons, ...federatedHolons].find(h => h.id === holonId);
        if (foundHolon) {
            holonName = foundHolon.name;
            console.log('[MyHolons] Found holon name:', holonName);
        } else {
            console.warn('[MyHolons] Could not find holon in loaded lists');
        }

        // Dispatch event with the holon name so TopBar can use it immediately
        if (browser && holonName) {
            window.dispatchEvent(new CustomEvent('holonNavigated', {
                detail: { holonId, holonName }
            }));
        }

        // Track this visit if wallet is connected
        if ($walletAddress) {
            addVisitedHolonToSeparateList(holonId);
        }

        console.log('[MyHolons] Navigating to:', `/${holonId}/dashboard`);
        goto(`/${holonId}/dashboard`);
    }

    // Drag and drop functionality
    let isDragging = false;
    let dragStartTime = 0;

    function handleDragStart(event: DragEvent, holon: MyHolon) {
        if (!event.dataTransfer) return;

        dragStartTime = Date.now();
        isDragging = true;

        draggedHolon = holon;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', holon.id);
    }

    function handleDragOver(event: DragEvent, index: number) {
        event.preventDefault();
        dragOverIndex = index;
    }

    function handleDragLeave() {
        dragOverIndex = -1;
    }

    function handleDrop(event: DragEvent, targetIndex: number) {
        event.preventDefault();
        
        if (!draggedHolon) return;
        
        const draggedIndex = myHolons.findIndex(h => h.id === draggedHolon!.id);
        if (draggedIndex === targetIndex) return;
        
        // Reorder holons
        const newHolons = [...myHolons];
        const [draggedItem] = newHolons.splice(draggedIndex, 1);
        newHolons.splice(targetIndex, 0, draggedItem);
        
        // Update order values
        newHolons.forEach((holon, index) => {
            holon.order = index;
        });
        
        myHolons = newHolons;
        savePersonalHolonsToStorage();
        
        // Reset drag state
        draggedHolon = null;
        dragOverIndex = -1;
    }

    function handleDragEnd() {
        // Reset drag state after a small delay to prevent click interference
        setTimeout(() => {
            isDragging = false;
            draggedHolon = null;
            dragOverIndex = -1;
        }, 100);
    }

    function handleHolonClick(event: MouseEvent, holonId: string) {
        // Only navigate if this was a simple click (not part of a drag)
        // Check if the mouse moved significantly during the click
        const timeSinceDragStart = Date.now() - dragStartTime;

        console.log('[MyHolons] handleHolonClick called', {
            holonId,
            isDragging,
            timeSinceDragStart,
            draggedHolon: draggedHolon?.id
        });

        // Allow navigation if:
        // 1. Not currently dragging, OR
        // 2. Drag just started (< 300ms), OR
        // 3. No draggedHolon is set
        if (!isDragging || timeSinceDragStart < 300 || !draggedHolon) {
            console.log('[MyHolons] Proceeding with navigation');
            navigateToHolon(holonId);
        } else {
            console.log('[MyHolons] Click ignored - dragging in progress');
        }
    }

    function formatLastVisited(timestamp: number) {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        return date.toLocaleDateString();
    }

    function getHolonTypeIcon(holon: MyHolon) {
        if (holon.isPinned) return 'pinned';
        if (!holon.isPersonal) return 'federated';
        return 'personal';
    }

    function getHolonTypeLabel(holon: MyHolon) {
        if (holon.isPinned) return 'Pinned';
        if (!holon.isPersonal) return 'Federated';
        return 'Personal';
    }
</script>

<!-- Main MyHolons Interface -->
<div class="p-6">
        <!-- Header -->
        <div class="flex justify-end items-center mb-6 gap-2">
            <button
                on:click={() => showMyQR = true}
                class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                My QR
            </button>
            <button
                on:click={() => showAddDialog = true}
                class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
                Add Holon
            </button>
        </div>

        <!-- Tab Navigation -->
        <div class="flex space-x-1 mb-6">
            <button
                on:click={() => activeTab = 'personal'}
                class="px-4 py-2 rounded-lg transition-colors {activeTab === 'personal' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}"
            >
                Personal Holons
            </button>
            <button
                on:click={() => activeTab = 'visited'}
                class="px-4 py-2 rounded-lg transition-colors {activeTab === 'visited' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}"
            >
                Visited Holons
            </button>
        </div>

        <!-- Search and Sort Controls -->
        <div class="flex flex-col md:flex-row gap-4 mb-6">
            <div class="flex-1">
                <input
                    type="text"
                    placeholder="Search holons..."
                    bind:value={searchQuery}
                    class="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>
            <div class="flex gap-2">
                <select
                    bind:value={sortBy}
                    class="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-indigo-500"
                >
                    <option value="order">Order</option>
                    <option value="name">Name</option>
                    <option value="lastVisited">Last Visited</option>
                </select>
                <button
                    on:click={() => sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'}
                    class="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white hover:bg-gray-700 transition-colors"
                >
                    {sortDirection === 'asc' ? '↑' : '↓'}
                </button>
            </div>
        </div>

        <!-- Status Messages -->
        {#if error}
            <div class="mb-4 p-4 bg-red-900/20 border border-red-700 rounded-lg text-red-400" transition:slide>
                {error}
            </div>
        {/if}

        {#if success}
            <div class="mb-4 p-4 bg-green-900/20 border border-green-700 rounded-lg text-green-400" transition:slide>
                {success}
            </div>
        {/if}

        <!-- Loading State -->
        {#if isLoading}
            <div class="flex flex-col items-center justify-center py-12">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-4"></div>
                <p class="text-gray-400 text-center mb-2">{loadingMessage}</p>
                
                <!-- Show additional progress info when updating names -->
                {#if loadingMessage.includes('Updating')}
                    <div class="text-center text-sm text-gray-500 mb-4">
                        <p>Fetching holon names from the network...</p>
                        <p class="mt-1">This ensures all holons display with proper names instead of IDs</p>
                        
                        <!-- Progress bar for name fetching -->
                        {#if nameFetchProgress.total > 0}
                            <div class="mt-4 w-64">
                                <div class="flex justify-between text-xs text-gray-400 mb-1">
                                    <span>Progress: {nameFetchProgress.completed}/{nameFetchProgress.total}</span>
                                    <span>{Math.round((nameFetchProgress.completed / nameFetchProgress.total) * 100)}%</span>
                                </div>
                                <div class="w-full bg-gray-700 rounded-full h-2">
                                    <div 
                                        class="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                                        style="width: {(nameFetchProgress.completed / nameFetchProgress.total) * 100}%"
                                    ></div>
                                </div>
                                <p class="text-xs text-gray-500 mt-2 text-center">{nameFetchProgress.current}</p>
                            </div>
                        {/if}
                    </div>
                {/if}
                
                <button 
                    on:click={loadData}
                    class="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                >
                    Retry Loading
                </button>
            </div>
        {:else}
            {#if activeTab === 'personal'}
                <!-- Personal Holons Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {#each filteredHolons.filter(h => h.isPersonal) as holon, index (holon.id)}
                    <div
                        class="h-full"
                        draggable="true"
                        on:dragstart={(e) => handleDragStart(e, holon)}
                        on:dragover={(e) => handleDragOver(e, index)}
                        on:dragleave={handleDragLeave}
                        on:drop={(e) => handleDrop(e, index)}
                        on:dragend={handleDragEnd}
                        on:click={(e) => handleHolonClick(e, holon.id)}
                        on:keydown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                navigateToHolon(holon.id);
                            }
                        }}
                        role="button"
                        tabindex="0"
                        aria-label="Navigate to {holon.name} holon"
                        animate:flip={{ duration: 200 }}
                        in:scale={{ duration: 200 }}
                    >
                        <div
                            class="bg-gray-800 hover:bg-gray-750 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 cursor-pointer relative group flex flex-col items-center justify-center text-center h-full"
                            class:ring-2={dragOverIndex === index}
                            class:ring-indigo-500={dragOverIndex === index}
                            class:opacity-50={draggedHolon?.id === holon.id}
                        >
                            <div class="flex-grow flex flex-col items-center justify-center">
                                <div class="w-12 h-12 mx-auto mb-4">
                                    <MyHolonsIcon />
                                </div>
                                <div class="max-w-full">
                                    <h3 class="font-semibold text-white text-lg text-center whitespace-normal break-words leading-tight">{holon.name}</h3>
                                    <p class="text-sm text-gray-400 truncate">{holon.id}</p>
                                </div>
                            </div>

                            <div class="mt-4 text-center w-full">
                                {#if holon.stats}
                                    <div class="flex justify-center gap-3 text-sm text-gray-400">
                                        <span><i class="fas fa-users"></i> {holon.stats.users}</span>
                                        <span><i class="fas fa-tasks"></i> {holon.stats.tasks}</span>
                                        <span><i class="fas fa-gift"></i> {holon.stats.offers}</span>
                                    </div>
                                {/if}
                                <div class="mt-3">
                                    <span class="inline-block text-xs px-2 py-1 bg-gray-700 rounded-full text-gray-300">
                                        {getHolonTypeLabel(holon)}
                                    </span>
                                </div>
                                <div class="text-xs text-gray-500 mt-2">
                                    {formatLastVisited(holon.lastVisited)}
                                </div>
                            </div>

                            <!-- Action Buttons -->
                            <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    on:click|stopPropagation={() => togglePin(holon.id)}
                                    class="p-1 hover:bg-gray-700 rounded transition-colors"
                                    class:text-yellow-400={holon.isPinned}
                                    class:text-gray-400={!holon.isPinned}
                                    title={holon.isPinned ? 'Unpin' : 'Pin'}
                                    aria-label={holon.isPinned ? 'Unpin holon' : 'Pin holon'}
                                >
                                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M3 3v14l3-3h11V3H3z" />
                                    </svg>
                                </button>
                                {#if holon.isPersonal}
                                    <button
                                        on:click|stopPropagation={() => removeHolon(holon.id)}
                                        class="p-1 hover:bg-red-700 rounded transition-colors text-red-400"
                                        title="Remove"
                                        aria-label="Remove holon"
                                    >
                                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                                        </svg>
                                    </button>
                                {/if}
                            </div>
                        </div>
                    </div>
                    {/each}
                </div>
    
                <!-- Empty State for Personal Holons -->
                {#if filteredHolons.filter(h => h.isPersonal).length === 0}
                    <div class="text-center py-12">
                        <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <h3 class="text-xl font-semibold text-gray-400 mb-2">No personal holons found</h3>
                        <p class="text-gray-500 mb-4">Add your first holon to get started</p>
                        
                        <!-- Restore from backup button -->
                        <button
                            on:click={restoreFromBackup}
                            class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 mx-auto"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Restore from Backup
                        </button>
                    </div>
                {/if}
            {:else if activeTab === 'visited'}
                <!-- Visited Holons Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    {#each visitedHolons.filter(h =>
                        h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        h.id.toLowerCase().includes(searchQuery.toLowerCase())
                    ).map(holon => {
                        // Ensure fallback names are not displayed for visited holons too
                        const displayName = holon.name && holon.name.trim() !== '' && holon.name !== `Holon ${holon.id}`
                            ? holon.name
                            : holon.id;
                        return { ...holon, name: displayName };
                    }).sort((a, b) => {
                        let aVal: any = a[sortBy === 'lastVisited' ? 'lastVisited' : 'name'];
                        let bVal: any = b[sortBy === 'lastVisited' ? 'lastVisited' : 'name'];

                        if (typeof aVal === 'string') {
                            aVal = aVal.toLowerCase();
                            bVal = bVal.toLowerCase();
                        }

                        const multiplier = sortDirection === 'asc' ? 1 : -1;
                        return aVal > bVal ? multiplier : -multiplier;
                    }) as holon, index (holon.id)}
                        <div
                            class="h-full"
                            on:click={(e) => handleHolonClick(e, holon.id)}
                            on:keydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    navigateToHolon(holon.id);
                                }
                            }}
                            role="button"
                            tabindex="0"
                            aria-label="Navigate to {holon.name} holon"
                            animate:flip={{ duration: 200 }}
                            in:scale={{ duration: 200 }}
                        >
                            <div class="bg-gray-800 hover:bg-gray-750 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 transition-all duration-300 cursor-pointer relative group flex flex-col items-center justify-center text-center h-full">
                                <!-- Top part -->
                                <div class="flex-grow flex flex-col items-center justify-center">
                                    <div class="w-12 h-12 mx-auto mb-4">
                                        <MyHolonsIcon />
                                    </div>
                                    <div class="max-w-full">
                                        <h3 class="font-semibold text-white text-lg text-center whitespace-normal break-words leading-tight">{holon.name}</h3>
                                        <p class="text-sm text-gray-400 truncate">{holon.id}</p>
                                    </div>
                                </div>
                                <!-- Bottom part -->
                                <div class="mt-4 text-center w-full">
                                    {#if holon.stats}
                                        <div class="flex justify-center gap-3 text-sm text-gray-400 mb-3">
                                            <span><i class="fas fa-users"></i> {holon.stats.users}</span>
                                            <span><i class="fas fa-tasks"></i> {holon.stats.tasks}</span>
                                            <span><i class="fas fa-gift"></i> {holon.stats.offers}</span>
                                        </div>
                                    {/if}
                                    <div class="mt-3">
                                        <span class="inline-block text-xs px-2 py-1 bg-indigo-600 rounded-full text-white">
                                            {holon.visitCount} visits
                                        </span>
                                    </div>
                                    <div class="text-xs text-gray-500 mt-2">
                                        {formatLastVisited(holon.lastVisited)}
                                    </div>
                                </div>
                                <!-- Action Buttons -->
                                <div class="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        on:click|stopPropagation={() => addToPersonalHolons(holon)}
                                        class="p-1 hover:bg-green-700 rounded transition-colors text-green-400"
                                        title="Add to personal holons"
                                        aria-label="Add {holon.name} to personal holons"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                                        </svg>
                                    </button>
                                    <button
                                        on:click|stopPropagation={() => removeHolon(holon.id, true)}
                                        class="p-1 hover:bg-red-700 rounded transition-colors text-red-400"
                                        title="Remove from visited list"
                                        aria-label="Remove {holon.name} from visited list"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>

                <!-- Empty State for Visited Holons -->
                {#if visitedHolons.length === 0}
                    <div class="text-center py-12">
                        <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 class="text-xl font-semibold text-gray-400 mb-2">No visited holons</h3>
                        <p class="text-gray-500">Holons you visit will appear here</p>
                        {#if !$walletAddress}
                            <p class="text-sm text-gray-600 mt-2">Connect your wallet to track visited holons</p>
                        {/if}
                    </div>
                {/if}
            {/if}
        {/if}
    </div>

<!-- QR Scanner Component -->
<QRScanner 
    showScanner={showQRScanner}
    on:scan={handleQRScan}
    on:error={handleQRScanError}
    on:close={() => showQRScanner = false}
/>

<!-- Add Holon Dialog -->
{#if showAddDialog}
    <div 
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" 
        transition:fade
        on:click|self={() => { 
            showAddDialog = false; 
            newHolonId = ''; 
            newHolonName = ''; 
            error = ''; 
            success = '';
            showHolonIdInfo = false;
        }}
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                showAddDialog = false; 
                newHolonId = ''; 
                newHolonName = ''; 
                error = ''; 
                success = '';
                showHolonIdInfo = false;
            }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabindex="-1"
    >
        <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4" transition:scale>
            <h3 id="dialog-title" class="text-xl font-bold text-white mb-4">Add New Holon</h3>
            
            <!-- Error/Success Messages -->
            {#if error}
                <div class="mb-4 p-3 bg-red-900/20 border border-red-700 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
            {/if}
            
            {#if success}
                <div class="mb-4 p-3 bg-green-900/20 border border-green-700 rounded-lg text-green-400 text-sm">
                    {success}
                </div>
            {/if}
            
            <div class="space-y-4">
                <div>
                    <div class="flex items-center gap-2 mb-2">
                        <label for="holon-id-input" class="block text-sm font-medium text-gray-300">Holon ID *</label>
                        <button
                            type="button"
                            class="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700"
                            title="How to get your Holon ID"
                            aria-label="Show help for getting Holon ID"
                            on:click={() => showHolonIdInfo = !showHolonIdInfo}
                        >
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </button>
                    </div>
                    
                    {#if showHolonIdInfo}
                        <div class="mb-3 p-3 bg-indigo-900/20 border border-indigo-700/50 rounded-lg text-sm">
                            <div class="text-indigo-300 font-medium mb-2">How to get your Holon ID:</div>
                            <div class="text-gray-300 space-y-1">
                                <div>1. Open Telegram and find @HolonsBot</div>
                                <div>2. Send one of these commands:</div>
                                <div class="ml-4 space-y-1">
                                    <div>• <code class="bg-gray-700 px-2 py-1 rounded text-indigo-300">/id</code> - Get your holon ID</div>
                                    <div>• <code class="bg-gray-700 px-2 py-1 rounded text-indigo-300">/dashboard</code> - Get a direct link</div>
                                </div>
                                <div>3. Copy the holon ID and paste it here</div>
                            </div>
                        </div>
                    {/if}
                    
                    <div class="flex gap-2">
                        <input
                            id="holon-id-input"
                            type="text"
                            bind:value={newHolonId}
                            placeholder="Enter holon ID"
                            on:keydown={(e) => {
                                if (e.key === 'Enter') {
                                    addNewHolon();
                                }
                            }}
                            class="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                        <button
                            type="button"
                            on:click={() => {
                                // Check if we're on desktop (no camera available)
                                const isDesktop = !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia;
                                if (isDesktop) {
                                    error = 'QR scanning is best used on mobile devices with cameras. Please manually enter the holon ID or use a mobile device.';
                                    setTimeout(() => error = '', 5000);
                                    return;
                                }
                                showQRScanner = true;
                            }}
                            class="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
                            title="Scan QR Code (Best on mobile devices)"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h6v6H3V3zm12 0h6v6h-6V3zM3 15h6v6H3v-6zm12 0h6v6h-6v-6zM9 3v6m0 6v6" />
                            </svg>
                            <span class="hidden sm:inline">Scan</span>
                        </button>
                    </div>
                </div>
                
                <div>
                    <label for="holon-name-input" class="block text-sm font-medium text-gray-300 mb-2">Display Name (optional)</label>
                    <input
                        id="holon-name-input"
                        type="text"
                        bind:value={newHolonName}
                        placeholder="Custom name for display"
                        on:keydown={(e) => {
                            if (e.key === 'Enter') {
                                addNewHolon();
                            }
                        }}
                        class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
            </div>
            
            <div class="flex gap-3 mt-6">
                <button
                    on:click={addNewHolon}
                    class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg transition-colors"
                >
                    Add Holon
                </button>
                <button
                    on:click={() => { 
                        showAddDialog = false; 
                        newHolonId = ''; 
                        newHolonName = ''; 
                        error = ''; 
                        success = '';
                        showHolonIdInfo = false;
                    }}
                    class="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- My QR Code Modal -->
{#if showMyQR}
    <div
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
        on:click={() => showMyQR = false}
        on:keydown={(e) => e.key === 'Escape' && (showMyQR = false)}
        role="dialog"
        tabindex="-1"
        transition:fade={{ duration: 150 }}
    >
        <div
            class="bg-gray-800 rounded-xl max-w-sm w-full p-6 shadow-2xl border border-gray-700"
            on:click|stopPropagation
            on:keydown|stopPropagation
            transition:scale={{ duration: 200, start: 0.95 }}
        >
            <!-- Header -->
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-xl font-bold text-white">My Holon QR Code</h3>
                <button
                    on:click={() => showMyQR = false}
                    class="text-gray-400 hover:text-white transition-colors"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- QR Code -->
            <div class="bg-white rounded-lg p-4 mb-4">
                <img
                    src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&format=svg&data={encodeURIComponent($nostrPublicKey || '')}&margin=10"
                    alt="QR Code for {$nostrPublicKey}"
                    class="w-full h-auto"
                />
            </div>

            <!-- Public Key Display -->
            <div class="mb-4">
                <p class="block text-sm text-gray-400 mb-1">Public Key / Holon ID</p>
                <div class="bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-300 break-all select-all">
                    {$nostrPublicKey || 'Not available'}
                </div>
            </div>

            <!-- Actions -->
            <div class="flex gap-2">
                <button
                    on:click={() => {
                        if ($nostrPublicKey) {
                            navigator.clipboard.writeText($nostrPublicKey);
                        }
                    }}
                    class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy ID
                </button>
                <a
                    href="https://api.qrserver.com/v1/create-qr-code/?size=500x500&format=png&data={encodeURIComponent($nostrPublicKey || '')}&margin=20"
                    download="holon-qr.png"
                    class="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download
                </a>
            </div>

            <p class="text-xs text-gray-500 text-center mt-4">
                Share this QR code to let others add your holon to their federation
            </p>
        </div>
    </div>
{/if}