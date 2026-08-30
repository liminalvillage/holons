import EventEmitter from "eventemitter3";
import { ethers } from "ethers";
import type { HoloSphere } from "holosphere";
import {
  HolonsContract,
  type HolonBundle,
  type HolonMember,
  type TokenBalance,
  type HolonType,
  type FlowConfig,
} from "./HolonsContract.js";
import {
  FlowSettings,
  type HolonSettings,
  type FlowVisualizationData,
} from "./FlowSettings.js";
import {
  getFederationSnapshot,
  removeFederationPartner,
  setFederationPartner,
} from "@holons/core/federation";

export interface HolonsManagerEvents {
  "wallet:connected": (address: string) => void;
  "wallet:disconnected": () => void;
  "holon:created": (bundle: HolonBundle) => void;
  "holon:updated": (holonId: string, data: any) => void;
  "transaction:pending": (data: any) => void;
  "transaction:submitted": (data: any) => void;
  "transaction:success": (data: any) => void;
  "transaction:failed": (data: any) => void;
  "transaction:error": (data: any) => void;
  "flow:updated": (holonId: string, config: any) => void;
  "federation:added": (holonId: string, targetId: string) => void;
  "federation:removed": (holonId: string, targetId: string) => void;
  "members:added": (holonId: string, members: string[]) => void;
  "settings:updated": (holonId: string, settings: HolonSettings) => void;
}

/**
 * Main Holons Manager class that integrates smart contracts with flow visualization.
 *
 * This class serves as the primary interface for managing holons (decentralized organizational units)
 * in the Holons ecosystem. It combines smart contract interactions with flow visualization
 * and settings management.
 *
 * Based on the original Holons.js and Settings.js but modernized for web frontend usage.
 * Updated to use holosphere2 API instead of direct Gun access.
 *
 * @class HolonsManager
 * @extends EventEmitter
 *
 * @fires HolonsManager#wallet:connected - When a wallet is successfully connected
 * @fires HolonsManager#wallet:disconnected - When a wallet is disconnected
 * @fires HolonsManager#holon:created - When a new holon is created
 * @fires HolonsManager#holon:updated - When a holon is updated
 * @fires HolonsManager#transaction:pending - When a transaction is pending
 * @fires HolonsManager#transaction:submitted - When a transaction is submitted
 * @fires HolonsManager#transaction:success - When a transaction succeeds
 * @fires HolonsManager#transaction:failed - When a transaction fails
 * @fires HolonsManager#flow:updated - When flow configuration is updated
 * @fires HolonsManager#federation:added - When a federation link is added
 * @fires HolonsManager#federation:removed - When a federation link is removed
 * @fires HolonsManager#members:added - When members are added to a holon
 * @fires HolonsManager#settings:updated - When holon settings are updated
 *
 * @example
 * ```typescript
 * import { HolonsManager } from './HolonsManager';
 * import { ethers } from 'ethers';
 *
 * const provider = new ethers.JsonRpcProvider('https://...');
 * const holosphere = new HoloSphere({ ... }); // HoloSphere instance
 *
 * const manager = new HolonsManager(provider, holosphere);
 *
 * // Connect wallet
 * await manager.connectWallet(signer);
 *
 * // Create a new holon bundle
 * const { holonId, address } = await manager.createHolonBundle(
 *   'user123',
 *   'MyHolon',
 *   BigInt('500000000000000000'), // 50% steepness
 *   6 // number of zones
 * );
 * ```
 */
export class HolonsManager extends EventEmitter {
  private contract: HolonsContract;
  private flowSettings: FlowSettings;
  private holosphere: HoloSphere;
  private currentHolon: string | null = null;
  private holonCache: Map<string, HolonBundle> = new Map();
  private settingsCache: Map<string, HolonSettings> = new Map();

