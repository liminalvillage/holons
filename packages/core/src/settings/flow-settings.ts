// Flow Settings Management based on the original Settings.js system.
// Migrated to @holons/core/settings as part of Phase B unification.
//
// Both web and telegram UIs share these primitives so that holon settings
// (federation, flow management, lens configuration) live in a single place
// and stay in sync across surfaces.

import type { HoloSphere } from 'holosphere';

export interface LensConfig {
  name: string;
  enabled: boolean;
  description?: string;
}

export interface FederationLink {
  targetId: string;
  targetName: string;
  relationship: 'federated' | 'notifies';
  lenses: {
    inbound: string[];
    outbound: string[];
  };
  /** Canonical creation/last-touch timestamp (ISO string). */
  created: string;
}

export interface HolonSettings {
  id: string;
  name: string;
  version: number;
  admin: string;
  timezone: string;
  language: string;
  theme: string;
  hex: string;
  maxTasks: number;
  federation: FederationLink[];
  lensConfig: {
    [targetId: string]: {
      inbound: string[];
      outbound: string[];
      /** Canonical creation/last-touch timestamp (ISO string). */
      created: string;
    };
  };
  flowManagement: {
    internalPercent: number;
    externalPercent: number;
    autoBalance: boolean;
    thresholds: {
      minInternal: number;
      maxInternal: number;
    };
  };
  /** Canonical creation/last-touch timestamp (ISO string). */
  created: string;
}

export interface FlowVisualizationData {
  nodes: FlowNode[];
  edges: FlowEdge[];
  metrics: FlowMetrics;
}

export interface FlowNode {
  id: string;
  name: string;
  type: 'internal' | 'external' | 'holon' | 'user';
  holonType?: 'Managed' | 'Zoned' | 'Splitter' | 'Appreciative';
  address?: string;
  balance?: number;
  members?: number;
  zones?: string[];
  position?: { x: number; y: number };
  status: 'active' | 'inactive' | 'pending';
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: 'federation' | 'notification' | 'payment' | 'governance';
  weight: number;
  lenses: string[];
  status: 'active' | 'inactive';
}

export interface FlowMetrics {
  totalNodes: number;
  totalEdges: number;
  internalFlow: number;
  externalFlow: number;
  federationCount: number;
  notificationCount: number;
  activeMembers: number;
  totalBalance: number;
}

// Available lens types based on the original system.
export const AVAILABLE_LENSES = [
  'quests', 'offers', 'tags', 'expenses',
  'announcements', 'users', 'shopping', 'recurring',
  'library', 'roles', 'checklists'
] as const;

export type LensType = typeof AVAILABLE_LENSES[number];

/**
 * Default `HolonSettings` skeleton used when nothing is persisted yet.
 *
 * Kept as a standalone helper (rather than baked into the class) so that
 * non-class callers — including the Telegram bot — can use it without
 * instantiating `FlowSettings`.
 */
export function getDefaultHolonSettings(holonId: string): HolonSettings {
  return {
    id: holonId,
    name: `Holon ${holonId}`,
    version: 1,
    admin: '',
    timezone: 'UTC',
    language: 'en',
    theme: 'dark',
    hex: '#3b82f6',
    maxTasks: 10,
    federation: [],
    lensConfig: {},
    flowManagement: {
      internalPercent: 50,
      externalPercent: 50,
      autoBalance: false,
      thresholds: {
        minInternal: 10,
        maxInternal: 90
      }
    },
    created: new Date().toISOString()
  };
}

/**
 * Parses raw holosphere settings data into a populated `HolonSettings`
 * with sane defaults for any missing fields.
 */
export function parseHolonSettings(data: any): HolonSettings {
  return {
    id: data.id || '',
    name: data.name || '',
    version: data.version || 1,
    admin: data.admin || '',
    timezone: data.timezone || 'UTC',
    language: data.language || 'en',
    theme: data.theme || 'dark',
    hex: data.hex || '#3b82f6',
    maxTasks: data.maxTasks || 10,
    federation: data.federation || [],
    lensConfig: data.lensConfig || {},
    flowManagement: data.flowManagement || {
      internalPercent: 50,
      externalPercent: 50,
      autoBalance: false,
      thresholds: { minInternal: 10, maxInternal: 90 }
    },
    // Canonical `created` (ISO). Promote legacy `timestamp` (ms epoch) for
    // records written before the unify.
    created: typeof data.created === 'string'
      ? data.created
      : (typeof data.timestamp === 'number' ? new Date(data.timestamp).toISOString() : new Date().toISOString())
  };
}

/**
 * Loads raw settings for a holon from holosphere.
 *
 * Returns the persisted object as-is (or `null` if nothing is stored).
 * Callers that want a normalised `HolonSettings` should pipe the result
 * through `parseHolonSettings`.
 */
