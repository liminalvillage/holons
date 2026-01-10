import type { HoloSphere } from 'holosphere';
import type { FederationPartner, FederationState, LensConfig, CapabilityInfo } from '../types/federation';
import { writable, type Writable } from 'svelte/store';

// V2 API type extensions (until holosphere types are updated)
interface HoloSphereV2 extends HoloSphere {
  myHolon: string;
  link(targetPubKey: string, scope: { holonId: string; lensName: string; dataId?: string }, options?: { permissions?: string[]; alias?: string }): Promise<{ capability: string; linkId: string }>;
  unlink(targetPubKey: string, scope?: { holonId?: string; lensName?: string }): Promise<{ revoked: string[] }>;
  getCapabilities(options?: { issued?: boolean; received?: boolean; revoked?: boolean }): Promise<{ issued: any[]; received: any[] }>;
  revokeCapability(capabilityId: string, reason?: string): Promise<void>;
  storeInboundCapability(issuerPubKey: string, capability: { token: string; scope: { holonId: string; lensName: string }; permissions: string[] }): Promise<void>;
  getFederation(holonId: string): Promise<any>;
  put(holonId: string, lens: string, data: any): Promise<any>;
  get(holonId: string, lens: string, dataId: string): Promise<any>;
  readFromFederatedSource(sourcePubKey: string, holonId: string, lensName: string, dataId: string | null): Promise<any>;
  addFederatedHolosphere(pubKey: string, options?: { alias?: string }): Promise<any>;
  writeGlobal(table: string, data: any): Promise<boolean>;
}

/**
 * FederationService - V2 API
 *
 * Provides reactive state for federation using the V2 link/unlink API:
 * - holosphere.link(targetPubKey, scope, options) - Direct capability grant
 * - holosphere.unlink(targetPubKey, scope?) - Revoke capabilities
 * - holosphere.getCapabilities(options) - List issued/received capabilities
 * - holosphere.revokeCapability(id, reason?) - Revoke specific capability
 */
export class FederationService {
  private holosphere: HoloSphereV2;
  private state: Writable<FederationState>;
  private currentHolonId: string = '';
  private knownCapabilityIds: Set<string> = new Set();
  // Map of holonId -> partnerPubKey for federated holons we can read from
  private federatedHolonSources: Map<string, string> = new Map();

  constructor(holosphere: HoloSphere) {
    this.holosphere = holosphere as HoloSphereV2;
    this.state = writable<FederationState>({
      partners: [],
      pendingRequests: [], // Kept for compatibility but not used in V2
      loading: false,
      error: null,
      initialized: false
    });
  }

  /** Set the current holon context for federation operations */
  setCurrentHolon(holonId: string): void {
    console.log('[FederationService] setCurrentHolon:', holonId);
    this.currentHolonId = holonId;
  }

  /** Agent's public key - always use the actual pubkey for federation */
  get myPubKey(): string {
    // Always use the actual pubkey for federation capabilities
    // This ensures partners can access data by navigating to the pubkey
    const pubKey = this.holosphere.myHolon || '';
    console.log('[FederationService] myPubKey:', pubKey?.slice(0, 16) + '...');
    return pubKey;
  }

  /** Current holon context (for display/UI purposes) */
  get currentHolon(): string {
    const holon = this.currentHolonId || this.holosphere.myHolon || '';
    console.log('[FederationService] currentHolon:', holon);
    return holon;
  }

  /** Get the reactive state store */
  getState(): Writable<FederationState> {
    return this.state;
  }

