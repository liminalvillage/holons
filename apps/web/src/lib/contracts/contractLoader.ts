// Contract loader - loads deployment addresses and ABIs from unified config
import { browser } from '$app/environment';
import {
  DEPLOYMENTS,
  getContractAddresses,
  getNetworkByChainId,
  type NetworkDeployments
} from './deployments.js';
import BundleJson from './Bundle.json';

// Network detection - safe for browser environment
function getNetworkName(): string {
  // In browser, use import.meta.env instead of process.env
  if (typeof window !== 'undefined') {
    // Try VITE_NETWORK_NAME first, then VITE_NETWORK, then fallback
    const envNetwork = (import.meta.env?.VITE_NETWORK_NAME as string) ||
                       (import.meta.env?.VITE_NETWORK as string) ||
                       (import.meta.env?.NETWORK as string);
    if (envNetwork) {
      console.log('[ContractLoader] Using network from env:', envNetwork);
      return envNetwork;
    }
  }
  // On server, use process.env if available
  const serverNetwork = typeof process !== 'undefined'
    ? (process.env?.VITE_NETWORK_NAME || process.env?.VITE_NETWORK || process.env?.NETWORK)
    : undefined;
  if (serverNetwork) {
    console.log('[ContractLoader] Using network from server env:', serverNetwork);
    return serverNetwork;
  }
  console.log('[ContractLoader] Defaulting to localhost');
  return 'localhost';
}

// Get current network key
export function getCurrentNetwork(): string {
  return getNetworkName();
}

// Get network deployment info
export function getNetworkDeployment(): NetworkDeployments | undefined {
  return DEPLOYMENTS[getNetworkName()];
}

// Available holon types
export const HOLON_TYPES = ['Managed', 'Zoned', 'Splitter', 'Appreciative', 'Bundle'] as const;
export type HolonType = typeof HOLON_TYPES[number];

// Development mode detection - safe for browser environment
export const isDevelopmentMode = () => {
  const networkName = getNetworkName();
  return !networkName || networkName === 'localhost' || networkName === 'hardhat';
};

// Basic contract ABIs for essential functions
const CONTRACT_ABIS = {
  // Bundle contract - loaded from compiled JSON
  Bundle: BundleJson.abi,
  Splitter: [
    {
      "inputs": [{"name": "internalPercent", "type": "uint256"}],
      "name": "updateSplit",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getInternalPercent",
      "outputs": [{"name": "", "type": "uint256"}],
      "stateMutability": "view",
      "type": "function"
    }
  ],
  Managed: [
    {
      "inputs": [{"name": "members", "type": "address[]"}],
      "name": "addMembers",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getMembers",
      "outputs": [{"name": "", "type": "address[]"}],
      "stateMutability": "view",
      "type": "function"
    }
  ],
  Zoned: [
    {
      "inputs": [],
      "name": "getZones",
      "outputs": [{"name": "", "type": "string[]"}],
      "stateMutability": "view",
      "type": "function"
    }
  ],
  Holons: [
    {
      "inputs": [],
      "name": "listFlavors",
      "outputs": [{"name": "", "type": "string[]"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [{"name": "", "type": "string"}],
      "name": "toAddress",
      "outputs": [{"name": "", "type": "address"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "listHolons",
      "outputs": [{"name": "", "type": "address[]"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [{"name": "_address", "type": "address"}],
      "name": "listHolonsOf",
      "outputs": [{"name": "", "type": "address[]"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {"name": "_creatorUserId", "type": "string"},
        {"name": "_name", "type": "string"},
        {"name": "_parameter", "type": "uint256"}
      ],
      "name": "newHolonBundle",
      "outputs": [{"name": "", "type": "address"}],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [{"name": "_name", "type": "string"}],
      "name": "getFlavorAddress",
      "outputs": [{"name": "", "type": "address"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "managedFactory",
      "outputs": [{"name": "", "type": "address"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "zonedFactory",
      "outputs": [{"name": "", "type": "address"}],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {"name": "_managedFactory", "type": "address"},
        {"name": "_zonedFactory", "type": "address"}
      ],
      "name": "setFactories",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {"name": "_flavorname", "type": "string"},
        {"name": "_flavoraddress", "type": "address"}
      ],
      "name": "newFlavor",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "anonymous": false,
      "inputs": [
        {"indexed": false, "name": "name", "type": "string"},
        {"indexed": false, "name": "addr", "type": "address"}
      ],
      "name": "NewHolon",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {"indexed": true, "name": "holonAddress", "type": "address"},
        {"indexed": false, "name": "holonName", "type": "string"},
        {"indexed": false, "name": "flavor", "type": "string"},
        {"indexed": true, "name": "creator", "type": "address"},
        {"indexed": false, "name": "timestamp", "type": "uint256"}
      ],
      "name": "HolonCreated",
      "type": "event"
    }
  ],
  SplitterFactory: [],
  ManagedFactory: [],
  ZonedFactory: [],
  AppreciativeFactory: []
};

// Get deployment addresses for current network (uses unified deployments config)
export function getDeploymentAddresses(): Record<string, string> {
  const network = getNetworkName();
  const addresses = getContractAddresses(network);

  // Fallback to localhost if network not found
  if (Object.keys(addresses).length === 0) {
    console.warn(`[ContractLoader] No deployments found for network: ${network}, falling back to localhost`);
    return getContractAddresses('localhost');
  }

  return addresses;
}

// Async functions that return the same data for backward compatibility
export async function loadContractABIs() {
  console.log('[ContractLoader] Loading contract ABIs...');
  return CONTRACT_ABIS;
}

export async function loadDeploymentAddresses() {
  const network = getNetworkName();
  const addresses = getDeploymentAddresses();
  console.log('[ContractLoader] Deployment addresses loaded:', {
    network,
    addresses,
    isDevelopment: isDevelopmentMode()
  });
  return addresses;
}

// Get contract bytecode for direct deployment
export function getContractBytecode(contractName: string): string | null {
  // Bytecodes are stored in the contract JSON files
  // This function is used for direct contract deployment
  try {
    const contractFile = CONTRACT_BYTECODES[contractName as keyof typeof CONTRACT_BYTECODES];
    return contractFile || null;
  } catch {
    return null;
  }
}

// Contract bytecodes for direct deployment (extracted from contract JSON files)
// Note: For Bundle deployment, use the Splitter bytecode as Bundle extends Splitter functionality
const CONTRACT_BYTECODES: Record<string, string> = {
  // Bytecodes will be populated by the build process or manually
  // Format: ContractName: '0x...'
};

// Synchronous exports
export { CONTRACT_ABIS };
export const CONTRACT_ADDRESSES = getDeploymentAddresses();

// Re-export from deployments for convenience
export { DEPLOYMENTS, getNetworkByChainId } from './deployments.js';