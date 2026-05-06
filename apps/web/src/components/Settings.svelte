<script lang="ts">
  import { onMount, getContext } from 'svelte';
  import { settingsStore, settingsHelpers, supportedLanguages } from '../stores/settings';
  import { nameMap, resolvedName, resolveName, forceRefresh, setName } from '$lib/stores/nameResolver';
  import { registerName as hnsRegister } from '$lib/hns';
  import { nostrStore } from '$lib/stores/nostr';
  import TitleBar from './shared/TitleBar.svelte';
  import Modal from './shared/Modal.svelte';
  import HexPicker from './shared/HexPicker.svelte';
  import {
    Plus,
    Settings as SettingsIcon,
    Users as UsersIcon,
    Globe as GlobeIcon,
    Map as MapIcon,
    X as XIcon
  } from 'svelte-feathers';

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
  type TabId = 'general' | 'community' | 'members';
  let activeTab: TabId = 'general';
  let newItemInputs: Record<string, string> = {};
  let realUserCount: number = 0;
  let realUsers: User[] = [];
  let hexPickerOpen = false;

  const tabs: Array<{ id: TabId; label: string; icon: any }> = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'community', label: 'Community', icon: GlobeIcon },
    { id: 'members', label: 'Members', icon: UsersIcon }
  ];

  // Use the expanded language list from the store
  const themes = [
    { id: 'light', name: 'Light', icon: '☀️', description: 'Clean and bright interface' },
    { id: 'dark', name: 'Dark', icon: '🌙', description: 'Dark interface for reduced eye strain' },
    { id: 'green', name: 'Green', icon: '🌿', description: 'Natural green theme' }
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

      const settingsToSave = { ...settings, id: holonId };
      await holosphere.put(holonId, 'settings', settingsToSave);

      // Update HNS if user owns this holon (has matching private key)
      const state = nostrStore.getState();
      if (state.privateKey && state.publicKey === holonId && settings.name) {
        try {
          await hnsRegister(holosphere, holonId, settings.name, state.privateKey);
        } catch (error) {
          console.warn('Failed to update HNS (local settings saved):', error);
        }
      }

      // Update reactive name store directly to avoid relay round-trip race.
      if (settings.name) {
        setName(holonId, settings.name);
      } else {
        forceRefresh(holonId);
      }

      window.dispatchEvent(new CustomEvent('holonNameUpdated', {
        detail: { holonId, newName: settings.name }
      }));

      showNotification('Settings saved', 'success');
    } catch (err) {
      console.error('Error saving settings:', err);
      showNotification('Failed to save settings', 'error');
    }
  }

  // React to holonId changes
  $: if (holonId) {
    holosphere = getContext('holosphere');
    loadSettings();
    resolveName(holonId);
  }

  // UI logic
  function updateSetting(key: keyof Settings, value: any) {
    settings = { ...settings, [key]: value };
    settingsHelpers.updateSetting(key as any, value);
    saveSettings();
  }
  function removeArrayItem(arrayName: keyof Settings, index: number) {
    settings = {
      ...settings,
      [arrayName]: (settings[arrayName] as any[]).filter((_, i) => i !== index)
    };
    saveSettings();
  }
  function addMultipleItems(arrayName: keyof Settings, text: string) {
    if (!text) return;
    const existing = settings[arrayName] as string[];
    const items = text.split(/[\,\n]/)
      .map(item => item.trim())
      .filter(item => item && !existing.includes(item));
    if (!items.length) {
      newItemInputs[arrayName as string] = '';
      return;
    }
    settings = { ...settings, [arrayName]: [...existing, ...items] };
    newItemInputs[arrayName as string] = '';
    saveSettings();
  }

  function setAdmin(userId: string | number) {
    if (userId === undefined || userId === null) return;
    settings = { ...settings, admin: userId.toString() };
    saveSettings();
  }

  function formatTimezone(timezone: string) {
    return timezone ? timezone.split('/')[1].replace('_', ' ') : 'Not set';
  }

  function handleHexSelect(e: CustomEvent<{ hex: string }>) {
    settings = { ...settings, hex: e.detail.hex };
    hexPickerOpen = false;
    saveSettings();
  }
</script>