  /**
   * Creates a new HolonsManager instance.
   *
   * @param {ethers.Provider} provider - The ethers.js provider for blockchain interactions
   * @param {HoloSphere} holosphere - The holosphere instance for decentralized data storage
   */
  constructor(provider: ethers.Provider, holosphere: HoloSphere) {
    super();

    // Create a separate EventEmitter for the contract to avoid circular references
    const contractEventEmitter = new EventEmitter();
    this.contract = new HolonsContract(provider, contractEventEmitter);
    this.flowSettings = new FlowSettings("");
    this.holosphere = holosphere;

    // Forward contract events
    this.setupEventForwarding(contractEventEmitter);
  }

  /**
   * Sets up event forwarding from the contract EventEmitter to the manager.
   *
   * @private
   * @param {EventEmitter} contractEventEmitter - The contract's event emitter instance
   * @returns {void}
   */
  private setupEventForwarding(contractEventEmitter: EventEmitter): void {
    const events = [
      "wallet:connected",
      "wallet:disconnected",
      "transaction:pending",
      "transaction:submitted",
      "transaction:success",
      "transaction:failed",
      "transaction:error",
    ];

    events.forEach((event) => {
      contractEventEmitter.on(event, (data: any) => {
        // Forward the event from contract to manager listeners
        this.emit(event as any, data);
      });
    });
  }

  /**
   * Connects a wallet signer for executing blockchain transactions.
   *
   * @async
   * @param {ethers.Signer} signer - The ethers.js signer instance
   * @returns {Promise<void>}
   * @fires HolonsManager#wallet:connected
   */
  async connectWallet(signer: ethers.Signer): Promise<void> {
    await this.contract.connect(signer);
  }

  /**
   * Disconnects the current wallet and clears the signer.
   *
   * @returns {void}
   * @fires HolonsManager#wallet:disconnected
   */
  disconnectWallet(): void {
    this.contract.disconnect();
  }

  /**
   * Sets the current holon context for subsequent operations.
   *
   * @param {string} holonId - The unique identifier of the holon
   * @returns {void}
   */
  setCurrentHolon(holonId: string): void {
    this.currentHolon = holonId;
    this.flowSettings = new FlowSettings(holonId);
  }

  /**
   * Creates a new holon of the specified type.
   *
   * @async
   * @param {HolonType} type - The type of holon to create
   * @param {string} creatorUserId - The user ID of the creator
   * @param {string} name - The name of the holon
   * @param {bigint} [steepness] - Zone decay factor (default: 0.5e18 = 50% decay)
   * @param {number} [nzones] - Number of zones (default: 6)
   * @returns {Promise<{transaction: ethers.TransactionResponse, holonId: string}>}
   * @fires HolonsManager#holon:created
   */
  async createHolon(
    type: HolonType,
    creatorUserId: string,
    name: string,
    steepness?: bigint,
    nzones?: number,
  ): Promise<{ transaction: ethers.TransactionResponse; holonId: string }> {
    const holonId = name;

    const tx = await this.contract.createHolon(
      type,
      creatorUserId,
      holonId,
      steepness,
      nzones,
    );

    // Wait for transaction and emit event
    this.contract.waitForTransaction(tx, `Bundle holon created`).then(() => {
      this.emit("holon:created", {
        address: "",
        creatorUserId,
        name: holonId,
        timestamp: Date.now(),
        steepness: steepness || BigInt("500000000000000000"),
        nzones: nzones || 6,
      } as HolonBundle);
    });

    return { transaction: tx, holonId };
  }

  /**
   * Checks if the Holons registry is properly configured with factories and flavors.
   *
   * @async
   * @returns {Promise<{isConfigured: boolean, managedFactory: string|null, zonedFactory: string|null, splitterFlavor: string|null, missingItems: string[]}>}
   */
  async checkRegistryConfiguration() {
    return this.contract.checkRegistryConfiguration();
  }

  /**
   * Configures the Holons registry by setting factories and registering flavors.
   *
   * @async
   * @returns {Promise<{success: boolean, transactions: string[], errors: string[]}>}
   */
  async configureRegistry() {
    return this.contract.configureRegistry();
  }