export async function loadSettings(
  holosphere: HoloSphere,
  holonId: string
): Promise<any | null> {
  try {
    const data = await holosphere.get(String(holonId), 'settings', String(holonId));
    return data ?? null;
  } catch (error) {
    console.error('Error loading holon settings:', error);
    return null;
  }
}

/**
 * Saves raw settings for a holon to holosphere.
 *
 * Accepts any settings shape (web `HolonSettings`, telegram bot settings,
 * partials, etc.) so the same primitive serves all surfaces.
 */
export async function saveSettings(
  holosphere: HoloSphere,
  holonId: string,
  settings: any
): Promise<void> {
  await holosphere.put(String(holonId), 'settings', settings);
}

/**
 * Manages holon flow settings including federation links, lens configurations,
 * and flow visualization data generation.
 *
 * Sits on top of the `loadSettings` / `saveSettings` primitives, adding the
 * web-side caching layer, change subscriptions, and visualization helpers.
 *
 * @class FlowSettings
 *
 * @example
 * ```typescript
 * import { FlowSettings } from '@holons/core/settings';
 *
 * const settings = new FlowSettings('myHolon');
 * const holonSettings = await settings.loadSettings(holosphere, 'myHolon');
 * await settings.updateFlowSettings(holosphere, 'myHolon', { internalPercent: 60 });
 * ```
 */
export class FlowSettings {
  private settings: Map<string, HolonSettings> = new Map();
  private callbacks: Map<string, Function[]> = new Map();

  constructor(private holonId: string) {}

  async loadSettings(holosphere: HoloSphere, holonId: string): Promise<HolonSettings> {
    const data = await loadSettings(holosphere, holonId);
    if (data) {
      const settings = parseHolonSettings(data);
      this.settings.set(holonId, settings);
      return settings;
    }
    const defaultSettings = getDefaultHolonSettings(holonId);
    this.settings.set(holonId, defaultSettings);
    return defaultSettings;
  }

  async saveSettings(holosphere: HoloSphere, holonId: string, settings: Partial<HolonSettings>): Promise<void> {
    const currentSettings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);
    const updatedSettings: HolonSettings = {
      ...currentSettings,
      ...settings,
      id: holonId,
      created: new Date().toISOString()
    };

    this.settings.set(holonId, updatedSettings);
    await saveSettings(holosphere, holonId, updatedSettings);

