import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { HolonsContract, type HolonBundle, type HolonMember, type TokenBalance, type HolonType, type FlowConfig } from './HolonsContract.js';
import { FlowSettings, type HolonSettings, type FlowVisualizationData, type LensType } from './FlowSettings.js';

export interface HolonsManagerEvents {
  'wallet:connected': (address: string) => void;
  'wallet:disconnected': () => void;
  'holon:created': (bundle: HolonBundle) => void;
  'holon:updated': (holonId: string, data: any) => void;
  'transaction:pending': (data: any) => void;
  'transaction:submitted': (data: any) => void;
  'transaction:success': (data: any) => void;
  'transaction:failed': (data: any) => void;
  'transaction:error': (data: any) => void;
  'flow:updated': (holonId: string, config: any) => void;
  'federation:added': (holonId: string, targetId: string) => void;
  'federation:removed': (holonId: string, targetId: string) => void;
  'members:added': (holonId: string, members: string[]) => void;
  'settings:updated': (holonId: string, settings: HolonSettings) => void;
}

/**
 * Main Holons Manager class that integrates smart contracts with flow visualization
 * Based on the original Holons.js and Settings.js but modernized for web frontend
 */
export class HolonsManager extends EventEmitter {
  private contract: HolonsContract;
  private flowSettings: FlowSettings;
  private gun: any;
  private currentHolon: string | null = null;
  private holonCache: Map<string, HolonBundle> = new Map();
  private settingsCache: Map<string, HolonSettings> = new Map();

  constructor(provider: ethers.Provider, gun: any) {
    super();
    
    // Create a separate EventEmitter for the contract to avoid circular references
    const contractEventEmitter = new EventEmitter();
    this.contract = new HolonsContract(provider, contractEventEmitter);
    this.flowSettings = new FlowSettings('');
    this.gun = gun;
    
    // Forward contract events
    this.setupEventForwarding(contractEventEmitter);
  }

  /**
   * Setup event forwarding from contract to manager
   */
  private setupEventForwarding(contractEventEmitter: EventEmitter): void {
    const events = [
      'wallet:connected', 'wallet:disconnected', 'transaction:pending',
      'transaction:submitted', 'transaction:success', 'transaction:failed', 'transaction:error'
    ];
    
    events.forEach(event => {
      contractEventEmitter.on(event, (data: any) => {
        // Forward the event from contract to manager listeners
        this.emit(event as any, data);
      });
    });
  }

  /**
   * Connect wallet for transactions
   */
  async connectWallet(signer: ethers.Signer): Promise<void> {
    await this.contract.connect(signer);
  }

  /**
   * Disconnect wallet
   */
  disconnectWallet(): void {
    this.contract.disconnect();
  }

  /**
   * Set current holon context
   */
  setCurrentHolon(holonId: string): void {
    this.currentHolon = holonId;
    this.flowSettings = new FlowSettings(holonId);
  }

  /**
   * Create a new Bundle holon
   */
  async createHolon(
    type: HolonType,
    creatorUserId: string,
    name: string,
    steepness?: bigint,
    nzones?: number
  ): Promise<{ transaction: ethers.TransactionResponse; holonId: string }> {
    const holonId = name;

    const tx = await this.contract.createHolon(type, creatorUserId, holonId, steepness, nzones);

    // Wait for transaction and emit event
    this.contract.waitForTransaction(tx, `Bundle holon created`).then(() => {
      this.emit('holon:created', {
        address: '',
        creatorUserId,
        name: holonId,
        timestamp: Date.now(),
        steepness: steepness || BigInt('500000000000000000'),
        nzones: nzones || 6
      } as HolonBundle);
    });

    return { transaction: tx, holonId };
  }

  /**
   * Check if the Holons registry is properly configured
   */
  async checkRegistryConfiguration() {
    return this.contract.checkRegistryConfiguration();
  }

  /**
   * Configure the Holons registry (set factories and register flavors)
   */
  async configureRegistry() {
    return this.contract.configureRegistry();
  }

