// Flow Settings Management based on the original Settings.js system
// Updated to use holosphere2 API instead of direct Gun access

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
  timestamp: number;
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
      timestamp: number;
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
  timestamp: number;
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

// Available lens types based on the original system
export const AVAILABLE_LENSES = [
  'quests', 'offers', 'tags', 'expenses',
  'announcements', 'users', 'shopping', 'recurring',
  'library', 'roles', 'checklists'
] as const;

export type LensType = typeof AVAILABLE_LENSES[number];

/**
 * Manages holon flow settings including federation links, lens configurations,
 * and flow visualization data generation.
 *
 * This class provides the settings layer for the Harvest holon system,
 * based on the original Settings.js system but modernized for the web frontend.
 * It handles persistence via holosphere2 and provides event-based change notifications.
 *
 * @class FlowSettings
 *
 * @example
 * ```typescript
 * import { FlowSettings } from './FlowSettings';
 *
 * const settings = new FlowSettings('myHolon');
 *
 * // Load settings
 * const holonSettings = await settings.loadSettings(holosphere, 'myHolon');
 *
 * // Update flow settings
 * await settings.updateFlowSettings(holosphere, 'myHolon', { internalPercent: 60 });
 *
 * // Manage federation
 * await settings.addFederationLink(holosphere, 'myHolon', 'targetHolon', 'Target', 'federated');
 * await settings.toggleLens(holosphere, 'myHolon', 'targetHolon', 'quests', 'federate');
 *
 * // Generate visualization
 * const viz = await settings.generateFlowVisualization('myHolon', bundle, members, balances);
 * ```
 */
export class FlowSettings {
  private settings: Map<string, HolonSettings> = new Map();
  private callbacks: Map<string, Function[]> = new Map();

  /**
   * Creates a new FlowSettings instance.
   *
   * @param {string} holonId - The holon identifier for these settings
   */
  constructor(private holonId: string) {}

  /**
   * Loads settings for a holon from holosphere.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The holon identifier
   * @returns {Promise<HolonSettings>} The holon settings (default if not found)
   */
  async loadSettings(holosphere: HoloSphere, holonId: string): Promise<HolonSettings> {
    try {
      const data = await holosphere.get(holonId, 'settings', holonId);
      if (data) {
        const settings = this.parseSettings(data);
        this.settings.set(holonId, settings);
        return settings;
      } else {
        const defaultSettings = this.getDefaultSettings(holonId);
        this.settings.set(holonId, defaultSettings);
        return defaultSettings;
      }
    } catch (error) {
      console.error('Error loading holon settings:', error);
      const defaultSettings = this.getDefaultSettings(holonId);
      this.settings.set(holonId, defaultSettings);
      return defaultSettings;
    }
  }

  /**
   * Saves settings for a holon to holosphere.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The holon identifier
   * @param {Partial<HolonSettings>} settings - The settings to save
   * @returns {Promise<void>}
   */
  async saveSettings(holosphere: HoloSphere, holonId: string, settings: Partial<HolonSettings>): Promise<void> {
    const currentSettings = this.settings.get(holonId) || this.getDefaultSettings(holonId);
    const updatedSettings = {
      ...currentSettings,
      ...settings,
      id: holonId,
      timestamp: Date.now()
    };

    this.settings.set(holonId, updatedSettings);
    await holosphere.put(holonId, 'settings', updatedSettings);

    this.notifyCallbacks('settings:updated', updatedSettings);
  }

