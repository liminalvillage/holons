<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { settingsStore, settingsHelpers, supportedLanguages } from '../stores/settings';
  import { nameMap, resolvedName, resolveName, forceRefresh, setName } from '$lib/stores/nameResolver';
  import { registerName as hnsRegister } from '$lib/hns';
  import { nostrStore } from '$lib/stores/nostr';
  import TitleBar from './shared/TitleBar.svelte';
  import { Plus } from 'svelte-feathers';

  // Types
  interface User {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
  }
  interface Settings {
    id: string | null;
    name: string;
    hex: string;
    version: number;
    timezone: string;
    language: string;
    theme: string;
    level: number;
    admin: string;
    roles: string[];
    values: string[];
    purpose: string;
    domains: string[];
    currencies: string[];
    maxTasks: number;
    users: User[];
  }

  export let holonId: string;

  let holosphere: any;
  let loading = true;
  let error: string | null = null;
  $: holonName = resolvedName(holonId, $nameMap, null, 'Settings');
  let notifications: Array<{id: number, message: string, type: string}> = [];
  let notificationId = 0;

  function getDefaultSettings(id: string): Settings {
    return {
      id,
      name: '',
      hex: '',
      version: 1.0,
      timezone: '',
      language: 'en',
      theme: 'green',
      level: 1,
      admin: '',
      roles: [],
      values: [],
      purpose: '',
      domains: [],
      currencies: [],
      maxTasks: 13,
      users: []
    };
  }

  let settings: Settings = getDefaultSettings('');

  // UI state
  let activeSection: string = 'general';
  let editMode: Record<string, boolean> = {};
  let newItemInputs: Record<string, string> = {};
  let realUserCount: number = 0;
  let realUsers: User[] = [];

  // Use the expanded language list from the store
  const languages = supportedLanguages;
  const themes = [
    { id: 'light', name: 'Light', icon: '☀️', description: 'Clean and bright interface with light colors' },
    { id: 'dark', name: 'Dark', icon: '🌙', description: 'Dark interface for reduced eye strain' },
    { id: 'green', name: 'Green', icon: '🌿', description: 'Natural green theme inspired by nature' }
  ];
  const timezones = {
    'Europe': [
      'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Europe/Rome', 'Europe/Madrid', 'Europe/Moscow'
    ],
    'Americas': [
      'America/New_York', 'America/Chicago', 'America/Denver',
      'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo'
    ],
    'Asia/Pacific': [
      'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
      'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland'
    ]
  };
  const maxTaskOptions = [0, 3, 5, 8, 13, 21, 34];

  // Notification helpers
  function showNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
    const id = notificationId++;
    notifications = [...notifications, { id, message, type }];
    setTimeout(() => {
      notifications = notifications.filter(n => n.id !== id);
    }, 3000);
  }
  function removeNotification(id: number) {
    notifications = notifications.filter(n => n.id !== id);
  }

  // Holosphere logic
  async function loadSettings() {
    try {
      loading = true;
      const data = await holosphere.getAll(holonId, 'settings');
      
      if (data && data[0]) {
        settings = { ...getDefaultSettings(holonId), ...data[0] };
      } else {
        settings = getDefaultSettings(holonId);
      }

      // Back-fill name from nameMap if loaded name is empty (handles relay propagation delay)
      if (!settings.name && $nameMap[holonId]) {
        settings.name = $nameMap[holonId];
      }

      // Update the global settings store
      settingsStore.set(settings);
      
      // Fetch real user count from holosphere
      await fetchRealUserCount();
      
    } catch (err) {
      console.error('Error loading settings:', err);
      error = 'Failed to load settings';
    } finally {
      loading = false;
    }
  }

  async function fetchRealUserCount() {
    try {
      const users = await holosphere.getAll(holonId, 'users');
      if (Array.isArray(users)) {
        realUserCount = users.length;
        realUsers = users;
      } else if (typeof users === 'object' && users !== null) {
        realUserCount = Object.keys(users).length;
        realUsers = Object.values(users);
      } else {
        realUserCount = 0;
        realUsers = [];
      }
    } catch (err) {
      console.error('Error fetching user count:', err);
      realUserCount = 0;
      realUsers = [];
    }
  }

  async function saveSettings() {
    try {
      if (!holosphere || !holonId) throw new Error('Holosphere or holonId missing');

      // Save settings to holonId/settings/holonId with the holonId as the key
      const settingsToSave = { ...settings, id: holonId };
      console.log('Saving settings to holosphere:', settingsToSave);

      await holosphere.put(holonId, 'settings', settingsToSave);

      // Update HNS if user owns this holon (has matching private key)
      const state = nostrStore.getState();
      if (state.privateKey && state.publicKey === holonId && settings.name) {
        try {
          await hnsRegister(holosphere, holonId, settings.name, state.privateKey);
          console.log('Updated HNS with new name:', settings.name);
        } catch (error) {
          console.warn('Failed to update HNS (local settings saved):', error);
        }
      }

      // Directly update the reactive name store and cache with the new name
      // (avoids relay round-trip race from forceRefresh)
      if (settings.name) {
        setName(holonId, settings.name);
      } else {
        forceRefresh(holonId);
      }

      // Dispatch event to update the name in TopBar and sidebar
      window.dispatchEvent(new CustomEvent('holonNameUpdated', {
        detail: { holonId, newName: settings.name }
      }));

      showNotification('Settings saved successfully!', 'success');
    } catch (err) {
      console.error('Error saving settings:', err);
      showNotification('Failed to save settings', 'error');
    }
  }

  async function resetSettings() {
    try {
      if (!holosphere || !holonId) throw new Error('Holosphere or holonId missing');
      settings = getDefaultSettings(holonId);

      // Save reset settings to holonId/settings/holonId
      const settingsToSave = { ...settings, id: holonId };
      console.log('Resetting settings in holosphere:', settingsToSave);

      await holosphere.put(holonId, 'settings', settingsToSave);

      // Clear the cached holon name to force refresh (will show fallback)
      forceRefresh(holonId);

      // Dispatch event to update the name in TopBar and MyHolons
      window.dispatchEvent(new CustomEvent('holonNameUpdated', {
        detail: { holonId, newName: settings.name || `Holon ${holonId}` }
      }));

      showNotification('Settings reset to defaults!', 'success');
    } catch (err) {
      console.error('Error resetting settings:', err);
      showNotification('Failed to reset settings', 'error');
    }
  }

  // React to holonId changes
  $: if (holonId) {
    holosphere = getContext('holosphere');
    loadSettings();
    // Resolve holon name reactively
    resolveName(holonId);
  }

  // UI logic - updated to use settings store
  function updateSetting(key, value) {
    settings = {
      ...settings,
      [key]: value
    };
    
    // Update the global settings store
    settingsHelpers.updateSetting(key, value);
    
    saveSettings();
  }
  function addArrayItem(arrayName, item) {
    if (item.trim() && !settings[arrayName].includes(item.trim())) {
      settings = {
        ...settings,
        [arrayName]: [...settings[arrayName], item.trim()]
      };
      newItemInputs[arrayName] = '';
      saveSettings();
    }
  }
  function removeArrayItem(arrayName, index) {
    settings = {
      ...settings,
      [arrayName]: settings[arrayName].filter((_, i) => i !== index)
    };
    saveSettings();
  }
  function addMultipleItems(arrayName, text) {
    const items = text.split(/[\,\n]/)
      .map(item => item.trim())
      .filter(item => item && !settings[arrayName].includes(item));
    settings = {
      ...settings,
      [arrayName]: [...settings[arrayName], ...items]
    };
    newItemInputs[arrayName] = '';
    saveSettings();
  }

  function setAdmin(userId) {
    if (userId === undefined || userId === null) {
      console.warn('setAdmin called with undefined userId');
      return;
    }
    settings = {
      ...settings,
      admin: userId.toString()
    };
    saveSettings();
  }
  function getSettingIcon(type) {
    const icons = {
      values: '💫',
      domains: '🗺️',
      roles: '👥',
      purpose: '🎯',
      language: '🌐',
      theme: '🎨',
      timezone: '🕒',
      admin: '👑',
      users: '👪',
      hex: '✡️',
      level: '📊',
      maxTasks: '📋'
    };
    return icons[type] || '⚙️';
  }
  function formatTimezone(timezone) {
    return timezone ? timezone.split('/')[1].replace('_', ' ') : 'Not set';
  }
