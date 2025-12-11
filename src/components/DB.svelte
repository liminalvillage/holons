<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { page } from "$app/stores";
	import type { HoloSphere } from "holosphere";

	// Use URL param directly instead of global ID store to avoid race conditions
	$: holonID = $page.params.id || "";

	let store: Record<string, any> = {};
	let selectedTable = "quests";
	let customTableName = "";
	let useCustomTable = false;
	let showDropdown = false;
	let tables = [
		{ value: "quests", label: "Tasks", icon: "fa-tasks" },
		{ value: "needs", label: "Local Needs", icon: "fa-hand-holding-heart" },
		{ value: "offers", label: "Offers", icon: "fa-gift" },
		{ value: "communities", label: "Communities", icon: "fa-users" },
		{ value: "organizations", label: "Organizations", icon: "fa-building" },
		{ value: "events", label: "Events", icon: "fa-calendar" },
		{ value: "users", label: "People", icon: "fa-user" },
		{ value: "settings", label: "Settings", icon: "fa-cog" },
		{ value: "expenses", label: "Expenses", icon: "fa-money-bill" },
		{ value: "profile", label: "Profile", icon: "fa-id-card" }
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

	// Search state
	let searchQuery = "";

	// Navigation state
	let navigationPath: string[] = [];
	let isRootMode = false;
	let rootData: Record<string, any> = {};

	// Gun address pattern detection
	const GUN_ADDRESS_PATTERN = /^[a-zA-Z0-9_-]{20,}$/;

	// Track current subscription to avoid re-subscribing to the same holon/table
	let currentSubscription = { holonId: '', tableName: '' };

	// Filter entries based on search query
	$: allEntries = Object.entries(isRootMode ? rootData : store);
	$: filteredEntries = searchQuery.trim()
		? allEntries.filter(([key, data]) => {
			const searchLower = searchQuery.toLowerCase();
			// Search in key
			if (key.toLowerCase().includes(searchLower)) return true;
			// Search in data (stringify and search)
			if (typeof data === 'object') {
				return JSON.stringify(data).toLowerCase().includes(searchLower);
			}
			return String(data).toLowerCase().includes(searchLower);
		})
		: allEntries;

	let holosphere = getContext("holosphere") as HoloSphere;
	let gun: any = null;
	let mounted = false;

	// React to holonID changes from URL - only subscribe when actually changing
	$: if (mounted && holonID && !isRootMode) {
		// Only resubscribe if the holon actually changed
		const currentTable = getCurrentTableName();
		if (currentSubscription.holonId !== holonID || currentSubscription.tableName !== currentTable) {
			subscribeToTable(currentTable);
		}
	}

	onMount(() => {
		mounted = true;

		if (holosphere && holosphere.gun) {
			gun = holosphere.gun;
			console.log("[DB] Gun instance initialized");
		} else {
			console.error("[DB] Failed to access Gun instance from HoloSphere");
		}

		// Initial subscription
		if (holonID) {
			subscribeToTable(getCurrentTableName());
		}

		function handleClickOutside(event: MouseEvent) {
			const target = event.target as HTMLElement;
			if (!target.closest('.table-dropdown')) {
				showDropdown = false;
			}
		}

		document.addEventListener('click', handleClickOutside);
		return () => {
			mounted = false;
			document.removeEventListener('click', handleClickOutside);
		};
	});

	function getCurrentTableName(): string {
		return useCustomTable ? customTableName : selectedTable || "quests";
	}

	async function subscribeToTable(tableName: string) {
		const safeHolonID = holonID || "";

		if (!safeHolonID || !safeHolonID.trim()) {
			console.log(`[DB] Skipping subscription - no holon ID provided`);
			return;
		}

		if (currentSubscription.holonId === safeHolonID && currentSubscription.tableName === tableName) {
			console.log(`[DB] Already subscribed to ${tableName} for holon: ${safeHolonID}, skipping`);
			return;
		}

		store = {};
		currentSubscription = { holonId: safeHolonID, tableName };
		console.log(`[DB] Subscribing to table: ${tableName} for holon: ${safeHolonID}`);

		if (holosphere && tableName.trim()) {
			// First, fetch initial data using read() - this filters out _deleted items
			try {
				const initialData = await holosphere.read(safeHolonID, tableName);
				if (initialData) {
					if (Array.isArray(initialData)) {
						initialData.forEach((item: any) => {
							if (item && item.id) {
								store[item.id] = item;
							}
						});
					} else if (typeof initialData === 'object') {
						Object.entries(initialData).forEach(([key, value]: [string, any]) => {
							if (value && value.id) {
								store[key] = value;
							}
						});
					}
					store = { ...store }; // Trigger reactivity
				}
				console.log(`[DB] Initial data loaded: ${Object.keys(store).length} entries`);
			} catch (error) {
				console.error(`[DB] Error loading initial data:`, error);
			}

			// Then subscribe for future updates
			holosphere.subscribe(safeHolonID, tableName, (newData: any, key?: string) => {
				if (typeof key !== 'string') return;
				// Filter out deleted items - holosphere marks deleted items with _deleted: true
				if (newData && !newData._deleted) {
					store[key] = newData;
				} else {
					delete store[key];
				}
				store = store; // Trigger reactivity
			});
		}
	}

	function selectTable(table: string) {
		selectedTable = table;
		useCustomTable = false;
		showDropdown = false;
		currentSubscription = { holonId: '', tableName: '' }; // Reset to force resubscribe
		subscribeToTable(table);
		expandedFields.clear();
		searchQuery = "";
	}

	function handleCustomTableSubmit() {
		if (customTableName.trim()) {
			useCustomTable = true;
			showDropdown = false;
			currentSubscription = { holonId: '', tableName: '' };
			subscribeToTable(customTableName.trim());
			expandedFields.clear();
			searchQuery = "";
		}
	}

	function toggleField(fieldPath: string) {
		if (expandedFields.has(fieldPath)) {
			expandedFields.delete(fieldPath);
		} else {
			expandedFields.add(fieldPath);
		}
		expandedFields = expandedFields;
	}

	async function deleteEntry(key: string) {
		if (!key) return;
		if (confirm("Are you sure you want to delete this entry?")) {
			try {
				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], null);
					delete rootData[key];
					rootData = { ...rootData };
				} else {
					const currentTable = getCurrentTableName();
					const safeHolonID = holonID || "";
					if (!safeHolonID || !currentTable) return;
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
		if (value.trim() === "") return "";
		const num = Number(value);
		if (!isNaN(num) && value.trim() !== "") return num;
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
		try {
			if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
				return JSON.parse(value);
			}
		} catch (e) {}
		return value;
	}

	// Try to parse a string value as JSON for display purposes
	function tryParseJson(value: any): { isParsed: boolean; parsed: any } {
		if (typeof value !== 'string') return { isParsed: false, parsed: value };
		const trimmed = value.trim();
		if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
			try {
				return { isParsed: true, parsed: JSON.parse(value) };
			} catch (e) {
				return { isParsed: false, parsed: value };
			}
		}
		return { isParsed: false, parsed: value };
	}

	// Deserialize Gun data - handles JSON string (primary) and _json wrapper (legacy)
	function deserializeGunData(data: any): any {
		if (!data) return data;

		// Primary format: JSON string (like old holosphere)
		if (typeof data === 'string') {
			try {
				return JSON.parse(data);
			} catch (e) {
				return data; // Return as-is if not valid JSON
			}
		}

		if (typeof data !== 'object') return data;

		// Legacy: holosphere2's _json wrapper format
		if (data._json && typeof data._json === 'string') {
			try {
				return JSON.parse(data._json);
			} catch (e) {
				return data;
			}
		}

		// Handle Gun node data with timestamps (has _ with > metadata)
		if (data._ && data._['>']) {
			const cleaned: Record<string, any> = {};
			for (const [k, v] of Object.entries(data)) {
				if (k === '_') continue;
				// Check if value is a JSON string
				if (typeof v === 'string') {
					try {
						cleaned[k] = JSON.parse(v);
					} catch {
						cleaned[k] = v;
					}
				// Check if the value is a _json wrapper (legacy)
				} else if (typeof v === 'object' && v !== null && (v as any)._json) {
					try {
						cleaned[k] = JSON.parse((v as any)._json);
					} catch {
						cleaned[k] = v;
					}
				} else {
					cleaned[k] = v;
				}
			}
			return Object.keys(cleaned).length > 0 ? cleaned : data;
		}

		// Clean Gun metadata from plain objects
		if (data._) {
			const cleaned = { ...data };
			delete cleaned['_'];
			return cleaned;
		}

		return data;
	}

	async function saveEdit(key: string, field: string) {
		try {
			const dataSource = isRootMode ? rootData : store;
			const entry = dataSource[key];
			let parsedValue: any;

			if (isArrayEditing && arrayEditIndex !== null) {
				const currentArray = [...entry[field]];
				parsedValue = inferType(editValue);
				currentArray[arrayEditIndex] = parsedValue;
				const updatedEntry = { ...entry, [field]: currentArray };

				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					await holosphere.put(holonID || "", getCurrentTableName(), updatedEntry);
				}
			} else {
				parsedValue = inferType(editValue);
				const updatedEntry = { ...entry, [field]: parsedValue };

				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					await holosphere.put(holonID || "", getCurrentTableName(), updatedEntry);
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
				await holosphere.put(holonID || "", getCurrentTableName(), updatedEntry);
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
				await holosphere.put(holonID || "", getCurrentTableName(), updatedEntry);
			}
			startEditing(key, field, newArray, newArray.length - 1);
		} catch (error) {
			console.error("Error adding array item:", error);
		}
	}

	async function removeArrayItem(key: string, field: string, index: number, currentArray: any[]) {
		if (confirm("Remove this item?")) {
			try {
				const dataSource = isRootMode ? rootData : store;
				const entry = dataSource[key];
				const newArray = [...currentArray];
				newArray.splice(index, 1);
				const updatedEntry = { ...entry, [field]: newArray };

				if (isRootMode) {
					await writeToGunPath([...navigationPath, key], updatedEntry);
				} else {
					await holosphere.put(holonID || "", getCurrentTableName(), updatedEntry);
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
		const fileName = isRootMode
			? `db_${navigationPath.length > 0 ? navigationPath.join('_') : 'root'}_${new Date().toISOString().split('T')[0]}.json`
			: `${getCurrentTableName()}_${new Date().toISOString().split('T')[0]}.json`;
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
		const fileName = `${getCurrentTableName()}_${key}_${new Date().toISOString().split('T')[0]}.json`;
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
				await writeToGunPath([...navigationPath, newEntryKey], parsedData);
			} else {
				await holosphere.put(holonID || "", getCurrentTableName(), { ...parsedData, id: newEntryKey });
			}
			isAddingNewEntry = false;
			newEntryJson = "{\n  \n}";
			newEntryKey = "";
		} catch (error) {
			alert("Invalid JSON format");
			console.error("Error adding new entry:", error);
		}
	}

	async function enterRootMode() {
		isRootMode = true;
		navigationPath = [];
		searchQuery = "";
		await loadRootData();
	}

	async function exitRootMode() {
		isRootMode = false;
		navigationPath = [];
		rootData = {};
		searchQuery = "";
		currentSubscription = { holonId: '', tableName: '' };
		subscribeToTable(getCurrentTableName());
	}

	async function loadRootData() {
		rootData = {};
		if (!gun) return;

		let currentRef = gun;

		if (navigationPath.length === 0) {
			const knownKeys = ['Holons', 'users', 'global', 'peers', 'system'];
			for (const testKey of knownKeys) {
				gun.get(testKey).once((data: any) => {
					if (data !== null && data !== undefined) {
						const deserialized = deserializeGunData(data);
						rootData[testKey] = (typeof deserialized === 'object' && deserialized !== null) ? deserialized : { value: deserialized, type: typeof deserialized };
						rootData = { ...rootData };
					}
				});
			}

			currentRef.map().on((data: any, key: string) => {
				if (data !== null && data !== undefined && key && !key.startsWith('_')) {
					const deserialized = deserializeGunData(data);
					rootData[key] = (typeof deserialized === 'object' && deserialized !== null) ? deserialized : { value: deserialized, type: typeof deserialized };
					rootData = { ...rootData };
				}
			});
		} else {
			for (const pathSegment of navigationPath) {
				currentRef = currentRef.get(pathSegment);
			}

			currentRef.map().on((data: any, key: string) => {
				if (data !== null && data !== undefined && key && !key.startsWith('_')) {
					const deserialized = deserializeGunData(data);
					rootData[key] = (typeof deserialized === 'object' && deserialized !== null) ? deserialized : { value: deserialized, type: typeof deserialized };
					rootData = { ...rootData };
				}
			});
		}
	}

	async function navigateToPath(pathSegment: string) {
		navigationPath = [...navigationPath, pathSegment];
		searchQuery = "";
		await loadRootData();
		expandedFields.clear();
	}

	async function navigateUp() {
		if (navigationPath.length > 0) {
			navigationPath = navigationPath.slice(0, -1);
			searchQuery = "";
			await loadRootData();
			expandedFields.clear();
		}
	}

	async function navigateToBreadcrumb(index: number) {
		navigationPath = navigationPath.slice(0, index + 1);
		searchQuery = "";
		await loadRootData();
		expandedFields.clear();
	}

	async function writeToGunPath(path: string[], data: any) {
		if (!gun) return;
		let gunRef = gun;
		for (const pathSegment of path) {
			gunRef = gunRef.get(pathSegment);
		}
		gunRef.put(data);
	}

	async function recursivelyDeleteNode(key: string) {
		if (!confirm(`Delete "${key}" and all nested data? This cannot be undone.`)) return;
		try {
			if (isRootMode) {
				let gunRef = gun;
				for (const pathSegment of [...navigationPath, key]) {
					gunRef = gunRef.get(pathSegment);
				}
				gunRef.put(null);
				delete rootData[key];
				rootData = { ...rootData };
			} else {
				await holosphere.delete(holonID || "", getCurrentTableName(), key);
				delete store[key];
				store = { ...store };
			}
		} catch (error) {
			console.error("Error during deletion:", error);
		}
	}

	function isGunAddress(value: any): boolean {
		if (typeof value !== 'string') return false;
		return GUN_ADDRESS_PATTERN.test(value);
	}

	function isGunReference(obj: any): boolean {
		if (typeof obj !== 'object' || obj === null) return false;
		return obj.hasOwnProperty('#') && typeof obj['#'] === 'string' && isGunAddress(obj['#']);
	}

	async function navigateToGunAddress(address: string) {
		if (isRootMode) {
			navigationPath = [address];
			searchQuery = "";
			await loadRootData();
			expandedFields.clear();
		} else {
			if (confirm(`Navigate to address: ${address}?\nThis will switch to Root Mode.`)) {
				isRootMode = true;
				navigationPath = [address];
				searchQuery = "";
				await loadRootData();
				expandedFields.clear();
			}
		}
	}

	function getDisplayLabel(): string {
		if (isRootMode) {
			return navigationPath.length > 0 ? navigationPath[navigationPath.length - 1] : 'Root';
		}
		const table = tables.find(t => t.value === selectedTable);
		return useCustomTable ? customTableName : (table?.label || selectedTable);
	}

	function getCurrentIcon(): string {
		if (isRootMode) return 'fa-database';
		const table = tables.find(t => t.value === selectedTable);
		return table?.icon || 'fa-table';
	}
</script>

<div class="db-explorer">
	<!-- Header -->
	<div class="header">
		<div class="header-left">
			<div class="title-section">
				<i class="fas {getCurrentIcon()} title-icon"></i>
				<h1>Database Explorer</h1>
			</div>

			<!-- Mode Toggle -->
			<div class="mode-toggle">
				<button
					class="mode-btn {!isRootMode ? 'active' : ''}"
					on:click={exitRootMode}
					disabled={!isRootMode}
				>
					<i class="fas fa-table"></i>
					Tables
				</button>
				<button
					class="mode-btn {isRootMode ? 'active' : ''}"
					on:click={enterRootMode}
					disabled={isRootMode}
				>
					<i class="fas fa-sitemap"></i>
					Root
				</button>
			</div>
		</div>

		<div class="header-right">
			<button class="action-btn export-btn" on:click={exportTableData}>
				<i class="fas fa-download"></i>
				Export
			</button>
			<button class="action-btn add-btn" on:click={() => isAddingNewEntry = true}>
				<i class="fas fa-plus"></i>
				New Entry
			</button>
		</div>
	</div>

	<!-- Navigation Bar -->
	<div class="nav-bar">
		{#if isRootMode}
			<!-- Breadcrumb Navigation -->
			<div class="breadcrumb">
				<button class="breadcrumb-item root" on:click={() => { navigationPath = []; loadRootData(); }}>
					<i class="fas fa-home"></i>
				</button>
				{#each navigationPath as segment, index}
					<i class="fas fa-chevron-right breadcrumb-separator"></i>
					<button
						class="breadcrumb-item {index === navigationPath.length - 1 ? 'current' : ''}"
						on:click={() => navigateToBreadcrumb(index)}
					>
						{segment.length > 20 ? segment.substring(0, 20) + '...' : segment}
					</button>
				{/each}
				{#if navigationPath.length > 0}
					<button class="nav-up-btn" on:click={navigateUp} title="Go up">
						<i class="fas fa-level-up-alt"></i>
					</button>
				{/if}
			</div>
		{:else}
			<!-- Table Selector -->
			<div class="table-dropdown">
				<button class="table-selector" on:click={() => showDropdown = !showDropdown}>
					<i class="fas {getCurrentIcon()}"></i>
					<span>{getDisplayLabel()}</span>
					<i class="fas fa-chevron-down dropdown-arrow {showDropdown ? 'open' : ''}"></i>
				</button>

				{#if showDropdown}
					<div class="dropdown-menu">
						<div class="dropdown-section">
							<div class="dropdown-header">Tables</div>
							{#each tables as table}
								<button
									class="dropdown-item {selectedTable === table.value && !useCustomTable ? 'selected' : ''}"
									on:click={() => selectTable(table.value)}
								>
									<i class="fas {table.icon}"></i>
									<span>{table.label}</span>
									<span class="table-key">{table.value}</span>
								</button>
							{/each}
						</div>
						<div class="dropdown-section custom-section">
							<div class="dropdown-header">Custom Table</div>
							<div class="custom-input-wrapper">
								<input
									type="text"
									placeholder="Enter table name..."
									bind:value={customTableName}
									on:keydown={(e) => e.key === 'Enter' && handleCustomTableSubmit()}
								/>
								<button class="custom-go-btn" on:click={handleCustomTableSubmit}>
									<i class="fas fa-arrow-right"></i>
								</button>
							</div>
						</div>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Search Box -->
		<div class="search-box">
			<i class="fas fa-search search-icon"></i>
			<input
				type="text"
				placeholder="Search records..."
				bind:value={searchQuery}
			/>
			{#if searchQuery}
				<button class="clear-search" on:click={() => searchQuery = ""}>
					<i class="fas fa-times"></i>
				</button>
			{/if}
		</div>

		<!-- Stats -->
		<div class="stats">
			<span class="stat">
				<strong>{filteredEntries.length}</strong>
				{#if searchQuery && filteredEntries.length !== allEntries.length}
					<span class="stat-label">of {allEntries.length}</span>
				{/if}
				<span class="stat-label">records</span>
			</span>
		</div>
	</div>

	<!-- Add New Entry Modal -->
	{#if isAddingNewEntry}
		<div class="modal-overlay" on:click={() => isAddingNewEntry = false}>
			<div class="modal" on:click|stopPropagation>
				<div class="modal-header">
					<h3>Add New Entry</h3>
					<button class="modal-close" on:click={() => isAddingNewEntry = false}>
						<i class="fas fa-times"></i>
					</button>
				</div>
				<div class="modal-body">
					<div class="form-group">
						<label for="entry-id">Entry ID</label>
						<input
							id="entry-id"
							type="text"
							placeholder="Unique identifier..."
							bind:value={newEntryKey}
						/>
					</div>
					<div class="form-group">
						<label for="entry-json">JSON Data</label>
						<textarea
							id="entry-json"
							rows="10"
							placeholder={'{ "key": "value" }'}
							bind:value={newEntryJson}
						></textarea>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn btn-secondary" on:click={() => isAddingNewEntry = false}>Cancel</button>
					<button class="btn btn-primary" on:click={addNewEntry}>Create Entry</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Content -->
	<div class="content">
		{#if filteredEntries.length === 0}
			<div class="empty-state">
				{#if searchQuery}
					<i class="fas fa-search empty-icon"></i>
					<h3>No matches found</h3>
					<p>No records match "{searchQuery}"</p>
					<button class="btn btn-secondary" on:click={() => searchQuery = ""}>Clear search</button>
				{:else}
					<i class="fas fa-inbox empty-icon"></i>
					<h3>No records</h3>
					<p>{isRootMode ? 'No data at this path' : 'This table is empty'}</p>
					<button class="btn btn-primary" on:click={() => isAddingNewEntry = true}>
						<i class="fas fa-plus"></i> Add first entry
					</button>
				{/if}
			</div>
		{:else}
			<div class="cards-grid">
				{#each filteredEntries as [key, data]}
					<div class="card" id={key}>
						<div class="card-header">
							<div class="card-id" title={key}>
								{key.length > 24 ? key.substring(0, 24) + '...' : key}
							</div>
							<div class="card-actions">
								{#if data?.status}
									<span class="status-badge status-{data.status}">{data.status}</span>
								{/if}
								{#if isRootMode && typeof data === 'object' && data !== null}
									<button class="card-action" on:click={() => navigateToPath(key)} title="Navigate into">
										<i class="fas fa-folder-open"></i>
									</button>
								{/if}
								<button class="card-action" on:click={() => exportEntry(key, data)} title="Export">
									<i class="fas fa-download"></i>
								</button>
								<button class="card-action danger" on:click={() => recursivelyDeleteNode(key)} title="Delete">
									<i class="fas fa-trash"></i>
								</button>
							</div>
						</div>

						<div class="card-body">
							{#if typeof data === "object" && data !== null}
								{#each Object.entries(data).filter(([f]) => f !== 'status') as [field, value]}
									<div class="field">
										<div class="field-header">
											<span class="field-name">{field}</span>
											<button class="field-edit" on:click={() => startEditing(key, field, value)}>
												<i class="fas fa-pen"></i>
											</button>
										</div>

										{#if editingField === `${key}.${field}`}
											<div class="field-editor">
												<textarea
													rows={typeof value === "object" ? 5 : 1}
													bind:value={editValue}
												></textarea>
												<div class="field-editor-actions">
													<button class="btn btn-sm btn-primary" on:click={() => saveEdit(key, field)}>Save</button>
													<button class="btn btn-sm btn-secondary" on:click={cancelEdit}>Cancel</button>
												</div>
											</div>
										{:else if typeof value === "object" && value !== null}
											<div class="field-value nested">
												{#if expandedFields.has(`${key}.${field}`)}
													{#if Array.isArray(value)}
														<div class="array-items">
															{#each value as item, index}
																<div class="array-item">
																	<span class="array-index">{index}</span>
																	<div class="array-content">
																		{#if isGunAddress(item)}
																			<button class="gun-link" on:click={() => navigateToGunAddress(item)}>
																				<i class="fas fa-link"></i> {item.substring(0, 16)}...
																			</button>
																		{:else}
																			<code>{JSON.stringify(item)}</code>
																		{/if}
																	</div>
																	<div class="array-actions">
																		<button on:click={() => startEditing(key, field, value, index)}><i class="fas fa-pen"></i></button>
																		<button on:click={() => removeArrayItem(key, field, index, value)}><i class="fas fa-times"></i></button>
																	</div>
																</div>
															{/each}
															<button class="add-array-item" on:click={() => addArrayItem(key, field, value)}>
																<i class="fas fa-plus"></i> Add item
															</button>
														</div>
													{:else}
														<pre>{JSON.stringify(value, null, 2)}</pre>
													{/if}
												{:else}
													<button class="expand-btn" on:click={() => toggleField(`${key}.${field}`)}>
														{Array.isArray(value) ? `[${value.length} items]` : '{...}'}
														<i class="fas fa-chevron-down"></i>
													</button>
												{/if}
												{#if expandedFields.has(`${key}.${field}`)}
													<button class="collapse-btn" on:click={() => toggleField(`${key}.${field}`)}>
														<i class="fas fa-chevron-up"></i> Collapse
													</button>
												{/if}
											</div>
										{:else}
											<div class="field-value">
												{#if isGunAddress(value)}
													<button class="gun-link" on:click={() => navigateToGunAddress(String(value))}>
														<i class="fas fa-link"></i> {String(value).substring(0, 20)}...
													</button>
												{:else}
													{String(value)}
												{/if}
											</div>
										{/if}
									</div>
								{/each}

								{#if addingFieldTo === key}
									<div class="add-field-form">
										<input type="text" placeholder="Field name" bind:value={newFieldName} />
										<input type="text" placeholder="Value" bind:value={editValue} />
										<div class="add-field-actions">
											<button class="btn btn-sm btn-primary" on:click={() => addNewField(key)}>Add</button>
											<button class="btn btn-sm btn-secondary" on:click={cancelEdit}>Cancel</button>
										</div>
									</div>
								{:else}
									<button class="add-field-btn" on:click={() => { addingFieldTo = key; editValue = ""; newFieldName = ""; }}>
										<i class="fas fa-plus"></i> Add field
									</button>
								{/if}
							{:else}
								<div class="field-value primitive">{JSON.stringify(data)}</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.db-explorer {
		background: #111827;
		border-radius: 1rem;
		overflow: hidden;
		color: white;
		min-height: 600px;
	}

	/* Header */
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem;
		border-bottom: 1px solid #1f2937;
		background: #0d1117;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 1.5rem;
	}

	.title-section {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.title-icon {
		font-size: 1.5rem;
		color: #60a5fa;
	}

	.title-section h1 {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0;
	}

	.mode-toggle {
		display: flex;
		background: #1f2937;
		border-radius: 0.5rem;
		padding: 0.25rem;
	}

	.mode-btn {
		padding: 0.5rem 1rem;
		border: none;
		background: transparent;
		color: #9ca3af;
		border-radius: 0.375rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		transition: all 0.2s;
	}

	.mode-btn:hover:not(:disabled) {
		color: white;
	}

	.mode-btn.active {
		background: #3b82f6;
		color: white;
	}

	.mode-btn:disabled {
		cursor: default;
	}

	.header-right {
		display: flex;
		gap: 0.75rem;
	}

	.action-btn {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.export-btn {
		background: #374151;
		color: white;
	}

	.export-btn:hover {
		background: #4b5563;
	}

	.add-btn {
		background: #059669;
		color: white;
	}

	.add-btn:hover {
		background: #047857;
	}

	/* Navigation Bar */
	.nav-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.5rem;
		background: #1f2937;
		border-bottom: 1px solid #374151;
	}

	/* Breadcrumb */
	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	.breadcrumb-item {
		padding: 0.375rem 0.75rem;
		background: #374151;
		border: none;
		border-radius: 0.375rem;
		color: #9ca3af;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.breadcrumb-item:hover {
		background: #4b5563;
		color: white;
	}

	.breadcrumb-item.root {
		padding: 0.375rem 0.5rem;
	}

	.breadcrumb-item.current {
		background: #3b82f6;
		color: white;
	}

	.breadcrumb-separator {
		color: #4b5563;
		font-size: 0.75rem;
	}

	.nav-up-btn {
		padding: 0.375rem 0.5rem;
		background: #374151;
		border: none;
		border-radius: 0.375rem;
		color: #9ca3af;
		cursor: pointer;
		margin-left: 0.5rem;
	}

	.nav-up-btn:hover {
		background: #4b5563;
		color: white;
	}

	/* Table Dropdown */
	.table-dropdown {
		position: relative;
		flex-shrink: 0;
	}

	.table-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: white;
		font-size: 0.875rem;
		cursor: pointer;
		min-width: 160px;
	}

	.table-selector:hover {
		background: #4b5563;
	}

	.dropdown-arrow {
		margin-left: auto;
		transition: transform 0.2s;
	}

	.dropdown-arrow.open {
		transform: rotate(180deg);
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 0.5rem;
		background: #1f2937;
		border: 1px solid #374151;
		border-radius: 0.5rem;
		min-width: 280px;
		z-index: 50;
		box-shadow: 0 10px 25px rgba(0,0,0,0.3);
		max-height: 400px;
		overflow-y: auto;
	}

	.dropdown-section {
		padding: 0.5rem;
	}

	.dropdown-header {
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		color: #6b7280;
		font-weight: 600;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: transparent;
		border: none;
		color: #d1d5db;
		font-size: 0.875rem;
		cursor: pointer;
		border-radius: 0.375rem;
		text-align: left;
	}

	.dropdown-item:hover {
		background: #374151;
		color: white;
	}

	.dropdown-item.selected {
		background: #3b82f6;
		color: white;
	}

	.dropdown-item .table-key {
		margin-left: auto;
		font-size: 0.75rem;
		color: #6b7280;
	}

	.dropdown-item.selected .table-key {
		color: rgba(255,255,255,0.7);
	}

	.custom-section {
		border-top: 1px solid #374151;
	}

	.custom-input-wrapper {
		display: flex;
		gap: 0.5rem;
		padding: 0 0.5rem;
	}

	.custom-input-wrapper input {
		flex: 1;
		padding: 0.5rem;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.375rem;
		color: white;
		font-size: 0.875rem;
	}

	.custom-go-btn {
		padding: 0.5rem 0.75rem;
		background: #3b82f6;
		border: none;
		border-radius: 0.375rem;
		color: white;
		cursor: pointer;
	}

	/* Search Box */
	.search-box {
		flex: 1;
		max-width: 400px;
		position: relative;
	}

	.search-box input {
		width: 100%;
		padding: 0.5rem 2.5rem 0.5rem 2.25rem;
		background: #374151;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: white;
		font-size: 0.875rem;
	}

	.search-box input::placeholder {
		color: #6b7280;
	}

	.search-box input:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
	}

	.search-icon {
		position: absolute;
		left: 0.75rem;
		top: 50%;
		transform: translateY(-50%);
		color: #6b7280;
	}

	.clear-search {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		padding: 0.25rem;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
	}

	.clear-search:hover {
		color: white;
	}

	/* Stats */
	.stats {
		flex-shrink: 0;
	}

	.stat {
		font-size: 0.875rem;
		color: #9ca3af;
	}

	.stat strong {
		color: white;
		font-weight: 600;
	}

	.stat-label {
		color: #6b7280;
	}

	/* Content */
	.content {
		padding: 1.5rem;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
	}

	.empty-icon {
		font-size: 3rem;
		color: #4b5563;
		margin-bottom: 1rem;
	}

	.empty-state h3 {
		font-size: 1.25rem;
		margin-bottom: 0.5rem;
	}

	.empty-state p {
		color: #6b7280;
		margin-bottom: 1.5rem;
	}

	/* Cards Grid */
	.cards-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1rem;
	}

	.card {
		background: #1f2937;
		border-radius: 0.75rem;
		overflow: hidden;
		border: 1px solid #374151;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: #111827;
		border-bottom: 1px solid #374151;
	}

	.card-id {
		font-family: monospace;
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.card-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.status-badge {
		padding: 0.125rem 0.5rem;
		font-size: 0.625rem;
		border-radius: 9999px;
		text-transform: uppercase;
		font-weight: 600;
	}

	.status-open { background: #059669; }
	.status-in_progress { background: #2563eb; }
	.status-completed { background: #7c3aed; }

	.card-action {
		padding: 0.375rem;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
		border-radius: 0.25rem;
	}

	.card-action:hover {
		background: #374151;
		color: white;
	}

	.card-action.danger:hover {
		background: #dc2626;
	}

	.card-body {
		padding: 1rem;
	}

	/* Fields */
	.field {
		margin-bottom: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #374151;
	}

	.field:last-of-type {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}

	.field-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.field-name {
		font-size: 0.75rem;
		font-weight: 600;
		color: #60a5fa;
	}

	.field-edit {
		padding: 0.25rem;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
		font-size: 0.75rem;
	}

	.field-edit:hover {
		color: #60a5fa;
	}

	.field-value {
		font-size: 0.875rem;
		color: #d1d5db;
		word-break: break-word;
	}

	.field-value.nested {
		background: #111827;
		border-radius: 0.375rem;
		padding: 0.5rem;
		margin-top: 0.25rem;
	}

	.field-value pre {
		margin: 0;
		font-size: 0.75rem;
		white-space: pre-wrap;
		color: #9ca3af;
	}

	.field-editor {
		margin-top: 0.5rem;
	}

	.field-editor textarea {
		width: 100%;
		padding: 0.5rem;
		background: #111827;
		border: 1px solid #4b5563;
		border-radius: 0.375rem;
		color: white;
		font-family: monospace;
		font-size: 0.875rem;
		resize: vertical;
	}

	.field-editor-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	/* Array Items */
	.array-items {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.array-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem;
		background: #1f2937;
		border-radius: 0.25rem;
	}

	.array-index {
		font-size: 0.625rem;
		color: #6b7280;
		min-width: 1.5rem;
	}

	.array-content {
		flex: 1;
		font-size: 0.75rem;
	}

	.array-content code {
		background: transparent;
		color: #9ca3af;
	}

	.array-actions {
		display: flex;
		gap: 0.25rem;
	}

	.array-actions button {
		padding: 0.25rem;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
		font-size: 0.625rem;
	}

	.array-actions button:hover {
		color: white;
	}

	.add-array-item {
		padding: 0.375rem;
		background: transparent;
		border: 1px dashed #4b5563;
		border-radius: 0.25rem;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
		text-align: center;
	}

	.add-array-item:hover {
		border-color: #60a5fa;
		color: #60a5fa;
	}

	.expand-btn, .collapse-btn {
		padding: 0.25rem 0.5rem;
		background: transparent;
		border: none;
		color: #60a5fa;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.collapse-btn {
		margin-top: 0.5rem;
		color: #6b7280;
	}

	/* Gun Link */
	.gun-link {
		background: #1e3a5f;
		border: none;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		color: #60a5fa;
		font-size: 0.75rem;
		cursor: pointer;
		font-family: monospace;
	}

	.gun-link:hover {
		background: #2563eb;
		color: white;
	}

	/* Add Field */
	.add-field-btn {
		width: 100%;
		padding: 0.5rem;
		background: transparent;
		border: 1px dashed #4b5563;
		border-radius: 0.375rem;
		color: #6b7280;
		font-size: 0.75rem;
		cursor: pointer;
		margin-top: 0.75rem;
	}

	.add-field-btn:hover {
		border-color: #60a5fa;
		color: #60a5fa;
	}

	.add-field-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: #111827;
		border-radius: 0.375rem;
	}

	.add-field-form input {
		padding: 0.5rem;
		background: #1f2937;
		border: 1px solid #4b5563;
		border-radius: 0.25rem;
		color: white;
		font-size: 0.875rem;
	}

	.add-field-actions {
		display: flex;
		gap: 0.5rem;
	}

	/* Modal */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: #1f2937;
		border-radius: 0.75rem;
		width: 90%;
		max-width: 500px;
		max-height: 90vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #374151;
	}

	.modal-header h3 {
		margin: 0;
		font-size: 1.125rem;
	}

	.modal-close {
		padding: 0.5rem;
		background: transparent;
		border: none;
		color: #6b7280;
		cursor: pointer;
	}

	.modal-close:hover {
		color: white;
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
	}

	.modal-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		border-top: 1px solid #374151;
	}

	.form-group {
		margin-bottom: 1rem;
	}

	.form-group:last-child {
		margin-bottom: 0;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: 0.75rem;
		background: #111827;
		border: 1px solid #4b5563;
		border-radius: 0.5rem;
		color: white;
		font-size: 0.875rem;
	}

	.form-group textarea {
		font-family: monospace;
		resize: vertical;
	}

	/* Buttons */
	.btn {
		padding: 0.625rem 1.25rem;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		transition: all 0.2s;
	}

	.btn-sm {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
	}

	.btn-primary {
		background: #3b82f6;
		color: white;
	}

	.btn-primary:hover {
		background: #2563eb;
	}

	.btn-secondary {
		background: #374151;
		color: white;
	}

	.btn-secondary:hover {
		background: #4b5563;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.header {
			flex-direction: column;
			gap: 1rem;
			align-items: stretch;
		}

		.header-left {
			flex-direction: column;
			align-items: stretch;
		}

		.header-right {
			justify-content: flex-end;
		}

		.nav-bar {
			flex-wrap: wrap;
		}

		.search-box {
			order: 3;
			max-width: none;
			flex-basis: 100%;
		}

		.cards-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
