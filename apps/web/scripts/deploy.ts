#!/usr/bin/env npx tsx
/**
 * Contract Deployment Script
 *
 * Usage:
 *   npm run deploy -- --network <network> [--contract <name>] [--all]
 *
 * Examples:
 *   npm run deploy -- --network sepolia --all
 *   npm run deploy -- --network localhost --contract Splitter
 *   npm run deploy -- --network gnosis --contract Bundle
 *
 * Environment variables (from .env):
 *   WEB3KEY - Deployer wallet private key
 *   WEB3PROVIDER - Custom RPC URL (optional, uses default for network)
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Load .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "../.env");

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts
        .join("=")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && value && !process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
  });
}

// Contract artifacts directory
const CONTRACTS_DIR = path.join(__dirname, "../src/lib/contracts");
const DEPLOYMENTS_FILE = path.join(CONTRACTS_DIR, "deployments.ts");

// Network configurations
const NETWORKS: Record<string, { chainId: number; rpcUrl: string }> = {
  localhost: { chainId: 31337, rpcUrl: "http://127.0.0.1:8545" },
  hardhat: { chainId: 31337, rpcUrl: "http://127.0.0.1:8545" },
  sepolia: { chainId: 11155111, rpcUrl: "https://rpc.sepolia.org" },
  goerli: { chainId: 5, rpcUrl: "https://rpc.goerli.mudit.blog" },
  mainnet: { chainId: 1, rpcUrl: "https://eth.llamarpc.com" },
  homestead: { chainId: 1, rpcUrl: "https://eth.llamarpc.com" },
  gnosis: { chainId: 100, rpcUrl: "https://rpc.gnosischain.com" },
  polygon: { chainId: 137, rpcUrl: "https://polygon-rpc.com" },
  arbitrum: { chainId: 42161, rpcUrl: "https://arb1.arbitrum.io/rpc" },
  optimism: { chainId: 10, rpcUrl: "https://mainnet.optimism.io" },
  base: { chainId: 8453, rpcUrl: "https://mainnet.base.org" },
};

// Contracts that can be deployed (in order of dependencies)
const DEPLOYABLE_CONTRACTS = [
  "ManagedFactory",
  "ZonedFactory",
  "SplitterFactory",
  "AppreciativeFactory",
  "Holons",
  "TestToken",
  "Splitter",
  "Bundle",
];

interface ContractArtifact {
  abi: any[];
  bytecode: string;
}

interface DeploymentResult {
  address: string;
  txHash: string;
  deployer: string;
  deployedAt: number;
}

function loadContractArtifact(contractName: string): ContractArtifact | null {
  const filePath = path.join(CONTRACTS_DIR, `${contractName}.json`);

  if (!fs.existsSync(filePath)) {
    console.log(`  Contract artifact not found: ${filePath}`);
    return null;
  }

  const artifact = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  // Handle different artifact formats
  let bytecode = artifact.bytecode;
  if (typeof bytecode === "object" && bytecode.object) {
    bytecode = bytecode.object;
  }

  // Ensure bytecode starts with 0x
  if (bytecode && !bytecode.startsWith("0x")) {
    bytecode = "0x" + bytecode;
  }

  return {
    abi: artifact.abi,
    bytecode: bytecode || "",
  };
}

async function deployContract(
  signer: ethers.Signer,
  contractName: string,
  constructorArgs: any[] = [],
): Promise<DeploymentResult> {
  console.log(`\nDeploying ${contractName}...`);

  const artifact = loadContractArtifact(contractName);
  if (!artifact) {
    throw new Error(`Contract artifact not found for ${contractName}`);
  }

  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`No bytecode found for ${contractName}`);
  }

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  );

  console.log(`  Constructor args: ${JSON.stringify(constructorArgs)}`);

  const contract = await factory.deploy(...constructorArgs);
  const tx = contract.deploymentTransaction();

  console.log(`  Transaction hash: ${tx?.hash}`);
  console.log(`  Waiting for confirmation...`);

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`  Deployed at: ${address}`);

  return {
    address,
    txHash: tx?.hash || "",
    deployer: await signer.getAddress(),
    deployedAt: Date.now(),
  };
}

function updateDeploymentsFile(
  networkKey: string,
  chainId: number,
  contractName: string,
  deployment: DeploymentResult,
): void {
  console.log(`\nUpdating deployments.ts for ${networkKey}/${contractName}...`);

  let content = fs.readFileSync(DEPLOYMENTS_FILE, "utf-8");

  // Check if network exists in DEPLOYMENTS
  const networkPattern = new RegExp(
    `${networkKey}:\\s*\\{[^}]*contracts:\\s*\\{`,
    "s",
  );

  if (!networkPattern.test(content)) {
    // Add new network
    const insertPoint = content.indexOf(
      "};",
      content.lastIndexOf("export const DEPLOYMENTS"),
    );
    const newNetwork = `
  ${networkKey}: {
    chainId: ${chainId},
    networkName: '${networkKey}',
    contracts: {
      ${contractName}: {
        address: '${deployment.address}',
        deployedAt: ${deployment.deployedAt},
        txHash: '${deployment.txHash}',
        deployer: '${deployment.deployer}'
      },
    }
  },`;
    content =
      content.slice(0, insertPoint) +
      newNetwork +
      "\n" +
      content.slice(insertPoint);
  } else {
    // Update existing network
    const contractEntry = `${contractName}: {
        address: '${deployment.address}',
        deployedAt: ${deployment.deployedAt},
        txHash: '${deployment.txHash}',
        deployer: '${deployment.deployer}'
      }`;

    // Check if contract already exists in this network
    const contractPattern = new RegExp(
      `(${networkKey}:[^}]*contracts:\\s*\\{[^}]*)${contractName}:\\s*\\{[^}]*\\}`,
      "s",
    );

    if (contractPattern.test(content)) {
      // Replace existing contract
      content = content.replace(contractPattern, `$1${contractEntry}`);
    } else {
      // Add new contract to existing network
      const insertPattern = new RegExp(
        `(${networkKey}:[^}]*contracts:\\s*\\{)`,
        "s",
      );
      content = content.replace(insertPattern, `$1\n      ${contractEntry},`);
    }
  }

  fs.writeFileSync(DEPLOYMENTS_FILE, content);
  console.log(`  Updated deployments.ts`);
}

function getConstructorArgs(
  contractName: string,
  deployer: string,
  existingDeployments: Record<string, string>,
): any[] {
  // Define constructor arguments for each contract type
  switch (contractName) {
    case "ManagedFactory":
    case "ZonedFactory":
    case "SplitterFactory":
    case "AppreciativeFactory":
      return []; // Factories typically have no constructor args

    case "Holons":
      // Holons(address owner)
      return [deployer];

    case "TestToken":
      // TestToken(string name, string symbol, uint256 initialSupply)
      return ["Test Token", "TEST", ethers.parseEther("1000000")];

    case "Splitter":
      // Splitter(address owner, string creatorUserId, string name, uint256 parameter, address managedFactory, address zonedFactory)
      return [
        deployer,
        "deployer",
        "DefaultSplitter",
        0,
        existingDeployments.ManagedFactory || ethers.ZeroAddress,
        existingDeployments.ZonedFactory || ethers.ZeroAddress,
      ];

    case "Bundle":
      // Bundle(address owner, string creatorUserId, string name, uint256 steepness, uint256 nzones)
      return [
        deployer,
        "deployer",
        "DefaultBundle",
        ethers.parseEther("0.5"), // 50% steepness
        6, // 6 zones
      ];

    default:
      return [];
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let networkKey = "";
  let contractName = "";
  let deployAll = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--network" && args[i + 1]) {
      networkKey = args[i + 1];
      i++;
    } else if (args[i] === "--contract" && args[i + 1]) {
      contractName = args[i + 1];
      i++;
    } else if (args[i] === "--all") {
      deployAll = true;
    }
  }

  // Use NETWORK from .env as default if not specified
  if (!networkKey) {
    networkKey = process.env.NETWORK || "";
    if (networkKey) {
      console.log(`Using network from .env: ${networkKey}`);
    }
  }

  if (!networkKey) {
    console.log(
      "Usage: npm run deploy -- --network <network> [--contract <name>] [--all]",
    );
    console.log("\nAvailable networks:", Object.keys(NETWORKS).join(", "));
    console.log("\nDeployable contracts:", DEPLOYABLE_CONTRACTS.join(", "));
    console.log("\nOr set NETWORK in your .env file to use as default");
    process.exit(1);
  }

  const network = NETWORKS[networkKey];
  if (!network) {
    console.error(`Unknown network: ${networkKey}`);
    console.log("Available networks:", Object.keys(NETWORKS).join(", "));
    process.exit(1);
  }

  // Get private key from WEB3KEY env var
  const privateKey = process.env.WEB3KEY;
  if (!privateKey) {
    console.error("WEB3KEY environment variable not set");
    console.log("Set it in your .env file: WEB3KEY=0x...");
    process.exit(1);
  }

  // Setup provider and signer - use WEB3PROVIDER if set
  const rpcUrl =
    process.env.WEB3PROVIDER || process.env.RPC_URL || network.rpcUrl;
  console.log(`\nConnecting to ${networkKey} (${rpcUrl})...`);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const deployerAddress = await signer.getAddress();

  console.log(`Deployer: ${deployerAddress}`);

  // Check balance
  const balance = await provider.getBalance(deployerAddress);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error("Deployer has no balance!");
    process.exit(1);
  }

  // Track deployed contracts for constructor args
  const deployedContracts: Record<string, string> = {};

  // Determine which contracts to deploy
  const contractsToDeploy = deployAll
    ? DEPLOYABLE_CONTRACTS
    : contractName
      ? [contractName]
      : [];

  if (contractsToDeploy.length === 0) {
    console.log("No contracts specified. Use --contract <name> or --all");
    process.exit(1);
  }

  console.log(`\nContracts to deploy: ${contractsToDeploy.join(", ")}`);

  // Deploy contracts
  for (const name of contractsToDeploy) {
    try {
      const constructorArgs = getConstructorArgs(
        name,
        deployerAddress,
        deployedContracts,
      );
      const result = await deployContract(signer, name, constructorArgs);

      deployedContracts[name] = result.address;
      updateDeploymentsFile(networkKey, network.chainId, name, result);
    } catch (error: any) {
      console.error(`Failed to deploy ${name}:`, error.message);
      if (!deployAll) {
        process.exit(1);
      }
    }
  }

  console.log("\n=== Deployment Summary ===");
  for (const [name, address] of Object.entries(deployedContracts)) {
    console.log(`${name}: ${address}`);
  }
  console.log("\nDeployment complete!");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
