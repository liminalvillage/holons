<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import type { HoloSphere } from "holosphere";

	let store: Record<string, any> = {};
	let selectedTable = "quests";
	let customTableName = "";
	let useCustomTable = false;
	let showDropdown = false;
	let tables = [
		{ value: "quests", label: "Tasks" },
		{ value: "needs", label: "Local Needs" },
		{ value: "offers", label: "Offers" },
		{ value: "communities", label: "Communities" },
		{ value: "organizations", label: "Organizations" },
		{ value: "events", label: "Events" },
		{ value: "users", label: "People" },
		{ value: "settings", label: "Settings" },
		{ value: "expenses", label: "Expenses" },
		{ value: "profile", label: "Profile" }
	];
	let expandedFields = new Set();
	let editingField: string | null = null;
	let editValue = "";
	let newFieldName = "";
	let addingFieldTo: string | null = null;
	let isArrayEditing = false;
	let arrayEditIndex: number | null = null;
	let isAddingNewEntry = false;
	let newEntryJson = "{\n  \n}";
	let newEntryKey = "";
	let showTableInfo = false;
	
	// Navigation state
	let navigationPath: string[] = [];
	let isRootMode = false;
	let rootData: Record<string, any> = {};
	let showNavigationMode = false;
	
	// Gun address pattern detection
	const GUN_ADDRESS_PATTERN = /^[a-zA-Z0-9_-]{20,}$/; // Gun UUIDs are typically long alphanumeric strings

	$: holonID = $ID;
	$: entries = Object.entries(isRootMode ? rootData : store);

	let holosphere = getContext("holosphere") as HoloSphere;
	let gun: any = null;

	onMount(() => {
		// Initialize Gun instance
		if (holosphere && holosphere.gun) {
			gun = holosphere.gun;
			console.log("Gun instance initialized:", gun);
		} else {
			console.error("Failed to access Gun instance from HoloSphere");
		}

		ID.subscribe((value) => {
			holonID = value;
			subscribeToTable(getCurrentTableName());
		});

		// Close dropdown when clicking outside
		function handleClickOutside(event: MouseEvent) {
			const target = event.target as HTMLElement;
			if (!target.closest('.lens-control')) {
				showDropdown = false;
			}
		}

		document.addEventListener('click', handleClickOutside);

		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});

	function getCurrentTableName(): string {
		return useCustomTable ? customTableName : selectedTable || "quests";
	}

	async function subscribeToTable(tableName: string) {
		store = {};
		const safeHolonID = holonID || "";
		console.log(`[Gun.svelte] Subscribing to table: ${tableName} for holon: ${safeHolonID}`);

		// Skip subscription if holon ID is empty
		if (!safeHolonID || !safeHolonID.trim()) {
			console.log(`[Gun.svelte] Skipping subscription - no holon ID provided`);
			return;
		}

		if (holosphere && tableName.trim()) {
			holosphere.subscribe(safeHolonID, tableName, (newData: any, key?: string) => {
				console.log(`[Gun.svelte] ${tableName} subscription update:`, { key, newData, type: typeof newData });
				if (typeof key !== 'string') {
					console.log(`[Gun.svelte] Skipping update - key is not string:`, key);
					return;
				}
				if (newData) {
					store[key] = newData;
					console.log(`[Gun.svelte] Added ${tableName} entry. Total entries: ${Object.keys(store).length}`);
				} else {
					delete store[key];
					store = store;
					console.log(`[Gun.svelte] Deleted ${tableName} entry. Total entries: ${Object.keys(store).length}`);
				}
			});
		} else {
			console.log(`[Gun.svelte] Cannot subscribe - holosphere: ${!!holosphere}, tableName: "${tableName}"`);
		}
	}

	function handleTableChange(table: string) {
		selectedTable = table;
		useCustomTable = false;
		showDropdown = false;
		subscribeToTable(table);
		expandedFields.clear();
	}

	function handleCustomTableChange() {
		if (customTableName.trim()) {
			useCustomTable = true;
			subscribeToTable(customTableName.trim());
			expandedFields.clear();
		}
	}

	function toggleDropdown() {
		showDropdown = !showDropdown;
	}

	function selectTable(table: string) {
		selectedTable = table;
		useCustomTable = false;
		showDropdown = false;
		subscribeToTable(table);
		expandedFields.clear();
	}

	let inputValue = selectedTable;

	function handleInputChange() {
		if (inputValue.trim() && !tables.some(t => t.value === inputValue)) {
			// If input doesn't match any predefined table, treat as custom
			useCustomTable = true;
			customTableName = inputValue;
			handleCustomTableChange();
		} else if (inputValue.trim()) {
			// If input matches a predefined table, use that
			useCustomTable = false;
			selectedTable = inputValue;
			handleTableChange(inputValue);
		}
	}

	$: inputValue = useCustomTable ? customTableName : selectedTable;

	function toggleField(fieldPath: string) {
		if (expandedFields.has(fieldPath)) {
			expandedFields.delete(fieldPath);
		} else {
			expandedFields.add(fieldPath);
		}
		expandedFields = expandedFields; // Trigger reactivity
	}

	async function deleteEntry(key: string) {
		if (!key) {
			console.error("Cannot delete: missing key");
			return;
		}

		if (confirm("Are you sure you want to delete this entry?")) {
			try {
				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], null);
					delete rootData[key];
					rootData = { ...rootData };
				} else {
					const currentTable = getCurrentTableName();
					const safeHolonID = holonID || "";
					
					if (!safeHolonID || !currentTable) {
						console.error("Cannot delete: missing parameters", {
							key,
							holonID: safeHolonID,
							currentTable,
						});
						return;
					}
					
					await holosphere.delete(safeHolonID, currentTable, key);
					delete store[key];
					store = { ...store };
				}
			} catch (error) {
				console.error("Error deleting entry:", error);
			}
		}
	}

	async function startEditing(key: string, field: string, value: any, index?: number) {
		editingField = `${key}.${field}`;
		isArrayEditing = Array.isArray(value);
		arrayEditIndex = typeof index === 'number' ? index : null;
		
		if (isArrayEditing && typeof index === 'number') {
			editValue = typeof value[index] === 'object' 
				? JSON.stringify(value[index], null, 2) 
				: String(value[index]);
		} else {
			editValue = typeof value === "object" 
				? JSON.stringify(value, null, 2) 
				: String(value);
		}
	}

	function inferType(value: string): any {
		// If it's empty, return empty string
		if (value.trim() === "") return "";

		// Try parsing as number first
		const num = Number(value);
		if (!isNaN(num) && value.trim() !== "") return num;

		// Check for boolean
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;

		// Try parsing as JSON
		try {
			if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
				return JSON.parse(value);
			}
		} catch (e) {
			// If parsing fails, fall through to string
		}

		// Default to string
		return value;
	}

	async function saveEdit(key: string, field: string) {
		try {
			const dataSource = isRootMode ? rootData : store;
			const entry = dataSource[key];
			let parsedValue: any;

			if (isArrayEditing && arrayEditIndex !== null) {
				// Handle array element editing
				const currentArray = [...entry[field]];
				parsedValue = inferType(editValue);
				currentArray[arrayEditIndex] = parsedValue;
				const updatedEntry = { ...entry, [field]: currentArray };
				
				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					const currentTable = getCurrentTableName();
					const safeHolonID = holonID || "";
					await holosphere.put(safeHolonID, currentTable, updatedEntry);
				}
			} else {
				// Handle regular field editing
				parsedValue = inferType(editValue);
				const updatedEntry = { ...entry, [field]: parsedValue };
				
				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					const currentTable = getCurrentTableName();
					const safeHolonID = holonID || "";
					await holosphere.put(safeHolonID, currentTable, updatedEntry);
				}
			}

			editingField = null;
			isArrayEditing = false;
			arrayEditIndex = null;
		} catch (error) {
			console.error("Error saving edit:", error);
		}
	}

	function cancelEdit() {
		editingField = null;
		editValue = "";
		addingFieldTo = null;
		newFieldName = "";
	}

	async function addNewField(key: string) {
		if (!newFieldName.trim()) {
			alert("Please enter a field name");
			return;
		}

		try {
			const dataSource = isRootMode ? rootData : store;
			const entry = dataSource[key];
			const parsedValue = inferType(editValue);
			const updatedEntry = { ...entry, [newFieldName]: parsedValue };
			
			if (isRootMode) {
				await writeToGunPath([...navigationPath, key], updatedEntry);
			} else {
				const currentTable = getCurrentTableName();
				const safeHolonID = holonID || "";
				await holosphere.put(safeHolonID, currentTable, updatedEntry);
			}
			cancelEdit();
		} catch (error) {
			console.error("Error adding new field:", error);
		}
	}

	async function addArrayItem(key: string, field: string, currentArray: any[]) {
		try {
			const dataSource = isRootMode ? rootData : store;
			const entry = dataSource[key];
			const newArray = [...currentArray, null];
			const updatedEntry = { ...entry, [field]: newArray };
			
			if (isRootMode) {
				await writeToGunPath([...navigationPath, key], updatedEntry);
			} else {
				const currentTable = getCurrentTableName();
				const safeHolonID = holonID || "";
				await holosphere.put(safeHolonID, currentTable, updatedEntry);
			}
			startEditing(key, field, newArray, newArray.length - 1);
		} catch (error) {
			console.error("Error adding array item:", error);
		}
	}

	async function removeArrayItem(key: string, field: string, index: number, currentArray: any[]) {
		if (confirm("Are you sure you want to remove this item?")) {
			try {
				const dataSource = isRootMode ? rootData : store;
				const entry = dataSource[key];
				const newArray = [...currentArray];
				newArray.splice(index, 1);
				const updatedEntry = { ...entry, [field]: newArray };
				
				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					const currentTable = getCurrentTableName();
					const safeHolonID = holonID || "";
					await holosphere.put(safeHolonID, currentTable, updatedEntry);
				}
			} catch (error) {
				console.error("Error removing array item:", error);
			}
		}
	}

	function exportTableData() {
		const dataSource = isRootMode ? rootData : store;
		const dataStr = JSON.stringify(dataSource, null, 2);
		const dataBlob = new Blob([dataStr], { type: 'application/json' });
		const url = URL.createObjectURL(dataBlob);
		const link = document.createElement('a');
		link.href = url;
		
		let fileName: string;
		if (isRootMode) {
			const pathStr = navigationPath.length > 0 ? navigationPath.join('_') : 'root';
			fileName = `gun_${pathStr}_${new Date().toISOString().split('T')[0]}.json`;
		} else {
			const currentTable = getCurrentTableName();
			fileName = `${currentTable}_${new Date().toISOString().split('T')[0]}.json`;
		}
		
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	function exportEntry(key: string, data: any) {
		const dataStr = JSON.stringify(data, null, 2);
		const dataBlob = new Blob([dataStr], { type: 'application/json' });
		const url = URL.createObjectURL(dataBlob);
		const link = document.createElement('a');
		link.href = url;
		
		let fileName: string;
		if (isRootMode) {
			const pathStr = navigationPath.length > 0 ? navigationPath.join('_') : 'root';
			fileName = `gun_${pathStr}_${key}_${new Date().toISOString().split('T')[0]}.json`;
		} else {
			fileName = `${selectedTable}_${key}_${new Date().toISOString().split('T')[0]}.json`;
		}
		
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	async function addNewEntry() {
		if (!newEntryKey.trim()) {
			alert("Please enter an ID for the new entry");
			return;
		}

		try {
			const parsedData = JSON.parse(newEntryJson);
			if (isRootMode) {
				// In root mode, we write directly to the path
				await writeToGunPath([...navigationPath, newEntryKey], parsedData);
			} else {
				const currentTable = getCurrentTableName();
				const safeHolonID = holonID || "";
				await holosphere.put(safeHolonID, currentTable, parsedData);
			}
			isAddingNewEntry = false;
			newEntryJson = "{\n  \n}";
			newEntryKey = "";
		} catch (error) {
			alert("Invalid JSON format");
			console.error("Error adding new entry:", error);
		}
	}

	// Root navigation functions
	async function enterRootMode() {
		isRootMode = true;
		navigationPath = [];
		showNavigationMode = true;
		await loadRootData();
	}

	async function exitRootMode() {
		isRootMode = false;
		showNavigationMode = false;
		navigationPath = [];
		rootData = {};
		// Return to current table subscription
		subscribeToTable(getCurrentTableName());
	}

	async function loadRootData() {
		try {
			console.log("Loading root data...", { navigationPath, isRootMode });
			rootData = {};
			
			if (!gun) {
				console.error("Gun instance not available");
				return;
			}
			
			console.log("Using Gun instance:", gun);
			
			let currentRef = gun;
			
			if (navigationPath.length === 0) {
				console.log("Loading from absolute Gun root");
				
				// First, try to find any data using the same approach as Navigator/GlobalHolons
				const knownKeys = ['Holons', 'users', 'global', 'peers', 'system'];
				
				// Test known keys to see what exists
				for (const testKey of knownKeys) {
					gun.get(testKey).once((data: any) => {
						if (data !== null && data !== undefined) {
							console.log(`Found data at key "${testKey}":`, typeof data, data);
							rootData[testKey] = (typeof data === 'object' && data !== null) ? data : { value: data, type: typeof data };
							rootData = { ...rootData };
						}
					});
				}
				
				// Also try to map over the root to see what's there
				currentRef.map().on((data: any, key: string) => {
					console.log("Root key found:", key, "Data type:", typeof data, "Is object:", typeof data === 'object');
					// Accept more data types and be less restrictive
					if (data !== null && data !== undefined && key && !key.startsWith('_')) {
						// For objects, store them directly; for primitives, wrap them
						rootData[key] = (typeof data === 'object' && data !== null) ? data : { value: data, type: typeof data };
						rootData = { ...rootData };
						console.log("Updated rootData keys:", Object.keys(rootData));
					}
				});
				
				// Alternative approach: try to list what's in the graph
				try {
					console.log("Attempting to access Gun graph directly...");
					// @ts-ignore - Access Gun's internal graph
					if (gun._.graph) {
						console.log("Gun graph keys:", Object.keys(gun._.graph));
						Object.keys(gun._.graph).forEach(key => {
							if (!key.startsWith('_') && gun._.graph[key]) {
								console.log(`Graph key found: ${key}`);
								rootData[key] = { 
									type: 'graph_node', 
									keys: Object.keys(gun._.graph[key]).filter(k => !k.startsWith('_')),
									data: gun._.graph[key]
								};
							}
						});
						rootData = { ...rootData };
					}
				} catch (e) {
					console.log("Could not access Gun graph directly:", e);
				}
				
			} else {
				console.log("Navigating to path:", navigationPath);
				// Navigate to specific path
				for (const pathSegment of navigationPath) {
					currentRef = currentRef.get(pathSegment);
					console.log("Navigated to:", pathSegment);
				}
				
				currentRef.map().on((data: any, key: string) => {
					console.log("Path key found:", key, "Data type:", typeof data);
					if (data !== null && data !== undefined && key && !key.startsWith('_')) {
						// For objects, store them directly; for primitives, wrap them
						rootData[key] = (typeof data === 'object' && data !== null) ? data : { value: data, type: typeof data };
						rootData = { ...rootData };
						console.log("Updated rootData keys:", Object.keys(rootData));
					}
				});
			}
			
			// Add a timeout to check if we received any data
			setTimeout(() => {
				console.log("Root data after 3 seconds:", rootData, "Keys:", Object.keys(rootData));
				if (Object.keys(rootData).length === 0) {
					console.log("No data found - trying final fallback approaches...");
					console.log("Gun instance structure:", gun);
					
					// Try to get ANY data that might exist
					console.log("Attempting to get app data...");
					// Try some common app namespace patterns
					['app', 'data', 'main'].forEach(appKey => {
						gun.get(appKey).once((appData: any) => {
							if (appData) {
								console.log(`Found app data at "${appKey}":`, appData);
								rootData[appKey] = appData;
								rootData = { ...rootData };
							}
						});
					});
				}
			}, 3000);
			
		} catch (error) {
			console.error("Error loading root data:", error);
		}
	}

	async function navigateToPath(pathSegment: string) {
		navigationPath = [...navigationPath, pathSegment];
		await loadRootData();
		expandedFields.clear();
	}

	async function navigateUp() {
		if (navigationPath.length > 0) {
			navigationPath = navigationPath.slice(0, -1);
			await loadRootData();
			expandedFields.clear();
		}
	}

	async function navigateToRoot() {
		navigationPath = [];
		await loadRootData();
		expandedFields.clear();
	}

	async function writeToGunPath(path: string[], data: any) {
		try {
			console.log("Writing to Gun path:", path, "Data:", data);
			
			if (!gun) {
				console.error("Gun instance not available for writing");
				return;
			}
			
			let gunRef = gun;
			
			for (const pathSegment of path) {
				gunRef = gunRef.get(pathSegment);
			}
			
			console.log("Writing data to Gun reference");
			gunRef.put(data);
		} catch (error) {
			console.error("Error writing to gun path:", error);
		}
	}

	// Recursive deletion function
	async function recursivelyDeleteNode(key: string) {
		if (!confirm(`Are you sure you want to recursively delete the entire node "${key}"? This will set all nested values and keys to null and cannot be undone.`)) {
			return;
		}

		try {
			if (isRootMode) {
				await recursivelyDeleteGunPath([...navigationPath, key]);
			} else {
				const currentTable = getCurrentTableName();
				const safeHolonID = holonID || "";
				
				// First get the entire entry to understand its structure
				const entry = store[key];
				if (entry && typeof entry === 'object') {
					await recursivelyDeleteEntry(safeHolonID, currentTable, key, entry);
				}
				
				// Finally delete the entry itself
				await holosphere.delete(safeHolonID, currentTable, key);
			}
			
			console.log(`Recursively deleted node: ${key}`);
		} catch (error) {
			console.error("Error during recursive deletion:", error);
		}
	}

	async function recursivelyDeleteGunPath(path: string[]) {
		try {
			console.log("Recursively deleting Gun path:", path);
			
			if (!gun) {
				console.error("Gun instance not available for deletion");
				return;
			}
			
			let gunRef = gun;
			
			for (const pathSegment of path) {
				gunRef = gunRef.get(pathSegment);
			}
			
			console.log("Setting Gun node to null");
			// Set the entire node to null
			gunRef.put(null);
		} catch (error) {
			console.error("Error recursively deleting gun path:", error);
		}
	}

	async function recursivelyDeleteEntry(holonId: string, table: string, entryKey: string, entryData: any) {
		try {
			// Recursively null out all nested properties
			if (typeof entryData === 'object' && entryData !== null) {
				for (const [fieldKey, fieldValue] of Object.entries(entryData)) {
					if (typeof fieldValue === 'object' && fieldValue !== null) {
						if (Array.isArray(fieldValue)) {
							// For arrays, set each element to null
							const nullArray = new Array(fieldValue.length).fill(null);
							const updatedEntry = { ...entryData, [fieldKey]: nullArray };
							await holosphere.put(holonId, table, updatedEntry);
						} else {
							// For objects, recursively null out properties
							await recursivelyNullifyObject(holonId, table, entryKey, fieldKey, fieldValue);
						}
					}
				}
			}
		} catch (error) {
			console.error("Error recursively deleting entry:", error);
		}
	}

	async function recursivelyNullifyObject(holonId: string, table: string, entryKey: string, fieldPath: string, obj: any) {
		try {
			if (typeof obj === 'object' && obj !== null) {
				for (const key of Object.keys(obj)) {
					obj[key] = null;
				}
				
				// Update the entry with nullified object
				const currentEntry = store[entryKey];
				const updatedEntry = { ...currentEntry, [fieldPath]: obj };
				await holosphere.put(holonId, table, updatedEntry);
			}
		} catch (error) {
			console.error("Error nullifying object:", error);
		}
	}

	// Gun address detection and navigation helpers
	function isGunAddress(value: any): boolean {
		if (typeof value !== 'string') return false;
		return GUN_ADDRESS_PATTERN.test(value);
	}

	function isGunReference(obj: any): boolean {
		if (typeof obj !== 'object' || obj === null) return false;
		// Gun references typically have a '#' property pointing to an address
		return obj.hasOwnProperty('#') && typeof obj['#'] === 'string' && isGunAddress(obj['#']);
	}

	function getGunAddress(obj: any): string | null {
		if (isGunAddress(obj)) return obj;
		if (isGunReference(obj)) return obj['#'];
		return null;
	}

	async function navigateToGunAddress(address: string) {
		console.log("Navigating to Gun address:", address);
		if (isRootMode) {
			navigationPath = [address];
			await loadRootData();
			expandedFields.clear();
		} else {
			// For non-root mode, we could potentially show the gun address data in a modal or navigate to root mode
			alert(`Gun address detected: ${address}\nSwitch to Root Mode to navigate to this address.`);
		}
	}

	async function loadGunAddressPreview(address: string): Promise<any> {
		if (!gun) return null;
		
		return new Promise((resolve) => {
			gun.get(address).once((data: any) => {
				resolve(data);
			});
		});
	}

	function formatJsonWithLinks(obj: any): string {
		const jsonString = JSON.stringify(obj, null, 2);
		
		// Replace Gun addresses in the JSON with clickable links
		return jsonString.replace(
			/"([a-zA-Z0-9_-]{20,})"/g,
			(match, address) => {
				if (isGunAddress(address)) {
					return `"<button class='text-blue-400 hover:text-blue-300 underline font-mono' onclick='navigateToGunAddress("${address}")' title='Click to navigate to Gun address'>🔗 ${address}</button>"`;
				}
				return match;
			}
		).replace(
			/"#": "([a-zA-Z0-9_-]{20,})"/g,
			(match, address) => {
				return `"#": "<button class='text-blue-400 hover:text-blue-300 underline font-mono' onclick='navigateToGunAddress("${address}")' title='Click to navigate to Gun reference'>🔗 ${address}</button>"`;
			}
		);
	}

	// Make navigateToGunAddress available globally for HTML onclick handlers
	if (typeof window !== 'undefined') {
		(window as any).navigateToGunAddress = navigateToGunAddress;
	}
</script>

<div class="flex flex-wrap">
	<div class="w-full lg:w-10/12 bg-gray-900 border border-gray-800 py-8 px-8 rounded-3xl shadow-2xl">
		<div class="flex justify-between text-white items-center mb-8">
			<div class="flex items-center gap-4">
				<p class="text-2xl font-bold">Database Explorer</p>
				
				<!-- Navigation Mode Toggle -->
				<div class="flex items-center gap-2">
					<button
						class="px-3 py-2 rounded-lg transition-all duration-200 font-medium {isRootMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-700 hover:bg-gray-600'}"
						on:click={isRootMode ? exitRootMode : enterRootMode}
					>
						{isRootMode ? 'Exit Root Mode' : 'Root Navigation'}
					</button>
				</div>

				{#if !isRootMode}
					<div class="lens-control relative">
						<label for="table-input" class="lens-label text-gray-300 font-medium">Table:</label>
						<div class="relative inline-block">
							<input
								id="table-input"
								type="text"
								class="bg-gray-900 text-white border border-gray-700 rounded-lg px-4 py-2 pr-10 w-56 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 focus:outline-none transition-all duration-200"
								placeholder="Enter table name or select..."
								bind:value={inputValue}
								on:input={handleInputChange}
								aria-label="Table name input"
							/>
						<button
							type="button"
							class="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors duration-200"
							on:click={toggleDropdown}
							aria-label="Toggle dropdown"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
						
						{#if showDropdown}
							<div class="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto backdrop-blur-sm">
								<div class="py-1">
									{#each tables as table}
										<button
											type="button"
											class="w-full text-left px-4 py-3 hover:bg-gray-800 text-gray-200 hover:text-white transition-colors duration-150 flex items-center justify-between group"
											on:click={() => selectTable(table.value)}
										>
											<span class="font-medium">{table.label}</span>
											<span class="text-xs text-gray-500 group-hover:text-gray-400">{table.value}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<button 
						class="info-button ml-3 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-300 p-2 rounded-lg transition-colors duration-200" 
						aria-label="Table information"
						on:mouseenter={() => showTableInfo = true}
						on:mouseleave={() => showTableInfo = false}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
							<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
							<circle cx="8" cy="8" r="3" fill="white" opacity="0.8"/>
							<circle cx="16" cy="16" r="3" fill="white" opacity="0.8"/>
						</svg>
					</button>
					
					{#if showTableInfo}
						<div class="absolute top-full left-0 mt-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 p-4 max-w-md">
							<p class="text-gray-200 font-medium mb-2">Tables store different types of data in the database:</p>
							<ul class="text-sm text-gray-300 space-y-1">
								<li><span class="font-semibold text-blue-400">Tasks:</span> Active tasks and quests</li>
								<li><span class="font-semibold text-green-400">Local Needs:</span> Community needs and requests</li>
								<li><span class="font-semibold text-yellow-400">Offers:</span> Available resources and services</li>
								<li><span class="font-semibold text-purple-400">Communities:</span> Active local groups</li>
								<li><span class="font-semibold text-indigo-400">Organizations:</span> Registered organizations</li>
								<li><span class="font-semibold text-pink-400">Events:</span> Scheduled activities</li>
								<li><span class="font-semibold text-cyan-400">People:</span> User profiles and accounts</li>
								<li><span class="font-semibold text-orange-400">Settings:</span> System configuration</li>
								<li><span class="font-semibold text-red-400">Expenses:</span> Financial records</li>
								<li><span class="font-semibold text-gray-400">Profile:</span> Personal information</li>
							</ul>
						</div>
					{/if}
				</div>
				{/if}

				{#if isRootMode}
					<!-- Breadcrumb Navigation -->
					<div class="flex items-center gap-2 px-4 py-2 bg-gray-800 rounded-lg">
						<button
							class="text-blue-400 hover:text-blue-300 font-medium"
							on:click={navigateToRoot}
						>
							Root
						</button>
						{#each navigationPath as pathSegment, index}
							<span class="text-gray-500">/</span>
							<button
								class="text-blue-400 hover:text-blue-300 font-medium"
								on:click={() => {
									navigationPath = navigationPath.slice(0, index + 1);
									loadRootData();
								}}
							>
								{pathSegment}
							</button>
						{/each}
						{#if navigationPath.length > 0}
							<button
								class="ml-2 text-gray-400 hover:text-gray-300"
								on:click={navigateUp}
								title="Go up one level"
								aria-label="Navigate up one level"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16l-4-4m0 0l4-4m-4 4h18" />
								</svg>
							</button>
						{/if}
					</div>
				{/if}
				<button
					class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg flex items-center gap-2 text-white font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
					on:click={exportTableData}
				>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
					</svg>
					Export JSON
				</button>
			</div>
			<p class="">{new Date().toDateString()}</p>
		</div>

		<div class="flex flex-wrap justify-between items-center pb-8">
			<div class="flex flex-wrap text-white">
				<div class="pr-10">
					<div class="text-2xl font-bold">{entries.length}</div>
					<div class="">{isRootMode ? 'Root Keys' : 'Records'}</div>
				</div>
				{#if isRootMode}
					<div class="pr-10">
						<div class="text-lg text-gray-300">Path: {navigationPath.length > 0 ? navigationPath.join(' > ') : 'Root'}</div>
						<div class="text-sm text-gray-400">Mode: Gun Root Navigation</div>
					</div>
				{/if}
			</div>
			<button
				class="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg flex items-center gap-2 text-white font-medium transition-all duration-200 shadow-lg hover:shadow-xl"
				on:click={() => isAddingNewEntry = true}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				New Entry
			</button>
		</div>

		{#if isAddingNewEntry}
			<div class="mb-8 p-4 bg-gray-700 rounded-xl text-white">
				<div class="flex justify-between items-center mb-4">
					<h3 class="text-lg font-semibold">Add New Entry</h3>
					<button
						class="text-gray-400 hover:text-gray-300"
						on:click={() => {
							isAddingNewEntry = false;
							newEntryJson = "{\n  \n}";
							newEntryKey = "";
						}}
						aria-label="Close add entry dialog"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div class="mb-4">
					<label for="new-entry-id" class="block mb-2">Entry ID:</label>
					<input
						id="new-entry-id"
						type="text"
						class="w-full bg-gray-800 text-white p-2 rounded"
						placeholder="Enter unique ID"
						bind:value={newEntryKey}
					/>
				</div>
				<div class="mb-4">
					<label for="new-entry-json" class="block mb-2">JSON Data:</label>
					<textarea
						id="new-entry-json"
						class="w-full bg-gray-800 text-white p-2 rounded font-mono"
						rows="10"
						bind:value={newEntryJson}
						placeholder="Enter JSON data"
					></textarea>
				</div>
				<div class="flex justify-end gap-2">
					<button
						class="px-4 py-2 bg-green-600 rounded hover:bg-green-700"
						on:click={addNewEntry}
					>
						Create
					</button>
					<button
						class="px-4 py-2 bg-gray-600 rounded hover:bg-gray-700"
						on:click={() => {
							isAddingNewEntry = false;
							newEntryJson = "{\n  \n}";
							newEntryKey = "";
						}}
					>
						Cancel
					</button>
				</div>
			</div>
		{/if}

		{#if isRootMode && entries.length === 0}
			<div class="w-full bg-gray-800 rounded-lg p-6 text-center text-gray-300">
				<h3 class="text-xl font-semibold mb-2">No Data Found</h3>
				<p class="mb-4">
					{#if navigationPath.length === 0}
						No data found at Gun database root. This could mean:
					{:else}
						No data found at path: {navigationPath.join(' > ')}
					{/if}
				</p>
				<ul class="text-sm text-gray-400 text-left max-w-md mx-auto mb-4">
					<li>• The database is empty at this level</li>
					<li>• Data might be stored under different keys</li>
					<li>• The Gun database might not be properly connected</li>
					{#if navigationPath.length > 0}
						<li>• Try navigating back to parent levels</li>
					{/if}
				</ul>
				
				{#if navigationPath.length === 0}
					<div class="flex gap-2 justify-center mb-4">
						<button
							class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm"
							on:click={() => navigateToPath('Holons')}
						>
							Try Holons
						</button>
						<button
							class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm"
							on:click={() => navigateToPath('app')}
						>
							Try App Data
						</button>
						<button
							class="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm"
							on:click={loadRootData}
						>
							Retry Scan
						</button>
					</div>
				{/if}
				
				<div class="mt-4 text-xs text-gray-500">
					Check browser console for debugging information
				</div>
			</div>
		{:else}
			<div class="flex flex-wrap">
				{#each entries as [key, data]}
					<div id={key} class="w-full md:w-6/12 lg:w-4/12">
					<div class="p-2">
						<div
							class="p-4 rounded-3xl bg-gray-700 text-white hover:bg-gray-600 transition-colors"
						>
							<div
								class="text-sm opacity-70 mb-2 flex justify-between"
							>
								<span>ID: {key}</span>
								<div class="flex gap-2">
									{#if data.status}
										<span
											class="px-2 py-0.5 rounded-full text-xs"
											style="background-color: {data.status ===
											'open'
												? '#4CAF50'
												: data.status === 'in_progress'
												? '#2196F3'
												: data.status === 'completed'
												? '#9C27B0'
												: '#757575'}"
										>
											{data.status}
										</span>
									{/if}
									{#if isRootMode && typeof data === 'object' && data !== null}
										<button
											class="text-green-400 hover:text-green-300"
											on:click={() => navigateToPath(key)}
											title="Navigate into this node"
											aria-label="Navigate into node {key}"
										>
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
											</svg>
										</button>
									{/if}
									<button
										class="text-blue-400 hover:text-blue-300"
										on:click={() => exportEntry(key, data)}
										title="Export entry"
										aria-label="Export entry {key}"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
										</svg>
									</button>
									<button
										class="text-orange-400 hover:text-orange-300"
										on:click={() => recursivelyDeleteNode(key)}
										title="Recursively delete entire node (sets all nested values to null)"
										aria-label="Recursively delete node {key}"
									>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
										</svg>
									</button>
									<button
										class="text-red-400 hover:text-red-300"
										on:click={() => deleteEntry(key)}
										title="Delete entry"
										aria-label="Delete entry {key}"
									>
										<svg
											class="w-4 h-4"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</div>
							</div>

							{#if typeof data === "object"}
								{#each Object.entries(data) as [field, value]}
									<div
										class="mb-2 hover:bg-gray-500 p-1 rounded"
									>
										<div
											class="flex justify-between items-start"
										>
											<span class="font-bold"
												>{field}:</span
											>
											<button
												class="text-blue-400 hover:text-blue-300 ml-2"
												on:click={() =>
													startEditing(
														key,
														field,
														value
													)}
												aria-label="Edit field"
											>
												<svg
													class="w-4 h-4"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
													/>
												</svg>
											</button>
										</div>

										{#if editingField === `${key}.${field}`}
											<div class="mt-2">
												<textarea
													class="w-full bg-gray-800 text-white p-2 rounded"
													rows={typeof value === "object" ? 5 : 1}
													bind:value={editValue}
													aria-label="Edit field value"
												></textarea>
												<div class="flex justify-end gap-2 mt-2">
													<button
														class="px-2 py-1 bg-green-600 rounded hover:bg-green-700"
														on:click={() => saveEdit(key, field)}
													>
														Save
													</button>
													<button
														class="px-2 py-1 bg-gray-600 rounded hover:bg-gray-700"
														on:click={cancelEdit}
													>
														Cancel
													</button>
												</div>
											</div>
										{:else if typeof value === "object" && value !== null}
											<div class="pl-4 mt-1">
												{#if expandedFields.has(`${key}.${field}`)}
													<div class="pl-4">
														{#if Array.isArray(value)}
															<div class="space-y-2">
																{#each value as item, index}
																	<div class="flex items-start gap-2">
																		<span class="text-gray-400">{index}:</span>
																		<div class="flex-1">
																			{#if isGunAddress(item)}
																				<button
																					class="text-blue-400 hover:text-blue-300 underline font-mono text-sm bg-gray-800 px-2 py-1 rounded"
																					on:click={() => navigateToGunAddress(item)}
																					title="Click to navigate to this Gun address"
																				>
																					🔗 {item}
																				</button>
																			{:else if isGunReference(item)}
																				<button
																					class="text-blue-400 hover:text-blue-300 underline font-mono text-sm bg-gray-800 px-2 py-1 rounded"
																					on:click={() => navigateToGunAddress(item['#'])}
																					title="Click to navigate to this Gun reference: {item['#']}"
																				>
																					🔗 #{item['#']}
																				</button>
																			{:else}
																				<div class="whitespace-pre-wrap font-mono text-sm">
																					{@html formatJsonWithLinks(item)}
																				</div>
																			{/if}
																		</div>
																		<div class="flex gap-1">
																																	<button
															class="text-blue-400 hover:text-blue-300"
															on:click={() => startEditing(key, field, value, index)}
															aria-label="Edit array item"
														>
																				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
																				</svg>
																			</button>
																																		<button
																class="text-red-400 hover:text-red-300"
																on:click={() => removeArrayItem(key, field, index, value)}
																aria-label="Remove array item"
															>
																				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
																				</svg>
																			</button>
																		</div>
																	</div>
																{/each}
																<button
																	class="mt-2 px-3 py-1 bg-blue-600 rounded hover:bg-blue-700 w-full text-left"
																	on:click={() => addArrayItem(key, field, value)}
																>
																	+ Add Item
																</button>
															</div>
														{:else}
															<div class="whitespace-pre-wrap font-mono text-sm">
																{@html formatJsonWithLinks(value)}
															</div>
														{/if}
													</div>
												{:else}
																								<button
												class="text-gray-400 cursor-pointer hover:text-gray-300"
												on:click={() =>
													toggleField(
														`${key}.${field}`
													)}
												aria-label="Toggle field expansion"
											>
														{Array.isArray(value)
															? `[${value.length} items]`
															: "{...}"}
													</button>
												{/if}
											</div>
										{:else}
											<div class="pl-4">
												{#if isGunAddress(value)}
													<button
														class="text-blue-400 hover:text-blue-300 underline font-mono text-sm bg-gray-800 px-2 py-1 rounded"
														on:click={() => navigateToGunAddress(String(value))}
														title="Click to navigate to this Gun address"
													>
														🔗 {String(value)}
													</button>
												{:else if isGunReference(value)}
													<button
														class="text-blue-400 hover:text-blue-300 underline font-mono text-sm bg-gray-800 px-2 py-1 rounded"
														on:click={() => navigateToGunAddress(String(value?.['#']))}
														title="Click to navigate to this Gun reference: {String(value?.['#'])}"
													>
														🔗 #{String(value?.['#'])}
													</button>
												{:else}
													<span>{String(value)}</span>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
								{#if addingFieldTo === key}
									<div class="mt-4 p-2 bg-gray-600 rounded">
										<div class="flex gap-2 mb-2">
											<input
												type="text"
												class="flex-1 bg-gray-800 text-white p-2 rounded"
												placeholder="Field name"
												bind:value={newFieldName}
											/>
										</div>
										<textarea
											class="w-full bg-gray-800 text-white p-2 rounded mb-2"
											rows="1"
											placeholder="Field value"
											bind:value={editValue}
										></textarea>
										<div class="flex justify-end gap-2">
											<button
												class="px-2 py-1 bg-green-600 rounded hover:bg-green-700"
												on:click={() => addNewField(key)}
											>
												Add
											</button>
											<button
												class="px-2 py-1 bg-gray-600 rounded hover:bg-gray-700"
												on:click={cancelEdit}
											>
												Cancel
											</button>
										</div>
									</div>
								{:else}
									<button
										class="mt-2 px-3 py-1 bg-blue-600 rounded hover:bg-blue-700 w-full text-left"
										on:click={() => {
											addingFieldTo = key;
											editValue = "";
											newFieldName = "";
										}}
									>
										+ Add Field
									</button>
								{/if}
							{:else}
								<div>{JSON.stringify(data)}</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.hover\:bg-gray-500:hover {
		background-color: rgba(107, 114, 128, 0.3);
	}

	textarea {
		font-family: monospace;
	}

	.lens-control {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
		min-height: 36px;
		background: white;
		border-radius: 4px;
		box-shadow: 0 0 0 2px rgba(0,0,0,0.1);
		white-space: nowrap;
	}

	.lens-label {
		color: #333;
		font-weight: 500;
		font-size: 14px;
		white-space: nowrap;
	}


</style>
