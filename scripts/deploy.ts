import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import * as tenderly from "@tenderly/hardhat-tenderly";

// import { run } from "hardhat"; // Add this import at the top


async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "localhost" : network.name;

  console.log(`Deploying contracts to network: ${networkName}`);

  const deploymentPath = path.resolve(__dirname, "../deployment.json");
  let deployments: Record<string, any> = {};

  // Load existing deployments
  if (fs.existsSync(deploymentPath)) {
    deployments = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  }

  // Ensure a section exists for this network
  if (!deployments[networkName]) {
    deployments[networkName] = {};
  }

  // Deploy SplitterFactory
  const SplitterFactory = await ethers.deployContract("SplitterFactory");
  const splitterFactory = await SplitterFactory.waitForDeployment();

  deployments[networkName]["SplitterFactory"] = splitterFactory.target;
  console.log("SplitterFactory deployed to:", splitterFactory.target);
  // Etherscan verification
  // await run("verify:verify", { address: splitterFactory.address }); // Verify SplitterFactory

  //Deploy AppreciativeFactory
  const AppreciativeFactory = await ethers.deployContract("AppreciativeFactory");
  const appreciativeFactory = await AppreciativeFactory.waitForDeployment();
  deployments[networkName]["AppreciativeFactory"] = appreciativeFactory.target;
  console.log("AppreciativeFactory deployed to:", appreciativeFactory.target);
  // Etherscan verification
  // await run("verify:verify", { address: appreciativeFactory.address }); // Verify AppreciativeFactory

  // // Deploy ZonedFactory
  const ZonedFactory = await ethers.deployContract("ZonedFactory");
  const zonedFactory = await ZonedFactory.waitForDeployment();
  deployments[networkName]["ZonedFactory"] = zonedFactory.target;
  console.log("ZonedFactory deployed to:", zonedFactory.target);
  // Etherscan verification
  // await run("verify:verify", { address: zonedFactory.address }); // Verify ZonedFactory

  // // Deploy ManagedFactory
  const ManagedFactory = await ethers.deployContract("ManagedFactory");
  const managedFactory = await ManagedFactory.waitForDeployment();
  deployments[networkName]["ManagedFactory"] = managedFactory.target;
  console.log("ManagedFactory deployed to:", managedFactory.target);
  // Etherscan verification
  // await run("verify:verify", { address: managedFactory.address }); // Verify ManagedFactory

  // Deploy Managed
  const Managed = await ethers.deployContract("Managed", [deployer, "Managed"]);
  const managed = await Managed.waitForDeployment();
  deployments[networkName]["Managed"] = managed.target;
  console.log("Managed deployed to:", managed.target);

  // Etherscan verification
  // await run("verify:verify", { address: managed.address }); // Verify Managed

  // // Deploy Holons
  // const Holons = await ethers.deployContract("Holons", [deployer, "Holons", "1"]);
  const Holons = await ethers.deployContract("Holons");
  const holons = await Holons.waitForDeployment();
  await holons.waitForDeployment();
  deployments[networkName]["Holons"] = holons.target;
  console.log("Holons deployed to:", holons.target);
  // Etherscan verification
  // await run("verify:verify", { address: holons.address }); // Verify Holons

  // // Deploy Zoned
  // const Holons = await ethers.deployContract("Holons", [deployer, "Holons", "1"]);
  const Zoned = await ethers.deployContract("Zoned", [deployer, "5", 1]);
  const zoned = await Zoned.waitForDeployment();
  await zoned.waitForDeployment();
  deployments[networkName]["Zoned"] = zoned.target;
  console.log("Zoned deployed to:", zoned.target);

  // // Deploy Spliter
  const Splitter = await ethers.deployContract("Splitter", [deployer, "Splitter", 1]);
  const splitter = await Zoned.waitForDeployment();
  await splitter.waitForDeployment();
  deployments[networkName]["Splitter"] = splitter.target;
  console.log("splitter deployed to:", splitter.target);

  // Deploy TestToken with 1 million tokens
  const TestToken = await ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy(ethers.parseEther("1000000"));
  await testToken.waitForDeployment();
  deployments[networkName]["TestToken"] = testToken.target;
  console.log("TestToken deployed to:", testToken.target);
  // Etherscan verification
  // await run("verify:verify", { address: testToken.address }); // Verify TestToken

  // Save deployments to file
  fs.writeFileSync(deploymentPath, JSON.stringify(deployments, null, 2));
  console.log(`Deployment addresses saved to deployment.json for network: ${networkName}`);

  // //Set flavors
  await holons.newFlavor("Splitter", splitterFactory.target);
  console.log("Splitter flavor set");
  await holons.newFlavor("Appreciative", appreciativeFactory.target);
  console.log("Appreciative flavor set");
  await holons.newFlavor("Zoned", zonedFactory.target);
  console.log("Zoned flavor set");
  await holons.newFlavor("Managed", managedFactory.target);
  console.log("Managed flavor set");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
