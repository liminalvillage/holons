// Unified contract deployments configuration
// This file contains deployed contract addresses and metadata per network
// Auto-updated by the deploy script

export interface ContractDeployment {
  address: string;
  deployedAt?: number; // timestamp
  txHash?: string;
  deployer?: string;
}

export interface NetworkDeployments {
  chainId: number;
  networkName: string;
  contracts: {
    Holons?: ContractDeployment;
    ManagedFactory?: ContractDeployment;
    ZonedFactory?: ContractDeployment;
    SplitterFactory?: ContractDeployment;
    AppreciativeFactory?: ContractDeployment;
    Managed?: ContractDeployment;
    Zoned?: ContractDeployment;
    Splitter?: ContractDeployment;
    Bundle?: ContractDeployment;
    TestToken?: ContractDeployment;
    [key: string]: ContractDeployment | undefined;
  };
}

export interface DeploymentsConfig {
  [networkKey: string]: NetworkDeployments;
}

// Network configurations with chain IDs
export const NETWORK_CONFIG: Record<
  string,
  { chainId: number; name: string; rpcUrl?: string }
> = {
  localhost: {
    chainId: 31337,
    name: "Localhost",
    rpcUrl: "http://127.0.0.1:8545",
  },
  hardhat: { chainId: 31337, name: "Hardhat", rpcUrl: "http://127.0.0.1:8545" },
  sepolia: {
    chainId: 11155111,
    name: "Sepolia Testnet",
    rpcUrl: "https://rpc.sepolia.org",
  },
  goerli: {
    chainId: 5,
    name: "Goerli Testnet",
    rpcUrl: "https://rpc.goerli.mudit.blog",
  },
  mainnet: { chainId: 1, name: "Ethereum Mainnet" },
  homestead: { chainId: 1, name: "Ethereum Mainnet" }, // alias
  gnosis: {
    chainId: 100,
    name: "Gnosis Chain",
    rpcUrl: "https://rpc.gnosischain.com",
  },
  polygon: {
    chainId: 137,
    name: "Polygon Mainnet",
    rpcUrl: "https://polygon-rpc.com",
  },
  arbitrum: {
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
  },
  optimism: {
    chainId: 10,
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
  },
  base: { chainId: 8453, name: "Base", rpcUrl: "https://mainnet.base.org" },
  virtualtestnet: {
    chainId: 1337,
    name: "Virtual Testnet",
    rpcUrl: "http://127.0.0.1:8545",
  },
};