  /** Initialize and load existing partners */
  async init(): Promise<void> {
    this.state.update(s => ({ ...s, loading: true, error: null }));
    try {
      await this.loadPartners();
      await this.checkForNewCapabilities(); // Check for incoming capabilities
      this.state.update(s => ({ ...s, loading: false, initialized: true }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialize';
      this.state.update(s => ({ ...s, loading: false, error: message }));
    }
  }

  /** Reload partners from holosphere using V2 getCapabilities API */
  async loadPartners(): Promise<void> {
    const partnersMap = new Map<string, FederationPartner>();

    try {
      // Get all capabilities (issued and received)
      const caps = await this.holosphere.getCapabilities({
        issued: true,
        received: true,
        revoked: false
      });

      // Build partner list from issued capabilities (outbound)
      for (const cap of caps.issued || []) {
        const pubKey = cap.recipient;
        if (!partnersMap.has(pubKey)) {
          partnersMap.set(pubKey, {
            id: pubKey,
            pubKey,
            status: 'connected',
            lensConfig: { inbound: [], outbound: [] },
            capabilities: {},
            createdAt: cap.issuedAt
          });
        }
        const partner = partnersMap.get(pubKey)!;

        // Add to outbound lenses
        if (cap.scope?.lensName && cap.scope.lensName !== '*') {
          if (!partner.lensConfig.outbound.includes(cap.scope.lensName)) {
            partner.lensConfig.outbound.push(cap.scope.lensName);
          }
        }

        // Store capability info
        const capKey = `${cap.scope?.lensName || '*'}:outbound`;
        partner.capabilities![capKey] = {
          token: '',
          permissions: cap.permissions,
          scope: cap.scope,
          issuedAt: cap.issuedAt,
          direction: 'outbound'
        };
      }

      // Build partner list from received capabilities (inbound)
      for (const cap of caps.received || []) {
        const pubKey = cap.issuer;
        if (!partnersMap.has(pubKey)) {
          partnersMap.set(pubKey, {
            id: pubKey,
            pubKey,
            status: 'connected',
            lensConfig: { inbound: [], outbound: [] },
            capabilities: {},
            createdAt: cap.receivedAt
          });
        }
        const partner = partnersMap.get(pubKey)!;

        // Track federated holon -> source pubKey mapping for smart reads
        if (cap.scope?.holonId && cap.scope.holonId !== '*') {
          this.federatedHolonSources.set(cap.scope.holonId, pubKey);
        }

        // Add to inbound lenses
        if (cap.scope?.lensName && cap.scope.lensName !== '*') {
          if (!partner.lensConfig.inbound.includes(cap.scope.lensName)) {
            partner.lensConfig.inbound.push(cap.scope.lensName);
          }
        }

        // Store capability info
        const capKey = `${cap.scope?.lensName || '*'}:inbound`;
        partner.capabilities![capKey] = {
          token: cap.token,
          permissions: cap.permissions,
          scope: cap.scope,
          issuedAt: cap.receivedAt,
          direction: 'inbound'
        };
      }

      // Also load from legacy federation data for backwards compatibility
      // Use currentHolon since federation metadata is stored per-holon
      try {
        const currentHolonId = this.currentHolon;
        console.log('[FederationService] loadPartners - querying getFederation for:', currentHolonId);
        const federationData = await this.holosphere.getFederation(currentHolonId);
        console.log('[FederationService] loadPartners - getFederation result:', federationData);
        if (federationData?.federated) {
          for (const partnerHolonId of federationData.federated) {
            if (!partnersMap.has(partnerHolonId)) {
              const lensConfig = federationData.lensConfig?.[partnerHolonId] || { inbound: [], outbound: [] };
              const name = federationData.partnerNames?.[partnerHolonId];
              partnersMap.set(partnerHolonId, {
                id: partnerHolonId,
                name,
                pubKey: partnerHolonId,
                status: 'connected',
                lensConfig: {
                  inbound: Array.isArray(lensConfig.inbound) ? lensConfig.inbound : [],
                  outbound: Array.isArray(lensConfig.outbound) ? lensConfig.outbound : []
                },
                createdAt: Date.now()
              });
            } else {
              // Merge name and lensConfig if available
              const name = federationData.partnerNames?.[partnerHolonId];
              const lensConfig = federationData.lensConfig?.[partnerHolonId];
              if (name || lensConfig) {
                const partner = partnersMap.get(partnerHolonId)!;
                if (name) partner.name = name;
                if (lensConfig) {
                  // Merge lens configs
                  if (Array.isArray(lensConfig.inbound)) {
                    lensConfig.inbound.forEach((l: string) => {
                      if (!partner.lensConfig.inbound.includes(l)) {
                        partner.lensConfig.inbound.push(l);
                      }
                    });
                  }
                  if (Array.isArray(lensConfig.outbound)) {
                    lensConfig.outbound.forEach((l: string) => {
                      if (!partner.lensConfig.outbound.includes(l)) {
                        partner.lensConfig.outbound.push(l);
                      }
                    });
                  }
                }
              }
            }
          }
        }
      } catch {
        // Legacy API may not be available
      }

      // Symmetric storage: Query each partner's federation data to see what they share with us
      // Their outbound to us = our inbound from them
      for (const [pubKey, partner] of partnersMap) {
        try {
          const partnerFedData = await this.holosphere.getFederation(pubKey);
          if (partnerFedData?.lensConfig?.[this.myPubKey]) {
            const theirConfigToUs = partnerFedData.lensConfig[this.myPubKey];
            // Their outbound to us becomes our inbound from them
            if (Array.isArray(theirConfigToUs.outbound)) {
              theirConfigToUs.outbound.forEach((lens: string) => {
                if (!partner.lensConfig.inbound.includes(lens)) {
                  partner.lensConfig.inbound.push(lens);
                }
              });
            }
          }
        } catch {
          // Partner's federation data not accessible
        }
      }
    } catch (err) {
      console.warn('Failed to load federation partners:', err);
    }

    // Note: Federated holon -> owner mapping is now handled inside holosphere2
    // When storeInboundCapability() is called, it registers the mapping automatically

    this.state.update(s => ({ ...s, partners: Array.from(partnersMap.values()) }));
  }

  /**
   * Link with a partner - V2 API
   * Creates a direct capability grant (no DM handshake needed)
   */
  async link(
    targetPubKey: string,
    lensConfig: LensConfig,
    options: { alias?: string } = {}
  ): Promise<{ capabilities: string[] }> {
    this.state.update(s => ({ ...s, loading: true, error: null }));

    const capabilities: string[] = [];

    try {
      // Create outbound links for each lens we're sharing
      for (const lensName of lensConfig.outbound) {
        const { capability, linkId } = await this.holosphere.link(
          targetPubKey,
          { holonId: this.myPubKey, lensName, dataId: '*' },
          { permissions: ['read'], alias: options.alias }
        );
        capabilities.push(linkId);
      }

      // Store federation metadata so partner can discover what we share with them
      await this.storeFederationMetadata(targetPubKey, lensConfig, options.alias);

      await this.loadPartners();
      this.state.update(s => ({ ...s, loading: false }));
      return { capabilities };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Link failed';
      this.state.update(s => ({ ...s, loading: false, error: message }));
      throw error;
    }
  }

  /**
   * Store federation metadata for symmetric discovery
   * Partners can query this to see what we're sharing with them
   * Uses writeGlobal to store in the same location getFederation reads from
   *
   * Note: Federation metadata is stored per-holon (currentHolon) for propagation,
   * while capability scope uses pubkey for reading.
   */
  private async storeFederationMetadata(
    targetPubKey: string,
    lensConfig: LensConfig,
    alias?: string
  ): Promise<void> {
    // Use currentHolon for federation metadata (where propagation happens from)
    // This is the holon the user is currently viewing/managing
    const holonId = this.currentHolon;
    if (!holonId) {
      console.warn('[FederationService] Cannot store metadata: no holon ID set');
      return;
    }

    try {
      // Get current federation data from the global table
      let federationData: any = {};
      try {
        federationData = await this.holosphere.getFederation(holonId) || {};
      } catch {
        federationData = {};
      }

      // Initialize structures if needed
      federationData.id = holonId; // Required for writeGlobal to identify the record
      if (!federationData.federated) federationData.federated = [];
      if (!federationData.outbound) federationData.outbound = [];
      if (!federationData.inbound) federationData.inbound = [];
      if (!federationData.lensConfig) federationData.lensConfig = {};
      if (!federationData.partnerNames) federationData.partnerNames = {};

      // Add partner to federated and outbound lists if not already there
      if (!federationData.federated.includes(targetPubKey)) {
        federationData.federated.push(targetPubKey);
      }
      if (!federationData.outbound.includes(targetPubKey)) {
        federationData.outbound.push(targetPubKey);
      }

      // Store lens config for this partner
      federationData.lensConfig[targetPubKey] = {
        inbound: lensConfig.inbound || [],
        outbound: lensConfig.outbound || []
      };

      // Store partner name if provided
      if (alias) {
        federationData.partnerNames[targetPubKey] = alias;
      }

      // Save to global federation table (same place getFederation reads from)
      console.log('[FederationService] STORING federation metadata:', {
        holonId,
        targetPubKey,
        federationData
      });
      await this.holosphere.writeGlobal('federation', federationData);

      // Verify it was stored
      const verify = await this.holosphere.getFederation(holonId);
      console.log('[FederationService] VERIFY after store - getFederation result:', verify);

      console.log('[FederationService] Stored federation metadata for', holonId, ':', {
        targetPubKey,
        lensConfig,
        federatedCount: federationData.federated.length,
        outboundCount: federationData.outbound.length
      });
    } catch (err) {
      console.warn('[FederationService] Failed to store federation metadata:', err);
      // Don't throw - this is supplementary storage
    }
  }

  /**
   * Unlink from a partner - V2 API
   * Revokes all capabilities to the partner and removes federation metadata
   */
  async unlink(targetPubKey: string, scope?: { lensName?: string }): Promise<{ revoked: string[] }> {
    this.state.update(s => ({ ...s, loading: true, error: null }));

    try {
      const result = await this.holosphere.unlink(targetPubKey, scope ? {
        holonId: '*',
        lensName: scope.lensName
      } : undefined);

      // Also remove from federation metadata in global table
      await this.removeFederationMetadata(targetPubKey);

      await this.loadPartners();
      this.state.update(s => ({ ...s, loading: false }));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unlink failed';
      this.state.update(s => ({ ...s, loading: false, error: message }));
      throw error;
    }
  }

  /**
   * Remove federation metadata for a partner from the global table
   */
  private async removeFederationMetadata(targetPubKey: string): Promise<void> {
    const holonId = this.currentHolon;
    if (!holonId) return;

    try {
      const federationData = await this.holosphere.getFederation(holonId);
      if (!federationData) return;

      // Remove partner from all arrays
      federationData.federated = (federationData.federated || []).filter((p: string) => p !== targetPubKey);
      federationData.outbound = (federationData.outbound || []).filter((p: string) => p !== targetPubKey);
      federationData.inbound = (federationData.inbound || []).filter((p: string) => p !== targetPubKey);

      // Remove lens config and name for this partner
      if (federationData.lensConfig) {
        delete federationData.lensConfig[targetPubKey];
      }
      if (federationData.partnerNames) {
        delete federationData.partnerNames[targetPubKey];
      }

      // Save updated federation data
      federationData.id = holonId;
      await this.holosphere.writeGlobal('federation', federationData);

      console.log('[FederationService] Removed federation metadata for', targetPubKey);
    } catch (err) {
      console.warn('[FederationService] Failed to remove federation metadata:', err);
    }
  }

  /**
   * Revoke a specific capability - V2 API
   */
  async revokeCapability(capabilityId: string, reason?: string): Promise<void> {
    await this.holosphere.revokeCapability(capabilityId, reason);
    await this.loadPartners();
  }

  /**
   * Get all capabilities - V2 API
   */
  async getCapabilities(options?: { issued?: boolean; received?: boolean; revoked?: boolean }) {
    return this.holosphere.getCapabilities(options);
  }

  /**
   * Store an inbound capability received from a partner - V2 API
   */
  async storeInboundCapability(
    issuerPubKey: string,
    capability: { token: string; scope: { holonId: string; lensName: string }; permissions: string[] }
  ): Promise<void> {
    await this.holosphere.storeInboundCapability(issuerPubKey, capability);
    await this.loadPartners();
  }

  /**
   * Read data from a federated source - V2 API
   * Uses the stored capability to access partner's data
   */
  async readFromFederatedSource(
    sourcePubKey: string,
    holonId: string,
    lensName: string,
    dataId?: string
  ): Promise<any> {
    return this.holosphere.readFromFederatedSource(sourcePubKey, holonId, lensName, dataId || null);
  }

  /**
   * Read data from a holon - automatically uses federated source if needed
   * holosphere2 now handles federation-aware reads internally via the holon registry
   */
  async read(holonId: string, lensName: string, dataId?: string): Promise<any> {
    return this.holosphere.read(holonId, lensName, dataId || null);
  }

  /**
   * Check if a holon is federated (owned by someone else)
   */
  isFederatedHolon(holonId: string): boolean {
    return this.federatedHolonSources.has(holonId);
  }

  /**
   * Get the source public key for a federated holon
   */
  getFederatedSource(holonId: string): string | undefined {
    return this.federatedHolonSources.get(holonId);
  }

  /**
   * Check for new incoming capabilities from partners
   * Discovers capabilities granted to us that we haven't seen before
   */
  async checkForNewCapabilities(): Promise<void> {
    try {
      const caps = await this.holosphere.getCapabilities({ received: true, revoked: false });
      const receivedCaps = caps.received || [];

      // Filter to only new capabilities we haven't seen
      const newCaps = receivedCaps.filter((c: any) => c.id && !this.knownCapabilityIds.has(c.id));

      if (newCaps.length > 0) {
        // Add new capabilities as pending requests for user to accept
        const pendingRequests = newCaps.map((cap: any) => ({
          id: cap.id,
          senderPubKey: cap.issuer,
          senderNpub: cap.issuer, // For display
          senderHolonId: cap.scope?.holonId || cap.issuer,
          senderHolonName: `Partner ${cap.issuer?.slice(0, 8)}...`,
          capabilityToken: cap.token,
          lensConfig: {
            outbound: cap.scope?.lensName ? [cap.scope.lensName] : [], // What they're offering us (their outbound = our inbound)
            inbound: []
          },
          direction: 'incoming',
          receivedAt: cap.receivedAt || Date.now()
        }));

        this.state.update(s => ({
          ...s,
          pendingRequests: [...s.pendingRequests, ...pendingRequests]
        }));

        // Mark as known so we don't show them again
        newCaps.forEach((c: any) => {
          if (c.id) this.knownCapabilityIds.add(c.id);
        });

        console.log(`[FederationService] Discovered ${newCaps.length} new incoming capabilities`);
      }
    } catch (err) {
      console.warn('[FederationService] Failed to check for new capabilities:', err);
    }
  }

  /**
   * Add a federated partner by public key
   */
  async addFederatedHolosphere(pubKey: string, options?: { alias?: string }): Promise<void> {
    await this.holosphere.addFederatedHolosphere(pubKey, options);
  }

  /** Get partner display name */
  getPartnerName(pubKey: string): string {
    let partners: FederationPartner[] = [];
    this.state.subscribe(s => partners = s.partners)();
    const partner = partners.find(p => p.pubKey === pubKey);
    if (partner?.name) return partner.name;
    return `${pubKey.slice(0, 8)}...${pubKey.slice(-4)}`;
  }

  // ============================================
  // Legacy API compatibility wrappers
  // ============================================

  /**
   * @deprecated Use link() instead
   */
  async federateHolon(
    targetHolon: string,
    lensConfig: LensConfig,
    options: { partnerName?: string; skipPropagation?: boolean } = {}
  ): Promise<boolean> {
    try {
      await this.link(targetHolon, lensConfig, { alias: options.partnerName });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @deprecated Use unlink() instead
   */
  async unfederateHolon(targetHolon: string): Promise<boolean> {
    try {
      await this.unlink(targetHolon);
      return true;
    } catch {
      return false;
    }
  }
}

// Factory and singleton
export function createFederationService(holosphere: HoloSphere): FederationService {
  return new FederationService(holosphere);
}

let instance: FederationService | null = null;

export function setFederationService(service: FederationService): void {
  instance = service;
}

export function getFederationService(): FederationService | null {
  return instance;
}
