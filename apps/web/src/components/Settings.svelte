<script lang="ts">
  import { readHolonSettings } from '@holons/core/settings';
  import { onMount, onDestroy, getContext } from 'svelte';
  import { get } from 'svelte/store';
  import { approveJoin, removeSeat, requestToJoin, watchJoinRequests, type JoinRequest } from '@holons/core/holons';
  import {
    completeTelegramLink,
    federateLinkedChat,
    linkedTelegramChats,
    offerTelegramLink,
    unfederateLinkedChat,
    unlinkTelegram,
    watchTelegramLink,
    type LinkAccept,
    type LinkRecord,
  } from '@holons/core/linking';
  import { telegramDeepLinks } from '@holons/core/claims';
  import { isHolonId, isTelegramChatId } from '@holons/core/protocol';
  import { signerFromSecretKey, writeAcceptance } from '@holons/core/holosphere';
  import { nostrPrivateKey } from '$lib/stores/nostr';
  import { telegramUser } from '$lib/stores/telegram';
  import { settingsStore, settingsHelpers, supportedLanguages } from '../stores/settings';
  import { skin, setSkin, accentOverride, setAccent, clearAccent, DEFAULT_ACCENT } from '$lib/stores/skin';

  // Colour-picker value: the active skin's custom accent, or its built-in default.
  $: accentValue = $accentOverride ?? DEFAULT_ACCENT[$skin];
  import { nameMap, resolvedName, resolveName, forceRefresh, setName } from '$lib/stores/nameResolver';
  import { shortId } from '@holons/core/identity';
  import { registerName as hnsRegister } from '$lib/hns';
  import { nostrStore } from '$lib/stores/nostr';
  import {
    addHolonMember,
    foundHolon,
    holonMembers,
    myHolonRole,
    removeHolonMember,
    syncFoundingAuthority,
    type FoundingAuthority
  } from '@holons/core/protocol';
  import { nostrUtils } from 'holosphere';
  import TitleBar from './shared/TitleBar.svelte';
  import Modal from './shared/Modal.svelte';
  // HexPicker pulls in mapbox-gl (~1.9 MB); load it lazily (see {#await} below)
  // so it only downloads when the picker is actually opened.
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
      // Not `getAll(...)[0]`: this component spreads what it reads and saves it
      // straight back, so picking the wrong record (imported calendars, a
      // legacy id-less write) would overwrite the holon's real settings with it.
      const data = await readHolonSettings(holosphere, holonId);

      if (data) {
        settings = { ...getDefaultSettings(holonId), ...data };
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
      // holosphere.getAll resolves to Array<T>.
      const users = (await holosphere.getAll(holonId, 'users')) ?? [];
      realUserCount = users.length;
      realUsers = users;
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

  // ── Members ────────────────────────────────────────────────────────────────
  // Who speaks for this hub (core's rule, @holons/core/protocol founding): a
  // Telegram chat is founded by its bot; a hub started here, or one nobody has
  // founded yet, can be founded by the signed-in member's own key — this
  // instance signs with it — who then seats others by public key.
  let founding: FoundingAuthority | null = null;
  let foundBusy = false;
  let hubKeys: Map<string, 'admin' | 'member'> = new Map();
  let hubRole: 'admin' | 'member' | null = null;
  let keyDraft = '';
  let keyBusy = false;
  // Hubs that seat members by key: founded from a screen, or born in Telegram
  // (its bot founds the signed log). A person's own holon and a cell seat nobody.
  const keyed = (id: string | null | undefined) => !!id && (isHolonId(id) || isTelegramChatId(id));
  // Where the signed-in key stands here — the rule every read applies. The way
  // in by key alone is a signed ask (kind-9021) an admin answers; the
  // signature is the proof of holding the key, nothing else is challenged.
  let standing: 'accepted' | 'held' | 'open' | null = null;
  let askBusy = false;
  let asked = new Set<string>();
  $: askedHere = asked.has(`${holonId}|${holosphere?.currentPubkey ?? ''}`);
  async function askSeat() {
    const s = signer();
    if (!holosphere || !s || askBusy) return;
    askBusy = true;
    try {
      const u = get(telegramUser) as { id?: string | number; first_name?: string; username?: string } | null;
      // A Telegram login names its Telegram id: the bot of a Telegram group
      // proves it from the key and links a member of the group at once.
      requestToJoin(holosphere, holonId, s, { ...publishOpts(), reason: u?.first_name || u?.username || '', telegramId: u?.id });
      asked = new Set(asked).add(`${holonId}|${holosphere.currentPubkey}`);
    } catch (err) {
      console.warn('[settings] could not ask to join:', err);
    } finally {
      askBusy = false;
    }
  }

  async function loadFounding(id: string) {
    if (!holosphere) return;
    try {
      const auth = await syncFoundingAuthority(holosphere, id);
      if (id !== holonId) return;
      founding = auth;
      if (auth.kind === 'anchored') {
        hubRole = await myHolonRole(holosphere, id);
        hubKeys = hubRole === 'admin' ? await holonMembers(holosphere, id) : new Map();
        try {
          standing = (await writeAcceptance(holosphere, id)).status;
        } catch {
          standing = null;
        }
      } else {
        hubRole = null;
        hubKeys = new Map();
        standing = null;
      }
      void loadKeyHolonBits(id);
    } catch (err) {
      console.warn('[settings] could not read who founds this hub:', err);
      founding = null;
    }
  }

  const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // ── Members by key (NIP-29 join requests) and a linked Telegram chat ──────
  // Both belong to holons founded from a screen (@holons/core/holons,
  // @holons/core/linking); the signed-in member's key signs what they need.
  const signer = () => {
    const sk = get(nostrPrivateKey);
    return sk ? signerFromSecretKey(sk) : null;
  };
  const publishOpts = () => ({ appName: holosphere?.appname as string | undefined });
  let joinRequests: JoinRequest[] = [];
  let stopJoins: (() => void) | null = null;
  let dismissed = new Set<string>();
  let telegramLinks: LinkRecord[] = [];
  const BOT = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined) || 'HolonsBot';
  const LINK_KEY = 'holons_hub_link';
  let linkPending: { hub: string; token: string; id: string; at: number } | null = null;
  let linkUrls: { personal: string; group: string } | null = null;
  let linkAccept: LinkAccept | null = null;
  let linkBusy = false;
  let linkError = '';
  let stopLink: (() => void) | null = null;
  onDestroy(() => {
    stopJoins?.();
    stopLink?.();
  });

  function watchJoins(id: string) {
    stopJoins?.();
    stopJoins = null;
    joinRequests = [];
    if (!holosphere || hubRole !== 'admin' || !keyed(id)) return;
    stopJoins = watchJoinRequests(holosphere, id, (r) => {
      if (id === holonId) joinRequests = r.filter((x) => !dismissed.has(x.pubkey));
    });
  }

  async function loadKeyHolonBits(id: string) {
    watchJoins(id);
    if (!holosphere || !isHolonId(id)) {
      telegramLinks = [];
      return;
    }
    try {
      const links = await linkedTelegramChats(holosphere, id);
      if (id === holonId) telegramLinks = links;
    } catch {
      telegramLinks = [];
    }
    // A wait left pending for this hub (they left for Telegram, or reloaded).
    try {
      const raw = localStorage.getItem(LINK_KEY);
      const p = raw ? JSON.parse(raw) : null;
      if (p && p.hub === id && Date.now() - p.at < 6 * 60 * 60 * 1000) armLink(p);
      else if (p) localStorage.removeItem(LINK_KEY);
    } catch {
      /* no pending link */
    }
  }

  async function approve(req: JoinRequest) {
    const s = signer();
    if (!holosphere || !holonId || !s || keyBusy) return;
    keyBusy = true;
    try {
      const pub = await approveJoin(holosphere, holonId, req.pubkey, s, { ...publishOpts(), name: req.reason });
      hubKeys = new Map(hubKeys).set(pub, 'member');
      joinRequests = joinRequests.filter((r) => r.pubkey !== pub);
    } catch (err) {
      showNotification(`Could not link that key — ${reasonOf(err)}`, 'error');
    } finally {
      keyBusy = false;
    }
  }
  function decline(req: JoinRequest) {
    dismissed = new Set(dismissed).add(req.pubkey);
    joinRequests = joinRequests.filter((r) => r.pubkey !== req.pubkey);
  }

  function armLink(p: { hub: string; token: string; id: string; at: number }) {
    if (!holosphere) return;
    linkPending = p;
    linkUrls = telegramDeepLinks(BOT, `link_${p.hub}_${p.token}`);
    stopLink?.();
    stopLink = watchTelegramLink(holosphere, { holon: p.hub, id: p.id }, (a) => (linkAccept = a), {
      onFailed: () => (linkError = 'The chat answered, but its acceptance could not be verified. Try the link again.'),
    });
  }
  async function startTelegramLink() {
    if (!holosphere || !holonId || linkBusy) return;
    linkBusy = true;
    linkError = '';
    try {
      const { token, id } = await offerTelegramLink(holosphere, holonId);
      const p = { hub: holonId, token, id, at: Date.now() };
      localStorage.setItem(LINK_KEY, JSON.stringify(p));
      armLink(p);
    } catch (err) {
      linkError = reasonOf(err);
    } finally {
      linkBusy = false;
    }
  }
  function cancelTelegramLink() {
    stopLink?.();
    stopLink = null;
    linkPending = null;
    linkUrls = null;
    linkAccept = null;
    linkError = '';
    localStorage.removeItem(LINK_KEY);
  }
  async function confirmTelegramLink() {
    if (!holosphere || !holonId || !linkPending || !linkAccept || linkBusy) return;
    linkBusy = true;
    try {
      const name = linkAccept.record.chat?.title?.trim() || linkAccept.chat;
      await completeTelegramLink(holosphere, { holon: holonId, id: linkPending.id, chat: linkAccept.chat, anchor: linkAccept.anchor, name });
      await federateLinkedChat(holosphere, holonId, linkAccept.chat, name).catch(() => {});
      showNotification(`Linked to ${name}`, 'success');
      cancelTelegramLink();
      window.dispatchEvent(new CustomEvent('federationChanged'));
      await loadFounding(holonId);
    } catch (err) {
      linkError = reasonOf(err);
    } finally {
      linkBusy = false;
    }
  }
  async function unlinkChat(link: LinkRecord) {
    if (!holosphere || !holonId || keyBusy) return;
    keyBusy = true;
    try {
      const gone = await unlinkTelegram(holosphere, holonId, link.id);
      if (gone && link.peer) await unfederateLinkedChat(holosphere, holonId, link.peer).catch(() => {});
      telegramLinks = telegramLinks.filter((l) => l.id !== link.id);
      showNotification('Unlinked', 'success');
      window.dispatchEvent(new CustomEvent('federationChanged'));
      await loadFounding(holonId);
    } catch (err) {
      showNotification(`Could not unlink — ${reasonOf(err)}`, 'error');
    } finally {
      keyBusy = false;
    }
  }

  async function foundThisHub() {
    if (!holosphere || !holonId || foundBusy) return;
    foundBusy = true;
    try {
      await foundHolon(holosphere, holonId, { name: settings.name || undefined });
      showNotification('Started: your key now signs for this hub', 'success');
      await loadFounding(holonId);
    } catch (err) {
      showNotification(`Could not start this hub — ${reasonOf(err)}`, 'error');
    } finally {
      foundBusy = false;
    }
  }

  async function addKey(role: 'admin' | 'member') {
    const key = keyDraft.trim();
    if (!holosphere || !holonId || !key || keyBusy) return;
    keyBusy = true;
    try {
      const s = signer();
      const pub = s ? await approveJoin(holosphere, holonId, key, s, { ...publishOpts(), role }) : await addHolonMember(holosphere, holonId, key, role);
      hubKeys = new Map(hubKeys).set(pub, role);
      keyDraft = '';
    } catch (err) {
      showNotification(`Could not link that key — ${reasonOf(err)}`, 'error');
    } finally {
      keyBusy = false;
    }
  }

  async function removeKey(pub: string) {
    if (!holosphere || !holonId || keyBusy) return;
    keyBusy = true;
    try {
      const s = signer();
      if (s) await removeSeat(holosphere, holonId, pub, s, publishOpts());
      else await removeHolonMember(holosphere, holonId, pub);
      const next = new Map(hubKeys);
      next.delete(pub);
      hubKeys = next;
    } catch (err) {
      showNotification(`Could not unlink that key — ${reasonOf(err)}`, 'error');
    } finally {
      keyBusy = false;
    }
  }

  // React to holonId changes
  $: if (holonId) {
    holosphere = getContext('holosphere');
    loadSettings();
    resolveName(holonId);
    founding = null;
    hubRole = null;
    hubKeys = new Map();
    void loadFounding(holonId);
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
            <h3 class="settings-section__title">Appearance</h3>

            <!-- Dashboard skin (this device) -->
            <div class="settings-field">
              <span class="settings-field__label">Theme <span class="settings-section__hint">this dashboard</span></span>
              <div class="theme-row">
                <button
                  type="button"
                  class="theme-chip"
                  class:theme-chip--active={$skin === 'whiteboard'}
                  on:click={() => setSkin('whiteboard')}
                  title="Light, paper-and-ink theme"
                >
                  <span class="theme-chip__icon">☀️</span>
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  class="theme-chip"
                  class:theme-chip--active={$skin === 'blackboard'}
                  on:click={() => setSkin('blackboard')}
                  title="Dark theme"
                >
                  <span class="theme-chip__icon">🌙</span>
                  <span>Dark</span>
                </button>
              </div>
            </div>

            <!-- Accent colour (per skin, this device) -->
            <div class="settings-field">
              <span class="settings-field__label">Accent <span class="settings-section__hint">{$skin === 'whiteboard' ? 'light' : 'dark'} theme</span></span>
              <div class="accent-row">
                <input
                  type="color"
                  class="accent-swatch"
                  value={accentValue}
                  on:input={(e) => setAccent(e.currentTarget.value)}
                  title="Pick an accent colour"
                  aria-label="Accent colour"
                />
                <span class="accent-value">{accentValue.toUpperCase()}</span>
                {#if $accentOverride}
                  <button type="button" class="accent-reset" on:click={clearAccent}>Reset</button>
                {/if}
              </div>
            </div>

            <!-- Telegram bot theme (separate, server-side preference) -->
            <div class="settings-field">
              <span class="settings-field__label">Bot theme <span class="settings-section__hint">Telegram only</span></span>
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
                    {resolvedName(user.id ?? user.username, $nameMap, user)}
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
                        {resolvedName(user.id ?? user.username, $nameMap, user)}
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

          <!-- Members: who is linked to this hub. One word for the whole story — a
               Telegram chat is linked to the hub (a hub born in a chat stays linked to
               it), a person's key is linked directly or through that chat, admins link
               and unlink. Underneath: the signed `_members` log and kind-9021 asks. -->
          <section class="settings-section">
            <h3 class="settings-section__title">Members</h3>
            {#if founding?.kind === 'anchored'}
              {#if keyed(holonId) && standing === 'held'}
                <p class="hub-key__note hub-key__note--warn">
                  You (<strong>{resolvedName(holosphere?.currentPubkey ?? '', $nameMap)}</strong>) aren't linked to this hub yet,
                  so only this device sees your changes. Ask below — the ask is signed by your key, nothing else is needed.
                  {#if isTelegramChatId(holonId)}
                    Or link this key to your Telegram account: send <code>/key</code> to the bot in a private chat.
                  {/if}
                </p>
                {#if askedHere}
                  <p class="hub-key__note">
                    {isTelegramChatId(holonId) && String(holonId).startsWith('-')
                      ? 'Asked — the admins were told in the Telegram group.'
                      : 'Asked — an admin links your key.'}
                  </p>
                {:else}
                  <button type="button" class="btn btn--primary btn--sm" disabled={askBusy || !signer()} on:click={askSeat}>
                    Link my key
                  </button>
                {/if}
              {:else if keyed(holonId) && standing === 'accepted'}
                <p class="hub-key__note">Your key is linked to this hub: your changes count for everyone.</p>
              {/if}
              {#if isTelegramChatId(holonId)}
                <p class="hub-key__note">
                  <strong>Telegram chat</strong> · This hub started in a Telegram chat and stays linked to it: the chat's members are linked here.
                </p>
              {/if}
            {:else if founding?.kind === 'self'}
              <p class="hub-key__note">This holon is its own key.</p>
            {:else if founding?.kind === 'bot'}
              <p class="hub-key__note hub-key__note--warn">
                This hub started in Telegram; its bot gives it a key the first time it runs with
                signing on. Until then nothing can be linked to it.
              </p>
            {:else if founding?.kind === 'open'}
              <p class="hub-key__note hub-key__note--warn">
                This hub has no key of its own yet. Start it with yours: you become its first admin.
              </p>
              <button type="button" class="btn btn--primary btn--sm" disabled={foundBusy} on:click={foundThisHub}>
                Start this hub with my key
              </button>
            {:else if founding?.kind === 'cell'}
              <p class="hub-key__note">A cell aggregates many holons: nobody starts it.</p>
            {:else}
              <p class="hub-key__note">Reading the relays…</p>
            {/if}

            {#if hubRole === 'admin' && joinRequests.length}
              <div class="settings-field">
                <span class="settings-field__label">Asking to be linked</span>
                <ul class="member-list">
                  {#each joinRequests as req (req.pubkey)}
                    <li class="member">
                      <div class="member__main">
                        <span class="member__avatar">🙋</span>
                        <span class="member__name">{req.reason.trim() || resolvedName(req.pubkey, $nameMap)}</span>
                        <code class="member__badge" title={req.pubkey}>{shortId(req.pubkey)}</code>
                      </div>
                      <div class="hub-key__actions">
                        <button type="button" class="btn btn--primary btn--sm" disabled={keyBusy} on:click={() => approve(req)}>Link</button>
                        <button type="button" class="btn btn--ghost btn--sm" disabled={keyBusy} on:click={() => decline(req)}>Dismiss</button>
                      </div>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
            {#if hubRole === 'admin'}
              <div class="settings-field">
                <span class="settings-field__label">Linked keys</span>
                <ul class="member-list">
                  {#each [...hubKeys] as [pub, role] (pub)}
                    <li class="member">
                      <div class="member__main">
                        <span class="member__avatar">🔑</span>
                        <span class="member__name" title={pub}>{resolvedName(pub, $nameMap)}</span>
                        <span class="member__badge">{role}</span>
                        {#if founding?.kind === 'anchored' && pub === founding.anchor}
                          <span class="member__badge">founder</span>
                        {/if}
                      </div>
                      {#if pub !== holosphere?.currentPubkey}
                        <button
                          type="button"
                          class="btn btn--ghost btn--sm"
                          disabled={keyBusy}
                          on:click={() => removeKey(pub)}
                          title="Unlink this key"
                        >
                          Unlink
                        </button>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </div>
              <div class="settings-field">
                <label for="hub-key-add" class="settings-field__label">Link a key</label>
                <input
                  id="hub-key-add"
                  type="text"
                  class="input"
                  bind:value={keyDraft}
                  placeholder="npub or hex public key"
                  autocomplete="off"
                  spellcheck="false"
                  on:keydown={(e) => e.key === 'Enter' && addKey('member')}
                />
                <div class="hub-key__actions">
                  <button type="button" class="btn btn--primary btn--sm" disabled={keyBusy || !keyDraft} on:click={() => addKey('member')}>
                    Link
                  </button>
                  <button type="button" class="btn btn--ghost btn--sm" disabled={keyBusy || !keyDraft} on:click={() => addKey('admin')}>
                    Link as admin
                  </button>
                </div>
              </div>
            {/if}
          </section>

          {#if hubRole === 'admin' && isHolonId(holonId)}
            <!-- A Telegram chat linked to this hub: its members are linked here, both boards show each other. -->
            <section class="settings-section">
              <h3 class="settings-section__title">Telegram chat</h3>
              <p class="hub-key__note">A linked chat's members are linked here, and its boards show here.</p>
              {#each telegramLinks as link (link.id)}
                <div class="member">
                  <div class="member__main">
                    <span class="member__avatar">💬</span>
                    <span class="member__name" title={link.peer}>{link.name || resolvedName(link.peer, $nameMap)}</span>
                  </div>
                  <button type="button" class="btn btn--ghost btn--sm" disabled={keyBusy} on:click={() => unlinkChat(link)}>Unlink</button>
                </div>
              {/each}
              {#if linkAccept}
                <p class="hub-key__note">
                  Link <strong>{linkAccept.record.chat?.title || linkAccept.chat}</strong>? The chat's members are linked here, the bot's key becomes an admin of this hub, and both boards show each other's items.
                </p>
                <div class="hub-key__actions">
                  <button type="button" class="btn btn--primary btn--sm" disabled={linkBusy} on:click={confirmTelegramLink}>Link it</button>
                  <button type="button" class="btn btn--ghost btn--sm" disabled={linkBusy} on:click={cancelTelegramLink}>Cancel</button>
                </div>
              {:else if linkPending && linkUrls}
                <p class="hub-key__note">Open Telegram with one of these links as an admin of the chat. The bot answers here; nothing to copy.</p>
                <div class="hub-key__actions">
                  <a class="btn btn--primary btn--sm" href={linkUrls.group} target="_blank" rel="noopener">A group chat</a>
                  <a class="btn btn--ghost btn--sm" href={linkUrls.personal} target="_blank" rel="noopener">My chat with the bot</a>
                  <button type="button" class="btn btn--ghost btn--sm" on:click={cancelTelegramLink}>Cancel</button>
                </div>
                <p class="hub-key__note">Waiting for the bot…</p>
              {:else}
                <button type="button" class="btn btn--primary btn--sm" disabled={linkBusy} on:click={startTelegramLink}>Link a Telegram chat</button>
              {/if}
              {#if linkError}
                <p class="hub-key__note hub-key__note--warn">{linkError}</p>
              {/if}
            </section>
          {/if}
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
    {#await import('./shared/HexPicker.svelte') then { default: HexPicker }}
      <HexPicker
        value={settings.hex}
        on:select={handleHexSelect}
        on:cancel={() => (hexPickerOpen = false)}
      />
    {/await}
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
    color: var(--color-text-secondary, var(--color-text-secondary));
  }

  .settings-state__spinner {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    border: 2px solid transparent;
    border-bottom-color: var(--color-accent, var(--color-accent-light));
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
    border-bottom: 1px solid var(--color-border, var(--color-bg-tertiary));
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
    color: var(--color-text-secondary, var(--color-text-secondary));
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
    border-bottom-color: var(--color-accent, var(--color-accent-light));
  }

  /* Sections */
  .settings-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-section {
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
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
    color: var(--color-text-muted, var(--color-text-muted));
  }

  .settings-section__count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    height: 1.25rem;
    padding: 0 0.4rem;
    background: var(--color-bg-tertiary, var(--color-bg-tertiary));
    border-radius: 9999px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--color-text-secondary, var(--color-text-secondary));
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
    color: var(--color-text-secondary, var(--color-text-secondary));
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings-field__hint {
    font-size: 0.7rem;
    color: var(--color-text-muted, var(--color-text-muted));
    font-weight: 400;
  }

  .settings-field__readonly {
    display: block;
    padding: 0.5rem 0.75rem;
    background: var(--color-bg-primary, var(--color-bg-primary));
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
    border-radius: 0.5rem;
    color: var(--color-text-secondary, var(--color-text-secondary));
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
    color: var(--color-text-muted, var(--color-text-muted));
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
    background: var(--color-bg-primary, var(--color-bg-primary));
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
    border-radius: 0.5rem;
    color: var(--color-text-primary, #fff);
    font-size: 0.875rem;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease;
    text-align: left;
  }

  .hex-field:hover {
    border-color: var(--color-accent, var(--color-accent-light));
    background: var(--color-bg-secondary, var(--color-bg-secondary));
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
    color: var(--color-text-muted, var(--color-text-muted));
    flex: 1;
    min-width: 0;
  }

  .hex-field__action {
    margin-left: auto;
    padding: 0.125rem 0.5rem;
    border-radius: 9999px;
    background: var(--color-accent, var(--color-accent-light));
    color: var(--color-text-primary);
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
    background: var(--color-bg-primary, var(--color-bg-primary));
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
    border-radius: 9999px;
    color: var(--color-text-secondary, var(--color-text-secondary));
    font-size: 0.8125rem;
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
  }

  .theme-chip:hover {
    color: var(--color-text-primary, #fff);
    border-color: var(--color-border-light, var(--color-border-light));
  }

  .theme-chip--active {
    color: var(--color-text-primary, #fff);
    border-color: var(--color-accent, var(--color-accent-light));
    background: rgba(99, 102, 241, 0.18);
  }

  .theme-chip__icon { line-height: 1; }

  /* Accent colour picker */
  .accent-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .accent-swatch {
    width: 44px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: none;
    cursor: pointer;
  }
  .accent-swatch::-webkit-color-swatch-wrapper { padding: 3px; }
  .accent-swatch::-webkit-color-swatch { border: none; border-radius: 5px; }
  .accent-swatch::-moz-color-swatch { border: none; border-radius: 5px; }
  .accent-value {
    font-family: var(--font-family-mono);
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    letter-spacing: 0.02em;
  }
  .accent-reset {
    margin-left: auto;
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--color-text-secondary);
    background: var(--color-bg-tertiary);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .accent-reset:hover { color: var(--color-text-primary); }

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
    background: var(--color-bg-primary, var(--color-bg-primary));
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
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
    color: var(--color-text-muted, var(--color-text-muted));
    cursor: pointer;
  }

  .chip__remove:hover {
    background: var(--color-error, #ef4444);
    color: var(--color-text-primary);
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
    background: var(--color-bg-primary, var(--color-bg-primary));
    border: 1px solid var(--color-border, var(--color-bg-tertiary));
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

  .hub-key__note {
    margin: 0 0 0.75rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--text-secondary, #6b7280);
  }
  .hub-key__note code {
    font-size: 0.85em;
  }
  .hub-key__note--warn {
    color: var(--warning, #b45309);
  }
  .hub-key__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }
  .empty-state {
    color: var(--color-text-muted, var(--color-text-muted));
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
    color: var(--color-text-primary);
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