</script>

<!-- Settings Container with proper scroll -->
<div class="space-y-4 min-h-0 pb-8">

<!-- TitleBar -->
<TitleBar {holonName} {holonId} title="Settings" />

	<!-- Loading/Error/Notification UI -->
	{#if loading}
		<div class="flex items-center justify-center py-12">
			<div class="text-center">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
				<p class="text-gray-400">Loading settings...</p>
			</div>
		</div>
	{:else if error}
		<div class="flex items-center justify-center py-12">
			<div class="text-center">
				<div class="text-4xl mb-4">⚠️</div>
				<h3 class="text-white text-lg font-medium mb-2">Error Loading Settings</h3>
				<p class="text-gray-400 mb-4">{error}</p>
				<button class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors" onclick={loadSettings}>
					🔄 Try Again
				</button>
			</div>
		</div>
	{/if}

	<!-- Notifications -->
	{#if notifications.length > 0}
		<div class="fixed top-5 right-5 z-50 flex flex-col gap-2">
			{#each notifications as notification (notification.id)}
				<div class="flex items-center justify-between p-4 rounded-xl shadow-lg max-w-sm {notification.type === 'success' ? 'bg-green-500 text-white' : notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-blue-500 text-white'}">
					<span class="text-sm font-medium">{notification.message}</span>
					<button 
						class="ml-3 text-white hover:text-gray-200 transition-colors" 
						onclick={() => removeNotification(notification.id)}
					>
						×
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if !loading && !error}
		<!-- Stats Bar -->
		<div class="stats-bar mb-6">
			<div class="stats-bar__item stats-bar__item--info">
				<span class="stats-bar__value">{realUserCount}</span>
				<span class="stats-bar__label">Users</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item">
				<span class="stats-bar__value">{settings.values.length}</span>
				<span class="stats-bar__label">Values</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item">
				<span class="stats-bar__value">{settings.domains.length}</span>
				<span class="stats-bar__label">Domains</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--warning">
				<span class="stats-bar__value">{settings.maxTasks}</span>
				<span class="stats-bar__label">Max Tasks</span>
			</div>
		</div>

		<!-- Settings Sections -->
		<div class="space-y-8">
					<!-- General Settings -->
					<section class="bg-gray-700/50 rounded-2xl p-8">
						<h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">🏠 General Settings</h2>
						
						<!-- Holon Identity -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">🆔 Holon Identity</h3>
							
							<div class="space-y-4">
								<div>
									<div class="text-sm font-medium text-gray-300 mb-2">Holon ID</div>
									<div class="px-4 py-3 bg-gray-600 text-gray-300 rounded-xl font-mono">
										{settings.id || 'Not set'}
									</div>
								</div>

								<div>
									<label for="holon-name" class="block text-sm font-medium text-gray-300 mb-2">Name</label>
									<input 
										id="holon-name"
										type="text" 
										bind:value={settings.name}
										onblur={() => updateSetting('name', settings.name)}
										onkeydown={(e) => e.key === 'Enter' && updateSetting('name', settings.name)}
										placeholder="Enter holon name"
										class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
								</div>

								<div>
									<label for="holon-hex" class="block text-sm font-medium text-gray-300 mb-2">Hex Address</label>
									<input 
										id="holon-hex"
										type="text" 
										bind:value={settings.hex}
										onblur={() => updateSetting('hex', settings.hex)}
										placeholder="Enter hex address"
										class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
								</div>
							</div>
						</div>

						<!-- Localization -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">🌐 Localization</h3>
							
							<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div>
									<label class="block text-sm font-medium text-gray-300 mb-2" for="language-select">
										Language 
										<span class="text-xs text-gray-400">(affects entire app translation)</span>
									</label>
									<select 
										id="language-select"
										class="w-full p-3 bg-gray-700 border border-gray-600 rounded-xl text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
										bind:value={settings.language}
										onchange={(e) => updateSetting('language', e.target.value)}
									>
										{#each supportedLanguages as lang}
											<option value={lang.code}>
												{lang.flag} {lang.name}
											</option>
										{/each}
									</select>
								</div>

								<div>
									<label for="holon-timezone" class="block text-sm font-medium text-gray-300 mb-2">Timezone</label>
									<select id="holon-timezone" bind:value={settings.timezone} onchange={() => updateSetting('timezone', settings.timezone)} class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors">
										<option value="">Select timezone</option>
										{#each Object.entries(timezones) as [region, tzs]}
											<optgroup label={region}>
												{#each tzs as tz}
													<option value={tz}>{formatTimezone(tz)}</option>
												{/each}
											</optgroup>
										{/each}
									</select>
								</div>
							</div>
						</div>

						<!-- Appearance -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">🎨 Appearance</h3>
							<div>
								<label for="holon-theme" class="block text-sm font-medium text-gray-300 mb-2">Theme <span class="text-xs text-gray-400">(for Telegram bot only)</span></label>
								<div class="flex gap-2 flex-wrap">
									{#each themes as theme}
										<button 
											class="px-4 py-3 rounded-xl border-2 transition-all duration-200 {settings.theme === theme.id ? 'border-blue-500 bg-blue-500/20 text-white' : 'border-gray-500 bg-gray-600 text-gray-300 hover:border-gray-400 hover:bg-gray-500'}"
											onclick={() => updateSetting('theme', theme.id)}
											title={theme.description}
										>
											{theme.icon} {theme.name}
										</button>
									{/each}
								</div>
							</div>
						</div>

						<!-- Limits -->
						<div>
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">📋 Task Limits</h3>
							
							<div>
								<label for="holon-max-tasks" class="block text-sm font-medium text-gray-300 mb-2">Maximum Tasks</label>
								<select id="holon-max-tasks" bind:value={settings.maxTasks} onchange={() => updateSetting('maxTasks', settings.maxTasks)} class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors">
									{#each maxTaskOptions as option}
										<option value={option}>
											{option === 0 ? 'Unlimited' : option}
										</option>
									{/each}
								</select>
							</div>
						</div>
					</section>

					<!-- Community Settings -->
					<section class="bg-gray-700/50 rounded-2xl p-8">
						<h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">👥 Community Settings</h2>

						<!-- Purpose -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">🎯 Purpose</h3>
							<textarea 
								bind:value={settings.purpose}
								onblur={() => updateSetting('purpose', settings.purpose)}
								placeholder="Define your holon's purpose..."
								rows="3"
								class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors resize-none"
							></textarea>
						</div>

						<!-- Values -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">💫 Values ({settings.values.length})</h3>
							<div class="space-y-4">
								<div class="flex gap-2">
									<input 
										type="text" 
										bind:value={newItemInputs.values}
										placeholder="Add values (comma-separated)"
										onkeydown={(e) => e.key === 'Enter' && addMultipleItems('values', newItemInputs.values)}
										class="flex-1 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
									<button onclick={() => addMultipleItems('values', newItemInputs.values)} class="btn btn--primary"><Plus size={16} />Add</button>
								</div>
								<div class="space-y-2">
									{#each settings.values as value, i}
										<div class="flex items-center justify-between p-3 bg-gray-600 rounded-xl">
											<span class="text-white">• {value}</span>
											<button class="text-red-400 hover:text-red-300 transition-colors" onclick={() => removeArrayItem('values', i)}>❌</button>
										</div>
									{/each}
								</div>
							</div>
						</div>

						<!-- Domains -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">🗺️ Domains ({settings.domains.length})</h3>
							<div class="space-y-4">
								<div class="flex gap-2">
									<input 
										type="text" 
										bind:value={newItemInputs.domains}
										placeholder="Add domains (comma-separated)"
										onkeydown={(e) => e.key === 'Enter' && addMultipleItems('domains', newItemInputs.domains)}
										class="flex-1 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
									<button onclick={() => addMultipleItems('domains', newItemInputs.domains)} class="btn btn--primary"><Plus size={16} />Add</button>
								</div>
								<div class="space-y-2">
									{#each settings.domains as domain, i}
										<div class="flex items-center justify-between p-3 bg-gray-600 rounded-xl">
											<span class="text-white">• {domain}</span>
											<button class="text-red-400 hover:text-red-300 transition-colors" onclick={() => removeArrayItem('domains', i)}>❌</button>
										</div>
									{/each}
								</div>
							</div>
						</div>

						<!-- Roles -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">👥 Roles ({settings.roles.length})</h3>
							<div class="space-y-4">
								<div class="flex gap-2">
									<input 
										type="text" 
										bind:value={newItemInputs.roles}
										placeholder="Add roles (comma-separated)"
										onkeydown={(e) => e.key === 'Enter' && addMultipleItems('roles', newItemInputs.roles)}
										class="flex-1 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
									<button onclick={() => addMultipleItems('roles', newItemInputs.roles)} class="btn btn--primary"><Plus size={16} />Add</button>
								</div>
								<div class="space-y-2">
									{#each settings.roles as role, i}
										<div class="flex items-center justify-between p-3 bg-gray-600 rounded-xl">
											<span class="text-white">• {role}</span>
											<button class="text-red-400 hover:text-red-300 transition-colors" onclick={() => removeArrayItem('roles', i)}>❌</button>
										</div>
									{/each}
								</div>
							</div>
						</div>

						<!-- Currencies -->
						<div class="mb-6">
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">💱 Currencies ({settings.currencies.length})</h3>
							<div class="space-y-4">
								<div class="flex gap-2">
									<input 
										type="text" 
										bind:value={newItemInputs.currencies}
										placeholder="Add currencies (singular form, e.g., euro, dollar)"
										onkeydown={(e) => e.key === 'Enter' && addMultipleItems('currencies', newItemInputs.currencies)}
										class="flex-1 px-4 py-3 rounded-xl bg-gray-600 text-white placeholder-gray-400 border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
									/>
									<button onclick={() => addMultipleItems('currencies', newItemInputs.currencies)} class="btn btn--primary"><Plus size={16} />Add</button>
								</div>
								<div class="space-y-2">
									{#each settings.currencies as currency, i}
										<div class="flex items-center justify-between p-3 bg-gray-600 rounded-xl">
											<span class="text-white">• {currency}</span>
											<button class="text-red-400 hover:text-red-300 transition-colors" onclick={() => removeArrayItem('currencies', i)}>❌</button>
										</div>
									{/each}
								</div>
							</div>
						</div>

						<!-- Users & Admin -->
						<div>
							<h3 class="text-lg font-semibold text-white mb-4 flex items-center gap-2">👪 Users & Administration</h3>
							
							<!-- User Count -->
							<div class="mb-2 text-sm text-gray-400">Total users in holon: <span class="font-bold text-white">{realUserCount}</span></div>

							<!-- Admin Selection -->
							<div class="mb-4">
								<label for="holon-admin" class="block text-sm font-medium text-gray-300 mb-2">Administrator</label>
								<select id="holon-admin" bind:value={settings.admin} onchange={() => updateSetting('admin', settings.admin)} class="w-full px-4 py-3 rounded-xl bg-gray-600 text-white border border-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors">
									<option value="">Select admin</option>
									{#each realUsers as user}
										<option value={user.id || user.username}>{user.first_name || user.username || `User ${user.id}`}</option>
									{/each}
								</select>
							</div>

							<!-- User List (Read-only) -->
							<div class="space-y-2">
								<h4 class="text-sm font-medium text-gray-300 mb-3">Users in Holon</h4>
								{#each realUsers as user}
									<div class="flex items-center justify-between p-3 bg-gray-600 rounded-xl">
										<span class="text-white">
											👤 {user.first_name || user.username || `User ${user.id}`}
											{#if settings.admin === (user.id || user.username)}
												<span class="ml-2 px-2 py-1 bg-yellow-500 text-white text-xs rounded-md">👑 Admin</span>
											{/if}
										</span>
										<div class="flex gap-2">
											{#if settings.admin !== (user.id || user.username)}
												<button class="text-yellow-400 hover:text-yellow-300 transition-colors" onclick={() => setAdmin(user.id || user.username)} title="Make admin">👑</button>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					</section>
				</div>
			{/if}
</div>

<style>
	/* Responsive design */
	@media (max-width: 768px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
		
		.flex {
			flex-direction: column;
		}
		
		.gap-2 {
			gap: 0.5rem;
		}
	}
</style> 