  /**
   * Gets default settings for a holon.
   *
   * @private
   * @param {string} holonId - The holon identifier
   * @returns {HolonSettings} The default settings
   */
  private getDefaultSettings(holonId: string): HolonSettings {
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
      timestamp: Date.now()
    };
  }

  /**
   * Parses settings from holosphere data format.
   *
   * @private
   * @param {any} data - The raw data
   * @returns {HolonSettings} The parsed settings
   */
  private parseSettings(data: any): HolonSettings {
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
      timestamp: data.timestamp || Date.now()
    };
  }

  /**
   * Updates flow management settings.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The holon identifier
   * @param {Partial<HolonSettings['flowManagement']>} flowSettings - The flow settings to update
   * @returns {Promise<void>}
   */
  async updateFlowSettings(
    holosphere: HoloSphere,
    holonId: string,
    flowSettings: Partial<HolonSettings['flowManagement']>
  ): Promise<void> {
    const currentSettings = this.settings.get(holonId) || this.getDefaultSettings(holonId);

    await this.saveSettings(holosphere, holonId, {
      flowManagement: {
        ...currentSettings.flowManagement,
        ...flowSettings
      }
    });
  }

  /**
   * Adds a federation link between holons.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The source holon identifier
   * @param {string} targetId - The target holon identifier
   * @param {string} targetName - The target holon name
   * @param {'federated' | 'notifies'} relationship - The relationship type
   * @returns {Promise<void>}
   */
  async addFederationLink(
    holosphere: HoloSphere,
    holonId: string,
    targetId: string,
    targetName: string,
    relationship: 'federated' | 'notifies'
  ): Promise<void> {
    const settings = this.settings.get(holonId) || this.getDefaultSettings(holonId);

    const existingLink = settings.federation.find(f => f.targetId === targetId);

    if (existingLink) {
      existingLink.relationship = relationship;
      existingLink.timestamp = Date.now();
    } else {
      settings.federation.push({
        targetId,
        targetName,
        relationship,
        lenses: {
          inbound: [],
          outbound: []
        },
        timestamp: Date.now()
      });
    }

    await this.saveSettings(holosphere, holonId, settings);
  }

  /**
   * Removes a federation link.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The source holon identifier
   * @param {string} targetId - The target holon identifier to remove
   * @returns {Promise<void>}
   */
  async removeFederationLink(holosphere: HoloSphere, holonId: string, targetId: string): Promise<void> {
    const settings = this.settings.get(holonId) || this.getDefaultSettings(holonId);

    settings.federation = settings.federation.filter(f => f.targetId !== targetId);
    delete settings.lensConfig[targetId];

    await this.saveSettings(holosphere, holonId, settings);
  }

  /**
   * Toggles a lens for a federation link.
   *
   * @async
   * @param {HoloSphere} holosphere - The holosphere instance
   * @param {string} holonId - The source holon identifier
   * @param {string} targetId - The target holon identifier
   * @param {LensType} lensType - The lens type to toggle
   * @param {'federate' | 'notify'} relationship - The relationship type
   * @returns {Promise<void>}
   */
  async toggleLens(
    holosphere: HoloSphere,
    holonId: string,
    targetId: string,
    lensType: LensType,
    relationship: 'federate' | 'notify'
  ): Promise<void> {
    const settings = this.settings.get(holonId) || this.getDefaultSettings(holonId);

    if (!settings.lensConfig[targetId]) {
      settings.lensConfig[targetId] = {
        inbound: [],
        outbound: [],
        timestamp: Date.now()
      };
    }

    // Map old relationship names to new array names
    const arrayName = relationship === 'federate' ? 'inbound' : 'outbound';
    const lensArray = settings.lensConfig[targetId][arrayName];
    const lensIndex = lensArray.indexOf(lensType);

    if (lensIndex > -1) {
      lensArray.splice(lensIndex, 1); // Remove
    } else {
      lensArray.push(lensType); // Add
    }

    settings.lensConfig[targetId].timestamp = Date.now();

    await this.saveSettings(holosphere, holonId, settings);
  }

  /**
   * Gets lens configuration for UI display.
   *
   * @param {string} holonId - The source holon identifier
   * @param {string} targetId - The target holon identifier
   * @param {'federate' | 'notify'} relationship - The relationship type
   * @returns {LensConfig[]} Array of lens configurations with enabled status
   */
  getLensesConfig(holonId: string, targetId: string, relationship: 'federate' | 'notify'): LensConfig[] {
    const settings = this.settings.get(holonId);
    if (!settings || !settings.lensConfig[targetId]) {
      return AVAILABLE_LENSES.map(name => ({ name, enabled: false }));
    }

    // Map old relationship names to new array names
    const arrayName = relationship === 'federate' ? 'inbound' : 'outbound';
    const activeLenses = settings.lensConfig[targetId][arrayName];
    
    return AVAILABLE_LENSES.map(name => ({
      name,
      enabled: activeLenses.includes(name),
      description: this.getLensDescription(name)
    }));
  }

  /**
   * Gets a human-readable description for a lens type.
   *
   * @private
   * @param {LensType} lens - The lens type
   * @returns {string} The description
   */
  private getLensDescription(lens: LensType): string {
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

  /**
   * Generates flow visualization data for rendering.
   *
   * @async
   * @param {string} holonId - The holon identifier
   * @param {any} holonBundle - The holon bundle data
   * @param {any[]} members - Array of holon members
   * @param {any[]} tokenBalances - Array of token balances
   * @returns {Promise<FlowVisualizationData>} The visualization data including nodes, edges, and metrics
   */
  async generateFlowVisualization(
    holonId: string,
    holonBundle: any,
    members: any[],
    tokenBalances: any[]
  ): Promise<FlowVisualizationData> {
    const settings = this.settings.get(holonId) || this.getDefaultSettings(holonId);
    
    const nodes: FlowNode[] = [];
    const edges: FlowEdge[] = [];
    
    // Add main holon nodes
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
      
      // Add flow edges
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

    // Add federation nodes and edges
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

  /**
   * Subscribes to settings change events.
   *
   * @param {string} event - The event name to subscribe to
   * @param {Function} callback - The callback function
   * @returns {void}
   */
  onSettingsChange(event: string, callback: Function): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  /**
   * Notifies registered callbacks of changes.
   *
   * @private
   * @param {string} event - The event name
   * @param {any} data - The event data
   * @returns {void}
   */
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

  /**
   * Gets current settings for a holon from cache.
   *
   * @param {string} holonId - The holon identifier
   * @returns {HolonSettings | null} The settings or null if not cached
   */
  getSettings(holonId: string): HolonSettings | null {
    return this.settings.get(holonId) || null;
  }

  /**
   * Clears the settings cache.
   *
   * @returns {void}
   */
  clearCache(): void {
    this.settings.clear();
  }
}