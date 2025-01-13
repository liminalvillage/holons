import fs from "fs";
import { ethers, network } from "hardhat"; // Import ethers from Hardhat
import { BigNumberish, BigNumber, ContractTransaction } from "ethers"; // Import specific types from ethers

async function main() {
  // Use the Hardhat network name
  const networkName = network.name;
  console.log(`Running on network: ${networkName}`);

  // Load deployment data
  const deploymentData = JSON.parse(fs.readFileSync("../deployment.json", "utf-8"));
  if (!deploymentData[networkName] || !deploymentData[networkName].TestToken) {
    throw new Error(`No deployment data found for network: ${networkName}`);
  }

  // Get the TestToken contract address for the specified network
  const testTokenAddress = deploymentData[networkName].TestToken;
  console.log(`Using TestToken address: ${testTokenAddress} on network: ${networkName}`);

  // Define ABI and initialize contract
  const testTokenABI = [
    "function transfer(address to, uint256 amount) public returns (bool)",
    "function balanceOf(address account) public view returns (uint256)"
  ];

  // Cast contract to include specific methods
  const testToken = new ethers.Contract(testTokenAddress, testTokenABI, ethers.provider) as ethers.Contract & {
    transfer(to: string, amount: BigNumberish): Promise<ContractTransaction>;
    balanceOf(account: string): Promise<BigNumber>;
  };

  // Get signer and perform transfer
  const [deployer] = await ethers.getSigners();
  const recipient = "0x04dfB907193F0daC9fe1811402C79b9f11e9cBB8";
  const amount = ethers.parseUnits("1000", 18);

  const tx = await testToken.connect(deployer).transfer(recipient, amount);
  await tx.wait();

  console.log(`Transferred ${ethers.formatUnits(amount, 18)} tokens to ${recipient}`);
  const recipientBalance = await testToken.balanceOf(recipient);
  console.log("Recipient Balance:", ethers.formatUnits(recipientBalance, 18));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
