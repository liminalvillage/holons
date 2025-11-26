// Flow Settings Management based on the original Settings.js system
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
  'announcements', 'users', 'shopping', 'recurring'
] as const;

export type LensType = typeof AVAILABLE_LENSES[number];

export class FlowSettings {
  private settings: Map<string, HolonSettings> = new Map();
  private callbacks: Map<string, Function[]> = new Map();

  constructor(private holonId: string) {}

  /**
   * Load settings for a holon
   */
  async loadSettings(gun: any, holonId: string): Promise<HolonSettings> {
    return new Promise((resolve) => {
      gun.get(`holon_settings/${holonId}`).once((data: any) => {
        if (data) {
          const settings = this.parseSettings(data);
          this.settings.set(holonId, settings);
          resolve(settings);
        } else {
          const defaultSettings = this.getDefaultSettings(holonId);
          this.settings.set(holonId, defaultSettings);
          resolve(defaultSettings);
        }
      });
    });
  }

  /**
   * Save settings for a holon
   */
  async saveSettings(gun: any, holonId: string, settings: Partial<HolonSettings>): Promise<void> {
    const currentSettings = this.settings.get(holonId) || this.getDefaultSettings(holonId);
    const updatedSettings = {
      ...currentSettings,
      ...settings,
      timestamp: Date.now()
    };
    
    this.settings.set(holonId, updatedSettings);
    gun.get(`holon_settings/${holonId}`).put(updatedSettings);
    
    this.notifyCallbacks('settings:updated', updatedSettings);
  }

  /**
   * Get default settings for a holon
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
   * Parse settings from Gun data
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
   * Update flow management settings
   */
  async updateFlowSettings(
    gun: any,
    holonId: string,
    flowSettings: Partial<HolonSettings['flowManagement']>
  ): Promise<void> {
    const currentSettings = this.settings.get(holonId) || this.getDefaultSettings(holonId);
    
    await this.saveSettings(gun, holonId, {
      flowManagement: {
        ...currentSettings.flowManagement,
        ...flowSettings
      }
    });
  }

  /**
   * Add federation link
   */
  async addFederationLink(
    gun: any,
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
    
    await this.saveSettings(gun, holonId, settings);
  }

  /**
   * Remove federation link
   */
  async removeFederationLink(gun: any, holonId: string, targetId: string): Promise<void> {
    const settings = this.settings.get(holonId) || this.getDefaultSettings(holonId);
    
    settings.federation = settings.federation.filter(f => f.targetId !== targetId);
    delete settings.lensConfig[targetId];
    
    await this.saveSettings(gun, holonId, settings);
  }

  /**
   * Toggle lens for federation link
   */
  async toggleLens(
    gun: any,
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
    
    await this.saveSettings(gun, holonId, settings);
  }

  /**
   * Get lens configuration for UI
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
   * Get lens description
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
      recurring: 'Recurring tasks and schedules'
    };
    
    return descriptions[lens] || '';
  }

  /**
   * Generate flow visualization data
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
   * Subscribe to settings changes
   */
  onSettingsChange(event: string, callback: Function): void {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  /**
   * Notify callbacks of changes
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
   * Get current settings for a holon
   */
  getSettings(holonId: string): HolonSettings | null {
    return this.settings.get(holonId) || null;
  }

  /**
   * Clear settings cache
   */
  clearCache(): void {
    this.settings.clear();
  }
}