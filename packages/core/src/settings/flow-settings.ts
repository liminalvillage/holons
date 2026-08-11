// Flow Settings Management based on the original Settings.js system.
// Migrated to @holons/core/settings as part of Phase B unification.
//
// Both web and telegram UIs share these primitives so that holon settings
// (federation, flow management, lens configuration) live in a single place
// and stay in sync across surfaces.

import type { HoloSphere } from 'holosphere';
import {
  getDefaultHolonSettings,
  loadSettings,
  parseHolonSettings,
  saveSettings,
} from './persistence.js';

// Persistence primitives moved to ./persistence.ts; re-exported here so the
// long-standing `@holons/core/settings` surface (and direct imports of this
// module) keep working.
export { getDefaultHolonSettings, parseHolonSettings, loadSettings, saveSettings };

// NOTE: federation links no longer live on the settings lens. The native
// federation record is the single store — manage it via
// `@holons/core/federation` (`setFederationPartner` / `removeFederationPartner`,
// read via `getFederationSnapshot`; `migrateLegacyFederationLinks` folds in
// records written before the unification).

export interface LensConfig {
  name: string;
  enabled: boolean;
  description?: string;
}

/** A federation partner as rendered by flow visualizations (snapshot-derived). */
export interface FederationPartnerView {
  id: string;
  name: string;
  inbound: string[];
  outbound: string[];
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

  // Federation links are NOT managed here — the native federation record is
  // the single store; use `setFederationPartner` / `removeFederationPartner`
  // from `@holons/core/federation`.

  async generateFlowVisualization(
    holonId: string,
    holonBundle: any,
    members: any[],
    tokenBalances: any[],
    partners: FederationPartnerView[] = []
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

    partners.forEach((partner, index) => {
      nodes.push({
        id: partner.id,
        name: partner.name,
        type: 'holon',
        position: { x: 100 + index * 150, y: 350 },
        status: 'active'
      });

      const activeLenses = [
        ...partner.inbound.map(l => `inbound:${l}`),
        ...partner.outbound.map(l => `outbound:${l}`)
      ];

      edges.push({
        id: `federation-${partner.id}`,
        source: 'external',
        target: partner.id,
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
      federationCount: partners.length,
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