    this.notifyCallbacks('settings:updated', updatedSettings);
  }

  async updateFlowSettings(
    holosphere: HoloSphere,
    holonId: string,
    flowSettings: Partial<HolonSettings['flowManagement']>
  ): Promise<void> {
    const currentSettings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);

    await this.saveSettings(holosphere, holonId, {
      flowManagement: {
        ...currentSettings.flowManagement,
        ...flowSettings
      }
    });
  }

  async addFederationLink(
    holosphere: HoloSphere,
    holonId: string,
    targetId: string,
    targetName: string,
    relationship: 'federated' | 'notifies'
  ): Promise<void> {
    // Mirrors `applyAddFederationLink` from ./federation-links — kept here
    // (not delegated) to avoid a circular import while reusing this class's
    // cache + change-notification path.
    const settings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);

    const existingLink = settings.federation.find(f => f.targetId === targetId);

    if (existingLink) {
      existingLink.relationship = relationship;
      existingLink.created = new Date().toISOString();
    } else {
      settings.federation.push({
        targetId,
        targetName,
        relationship,
        lenses: { inbound: [], outbound: [] },
        created: new Date().toISOString()
      });
    }

    await this.saveSettings(holosphere, holonId, settings);
  }

  async removeFederationLink(holosphere: HoloSphere, holonId: string, targetId: string): Promise<void> {
    const settings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);

    settings.federation = settings.federation.filter(f => f.targetId !== targetId);
    delete settings.lensConfig[targetId];

    await this.saveSettings(holosphere, holonId, settings);
  }

  async toggleLens(
    holosphere: HoloSphere,
    holonId: string,
    targetId: string,
    lensType: LensType,
    relationship: 'federate' | 'notify'
  ): Promise<void> {
    const settings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);

    if (!settings.lensConfig[targetId]) {
      settings.lensConfig[targetId] = {
        inbound: [],
        outbound: [],
        created: new Date().toISOString()
      };
    }

    const arrayName = relationship === 'federate' ? 'inbound' : 'outbound';
    const lensArray = settings.lensConfig[targetId][arrayName];
    const lensIndex = lensArray.indexOf(lensType);

    if (lensIndex > -1) {
      lensArray.splice(lensIndex, 1);
    } else {
      lensArray.push(lensType);
    }

    settings.lensConfig[targetId].created = new Date().toISOString();

    await this.saveSettings(holosphere, holonId, settings);
  }

  getLensesConfig(holonId: string, targetId: string, relationship: 'federate' | 'notify'): LensConfig[] {
    const settings = this.settings.get(holonId);
    if (!settings || !settings.lensConfig[targetId]) {
      return AVAILABLE_LENSES.map(name => ({ name, enabled: false }));
    }

    const arrayName = relationship === 'federate' ? 'inbound' : 'outbound';
    const activeLenses = settings.lensConfig[targetId][arrayName];

    return AVAILABLE_LENSES.map(name => ({
      name,
      enabled: activeLenses.includes(name),
      description: getLensDescription(name)
    }));
  }

  async generateFlowVisualization(
    holonId: string,
    holonBundle: any,
    members: any[],
    tokenBalances: any[]
  ): Promise<FlowVisualizationData> {
    const settings = this.settings.get(holonId) || getDefaultHolonSettings(holonId);

    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];

    if (holonBundle) {
      nodes.push({
        id: 'internal',
        name: 'Internal (Managed)',
        type: 'internal',
        holonType: 'Managed',
        address: holonBundle.managedAddress,
        members: members.length,
        position: { x: 200, y: 200 },
        status: 'active'
      });

      nodes.push({
        id: 'external',
        name: 'External (Zoned)',
        type: 'external',
        holonType: 'Zoned',
        address: holonBundle.zonedAddress,
        zones: ['zone1', 'zone2'],
        position: { x: 400, y: 200 },
        status: 'active'
      });

      nodes.push({
        id: 'splitter',
        name: 'Flow Controller',
        type: 'holon',
        holonType: 'Splitter',
        address: holonBundle.splitterAddress,
        balance: tokenBalances.reduce((sum, t) => sum + parseFloat(t.formatted), 0),
        position: { x: 300, y: 100 },
        status: 'active'
      });

      edges.push({
        id: 'splitter-internal',
        source: 'splitter',
        target: 'internal',
        type: 'payment',
        weight: settings.flowManagement.internalPercent,
        lenses: [],
        status: 'active'
      });

      edges.push({
        id: 'splitter-external',
        source: 'splitter',
        target: 'external',
        type: 'payment',
        weight: settings.flowManagement.externalPercent,
        lenses: [],
        status: 'active'
      });
    }

    settings.federation.forEach((fed, index) => {
      nodes.push({
        id: fed.targetId,
        name: fed.targetName,
        type: 'holon',
        position: { x: 100 + index * 150, y: 350 },
        status: 'active'
      });

      const activeLenses = [
        ...fed.lenses.inbound.map(l => `inbound:${l}`),
        ...fed.lenses.outbound.map(l => `outbound:${l}`)
      ];

      edges.push({
        id: `federation-${fed.targetId}`,
        source: 'external',
        target: fed.targetId,
        type: 'federation',
        weight: activeLenses.length,
        lenses: activeLenses,
        status: 'active'
      });
    });

    const metrics: FlowMetrics = {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      internalFlow: settings.flowManagement.internalPercent,
      externalFlow: settings.flowManagement.externalPercent,
      federationCount: settings.federation.length,
      notificationCount: settings.federation.filter(f => f.relationship === 'notifies').length,
      activeMembers: members.length,
      totalBalance: tokenBalances.reduce((sum, t) => sum + parseFloat(t.formatted), 0)
    };

    return { nodes, edges, metrics };
  }

  onSettingsChange(event: string, callback: Function): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  private notifyCallbacks(event: string, data: any): void {
    const callbacks = this.callbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in settings callback:', error);
        }
      });
    }
  }

  getSettings(holonId: string): HolonSettings | null {
    return this.settings.get(holonId) || null;
  }

  clearCache(): void {
    this.settings.clear();
  }
}

/**
 * Human-readable description for a lens type.
 *
 * Exposed as a free function so non-class callers can render lens UIs
 * without spinning up a `FlowSettings` instance.
 */
export function getLensDescription(lens: LensType): string {
  const descriptions: Record<LensType, string> = {
    quests: 'Share and manage quests across holons',
    offers: 'Exchange offers and opportunities',
    tags: 'Shared tagging and categorization',
    expenses: 'Expense tracking and reimbursements',
    announcements: 'Important notifications and updates',
    users: 'User directory and member management',
    shopping: 'Marketplace and commerce features',
    recurring: 'Recurring tasks and schedules',
    library: 'Shared items, tools and books for borrowing',
    roles: 'Role assignments and rotations',
    checklists: 'Reusable checklist templates'
  };

  return descriptions[lens] || '';
}
