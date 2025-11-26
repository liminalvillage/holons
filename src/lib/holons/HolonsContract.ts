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

// Holon Types based on the original system
export type HolonType = 'Managed' | 'Zoned' | 'Splitter' | 'Appreciative';

export interface HolonBundle {
  splitterAddress: string;
  managedAddress: string;
  zonedAddress: string;
  creatorUserId: string;
  name: string;
  timestamp: number;
}

export interface FlowConfig {
  internalPercent: number;
  externalPercent: number;
  lensConfig: {
    [targetId: string]: {
      inbound: string[];
      outbound: string[];
      timestamp: number;
    };
  };
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
    'Appreciative': '💯'
  };

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
        const address = signer.address || 'unknown';
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
   * Create a new holon of specified type
   */
  async createHolon(
    type: HolonType, 
    creatorUserId: string, 
    name: string, 
    parameterValue: number = 0
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

    return this.executeTransaction(
      holonsContract,
      'newHolon',
      [type, creatorUserId, name, parameterValue],
      { gasLimit: 5000000 }
    );
  }

  /**
   * Create a complete holon bundle (Splitter + Managed + Zoned)
   */
  async createHolonBundle(
    creatorUserId: string,
    name: string
  ): Promise<{
    transaction: ethers.TransactionResponse;
    bundleInfo: Partial<HolonBundle>;
  }> {
    if (this.isDevelopment) {
      // Return mock transaction for development
      const mockTx = {
        hash: '0x' + Math.random().toString(16).substr(2, 64),
        wait: async () => ({ status: 1, logs: [] }),
        to: null,
        from: '',
        nonce: 0,
        gasLimit: BigInt(0),
        gasPrice: BigInt(0),
        data: '',
        value: BigInt(0),
        chainId: 1
      } as any as ethers.TransactionResponse;
      
      return {
        transaction: mockTx,
        bundleInfo: {
          splitterAddress: '0x' + Math.random().toString(16).substr(2, 40),
          managedAddress: '0x' + Math.random().toString(16).substr(2, 40), 
          zonedAddress: '0x' + Math.random().toString(16).substr(2, 40),
          creatorUserId,
          name,
          timestamp: Date.now()
        }
      };
    }

    // Real implementation would create actual contracts
    const tx = await this.createHolon('Splitter', creatorUserId, name, 0);
    
    return {
      transaction: tx,
      bundleInfo: {
        creatorUserId,
        name,
        timestamp: Date.now()
      }
    };
  }

  /**
   * Get holon bundle addresses for a given chat/name
   */
  async getHolonBundle(chatId: string): Promise<HolonBundle | null> {
    try {
      const normalizedName = `chat_${Math.abs(parseInt(chatId))}`;
      console.log(`[HolonsContract] Looking for holon bundle with chatId: ${chatId}, normalized: ${normalizedName}`);
      
      // Ensure contracts are initialized
      await this.initialize();
      
      // Query the Holons contract to get the holon address
      const holonsContract = await this.getContract(
        this.addresses.Holons,
        this.contractABIs.Holons
      );
      
      console.log(`[HolonsContract] Using Holons contract at address: ${this.addresses.Holons}`);
      
      // First, let's try to list all existing holons to debug
      try {
        const allHolons = await holonsContract.listHolons();
        console.log(`[HolonsContract] All holons in contract:`, allHolons);
      } catch (listError: any) {
        if (listError.code === 'BAD_DATA' && listError.value === '0x') {
          console.log(`[HolonsContract] No holons exist in contract yet (empty array)`);
        } else {
          console.warn(`[HolonsContract] Could not list holons:`, listError);
        }
      }
      
      // Check if this holon exists by looking up its address
      let holonAddress: string;
      try {
        holonAddress = await holonsContract.toAddress(normalizedName);
        console.log(`[HolonsContract] toAddress(${normalizedName}) returned: ${holonAddress}`);
      } catch (error: any) {
        // Check if this is a "could not decode result data" error (empty return)
        if (error.code === 'BAD_DATA' && error.value === '0x') {
          console.log(`[HolonsContract] Holon ${normalizedName} not found in contract (empty return)`);
          return null;
        }
        console.log(`[HolonsContract] Holon ${normalizedName} not found in toAddress mapping:`, error);
        return null;
      }
      
      // If address is zero address, holon doesn't exist
      if (!holonAddress || holonAddress === '0x0000000000000000000000000000000000000000') {
        console.log(`[HolonsContract] Holon ${normalizedName} has zero address: ${holonAddress}`);
        return null;
      }
      
      console.log(`[HolonsContract] Found holon ${normalizedName} at address: ${holonAddress}`);
      
      // For a complete bundle, we need to derive the component addresses
      // Based on the contract system, this would typically involve:
      // 1. Getting the splitter address from the main holon address
      // 2. Getting managed and zoned addresses from the splitter
      
      // For now, return the main holon address as splitter (this may need refinement)
      const bundle = {
        splitterAddress: holonAddress,
        managedAddress: holonAddress, // This may be derived differently
        zonedAddress: holonAddress,   // This may be derived differently
        creatorUserId: '', // Would need to be queried from contract
        name: normalizedName,
        timestamp: 0 // Would need to be queried from contract events
      };
      
      console.log(`[HolonsContract] Returning bundle:`, bundle);
      return bundle;
    } catch (error) {
      console.error('[HolonsContract] Error getting holon bundle:', error);
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
   * Set flow split ratios (internal vs external)
   */
  async setFlowSplit(
    splitterAddress: string,
    internalPercent: number
  ): Promise<ethers.TransactionResponse> {
    const externalPercent = 100 - internalPercent;
    
    const contract = await this.getContract(
      splitterAddress,
      [] // Would be loaded from Splitter ABI
    );

    return this.executeTransaction(
      contract,
      'setContractSplit',
      [internalPercent, externalPercent],
      { gasLimit: 1000000 }
    );
  }

  /**
   * Get current flow configuration
   */
  async getFlowConfig(splitterAddress: string): Promise<FlowConfig> {
    const contract = await this.getContract(
      splitterAddress,
      [] // Would be loaded from Splitter ABI
    );

    try {
      // This would query the actual contract
      const internalPercent = 50; // await contract.getInternalPercent();
      
      return {
        internalPercent,
        externalPercent: 100 - internalPercent,
        lensConfig: {}
      };
    } catch (error) {
      console.error('Error getting flow config:', error);
      return {
        internalPercent: 50,
        externalPercent: 50,
        lensConfig: {}
      };
    }
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
}