  /**
   * Ensure registry is configured before deployment
   * Auto-configures if not set up
   */
  async ensureRegistryConfigured(): Promise<boolean> {
    const config = await this.checkRegistryConfiguration();

    if (!config.isConfigured) {
      console.log('[HolonsManager] Registry not configured. Missing:', config.missingItems);
      console.log('[HolonsManager] Attempting to configure registry...');

      const result = await this.configureRegistry();

      if (!result.success) {
        console.error('[HolonsManager] Failed to configure registry:', result.errors);
        return false;
      }

      console.log('[HolonsManager] Registry configured successfully');
    }

    return true;
  }

  /**
   * Create Bundle contract (recommended approach)
   * Uses direct deployment - no registry needed!
   */
  async createHolonBundle(
    creatorUserId: string,
    holonName: string,
    steepness?: bigint,
    nzones?: number
  ): Promise<{ transaction: ethers.TransactionResponse; holonId: string; address?: string }> {
    // Use direct deployment - simpler and doesn't need registry configuration
    console.log('[HolonsManager] Using direct Bundle deployment...');

    const result = await this.contract.deployBundleDirect(creatorUserId, holonName, steepness, nzones);

    // Cache the result immediately
    this.holonCache.set(holonName, result.bundle);
    this.emit('holon:created', result.bundle);

    return {
      transaction: result.transaction,
      holonId: holonName,
      address: result.address
    };
  }

  /**
   * Deploy Bundle directly (alias for createHolonBundle)
   */
  async deployBundleDirect(
    creatorUserId: string,
    holonName: string,
    steepness?: bigint,
    nzones?: number
  ) {
    return this.contract.deployBundleDirect(creatorUserId, holonName, steepness, nzones);
  }

  /**
   * Get holon bundle information
   */
  async getHolonBundle(holonId: string): Promise<HolonBundle | null> {
    // Check cache first
    if (this.holonCache.has(holonId)) {
      return this.holonCache.get(holonId)!;
    }
    
    const bundle = await this.contract.getHolonBundle(holonId);
    if (bundle) {
      this.holonCache.set(holonId, bundle);
    }
    
    return bundle;
  }

