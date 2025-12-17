import { ethers } from 'ethers';
import type { EventEmitter } from 'events';
import {
  CONTRACT_ABIS,
  CONTRACT_ADDRESSES,
  HOLON_TYPES,
  isDevelopmentMode,
  loadContractABIs,
  loadDeploymentAddresses
} from '../contracts/contractLoader.js';
import { BUNDLE_BYTECODE } from '../contracts/bundleBytecode.js';

// Holon Types based on the original system
export type HolonType = 'Managed' | 'Zoned' | 'Splitter' | 'Appreciative' | 'Bundle';

// Single Bundle contract interface (unified holon)
export interface HolonBundle {
  address: string;           // Single Bundle contract address
  creatorUserId: string;
  name: string;
  timestamp: number;
  // Configurable parameters
  steepness: bigint;         // Zone decay factor (0.5e18 = 50% decay per zone)
  nzones: number;            // Number of zones (default 6)
  // Legacy compatibility - all point to the same address
  splitterAddress?: string;
  managedAddress?: string;
  zonedAddress?: string;
}

export interface FlowConfig {
  interiorPercent: number;   // Interior (internal members) percentage
  exteriorPercent: number;   // Exterior (federated holons) percentage
  steepness: bigint;         // Zone decay factor
  nzones: number;            // Number of zones
}

export interface HolonMember {
  id: string;
  address?: string;
  role: 'creator' | 'admin' | 'member';
  zones?: string[];
  joinedAt: number;
}

export interface TokenBalance {
  symbol: string;
  address: string;
  balance: bigint;
  decimals: number;
  formatted: string;
}

export class HolonsContract {
  private provider: ethers.Provider;
  private signer: ethers.Signer | null = null;
  private contracts: Map<string, ethers.Contract> = new Map();
  private eventEmitter: EventEmitter;
  
  // Contract addresses from deployment.json
  private addresses = CONTRACT_ADDRESSES;
  private contractABIs = CONTRACT_ABIS;

  // Development mode flag
  private readonly isDevelopment = isDevelopmentMode();
  
  // Initialization flag
  private initialized = false;

  // Holon type icons for UI
  private readonly HOLON_ICONS: Record<HolonType, string> = {
    'Managed': '🔹',
    'Zoned': '🔶',
    'Splitter': '💱',
    'Appreciative': '💯',
    'Bundle': '📦'
  };

  // Default Bundle parameters
  private readonly DEFAULT_STEEPNESS = BigInt('500000000000000000'); // 0.5e18 = 50% decay
  private readonly DEFAULT_NZONES = 6;