  /**
   * Ensures the registry is configured before deployment.
   * Auto-configures if not already set up.
   *
   * @async
   * @returns {Promise<boolean>} True if registry is configured, false otherwise
   */
  async ensureRegistryConfigured(): Promise<boolean> {
    const config = await this.checkRegistryConfiguration();

    if (!config.isConfigured) {
      console.log(
        "[HolonsManager] Registry not configured. Missing:",
        config.missingItems,
      );
      console.log("[HolonsManager] Attempting to configure registry...");

      const result = await this.configureRegistry();

      if (!result.success) {
        console.error(
          "[HolonsManager] Failed to configure registry:",
          result.errors,
        );
        return false;
      }

      console.log("[HolonsManager] Registry configured successfully");
    }

    return true;
  }

  /**
   * Creates a Bundle holon contract using direct deployment.
   * This is the recommended approach as it doesn't require registry configuration.
   *
   * @async
   * @param {string} creatorUserId - The user ID of the creator
   * @param {string} holonName - The name of the holon
   * @param {bigint} [steepness] - Zone decay factor (default: 0.5e18 = 50% decay per zone)
   * @param {number} [nzones] - Number of zones (default: 6)
   * @returns {Promise<{transaction: ethers.TransactionResponse, holonId: string, address?: string}>}
   * @fires HolonsManager#holon:created
   */
  async createHolonBundle(
    creatorUserId: string,
    holonName: string,
    steepness?: bigint,
    nzones?: number,
  ): Promise<{
    transaction: ethers.TransactionResponse;
    holonId: string;
    address?: string;
  }> {
    // Use direct deployment - simpler and doesn't need registry configuration
    console.log("[HolonsManager] Using direct Bundle deployment...");

    const result = await this.contract.deployBundleDirect(
      creatorUserId,
      holonName,
      steepness,
      nzones,
    );

    // Cache the result immediately
    this.holonCache.set(holonName, result.bundle);
    this.emit("holon:created", result.bundle);

    return {
      transaction: result.transaction,
      holonId: holonName,
      address: result.address,
    };
  }

  /**
   * Deploys a Bundle contract directly (alias for createHolonBundle).
   *
   * @async
   * @param {string} creatorUserId - The user ID of the creator
   * @param {string} holonName - The name of the holon
   * @param {bigint} [steepness] - Zone decay factor
   * @param {number} [nzones] - Number of zones
   * @returns {Promise<{address: string, transaction: ethers.TransactionResponse, bundle: HolonBundle}>}
   */
  async deployBundleDirect(
    creatorUserId: string,
    holonName: string,
    steepness?: bigint,
    nzones?: number,
  ) {
    return this.contract.deployBundleDirect(
      creatorUserId,
      holonName,
      steepness,
      nzones,
    );
  }