  /**
   * Add members to interior (Bundle contract)
   */
  async addMembersToInternal(holonId: string, userIds: string[]): Promise<ethers.TransactionResponse> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      throw new Error('Bundle not found');
    }

    const tx = await this.contract.addMembersToManaged(bundle.address, userIds);

    this.contract.waitForTransaction(tx, `Added ${userIds.length} members to Bundle`).then(() => {
      this.emit('members:added', holonId, userIds);
    });

    return tx;
  }

  /**
   * Add holons to exterior zones (Bundle contract)
   */
  async addHolonsToExternal(holonId: string, holonIds: string[]): Promise<ethers.TransactionResponse> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      throw new Error('Bundle not found');
    }

    const tx = await this.contract.addHolonsToZoned(bundle.address, holonIds);

    this.contract.waitForTransaction(tx, `Added ${holonIds.length} holons to exterior`).then(() => {
      this.emit('holon:updated', holonId, { type: 'holons_added', holonIds });
    });

    return tx;
  }

  /**
   * Update flow split ratio between interior and exterior
   */
  async updateFlowSplit(bundleAddress: string, interiorPercent: number): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setFlowSplit(bundleAddress, interiorPercent);

    this.contract.waitForTransaction(tx, `Flow split updated to ${interiorPercent}% interior`).then(() => {
      this.emit('flow:updated', bundleAddress, { interiorPercent, exteriorPercent: 100 - interiorPercent });
    });

    return tx;
  }

  /**
   * Set steepness parameter on Bundle contract
   */
  async setSteepness(bundleAddress: string, steepness: bigint): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setSteepness(bundleAddress, steepness);

    this.contract.waitForTransaction(tx, 'Steepness updated').then(() => {
      this.emit('flow:updated', bundleAddress, { steepness });
    });

    return tx;
  }

  /**
   * Set number of zones on Bundle contract
   */
  async setNzones(bundleAddress: string, nzones: number): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setNzones(bundleAddress, nzones);

    this.contract.waitForTransaction(tx, 'Zones updated').then(() => {
      this.emit('flow:updated', bundleAddress, { nzones });
    });

    return tx;
  }

  /**
   * Update interior members with their share percentages
   */
  async updateInteriorMembers(
    bundleAddress: string,
    members: Array<{ userId: string; sharePercent: number }>
  ): Promise<ethers.TransactionResponse> {
    const userIds = members.map(m => m.userId);
    const percentages = members.map(m => m.sharePercent);

    const tx = await this.contract.setInteriorSplit(bundleAddress, userIds, percentages);

    this.contract.waitForTransaction(tx, 'Interior members updated').then(() => {
      this.emit('members:updated', bundleAddress, { members });
    });

    return tx;
  }

  /**
   * Add members to the interior of a Bundle
   */
  async addInteriorMembers(
    bundleAddress: string,
    userIds: string[]
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.addInteriorMembers(bundleAddress, userIds);

    this.contract.waitForTransaction(tx, 'Members added').then(() => {
      this.emit('members:added', bundleAddress, { userIds });
    });

    return tx;
  }

  /**
   * Add a single member to the interior of a Bundle
   */
  async addMember(
    bundleAddress: string,
    userId: string
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.addMember(bundleAddress, userId);

    this.contract.waitForTransaction(tx, 'Member added').then(() => {
      this.emit('member:added', bundleAddress, { userId });
    });

    return tx;
  }

  /**
   * Assign a member to a zone in a Bundle contract
   */
  async assignToZone(
    bundleAddress: string,
    userId: string,
    zone: number
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.assignToZone(bundleAddress, userId, zone);

    this.contract.waitForTransaction(tx, `Member assigned to zone ${zone}`).then(() => {
      this.emit('member:zoneAssigned', bundleAddress, { userId, zone });
    });

    return tx;
  }

  /**
   * Batch assign members to zones in a Bundle contract
   */
  async assignMembersToZones(
    bundleAddress: string,
    assignments: Array<{ userId: string; zone: number }>
  ): Promise<ethers.TransactionResponse> {
    const userIds = assignments.map(a => a.userId);
    const zones = assignments.map(a => a.zone);

    const tx = await this.contract.assignMembersToZones(bundleAddress, userIds, zones);

    this.contract.waitForTransaction(tx, `${assignments.length} members assigned to zones`).then(() => {
      this.emit('members:zonesAssigned', bundleAddress, { assignments });
    });

    return tx;
  }

  /**
   * Get current flow configuration from Bundle contract
   */
  async getFlowConfiguration(bundleAddress: string): Promise<FlowConfig | null> {
    if (!bundleAddress) {
      return null;
    }

    try {
      return await this.contract.getFlowConfig(bundleAddress);
    } catch (error) {
      console.error('Error getting flow configuration:', error);
      return null;
    }
  }

  /**
   * Add federation link
   */
  async addFederationLink(
    holonId: string, 
    targetId: string, 
    targetName: string, 
    relationship: 'federated' | 'notifies'
  ): Promise<void> {
    await this.flowSettings.addFederationLink(this.gun, holonId, targetId, targetName, relationship);
    this.emit('federation:added', holonId, targetId);
  }

  /**
   * Remove federation link
   */
  async removeFederationLink(holonId: string, targetId: string): Promise<void> {
    await this.flowSettings.removeFederationLink(this.gun, holonId, targetId);
    this.emit('federation:removed', holonId, targetId);
  }

  /**
   * Toggle lens for federation
   */
  async toggleFederationLens(
    holonId: string,
    targetId: string, 
    lensType: LensType,
    relationship: 'federate' | 'notify'
  ): Promise<void> {
    await this.flowSettings.toggleLens(this.gun, holonId, targetId, lensType, relationship);
    
    const settings = await this.flowSettings.loadSettings(this.gun, holonId);
    this.emit('settings:updated', holonId, settings);
  }

  /**
   * Get holon members from Bundle contract
   */
  async getHolonMembers(holonId: string): Promise<HolonMember[]> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    return this.contract.getHolonMembers(bundle.address);
  }

  /**
   * Get token balances for Bundle contract
   */
  async getHolonBalances(holonId: string, tokenAddresses: string[]): Promise<TokenBalance[]> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    // Get balances for the Bundle contract (single address)
    return this.contract.getTokenBalances(bundle.address, tokenAddresses);
  }

  /**
   * Get interior members with their shares and balances
   */
  async getInteriorMembersWithBalances(holonId: string): Promise<{
    userId: string;
    share: bigint;
    sharePercent: number;
    etherBalance: bigint;
    etherFormatted: string;
  }[]> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    const members = await this.contract.getInteriorMembersWithBalances(bundle.address);

    // Calculate total shares for percentage
    const totalShares = members.reduce((sum, m) => sum + m.share, BigInt(0));

    return members.map(m => ({
      ...m,
      sharePercent: totalShares > 0 ? Number((m.share * BigInt(10000)) / totalShares) / 100 : 0,
      etherFormatted: ethers.formatEther(m.etherBalance)
    }));
  }

  /**
   * Generate comprehensive flow visualization
   */
  async generateFlowVisualization(holonId: string): Promise<FlowVisualizationData> {
    const [bundle, members, settings] = await Promise.all([
      this.getHolonBundle(holonId),
      this.getHolonMembers(holonId),
      this.flowSettings.loadSettings(this.gun, holonId)
    ]);
    
    if (!bundle) {
      throw new Error('Holon bundle not found');
    }
    
    // Get token balances for visualization
    const commonTokens = [
      process.env.VITE_TEST_TOKEN_ADDRESS || '0x...'
    ].filter(addr => addr !== '0x...');
    
    const tokenBalances = await this.getHolonBalances(holonId, commonTokens);
    
    return this.flowSettings.generateFlowVisualization(holonId, bundle, members, tokenBalances);
  }

  /**
   * Get holon settings
   */
  async getHolonSettings(holonId: string): Promise<HolonSettings> {
    if (this.settingsCache.has(holonId)) {
      return this.settingsCache.get(holonId)!;
    }
    
    const settings = await this.flowSettings.loadSettings(this.gun, holonId);
    this.settingsCache.set(holonId, settings);
    
    return settings;
  }

  /**
   * Update holon settings
   */
  async updateHolonSettings(holonId: string, updates: Partial<HolonSettings>): Promise<void> {
    await this.flowSettings.saveSettings(this.gun, holonId, updates);
    
    const updatedSettings = await this.getHolonSettings(holonId);
    this.settingsCache.set(holonId, updatedSettings);
    
    this.emit('settings:updated', holonId, updatedSettings);
  }

  /**
   * Get available holon types
   */
  async getAvailableHolonTypes(): Promise<HolonType[]> {
    return this.contract.getAvailableHolonTypes();
  }

  /**
   * Get holon type icon
   */
  getHolonTypeIcon(type: HolonType): string {
    return this.contract.getHolonIcon(type);
  }

  /**
   * Check if wallet is connected
   */
  isWalletConnected(): boolean {
    return this.contract.isConnected();
  }

  /**
   * Get connected wallet address
   */
  async getWalletAddress(): Promise<string | null> {
    return this.contract.getWalletAddress();
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.holonCache.clear();
    this.settingsCache.clear();
    this.flowSettings.clearCache();
  }

  /**
   * Subscribe to specific holon events
   */
  onHolonEvent(holonId: string, event: string, callback: Function): void {
    this.on(event, (eventHolonId: string, ...args: any[]) => {
      if (eventHolonId === holonId) {
        callback(...args);
      }
    });
  }

  /**
   * Get comprehensive holon status
   */
  async getHolonStatus(holonId: string): Promise<{
    bundle: HolonBundle | null;
    members: HolonMember[];
    settings: HolonSettings;
    balances: TokenBalance[];
    flowConfig: any;
    visualization: FlowVisualizationData;
  }> {
    console.log(`[HolonsManager] Getting holon status for: ${holonId}`);
    
    const [bundle, members, settings, flowConfig] = await Promise.all([
      this.getHolonBundle(holonId),
      this.getHolonMembers(holonId),
      this.getHolonSettings(holonId),
      this.getFlowConfiguration(holonId)
    ]);
    
    console.log(`[HolonsManager] Bundle result:`, bundle);
    console.log(`[HolonsManager] Members result:`, members);
    console.log(`[HolonsManager] Settings result:`, settings);
    
    const balances = bundle ? await this.getHolonBalances(holonId, []) : [];
    const visualization = await this.generateFlowVisualization(holonId);
    
    const status = {
      bundle,
      members,
      settings,
      balances,
      flowConfig,
      visualization
    };
    
    console.log(`[HolonsManager] Final holon status:`, status);
    
    return status;
  }
}