<div class="space-y-4 pb-8">
  <TitleBar {holonName} {holonId} title="Settings" icon={SettingsIcon} />

  {#if loading}
    <div class="settings-state">
      <div class="settings-state__spinner"></div>
      <p>Loading settings…</p>
    </div>
  {:else if error}
    <div class="settings-state">
      <div class="settings-state__icon">⚠️</div>
      <h3>Error Loading Settings</h3>
      <p>{error}</p>
      <button class="btn btn--primary" on:click={loadSettings}>Try Again</button>
    </div>
  {:else}
    <div class="w-full bg-gray-800 p-4 sm:p-6 rounded-2xl">
      <!-- Stats Bar -->
      <div class="stats-bar mb-4">
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
          <span class="stats-bar__value">{settings.maxTasks || '∞'}</span>
          <span class="stats-bar__label">Max Tasks</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="settings-tabs" role="tablist" aria-label="Settings sections">
        {#each tabs as tab}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            class="settings-tabs__btn"
            class:settings-tabs__btn--active={activeTab === tab.id}
            on:click={() => (activeTab = tab.id)}
          >
            <svelte:component this={tab.icon} size="14" />
            <span>{tab.label}</span>
          </button>
        {/each}
      </div>

      <!-- Tab content -->
      <div class="settings-content">
        {#if activeTab === 'general'}
          <!-- Identity -->
          <section class="settings-section">
            <h3 class="settings-section__title">Identity</h3>

            <div class="settings-field">
              <span class="settings-field__label">Holon ID</span>
              <code class="settings-field__readonly">{settings.id || 'Not set'}</code>
            </div>

            <div class="settings-field">
              <label for="holon-name" class="settings-field__label">Name</label>
              <input
                id="holon-name"
                type="text"
                class="input"
                bind:value={settings.name}
                on:blur={() => updateSetting('name', settings.name)}
                on:keydown={(e) => e.key === 'Enter' && updateSetting('name', settings.name)}
                placeholder="Enter holon name"
              />
            </div>

            <div class="settings-field">
              <span class="settings-field__label">Hex Address</span>
              <button type="button" class="hex-field" on:click={() => (hexPickerOpen = true)}>
                <MapIcon size="14" />
                {#if settings.hex}
                  <code class="hex-field__value" title={settings.hex}>{settings.hex}</code>
                {:else}
                  <span class="hex-field__placeholder">Pick a hex on the map…</span>
                {/if}
                <span class="hex-field__action">{settings.hex ? 'Change' : 'Pick'}</span>
              </button>
              {#if settings.hex}
                <button
                  type="button"
                  class="settings-field__inline-clear"
                  on:click={() => updateSetting('hex', '')}
                  title="Clear hex"
                >
                  <XIcon size="12" /> clear
                </button>
              {/if}
            </div>
          </section>

          <!-- Localization -->
          <section class="settings-section">
            <h3 class="settings-section__title">Localization</h3>
            <div class="settings-grid">
              <div class="settings-field">
                <label for="language-select" class="settings-field__label">
                  Language
                  <span class="settings-field__hint">affects entire app translation</span>
                </label>
                <select
                  id="language-select"
                  class="input"
                  bind:value={settings.language}
                  on:change={(e) => updateSetting('language', (e.target as HTMLSelectElement).value)}
                >
                  {#each supportedLanguages as lang}
                    <option value={lang.code}>{lang.flag} {lang.name}</option>
                  {/each}
                </select>
              </div>

              <div class="settings-field">
                <label for="holon-timezone" class="settings-field__label">Timezone</label>
                <select
                  id="holon-timezone"
                  class="input"
                  bind:value={settings.timezone}
                  on:change={() => updateSetting('timezone', settings.timezone)}
                >
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
          </section>

          <!-- Appearance -->
          <section class="settings-section">
            <h3 class="settings-section__title">
              Appearance
              <span class="settings-section__hint">Telegram bot only</span>
            </h3>
            <div class="theme-row">
              {#each themes as theme}
                <button
                  type="button"
                  class="theme-chip"
                  class:theme-chip--active={settings.theme === theme.id}
                  on:click={() => updateSetting('theme', theme.id)}
                  title={theme.description}
                >
                  <span class="theme-chip__icon">{theme.icon}</span>
                  <span>{theme.name}</span>
                </button>
              {/each}
            </div>
          </section>

          <!-- Limits -->
          <section class="settings-section">
            <h3 class="settings-section__title">Task Limits</h3>
            <div class="settings-field">
              <label for="holon-max-tasks" class="settings-field__label">Maximum Tasks</label>
              <select
                id="holon-max-tasks"
                class="input"
                bind:value={settings.maxTasks}
                on:change={() => updateSetting('maxTasks', settings.maxTasks)}
              >
                {#each maxTaskOptions as option}
                  <option value={option}>{option === 0 ? 'Unlimited' : option}</option>
                {/each}
              </select>
            </div>
          </section>

        {:else if activeTab === 'community'}
          <!-- Purpose -->
          <section class="settings-section">
            <h3 class="settings-section__title">Purpose</h3>
            <textarea
              class="input"
              rows="3"
              placeholder="Define your holon's purpose…"
              bind:value={settings.purpose}
              on:blur={() => updateSetting('purpose', settings.purpose)}
            ></textarea>
          </section>

          {#each [
            { key: 'values' as const, label: 'Values', placeholder: 'Add values (comma-separated)' },
            { key: 'domains' as const, label: 'Domains', placeholder: 'Add domains (comma-separated)' },
            { key: 'roles' as const, label: 'Roles', placeholder: 'Add roles (comma-separated)' },
            { key: 'currencies' as const, label: 'Currencies', placeholder: 'Add currencies (singular form)' }
          ] as group}
            <section class="settings-section">
              <h3 class="settings-section__title">
                {group.label}
                <span class="settings-section__count">{settings[group.key].length}</span>
              </h3>
              <div class="chip-input">
                <input
                  type="text"
                  class="input"
                  placeholder={group.placeholder}
                  bind:value={newItemInputs[group.key]}
                  on:keydown={(e) => e.key === 'Enter' && addMultipleItems(group.key, newItemInputs[group.key] || '')}
                />
                <button
                  type="button"
                  class="btn btn--primary"
                  on:click={() => addMultipleItems(group.key, newItemInputs[group.key] || '')}
                >
                  <Plus size="14" /> Add
                </button>
              </div>
              {#if settings[group.key].length}
                <ul class="chip-list">
                  {#each settings[group.key] as item, i}
                    <li class="chip">
                      <span>{item}</span>
                      <button
                        type="button"
                        class="chip__remove"
                        aria-label="Remove {item}"
                        on:click={() => removeArrayItem(group.key, i)}
                      >
                        <XIcon size="12" />
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/each}

        {:else if activeTab === 'members'}
          <section class="settings-section">
            <h3 class="settings-section__title">
              Members
              <span class="settings-section__count">{realUserCount}</span>
            </h3>

            <div class="settings-field">
              <label for="holon-admin" class="settings-field__label">Administrator</label>
              <select
                id="holon-admin"
                class="input"
                bind:value={settings.admin}
                on:change={() => updateSetting('admin', settings.admin)}
              >
                <option value="">Select admin</option>
                {#each realUsers as user}
                  <option value={user.id || user.username}>
                    {user.first_name || user.username || `User ${user.id}`}
                  </option>
                {/each}
              </select>
            </div>

            {#if realUsers.length}
              <ul class="member-list">
                {#each realUsers as user}
                  {@const uid = user.id || user.username}
                  <li class="member">
                    <div class="member__main">
                      <span class="member__avatar">👤</span>
                      <span class="member__name">
                        {user.first_name || user.username || `User ${user.id}`}
                      </span>
                      {#if settings.admin === uid?.toString()}
                        <span class="member__badge">Admin</span>
                      {/if}
                    </div>
                    {#if settings.admin !== uid?.toString()}
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        on:click={() => setAdmin(uid)}
                        title="Make admin"
                      >
                        Make admin
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="empty-state">No members yet.</p>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Notifications -->
  {#if notifications.length > 0}
    <div class="toast-stack">
      {#each notifications as n (n.id)}
        <div class="toast toast--{n.type}">
          <span>{n.message}</span>
          <button on:click={() => removeNotification(n.id)} aria-label="Dismiss">×</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Hex picker popup -->
<Modal bind:open={hexPickerOpen} title="Select Hex Address" size="lg">
  {#if hexPickerOpen}
    <HexPicker
      value={settings.hex}
      on:select={handleHexSelect}
      on:cancel={() => (hexPickerOpen = false)}
    />
  {/if}
</Modal>

<style>
  /* States */
  .settings-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem 1rem;
    color: var(--color-text-secondary, #d1d5db);
  }

  .settings-state__spinner {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    border: 2px solid transparent;
    border-bottom-color: var(--color-accent, #6366f1);
    animation: spin 1s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .settings-state__icon {
    font-size: 2.25rem;
  }

  .settings-state h3 {
    color: var(--color-text-primary, #fff);
    font-weight: 600;
  }

  /* Tabs */
  .settings-tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--color-border, #374151);
    margin-bottom: 1rem;
    overflow-x: auto;
  }

  .settings-tabs__btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.625rem 0.875rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-secondary, #d1d5db);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: color 150ms ease, border-color 150ms ease;
    white-space: nowrap;
  }

  .settings-tabs__btn:hover {
    color: var(--color-text-primary, #fff);
  }

  .settings-tabs__btn--active {
    color: var(--color-text-primary, #fff);
    border-bottom-color: var(--color-accent, #6366f1);
  }

  /* Sections */
  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-section {
    background: rgba(55, 65, 81, 0.4);
    border: 1px solid var(--color-border, #374151);
    border-radius: 0.75rem;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .settings-section__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary, #fff);
    margin: 0;
  }

  .settings-section__hint {
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--color-text-muted, #9ca3af);
  }

  .settings-section__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.25rem;
    padding: 0 0.4rem;
    background: var(--color-bg-tertiary, #374151);
    border-radius: 9999px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-secondary, #d1d5db);
  }

  /* Fields */
  .settings-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  @media (min-width: 640px) {
    .settings-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .settings-field {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .settings-field__label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-text-secondary, #d1d5db);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings-field__hint {
    font-size: 0.7rem;
    color: var(--color-text-muted, #9ca3af);
    font-weight: 400;
  }

  .settings-field__readonly {
    display: block;
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: 0.5rem;
    color: var(--color-text-secondary, #d1d5db);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .settings-field__inline-clear {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.375rem;
    background: transparent;
    border: none;
    color: var(--color-text-muted, #9ca3af);
    font-size: 0.7rem;
    cursor: pointer;
  }

  .settings-field__inline-clear:hover {
    color: var(--color-error, #ef4444);
  }

  /* Hex picker trigger field */
  .hex-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: 0.5rem;
    color: var(--color-text-primary, #fff);
    font-size: 0.875rem;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease;
    text-align: left;
  }

  .hex-field:hover {
    border-color: var(--color-accent, #6366f1);
    background: var(--color-bg-secondary, #1f2937);
  }

  .hex-field__value {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--color-text-primary, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .hex-field__placeholder {
    color: var(--color-text-muted, #9ca3af);
    flex: 1;
    min-width: 0;
  }

  .hex-field__action {
    margin-left: auto;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--color-accent, #6366f1);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Theme chips */
  .theme-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .theme-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.875rem;
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: 9999px;
    color: var(--color-text-secondary, #d1d5db);
    font-size: 0.8125rem;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
  }

  .theme-chip:hover {
    color: var(--color-text-primary, #fff);
    border-color: var(--color-border-light, #4b5563);
  }

  .theme-chip--active {
    color: var(--color-text-primary, #fff);
    border-color: var(--color-accent, #6366f1);
    background: rgba(99, 102, 241, 0.18);
  }

  .theme-chip__icon { line-height: 1; }

  /* Chip input + chip list */
  .chip-input {
    display: flex;
    gap: 0.5rem;
  }

  .chip-input .input { flex: 1; min-width: 0; }

  .chip-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem 0.25rem 0.625rem;
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: 9999px;
    color: var(--color-text-primary, #fff);
    font-size: 0.8125rem;
  }

  .chip__remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    background: transparent;
    border: none;
    color: var(--color-text-muted, #9ca3af);
    cursor: pointer;
  }

  .chip__remove:hover {
    background: var(--color-error, #ef4444);
    color: #fff;
  }

  /* Members */
  .member-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .member {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-primary, #111827);
    border: 1px solid var(--color-border, #374151);
    border-radius: 0.5rem;
  }

  .member__main {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .member__name {
    color: var(--color-text-primary, #fff);
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .member__badge {
    padding: 0.125rem 0.5rem;
    background: rgba(234, 179, 8, 0.2);
    border: 1px solid rgba(234, 179, 8, 0.4);
    border-radius: 9999px;
    color: #fde047;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .empty-state {
    color: var(--color-text-muted, #9ca3af);
    font-size: 0.875rem;
    text-align: center;
    padding: 0.5rem 0;
  }

  /* Toasts */
  .toast-stack {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 0.875rem;
    border-radius: 0.5rem;
    color: #fff;
    font-size: 0.8125rem;
    box-shadow: 0 6px 16px -6px rgba(0, 0, 0, 0.4);
  }

  .toast button {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.85);
    font-size: 1rem;
    cursor: pointer;
  }

  .toast--success { background: #16a34a; }
  .toast--error { background: #dc2626; }
  .toast--info { background: #2563eb; }
</style>