  /**
   * Retrieves holon bundle information by ID.
   * Uses caching for improved performance.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<HolonBundle | null>} The holon bundle or null if not found
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
   * Adds members to the interior of a Bundle contract.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @param {string[]} userIds - Array of user IDs to add
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#members:added
   * @throws {Error} If bundle not found
   */
  async addMembersToInternal(
    holonId: string,
    userIds: string[],
  ): Promise<ethers.TransactionResponse> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      throw new Error("Bundle not found");
    }

    const tx = await this.contract.addMembersToManaged(bundle.address, userIds);

    this.contract
      .waitForTransaction(tx, `Added ${userIds.length} members to Bundle`)
      .then(() => {
        this.emit("members:added", holonId, userIds);
      });

    return tx;
  }

  /**
   * Adds holons to exterior zones of a Bundle contract.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @param {string[]} holonIds - Array of holon IDs to add to exterior
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#holon:updated
   * @throws {Error} If bundle not found
   */
  async addHolonsToExternal(
    holonId: string,
    holonIds: string[],
  ): Promise<ethers.TransactionResponse> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      throw new Error("Bundle not found");
    }

    const tx = await this.contract.addHolonsToZoned(bundle.address, holonIds);

    this.contract
      .waitForTransaction(tx, `Added ${holonIds.length} holons to exterior`)
      .then(() => {
        this.emit("holon:updated", holonId, { type: "holons_added", holonIds });
      });

    return tx;
  }

  /**
   * Updates the flow split ratio between interior and exterior.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {number} interiorPercent - The percentage allocated to interior (0-100)
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#flow:updated
   */
  async updateFlowSplit(
    bundleAddress: string,
    interiorPercent: number,
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setFlowSplit(bundleAddress, interiorPercent);

    this.contract
      .waitForTransaction(
        tx,
        `Flow split updated to ${interiorPercent}% interior`,
      )
      .then(() => {
        this.emit("flow:updated", bundleAddress, {
          interiorPercent,
          exteriorPercent: 100 - interiorPercent,
        });
      });

    return tx;
  }

  /**
   * Sets the steepness parameter on a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {bigint} steepness - The steepness value (WAD scale, e.g., 0.5e18)
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#flow:updated
   */
  async setSteepness(
    bundleAddress: string,
    steepness: bigint,
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setSteepness(bundleAddress, steepness);

    this.contract.waitForTransaction(tx, "Steepness updated").then(() => {
      this.emit("flow:updated", bundleAddress, { steepness });
    });

    return tx;
  }

  /**
   * Sets the number of zones on a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {number} nzones - The number of zones
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#flow:updated
   */
  async setNzones(
    bundleAddress: string,
    nzones: number,
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.setNzones(bundleAddress, nzones);

    this.contract.waitForTransaction(tx, "Zones updated").then(() => {
      this.emit("flow:updated", bundleAddress, { nzones });
    });

    return tx;
  }

  /**
   * Updates interior members with their share percentages.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {Array<{userId: string, sharePercent: number}>} members - Array of members with their share percentages
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   */
  async updateInteriorMembers(
    bundleAddress: string,
    members: Array<{ userId: string; sharePercent: number }>,
  ): Promise<ethers.TransactionResponse> {
    const userIds = members.map((m) => m.userId);
    const percentages = members.map((m) => m.sharePercent);

    const tx = await this.contract.setInteriorSplit(
      bundleAddress,
      userIds,
      percentages,
    );

    this.contract
      .waitForTransaction(tx, "Interior members updated")
      .then(() => {
        this.emit("members:updated", bundleAddress, { members });
      });

    return tx;
  }

  /**
   * Adds members to the interior of a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {string[]} userIds - Array of user IDs to add
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#members:added
   */
  async addInteriorMembers(
    bundleAddress: string,
    userIds: string[],
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.addInteriorMembers(bundleAddress, userIds);

    this.contract.waitForTransaction(tx, "Members added").then(() => {
      this.emit("members:added", bundleAddress, { userIds });
    });

    return tx;
  }

  /**
   * Adds a single member to the interior of a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {string} userId - The user ID to add
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#member:added
   */
  async addMember(
    bundleAddress: string,
    userId: string,
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.addMember(bundleAddress, userId);

    this.contract.waitForTransaction(tx, "Member added").then(() => {
      this.emit("member:added", bundleAddress, { userId });
    });

    return tx;
  }

  /**
   * Assigns a member to a specific zone in a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {string} userId - The user ID to assign
   * @param {number} zone - The zone number to assign to
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#member:zoneAssigned
   */
  async assignToZone(
    bundleAddress: string,
    userId: string,
    zone: number,
  ): Promise<ethers.TransactionResponse> {
    const tx = await this.contract.assignToZone(bundleAddress, userId, zone);

    this.contract
      .waitForTransaction(tx, `Member assigned to zone ${zone}`)
      .then(() => {
        this.emit("member:zoneAssigned", bundleAddress, { userId, zone });
      });

    return tx;
  }

  /**
   * Batch assigns members to zones in a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {Array<{userId: string, zone: number}>} assignments - Array of zone assignments
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#members:zonesAssigned
   */
  async assignMembersToZones(
    bundleAddress: string,
    assignments: Array<{ userId: string; zone: number }>,
  ): Promise<ethers.TransactionResponse> {
    const userIds = assignments.map((a) => a.userId);
    const zones = assignments.map((a) => a.zone);

    const tx = await this.contract.assignMembersToZones(
      bundleAddress,
      userIds,
      zones,
    );

    this.contract
      .waitForTransaction(tx, `${assignments.length} members assigned to zones`)
      .then(() => {
        this.emit("members:zonesAssigned", bundleAddress, { assignments });
      });

    return tx;
  }

  /**
   * Syncs all Bundle parameters in a single transaction.
   * This is the most efficient way to update multiple parameters at once.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @param {Object} params - The parameters to sync
   * @param {number} params.interiorPercent - Interior percentage (0-100)
   * @param {bigint} params.steepness - Steepness value (WAD scale)
   * @param {number} params.nzones - Number of zones
   * @param {Array<{userId: string, percentage: number}>} params.interiorMembers - Interior members with percentages
   * @param {Array<{userId: string, zone: number}>} params.exteriorMembers - Exterior members with zones
   * @returns {Promise<ethers.TransactionResponse>} The transaction response
   * @fires HolonsManager#bundle:synced
   */
  async syncAll(
    bundleAddress: string,
    params: {
      interiorPercent: number; // 0-100
      steepness: bigint; // WAD scale
      nzones: number;
      interiorMembers: Array<{ userId: string; percentage: number }>; // percentage 0-100
      exteriorMembers: Array<{ userId: string; zone: number }>;
    },
  ): Promise<ethers.TransactionResponse> {
    const exteriorPercent = 100 - params.interiorPercent;

    // Filter out members with 0 or negative percentage
    const validInteriorMembers = params.interiorMembers.filter(
      (m) => m.percentage > 0,
    );

    // Convert interior percentages to basis points (must sum to 10000)
    let interiorUserIds: string[] = [];
    let interiorPercentages: number[] = [];

    if (validInteriorMembers.length > 0) {
      // Normalize percentages to sum to 10000 basis points
      const totalPercentage = validInteriorMembers.reduce(
        (sum, m) => sum + m.percentage,
        0,
      );
      if (totalPercentage > 0) {
        interiorUserIds = validInteriorMembers.map((m) => m.userId);
        interiorPercentages = validInteriorMembers.map((m, i, arr) => {
          if (i === arr.length - 1) {
            // Last one gets the remainder to ensure exact sum of 10000
            const sumSoFar = arr
              .slice(0, i)
              .reduce(
                (sum, _, j) =>
                  sum +
                  Math.round(
                    (validInteriorMembers[j].percentage / totalPercentage) *
                      10000,
                  ),
                0,
              );
            return 10000 - sumSoFar;
          }
          return Math.round((m.percentage / totalPercentage) * 10000);
        });
      }
    }

    // Filter out exterior members with invalid zones
    const validExteriorMembers = params.exteriorMembers.filter(
      (m) => m.zone >= 1,
    );
    const exteriorUserIds = validExteriorMembers.map((m) => m.userId);
    const exteriorZones = validExteriorMembers.map((m) => m.zone);

    const tx = await this.contract.syncAll(bundleAddress, {
      interiorPercent: params.interiorPercent,
      exteriorPercent,
      steepness: params.steepness,
      nzones: params.nzones,
      interiorUserIds,
      interiorPercentages,
      exteriorUserIds,
      exteriorZones,
    });

    this.contract.waitForTransaction(tx, "Bundle synced").then(() => {
      this.emit("bundle:synced", bundleAddress);
    });

    return tx;
  }

  /**
   * Gets the current flow configuration from a Bundle contract.
   *
   * @async
   * @param {string} bundleAddress - The address of the Bundle contract
   * @returns {Promise<FlowConfig | null>} The flow configuration or null if not found
   */
  async getFlowConfiguration(
    bundleAddress: string,
  ): Promise<FlowConfig | null> {
    if (!bundleAddress) {
      return null;
    }

    try {
      return await this.contract.getFlowConfig(bundleAddress);
    } catch (error) {
      console.error("Error getting flow configuration:", error);
      return null;
    }
  }

  /**
   * Adds (or updates) a federation partner on the native federation record —
   * the single federation store, honored by federated reads and publishing.
   * Preserves any lens config the partner already has.
   *
   * @async
   * @param {string} holonId - The source holon ID
   * @param {string} targetId - The target holon ID
   * @param {string} targetName - The name of the target holon
   * @returns {Promise<void>}
   * @fires HolonsManager#federation:added
   */
  async addFederationLink(
    holonId: string,
    targetId: string,
    targetName: string,
  ): Promise<void> {
    const snapshot = await getFederationSnapshot(this.holosphere, holonId);
    const existing = snapshot.lensConfig[targetId];
    await setFederationPartner(this.holosphere, holonId, targetId, {
      inbound: existing?.inbound ?? [],
      outbound: existing?.outbound ?? [],
      partnerName: targetName,
    });
    this.emit("federation:added", holonId, targetId);
  }

  /**
   * Removes a federation partner from the native federation record.
   *
   * @async
   * @param {string} holonId - The source holon ID
   * @param {string} targetId - The target holon ID to remove
   * @returns {Promise<void>}
   * @fires HolonsManager#federation:removed
   */
  async removeFederationLink(holonId: string, targetId: string): Promise<void> {
    await removeFederationPartner(this.holosphere, holonId, targetId);
    this.emit("federation:removed", holonId, targetId);
  }

  /**
   * Gets holon members from a Bundle contract.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<HolonMember[]>} Array of holon members
   */
  async getHolonMembers(holonId: string): Promise<HolonMember[]> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    return this.contract.getHolonMembers(bundle.address);
  }

  /**
   * Gets token balances for a Bundle contract.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @param {string[]} tokenAddresses - Array of ERC20 token addresses to check
   * @returns {Promise<TokenBalance[]>} Array of token balances
   */
  async getHolonBalances(
    holonId: string,
    tokenAddresses: string[],
  ): Promise<TokenBalance[]> {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    // Get balances for the Bundle contract (single address)
    return this.contract.getTokenBalances(bundle.address, tokenAddresses);
  }

  /**
   * Gets interior members with their shares and ether balances.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<Array<{userId: string, share: bigint, sharePercent: number, etherBalance: bigint, etherFormatted: string}>>}
   */
  async getInteriorMembersWithBalances(holonId: string): Promise<
    {
      userId: string;
      share: bigint;
      sharePercent: number;
      etherBalance: bigint;
      etherFormatted: string;
    }[]
  > {
    const bundle = await this.getHolonBundle(holonId);
    if (!bundle || !bundle.address) {
      return [];
    }

    const members = await this.contract.getInteriorMembersWithBalances(
      bundle.address,
    );

    // Calculate total shares for percentage
    const totalShares = members.reduce((sum, m) => sum + m.share, BigInt(0));

    return members.map((m) => ({
      ...m,
      sharePercent:
        totalShares > 0
          ? Number((m.share * BigInt(10000)) / totalShares) / 100
          : 0,
      etherFormatted: ethers.formatEther(m.etherBalance),
    }));
  }

  /**
   * Generates comprehensive flow visualization data for a holon.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<FlowVisualizationData>} The flow visualization data
   * @throws {Error} If holon bundle not found
   */
  async generateFlowVisualization(
    holonId: string,
  ): Promise<FlowVisualizationData> {
    const [bundle, members, , snapshot] = await Promise.all([
      this.getHolonBundle(holonId),
      this.getHolonMembers(holonId),
      this.flowSettings.loadSettings(this.holosphere, holonId),
      getFederationSnapshot(this.holosphere, holonId).catch(() => ({
        federated: [] as string[],
        lensConfig: {} as Record<
          string,
          { inbound: string[]; outbound: string[] }
        >,
        partnerNames: {} as Record<string, string>,
      })),
    ]);

    if (!bundle) {
      throw new Error("Holon bundle not found");
    }

    // Get token balances for visualization
    const commonTokens = [
      process.env.VITE_TEST_TOKEN_ADDRESS || "0x...",
    ].filter((addr) => addr !== "0x...");

    const tokenBalances = await this.getHolonBalances(holonId, commonTokens);

    // Federation nodes/edges come from the native federation record.
    const partners = snapshot.federated.map((id) => ({
      id,
      name: snapshot.partnerNames[id] ?? id,
      inbound: snapshot.lensConfig[id]?.inbound ?? [],
      outbound: snapshot.lensConfig[id]?.outbound ?? [],
    }));

    return this.flowSettings.generateFlowVisualization(
      holonId,
      bundle,
      members,
      tokenBalances,
      partners,
    );
  }

  /**
   * Gets holon settings from cache or loads from holosphere.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<HolonSettings>} The holon settings
   */
  async getHolonSettings(holonId: string): Promise<HolonSettings> {
    if (this.settingsCache.has(holonId)) {
      return this.settingsCache.get(holonId)!;
    }

    const settings = await this.flowSettings.loadSettings(
      this.holosphere,
      holonId,
    );
    this.settingsCache.set(holonId, settings);

    return settings;
  }

  /**
   * Updates holon settings and persists to holosphere.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @param {Partial<HolonSettings>} updates - The settings updates to apply
   * @returns {Promise<void>}
   * @fires HolonsManager#settings:updated
   */
  async updateHolonSettings(
    holonId: string,
    updates: Partial<HolonSettings>,
  ): Promise<void> {
    await this.flowSettings.saveSettings(this.holosphere, holonId, updates);

    const updatedSettings = await this.getHolonSettings(holonId);
    this.settingsCache.set(holonId, updatedSettings);

    this.emit("settings:updated", holonId, updatedSettings);
  }

  /**
   * Gets available holon types/flavors from the registry.
   *
   * @async
   * @returns {Promise<HolonType[]>} Array of available holon types
   */
  async getAvailableHolonTypes(): Promise<HolonType[]> {
    return this.contract.getAvailableHolonTypes();
  }

  /**
   * Gets the emoji icon for a holon type.
   *
   * @param {HolonType} type - The holon type
   * @returns {string} The emoji icon
   */
  getHolonTypeIcon(type: HolonType): string {
    return this.contract.getHolonIcon(type);
  }

  /**
   * Checks if a wallet is currently connected.
   *
   * @returns {boolean} True if wallet is connected
   */
  isWalletConnected(): boolean {
    return this.contract.isConnected();
  }

  /**
   * Gets the connected wallet address.
   *
   * @async
   * @returns {Promise<string | null>} The wallet address or null if not connected
   */
  async getWalletAddress(): Promise<string | null> {
    return this.contract.getWalletAddress();
  }

  /**
   * Clears all internal caches (holon cache, settings cache, and flow settings cache).
   *
   * @returns {void}
   */
  clearCache(): void {
    this.holonCache.clear();
    this.settingsCache.clear();
    this.flowSettings.clearCache();
  }

  /**
   * Subscribes to events for a specific holon.
   *
   * @param {string} holonId - The unique identifier of the holon
   * @param {string} event - The event name to subscribe to
   * @param {Function} callback - The callback function to invoke
   * @returns {void}
   */
  onHolonEvent(holonId: string, event: string, callback: Function): void {
    this.on(event, (eventHolonId: string, ...args: any[]) => {
      if (eventHolonId === holonId) {
        callback(...args);
      }
    });
  }

  /**
   * Gets comprehensive status for a holon including bundle, members, settings, and visualization.
   *
   * @async
   * @param {string} holonId - The unique identifier of the holon
   * @returns {Promise<{bundle: HolonBundle|null, members: HolonMember[], settings: HolonSettings, balances: TokenBalance[], flowConfig: any, visualization: FlowVisualizationData}>}
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
      this.getFlowConfiguration(holonId),
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
      visualization,
    };

    console.log(`[HolonsManager] Final holon status:`, status);

    return status;
  }
}