  constructor(provider: ethers.Provider, eventEmitter: EventEmitter) {
    this.provider = provider;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Initialize contracts with real ABIs and addresses
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Load real contracts and addresses
      const [abis, addresses] = await Promise.all([
        loadContractABIs(),
        loadDeploymentAddresses()
      ]);
      
      this.contractABIs = abis;
      this.addresses = addresses;
      this.initialized = true;
      
      console.log('HolonsContract initialized with real contracts');
    } catch (error) {
      console.warn('Failed to initialize real contracts, using fallbacks:', error);
      this.initialized = true; // Mark as initialized even with fallbacks
    }
  }

  /**
   * Connect a wallet/signer for transactions
   */
  async connect(signer: ethers.Signer): Promise<void> {
    try {
      this.signer = signer;
      const address = await signer.getAddress();
      this.eventEmitter.emit('wallet:connected', address);
    } catch (error: any) {
      // Handle ENS-related errors gracefully
      if (error.code === 'UNSUPPORTED_OPERATION' && error.operation === 'getEnsAddress') {
        console.warn('Network does not support ENS, continuing without ENS resolution');
        this.signer = signer;
        // Try to get address without ENS resolution
        const address = (signer as any).address || 'unknown';
        this.eventEmitter.emit('wallet:connected', address);
      } else {
        throw error;
      }
    }
  }

  /**
   * Disconnect wallet
   */
  disconnect(): void {
    this.signer = null;
    this.contracts.clear();
    this.eventEmitter.emit('wallet:disconnected');
  }

  /**
   * Get or create contract instance
   */
  private async getContract(address: string, abi: any[]): Promise<ethers.Contract> {
    const key = `${address}:${JSON.stringify(abi).substring(0, 50)}`;

    // Debug: Log what ABI is being used
    console.log('[HolonsContract] getContract:', {
      address,
      abiLength: abi?.length || 0,
      abiPreview: abi?.slice(0, 2).map((item: any) => item.name || item.type) || 'empty',
      cacheKey: key.substring(0, 80)
    });

    if (!abi || abi.length === 0) {
      console.error('[HolonsContract] WARNING: Empty ABI for contract at', address);
    }

    if (!this.contracts.has(key)) {
      const contract = new ethers.Contract(
        address,
        abi,
        this.signer || this.provider
      );
      this.contracts.set(key, contract);
    }

    return this.contracts.get(key)!;
  }

  /**
   * Execute a transaction with proper error handling and events
   */
  private async executeTransaction(
    contract: ethers.Contract,
    method: string,
    args: any[] = [],
    options: any = {}
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    // Debug: Log contract details
    console.log('[HolonsContract] executeTransaction:', {
      contractAddress: contract.target,
      method,
      args,
      hasInterface: !!contract.interface,
      hasMethod: typeof contract[method] === 'function'
    });

    // Verify the method exists on the contract interface
    if (!contract.interface || !contract[method]) {
      console.error('[HolonsContract] Method not found on contract:', method);
      console.error('[HolonsContract] Contract interface:', contract.interface);
      throw new Error(`Method "${method}" not found on contract at ${contract.target}`);
    }

    try {
      // Get fee data with ENS error handling
      let feeData;
      try {
        feeData = await this.provider.getFeeData();
      } catch (feeError: any) {
        if (feeError.code === 'UNSUPPORTED_OPERATION') {
          console.warn('Fee data not available on this network, using defaults');
          feeData = null;
        } else {
          throw feeError;
        }
      }
      
      // Merge options with fee data
      const txOptions = {
        gasLimit: 3000000,
        ...(feeData && {
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          maxFeePerGas: feeData.maxFeePerGas,
        }),
        ...options
      };

      this.eventEmitter.emit('transaction:pending', {
        contract: contract.target,
        method,
        args
      });

      const tx = await contract[method](...args, txOptions);
      
      this.eventEmitter.emit('transaction:submitted', {
        hash: tx.hash,
        contract: contract.target,
        method
      });

      return tx;
    } catch (error) {
      this.eventEmitter.emit('transaction:error', {
        contract: contract.target,
        method,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Wait for transaction confirmation with events
   */
  async waitForTransaction(tx: ethers.TransactionResponse, message?: string): Promise<ethers.TransactionReceipt> {
    try {
      const receipt = await tx.wait();
      
      if (receipt?.status === 1) {
        this.eventEmitter.emit('transaction:success', {
          hash: tx.hash,
          message: message || 'Transaction successful',
          receipt
        });
      } else {
        this.eventEmitter.emit('transaction:failed', {
          hash: tx.hash,
          message: 'Transaction failed'
        });
      }
      
      return receipt!;
    } catch (error) {
      this.eventEmitter.emit('transaction:failed', {
        hash: tx.hash,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Check if the Holons contract is properly configured with factories
   */
  async checkContractConfiguration(): Promise<{
    isConfigured: boolean;
    managedFactory: string | null;
    zonedFactory: string | null;
    splitterFlavor: string | null;
  }> {
    await this.initialize();

    const holonsContract = await this.getContract(
      this.addresses.Holons,
      this.contractABIs.Holons
    );

    let managedFactory: string | null = null;
    let zonedFactory: string | null = null;
    let splitterFlavor: string | null = null;

    try {
      managedFactory = await holonsContract.managedFactory();
      console.log('[HolonsContract] managedFactory:', managedFactory);
    } catch (err) {
      console.log('[HolonsContract] managedFactory not set or not available');
    }

    try {
      zonedFactory = await holonsContract.zonedFactory();
      console.log('[HolonsContract] zonedFactory:', zonedFactory);
    } catch (err) {
      console.log('[HolonsContract] zonedFactory not set or not available');
    }

    try {
      splitterFlavor = await holonsContract.getFlavorAddress('Splitter');
      console.log('[HolonsContract] Splitter flavor:', splitterFlavor);
    } catch (err) {
      console.log('[HolonsContract] Splitter flavor not registered');
    }

    const isConfigured = !!(
      managedFactory &&
      managedFactory !== '0x0000000000000000000000000000000000000000' &&
      zonedFactory &&
      zonedFactory !== '0x0000000000000000000000000000000000000000' &&
      splitterFlavor &&
      splitterFlavor !== '0x0000000000000000000000000000000000000000'
    );

    console.log('[HolonsContract] Contract configured:', isConfigured);

    return { isConfigured, managedFactory, zonedFactory, splitterFlavor };
  }

  /**
   * Set the factory addresses on the Holons contract (requires owner/admin)
   */
  async setFactories(managedFactory: string, zonedFactory: string): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error('Wallet not connected');
    }

    await this.initialize();

    const holonsContract = await this.getContract(
      this.addresses.Holons,
      [...this.contractABIs.Holons, {
        "inputs": [{"name": "_managedFactory", "type": "address"}, {"name": "_zonedFactory", "type": "address"}],
        "name": "setFactories",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }]
    );

    console.log('[HolonsContract] Setting factories:', { managedFactory, zonedFactory });
    return holonsContract.setFactories(managedFactory, zonedFactory);
  }

  /**
   * Create a new Bundle holon using the Holons registry
   * The Bundle contract is a unified holon with configurable steepness and zones
   */
  async createHolon(
    type: HolonType,
    creatorUserId: string,
    name: string,
    steepness?: bigint,
    nzones?: number
  ): Promise<ethers.TransactionResponse> {
    if (!this.addresses.Holons) {
      throw new Error('Holons contract address not configured');
    }

    // Ensure contracts are initialized
    await this.initialize();

    // Use the actual Holons contract ABI
    const holonsContract = await this.getContract(
      this.addresses.Holons,
      this.contractABIs.Holons
    );

    // Use steepness as the parameter value (Bundle flavor uses this)
    const steepnessValue = steepness || this.DEFAULT_STEEPNESS;
    const zonesValue = nzones || this.DEFAULT_NZONES;

    // Create Bundle type holon through the registry
    // The Holons registry will use the Bundle factory to deploy
    return this.executeTransaction(
      holonsContract,
      'newHolonBundle',
      [creatorUserId, name, steepnessValue],
      { gasLimit: 5000000 }
    );
  }

  /**
   * Create a Bundle contract (unified holon with configurable parameters)
   * Uses the Holons registry - requires registry to be configured
   * @param creatorUserId - The creator's user ID
   * @param name - The holon name
   * @param steepness - Zone decay factor (default 0.5e18 = 50% decay per zone)
   * @param nzones - Number of zones (default 6)
   */
  async createHolonBundle(
    creatorUserId: string,
    name: string,
    steepness?: bigint,
    nzones?: number
  ): Promise<{
    transaction: ethers.TransactionResponse;
    bundleInfo: Partial<HolonBundle>;
  }> {
    if (!this.signer) {
      throw new Error('Wallet not connected. Please connect your wallet first.');
    }

    const steepnessValue = steepness || this.DEFAULT_STEEPNESS;
    const zonesValue = nzones || this.DEFAULT_NZONES;

    // Deploy Bundle contract through the Holons registry
    const tx = await this.createHolon('Bundle', creatorUserId, name, steepnessValue, zonesValue);

    return {
      transaction: tx,
      bundleInfo: {
        creatorUserId,
        name,
        timestamp: Date.now(),
        steepness: steepnessValue,
        nzones: zonesValue
      }
    };
  }

  /**
   * Deploy a Bundle contract directly (no registry needed!)
   * This is the simplest way to deploy a holon contract
   * Bundle constructor: (owner, creatorUserId, name, steepness, nzones)
   * @param creatorUserId - The creator's user ID
   * @param name - The holon name
   * @param steepness - Zone decay factor (default 0.5e18 = 50% decay per zone)
   * @param nzones - Number of zones (default 6)
   * @returns The deployed contract address and transaction
   */
  async deployBundleDirect(
    creatorUserId: string,
    name: string,
    steepness?: bigint,
    nzones?: number
  ): Promise<{
    address: string;
    transaction: ethers.TransactionResponse;
    bundle: HolonBundle;
  }> {
    if (!this.signer) {
      throw new Error('Wallet not connected. Please connect your wallet first.');
    }

    const steepnessValue = steepness || this.DEFAULT_STEEPNESS;
    const zonesValue = nzones || this.DEFAULT_NZONES;
    const ownerAddress = await this.signer.getAddress();

    console.log('[HolonsContract] Deploying Bundle directly...');
    console.log('[HolonsContract] Owner:', ownerAddress);
    console.log('[HolonsContract] Creator:', creatorUserId);
    console.log('[HolonsContract] Name:', name);
    console.log('[HolonsContract] Steepness:', steepnessValue.toString());
    console.log('[HolonsContract] Nzones:', zonesValue);

    // Ensure contracts are initialized
    await this.initialize();

    if (!BUNDLE_BYTECODE) {
      throw new Error('Bundle bytecode not available. Please run the deployment setup.');
    }

    // Bundle ABI for deployment - only need constructor for deployment
    // Bundle constructor: (address _owner, string _creatorUserId, string _name, uint256 _steepness, uint256 _nzones)
    const bundleABI = [
      {
        "type": "constructor",
        "inputs": [
          { "name": "_owner", "type": "address" },
          { "name": "_creatorUserId", "type": "string" },
          { "name": "_name", "type": "string" },
          { "name": "_steepness", "type": "uint256" },
          { "name": "_nzones", "type": "uint256" }
        ],
        "stateMutability": "nonpayable"
      }
    ];

    // Create contract factory and deploy
    const factory = new ethers.ContractFactory(bundleABI, BUNDLE_BYTECODE, this.signer);

    // Refresh signer connection to ensure valid session
    try {
      await this.signer.getAddress();
    } catch (e) {
      throw new Error('Wallet session expired. Please reconnect your wallet.');
    }

    console.log('[HolonsContract] Deploying Bundle contract...');
    console.log('[HolonsContract] Constructor args:', {
      owner: ownerAddress,
      creatorUserId,
      name,
      steepness: steepnessValue.toString(),
      nzones: zonesValue
    });

    // Get fresh fee data
    const feeData = await this.provider.getFeeData();

    const contract = await factory.deploy(
      ownerAddress,
      creatorUserId,
      name,
      steepnessValue,  // steepness - BigInt is supported in ethers v6
      zonesValue,      // nzones
      {
        gasLimit: 10000000n,  // Increased for larger Bundle bytecode
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas
      }
    );

    // Get the transaction
    const tx = contract.deploymentTransaction();
    if (!tx) {
      throw new Error('Failed to get deployment transaction');
    }

    console.log('[HolonsContract] Deployment transaction:', tx.hash);

    // Wait for deployment
    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log('[HolonsContract] Bundle deployed at:', address);

    const bundle: HolonBundle = {
      address,
      creatorUserId,
      name,
      timestamp: Date.now(),
      steepness: steepnessValue,
      nzones: zonesValue,
      splitterAddress: address,
      managedAddress: address,
      zonedAddress: address
    };

    this.eventEmitter.emit('bundle:deployed', bundle);

    return {
      address,
      transaction: tx,
      bundle
    };
  }

  /**
   * Get Bundle contract for a given holon name
   */
  async getHolonBundle(holonName: string): Promise<HolonBundle | null> {
    try {
      console.log(`[HolonsContract] Looking for Bundle with name: ${holonName}`);

      // Ensure contracts are initialized
      await this.initialize();

      // Query the Holons contract to get the holon address
      const holonsContract = await this.getContract(
        this.addresses.Holons,
        this.contractABIs.Holons
      );

      console.log(`[HolonsContract] Using Holons contract at address: ${this.addresses.Holons}`);

      // Check if this holon exists by looking up its address
      let bundleAddress: string;
      try {
        bundleAddress = await holonsContract.toAddress(holonName);
        console.log(`[HolonsContract] toAddress(${holonName}) returned: ${bundleAddress}`);
      } catch (error: any) {
        if (error.code === 'BAD_DATA' && error.value === '0x') {
          console.log(`[HolonsContract] Bundle ${holonName} not found in contract (empty return)`);
          return null;
        }
        console.log(`[HolonsContract] Bundle ${holonName} not found in toAddress mapping:`, error);
        return null;
      }

      // If address is zero address, holon doesn't exist
      if (!bundleAddress || bundleAddress === '0x0000000000000000000000000000000000000000') {
        console.log(`[HolonsContract] Bundle ${holonName} has zero address: ${bundleAddress}`);
        return null;
      }

      console.log(`[HolonsContract] Found Bundle ${holonName} at address: ${bundleAddress}`);

      // Get Bundle contract to read its parameters
      let steepness = this.DEFAULT_STEEPNESS;
      let nzones = this.DEFAULT_NZONES;

      try {
        const bundleContract = await this.getContract(
          bundleAddress,
          this.contractABIs.Bundle
        );

        steepness = await bundleContract.steepness();
        nzones = Number(await bundleContract.nzones());
        console.log(`[HolonsContract] Bundle parameters: steepness=${steepness}, nzones=${nzones}`);
      } catch (readError) {
        console.warn('[HolonsContract] Could not read Bundle parameters, using defaults:', readError);
      }

      const bundle: HolonBundle = {
        address: bundleAddress,
        creatorUserId: '',
        name: holonName,
        timestamp: 0,
        steepness,
        nzones,
        // Legacy compatibility
        splitterAddress: bundleAddress,
        managedAddress: bundleAddress,
        zonedAddress: bundleAddress
      };

      console.log(`[HolonsContract] Returning Bundle:`, bundle);
      return bundle;
    } catch (error) {
      console.error('[HolonsContract] Error getting Bundle:', error);
      return null;
    }
  }

  /**
   * Add members to managed holon
   */
  async addMembersToManaged(
    managedAddress: string,
    userIds: string[]
  ): Promise<ethers.TransactionResponse> {
    const contract = await this.getContract(
      managedAddress,
      [] // Would be loaded from Managed ABI
    );

    return this.executeTransaction(
      contract,
      'addMembers',
      [userIds],
      { gasLimit: 3000000 }
    );
  }

  /**
   * Add holons to zoned holon (federation)
   */
  async addHolonsToZoned(
    zonedAddress: string,
    holonIds: string[]
  ): Promise<ethers.TransactionResponse> {
    const contract = await this.getContract(
      zonedAddress,
      [] // Would be loaded from Zoned ABI
    );

    return this.executeTransaction(
      contract,
      'addMembers',
      [holonIds],
      { gasLimit: 3000000 }
    );
  }

  /**
   * Set flow split ratios (interior vs exterior) on a Bundle contract
   */
  async setFlowSplit(
    bundleAddress: string,
    interiorPercent: number
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    const exteriorPercent = 100 - interiorPercent;

    console.log('[HolonsContract] setFlowSplit called:', {
      bundleAddress,
      interiorPercent,
      exteriorPercent,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'setContractSplit',
      [interiorPercent, exteriorPercent],
      { gasLimit: 1000000 }
    );
  }

  /**
   * Set steepness parameter on a Bundle contract
   */
  async setSteepness(
    bundleAddress: string,
    steepness: bigint
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    console.log('[HolonsContract] setSteepness called:', {
      bundleAddress,
      steepness: steepness.toString(),
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'setSteepness',
      [steepness],
      { gasLimit: 500000 }
    );
  }

  /**
   * Set number of zones on a Bundle contract
   */
  async setNzones(
    bundleAddress: string,
    nzones: number
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    console.log('[HolonsContract] setNzones called:', {
      bundleAddress,
      nzones,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'setNzones',
      [nzones],
      { gasLimit: 500000 }
    );
  }

  /**
   * Set interior member splits on a Bundle contract
   * This adds members (if not already added) and sets their share percentages
   */
  async setInteriorSplit(
    bundleAddress: string,
    userIds: string[],
    percentages: number[]
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    if (userIds.length !== percentages.length) {
      throw new Error('userIds and percentages arrays must have the same length');
    }

    console.log('[HolonsContract] setInteriorSplit called:', {
      bundleAddress,
      userIds,
      percentages,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    // Convert percentages to uint256 values
    const percentagesUint = percentages.map(p => BigInt(Math.round(p)));

    return this.executeTransaction(
      contract,
      'setInteriorSplit',
      [userIds, percentagesUint],
      { gasLimit: 1000000 }
    );
  }

  /**
   * Add members to a Bundle contract's interior
   */
  async addInteriorMembers(
    bundleAddress: string,
    userIds: string[]
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    console.log('[HolonsContract] addInteriorMembers called:', {
      bundleAddress,
      userIds,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'addMembers',
      [userIds],
      { gasLimit: 1000000 }
    );
  }

  /**
   * Get current flow configuration from a Bundle contract
   * Uses Bundle contract functions: interiorPercentage, exteriorPercentage, steepness, nzones
   */
  async getFlowConfig(bundleAddress: string): Promise<FlowConfig> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );

      // Splitter contract uses internalContractSplitPercentage/externalContractSplitPercentage
      const [interiorPercent, exteriorPercent] = await Promise.all([
        contract.internalContractSplitPercentage().catch(() => BigInt(50)),
        contract.externalContractSplitPercentage().catch(() => BigInt(50))
      ]);

      console.log('[HolonsContract] Flow config from Splitter contract:', {
        interiorPercent: Number(interiorPercent),
        exteriorPercent: Number(exteriorPercent)
      });

      return {
        interiorPercent: Number(interiorPercent),
        exteriorPercent: Number(exteriorPercent),
        // Splitter doesn't have steepness/nzones, use defaults
        steepness: this.DEFAULT_STEEPNESS,
        nzones: this.DEFAULT_NZONES
      };
    } catch (error) {
      console.error('Error getting flow config:', error);
      return {
        interiorPercent: 50,
        exteriorPercent: 50,
        steepness: this.DEFAULT_STEEPNESS,
        nzones: this.DEFAULT_NZONES
      };
    }
  }

  /**
   * Get interior members from a Bundle contract
   */
  async getInteriorMembers(bundleAddress: string): Promise<string[]> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );
      return await contract.getInteriorMembers();
    } catch (error) {
      console.error('Error getting interior members:', error);
      return [];
    }
  }

  /**
   * Get zone members from a Bundle contract
   */
  async getZoneMembers(bundleAddress: string, zone: number): Promise<string[]> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );
      return await contract.getZoneMembers(zone);
    } catch (error) {
      console.error('Error getting zone members:', error);
      return [];
    }
  }

  /**
   * Get zone weights from a Bundle contract
   */
  async getZoneWeights(bundleAddress: string): Promise<bigint[]> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );
      return await contract.getZoneWeights();
    } catch (error) {
      console.error('Error getting zone weights:', error);
      return [];
    }
  }

  /**
   * Get interior share for a specific user from a Bundle contract
   */
  async getInteriorShare(bundleAddress: string, userId: string): Promise<bigint> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );
      return await contract.interiorShare(userId);
    } catch (error) {
      console.error('Error getting interior share:', error);
      return BigInt(0);
    }
  }

  /**
   * Get ether balance for a specific user from a Bundle contract
   */
  async getUserEtherBalance(bundleAddress: string, userId: string): Promise<bigint> {
    try {
      const contract = await this.getContract(
        bundleAddress,
        this.contractABIs.Bundle
      );
      return await contract.etherBalance(userId);
    } catch (error) {
      console.error('Error getting user ether balance:', error);
      return BigInt(0);
    }
  }

  /**
   * Batch fetch all interior members with their shares and balances
   */
  async getInteriorMembersWithBalances(bundleAddress: string): Promise<{
    userId: string;
    share: bigint;
    etherBalance: bigint;
  }[]> {
    try {
      const members = await this.getInteriorMembers(bundleAddress);

      const memberData = await Promise.all(
        members.map(async (userId) => {
          const [share, etherBalance] = await Promise.all([
            this.getInteriorShare(bundleAddress, userId),
            this.getUserEtherBalance(bundleAddress, userId)
          ]);
          return { userId, share, etherBalance };
        })
      );

      return memberData;
    } catch (error) {
      console.error('Error getting interior members with balances:', error);
      return [];
    }
  }

  /**
   * Add a member to a Bundle contract
   */
  async addMember(
    bundleAddress: string,
    userId: string
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    console.log('[HolonsContract] addMember called:', {
      bundleAddress,
      userId,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'addMember',
      [userId],
      { gasLimit: 500000 }
    );
  }

  /**
   * Batch assign members to zones in a Bundle contract
   */
  async assignMembersToZones(
    bundleAddress: string,
    userIds: string[],
    zones: number[]
  ): Promise<ethers.TransactionResponse> {
    await this.initialize();

    if (userIds.length !== zones.length) {
      throw new Error('userIds and zones arrays must have the same length');
    }

    console.log('[HolonsContract] assignMembersToZones called:', {
      bundleAddress,
      userIds,
      zones,
      bundleAbiLength: this.contractABIs.Bundle?.length || 0
    });

    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'assignMembersToZones',
      [userIds, zones.map(z => BigInt(z))],
      { gasLimit: 2000000 }
    );
  }

  /**
   * Assign a member to a zone in a Bundle contract
   */
  async assignToZone(
    bundleAddress: string,
    userId: string,
    zone: number
  ): Promise<ethers.TransactionResponse> {
    const contract = await this.getContract(
      bundleAddress,
      this.contractABIs.Bundle
    );

    return this.executeTransaction(
      contract,
      'assignToZone',
      [userId, zone],
      { gasLimit: 500000 }
    );
  }

  /**
   * Get holon members
   */
  async getHolonMembers(managedAddress: string): Promise<HolonMember[]> {
    const contract = await this.getContract(
      managedAddress,
      [] // Would be loaded from Managed ABI
    );

    try {
      // This would query the actual contract
      const size = 0; // await contract.getSize();
      const members: HolonMember[] = [];
      
      // for (let i = 0; i < size; i++) {
      //   const member = await contract.getMember(i);
      //   members.push({
      //     id: member.id,
      //     address: member.address,
      //     role: member.role || 'member',
      //     joinedAt: member.joinedAt || Date.now()
      //   });
      // }
      
      return members;
    } catch (error) {
      console.error('Error getting holon members:', error);
      return [];
    }
  }

  /**
   * Get token balances for a holon
   */
  async getTokenBalances(
    holonAddress: string,
    tokenAddresses: string[]
  ): Promise<TokenBalance[]> {
    const balances: TokenBalance[] = [];
    
    for (const tokenAddress of tokenAddresses) {
      try {
        const tokenContract = await this.getContract(
          tokenAddress,
          ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)']
        );
        
        const [balance, decimals, symbol] = await Promise.all([
          tokenContract.balanceOf(holonAddress),
          tokenContract.decimals(),
          tokenContract.symbol()
        ]);
        
        balances.push({
          symbol,
          address: tokenAddress,
          balance,
          decimals,
          formatted: ethers.formatUnits(balance, decimals)
        });
      } catch (error) {
        console.error(`Error getting balance for token ${tokenAddress}:`, error);
      }
    }
    
    return balances;
  }

  /**
   * Get available holon types/flavors
   */
  async getAvailableHolonTypes(): Promise<HolonType[]> {
    try {
      if (this.isDevelopment) {
        return [...HOLON_TYPES];
      }
      
      // Ensure contracts are initialized
      await this.initialize();
      
      const holonsContract = await this.getContract(
        this.addresses.Holons,
        this.contractABIs.Holons
      );
      
      // return await holonsContract.listFlavors();
      return ['Managed', 'Zoned', 'Splitter', 'Appreciative'];
    } catch (error) {
      console.error('Error getting holon types:', error);
      return ['Managed', 'Zoned', 'Splitter', 'Appreciative'];
    }
  }

  /**
   * Get holon type icon
   */
  getHolonIcon(type: HolonType): string {
    return this.HOLON_ICONS[type] || '🔸';
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.signer !== null;
  }

  /**
   * Get connected wallet address
   */
  async getWalletAddress(): Promise<string | null> {
    if (!this.signer) return null;
    try {
      return await this.signer.getAddress();
    } catch (error) {
      console.error('Error getting wallet address:', error);
      return null;
    }
  }

  /**
   * Add event listener for contract events
   */
  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Remove event listener
   */
  off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Check if the Holons registry is properly configured
   * Returns configuration status and what's missing
   */
  async checkRegistryConfiguration(): Promise<{
    isConfigured: boolean;
    managedFactory: string | null;
    zonedFactory: string | null;
    splitterFlavor: string | null;
    missingItems: string[];
  }> {
    await this.initialize();

    const result = {
      isConfigured: true,
      managedFactory: null as string | null,
      zonedFactory: null as string | null,
      splitterFlavor: null as string | null,
      missingItems: [] as string[]
    };

    try {
      const holonsContract = await this.getContract(
        this.addresses.Holons,
        this.contractABIs.Holons
      );

      // Check managedFactory
      try {
        result.managedFactory = await holonsContract.managedFactory();
        if (!result.managedFactory || result.managedFactory === '0x0000000000000000000000000000000000000000') {
          result.missingItems.push('managedFactory');
          result.managedFactory = null;
        }
      } catch (e) {
        result.missingItems.push('managedFactory');
        console.log('[HolonsContract] managedFactory not set:', e);
      }

      // Check zonedFactory
      try {
        result.zonedFactory = await holonsContract.zonedFactory();
        if (!result.zonedFactory || result.zonedFactory === '0x0000000000000000000000000000000000000000') {
          result.missingItems.push('zonedFactory');
          result.zonedFactory = null;
        }
      } catch (e) {
        result.missingItems.push('zonedFactory');
        console.log('[HolonsContract] zonedFactory not set:', e);
      }

      // Check Splitter flavor
      try {
        result.splitterFlavor = await holonsContract.getFlavorAddress('Splitter');
        if (!result.splitterFlavor || result.splitterFlavor === '0x0000000000000000000000000000000000000000') {
          result.missingItems.push('Splitter flavor');
          result.splitterFlavor = null;
        }
      } catch (e) {
        result.missingItems.push('Splitter flavor');
        console.log('[HolonsContract] Splitter flavor not registered:', e);
      }

      result.isConfigured = result.missingItems.length === 0;

      console.log('[HolonsContract] Registry configuration:', result);
      return result;
    } catch (error) {
      console.error('[HolonsContract] Error checking registry configuration:', error);
      result.isConfigured = false;
      result.missingItems.push('Unable to query contract');
      return result;
    }
  }

  /**
   * Configure the Holons registry with factories and flavors
   * This should only be called once during initial setup
   */
  async configureRegistry(): Promise<{
    success: boolean;
    transactions: string[];
    errors: string[];
  }> {
    if (!this.signer) {
      throw new Error('Wallet not connected. Please connect your wallet first.');
    }

    await this.initialize();

    const result = {
      success: true,
      transactions: [] as string[],
      errors: [] as string[]
    };

    try {
      const holonsContract = await this.getContract(
        this.addresses.Holons,
        this.contractABIs.Holons
      );

      const config = await this.checkRegistryConfiguration();

      // Set factories if not set
      if (!config.managedFactory || !config.zonedFactory) {
        if (this.addresses.ManagedFactory && this.addresses.ZonedFactory) {
          try {
            console.log('[HolonsContract] Setting factories...');
            const tx = await this.executeTransaction(
              holonsContract,
              'setFactories',
              [this.addresses.ManagedFactory, this.addresses.ZonedFactory],
              { gasLimit: 200000 }
            );
            const receipt = await tx.wait();
            result.transactions.push(`setFactories: ${receipt?.hash}`);
            console.log('[HolonsContract] Factories set successfully');
          } catch (e: any) {
            result.errors.push(`setFactories: ${e.message}`);
            console.error('[HolonsContract] Failed to set factories:', e);
          }
        } else {
          result.errors.push('Factory addresses not available in deployment config');
        }
      }

      // Register Splitter flavor if not registered
      if (!config.splitterFlavor && this.addresses.SplitterFactory) {
        try {
          console.log('[HolonsContract] Registering Splitter flavor...');
          const tx = await this.executeTransaction(
            holonsContract,
            'newFlavor',
            ['Splitter', this.addresses.SplitterFactory],
            { gasLimit: 200000 }
          );
          const receipt = await tx.wait();
          result.transactions.push(`newFlavor(Splitter): ${receipt?.hash}`);
          console.log('[HolonsContract] Splitter flavor registered successfully');
        } catch (e: any) {
          // Might fail if flavor already exists
          if (e.message?.includes('already exists')) {
            console.log('[HolonsContract] Splitter flavor already registered');
          } else {
            result.errors.push(`newFlavor(Splitter): ${e.message}`);
            console.error('[HolonsContract] Failed to register Splitter flavor:', e);
          }
        }
      }

      result.success = result.errors.length === 0;
      return result;
    } catch (error: any) {
      console.error('[HolonsContract] Error configuring registry:', error);
      result.success = false;
      result.errors.push(error.message);
      return result;
    }
  }
}