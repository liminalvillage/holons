import { ethers, network } from "hardhat";

async function main() {
    // Use the Hardhat network name
    const networkName = network.name;
    console.log(`Running on network: ${networkName}`);

    // Define contract and token details
    const contractAddress = "0xd84FC39c85876EFD6CE8D0F48469C45D23CB147C";
    const userId = "535329585";
    const tokenAddress = "0xF1C4C314471b76DdC95c7f34f88d21424F924CB8";

    // Initialize ethers provider dynamically from Hardhat's preconfigured provider
    const provider = ethers.provider; // Preconfigured provider by Hardhat

    // Fetch the network information
    const networkDetails = await provider.getNetwork();
    console.log(`Using network: ${networkDetails.name} (chainId: ${networkDetails.chainId})`);

    // Connect to the Managed contract
    const contract = new ethers.Contract(contractAddress, [
        "function tokenBalance(string memory userId, address tokenAddress) public view returns (uint256)"
    ], provider);

    // Fetch the token balance
    const balance = await contract.tokenBalance(userId, tokenAddress);

    // Format and display the balance
    console.log(`Token Balance for ${userId} on token ${tokenAddress}: ${ethers.formatUnits(balance, 18)} tokens`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