// Deployed contract addresses by network
// This is the source of truth for all deployed contracts
export const DEPLOYMENTS: DeploymentsConfig = {
  localhost: {
    chainId: 31337,
    networkName: "Localhost",
    contracts: {
      ManagedFactory: { address: "0x970BEdBc63360f45722fc745D652002ED4e13402" },
      ZonedFactory: { address: "0xe0cCCCf322adFEDba141e41c2E3196165EeE5bB7" },
      SplitterFactory: {
        address: "0x414e49fE684f3561deF89740c642e6C6c380246E",
      },
      AppreciativeFactory: {
        address: "0x09254D834049de367305E429855b2CfD0E0A00ad",
      },
      Holons: { address: "0x6b31F3b8da4Dfe7b4AB0e37287D3856f17130343" },
      Managed: { address: "0xEfE3Ade7c6836F2613ae646C7c836131AE47281c" },
      Zoned: { address: "0x795d745FbAB949cCC1a5E30DA9376d9a65510971" },
      Splitter: { address: "0x0E81302DE110990cC3Fdd2a8ECb5bf8302d8b0e9" },
      TestToken: { address: "0xd70229C297DB9C900fF797621Aa58C6EacdBb23b" },
    },
  },
  homestead: {
    chainId: 1,
    networkName: "Ethereum Mainnet",
    contracts: {
      SplitterFactory: {
        address: "0xB426156a15601C0103910E9c731Bb3615C2CFC92",
      },
      AppreciativeFactory: {
        address: "0x264c8344A60d0687c0312abF0187F582Ed225854",
      },
      ZonedFactory: { address: "0x44bB2aBcd848DeC740F3853f33303a2257b70b33" },
      ManagedFactory: { address: "0xEd8A6280C0684A5d2B939E1ac440f52957489D7B" },
      Managed: { address: "0x335D0d9bc5C5e03E1DCd3575509a03034A2f12F7" },
      Holons: { address: "0x3fE6F808E4bA48ACD56b88EF1DA1de11e330186e" },
      TestToken: { address: "0xeAD87f57830089eB963930765B0AD48699Ffe30a" },
    },
  },
  virtualtestnet: {
    chainId: 1337,
    networkName: "Virtual Testnet",
    contracts: {
      SplitterFactory: {
        address: "0x20952eDCFD5700156d0A28DB7A6C0af8bA803ca2",
      },
      AppreciativeFactory: {
        address: "0x0f930ffff873765e08c44DBA77C901FC57c7e145",
      },
      ZonedFactory: { address: "0x429842D2a4fF4b49781Bf5536F65C553989364bB" },
      ManagedFactory: { address: "0x8B9670C075aaaC9966d36bFce9b0BEadE289d6c1" },
      Managed: { address: "0xf4A59048E3eF61f9Fb1B2c528BE075460AD976Ef" },
      Holons: { address: "0xcFe2AB3CD7830d13D9eaE6c1b7f2fd9f07d810ED" },
      TestToken: { address: "0x3d89F1D406e864E2a0fc4697dbAa44e63c62E924" },
      Zoned: { address: "0x9873b2202C74c54C1D3F7f3119f8a17f65a2A63F" },
      Splitter: { address: "0x9873b2202C74c54C1D3F7f3119f8a17f65a2A63F" },
    },
  },
  gnosis: {
    chainId: 100,
    networkName: "Gnosis Chain",
    contracts: {
      SplitterFactory: {
        address: "0x8F29D63161356cd3C4276ABADfe37329597a05F0",
      },
      AppreciativeFactory: {
        address: "0x7cca01Ad06b09a5c6455D530060b2BE26c147f5C",
      },
      ZonedFactory: { address: "0x60cAea42439028A762Cce8D03A315Ec68686E457" },
      ManagedFactory: { address: "0x9a9499eB4caf6483669Bb757B6452338F6985a4e" },
      Managed: { address: "0x7B71b9378abeAD38A60ef8Aea1C6c4Dd67A04e21" },
      Holons: { address: "0x49E9D0701e53C9158bD629E6F68A62FC034ACAb3" },
      Zoned: { address: "0x84564845f4f184B704F26c8d7286A7713ce3a19D" },
      Splitter: { address: "0xD66B44FAFAb1f468CBE8Ad208B44d922A7aCD6ee" },
      TestToken: { address: "0x22DCdee672A7DFC42B5E0b06AFA4bA26D2Ec3A80" },
    },
  },
  sepolia: {
    chainId: 11155111,
    networkName: "Sepolia Testnet",
    contracts: {
      Splitter: {
        address: "0x782E8aA922ba202c2B22482303c459a64748570b",
        deployedAt: 1765835961492,
        txHash:
          "0xadf03c09ce7cef43ea120ea362d892b4695cd5b09bc84ac0c9b45141b75d1bd6",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      ManagedFactory: {
        address: "0x76E8FBe6a9026AeDd1aF6399cB030a25395CF211",
        deployedAt: 1765796451762,
        txHash:
          "0xc4cfa359eb3d80f6d24be4072fd761e280cd19e90dce18ef398eb7ea401e47e3",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      ZonedFactory: {
        address: "0x0237ef39Ff014f00C088c225FEE8c19033043Bb3",
        deployedAt: 1765796460949,
        txHash:
          "0xdc98d028534a85e2f301a9ca8b27c69c2eec487299886c05fb32585b2314dfc1",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      SplitterFactory: {
        address: "0x71b90590912D851e2c361dd0803Fd8148E293e45",
        deployedAt: 1765796474015,
        txHash:
          "0xef660814819e3c003f1e1be12d35ca9296ac99d237ba893f39505c8d19a84c73",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      AppreciativeFactory: {
        address: "0x3Db4EDB81ce3fB5Ad2a781D02E7C5F65c2aAcecA",
        deployedAt: 1765796487153,
        txHash:
          "0x60ebd5f2b25c17dfc30fcb01f82d4fe1d6e094f66a3cc76395abcd846e80b659",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      Holons: {
        address: "0xc67F3cd7065C8ea480da28E6026e7774D7C09dd5",
        deployedAt: 1765796500243,
        txHash:
          "0x943f6550f8bf749ad8728f3e55b0432007a9a5f19920f9aea90bd3f0d0297770",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      TestToken: {
        address: "0xc785aF1397a8Cd3d2C95BE032F93B66c7709AdD5",
        deployedAt: 1765796513312,
        txHash:
          "0xb921d31aa0a53d4801c10e421aa3756f5721c7e993feb5d5f65d975b0b2866b5",
        deployer: "0x22FCFCde1010aD545484E3D11B56E892Ba0F9A79",
      },
      // Reconstructed Bundle with the cascadeCount fix; the 2025-12
      // deployment (0xC2DBA11019AcE422576cE8869fdFD65C8D2fc562) predates the
      // current ABI and always emitted cascadeCount=0.
      Bundle: {
        address: "0x7E4a1bE888078887A83f86B17A073484A3c65067",
        deployedAt: 1788122868000,
        txHash:
          "0x955adbaeaec41fa8f2f3a3d458a757fb09510838eaa9c9a5c10b06450b1e651f",
        deployer: "0x1CAE687b6a5F587A9936E4a4218a54da7e2FCcCf",
      },
    },
  },
};

// Helper to get deployment for current network
export function getDeployment(
  networkKey: string,
): NetworkDeployments | undefined {
  return DEPLOYMENTS[networkKey];
}

// Helper to get contract address
export function getContractAddress(
  networkKey: string,
  contractName: string,
): string | undefined {
  return DEPLOYMENTS[networkKey]?.contracts[contractName]?.address;
}

// Helper to get all contract addresses for a network (flat object)
export function getContractAddresses(
  networkKey: string,
): Record<string, string> {
  const deployment = DEPLOYMENTS[networkKey];
  if (!deployment) return {};

  const addresses: Record<string, string> = {};
  for (const [name, data] of Object.entries(deployment.contracts)) {
    if (data?.address) {
      addresses[name] = data.address;
    }
  }
  return addresses;
}

// Get chain ID by network key
export function getChainId(networkKey: string): number | undefined {
  return (
    NETWORK_CONFIG[networkKey]?.chainId || DEPLOYMENTS[networkKey]?.chainId
  );
}

// Get network key by chain ID
export function getNetworkByChainId(chainId: number): string | undefined {
  for (const [key, config] of Object.entries(NETWORK_CONFIG)) {
    if (config.chainId === chainId) return key;
  }
  for (const [key, deployment] of Object.entries(DEPLOYMENTS)) {
    if (deployment.chainId === chainId) return key;
  }
  return undefined;
}

// List all available networks
export function getAvailableNetworks(): string[] {
  return Object.keys(DEPLOYMENTS);
}
