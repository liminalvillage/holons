/**
 * Creates a new holon bundle
 * @param {Object} holonsContract - The Holons contract instance
 * @param {string} creatorUserId - The ID of the user creating the bundle
 * @param {string} holonName - The name for the new bundle
 * @param {number} parameterValue - The parameter value for the bundle
 * @returns {Promise<Object>} Result object with success status and bundle address
 */
export async function createHolonBundle(
  holonsContract,
  creatorUserId,
  holonName,
  parameterValue
) {
  try {
    // 1. Create the Holon Bundle (Splitter)
    const txBundle = await holonsContract.newHolonBundle(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 15_000_000 }
    );
    console.log('Transaction submitted for newHolonBundle:', txBundle.hash);

    const receiptBundle = await txBundle.wait();
    console.log(
      'newHolonBundle transaction confirmed:',
      receiptBundle.status === 1 ? 'Success' : 'Failed'
    );
    if (receiptBundle.status !== 1) {
      throw new Error(
        `Holon Bundle creation transaction failed (Hash: ${txBundle.hash})`
      );
    }

    // 2. Get the bundle address from the transaction receipt events
    let splitterAddress;
    for (const log of receiptBundle.logs) {
      try {
        const parsedLog = holonsContract.interface.parseLog(log);
        if (parsedLog && parsedLog.name === 'HolonBundleCreated') {
          splitterAddress = parsedLog.args.bundleAddress;
          console.log(`Found Splitter address from event: ${splitterAddress}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback: try to get address from contract mapping if event parsing failed
    if (!splitterAddress) {
      console.log(
        `Retrieving Splitter address mapped in Holons contract for holonName: ${holonName}`
      );
      splitterAddress = await holonsContract.toAddress(holonName);
      console.log(
        `Retrieved Splitter Address from Holons mapping: ${splitterAddress}`
      );
    }

    // Check if splitterAddress is valid
    if (
      !splitterAddress ||
      splitterAddress === '0x0000000000000000000000000000000000000000'
    ) {
      throw new Error(
        `Failed to retrieve a valid Splitter address for ${holonName} after bundle creation.`
      );
    }

    return {
      success: true,
      bundleAddress: splitterAddress,
    };
  } catch (error) {
    console.error('Error creating holon bundle:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Creates managed and zoned contracts for a bundle
 * @param {Object} splitterContract - The Splitter contract instance
 * @param {string} creatorUserId - The ID of the user creating the contracts
 * @param {string} holonName - The name for the contracts
 * @param {number} parameterValue - The parameter value for the contracts
 * @returns {Promise<Object>} Result object with success status and contract addresses
 */
export async function createBundleContracts(
  splitterContract,
  creatorUserId,
  holonName,
  parameterValue
) {
  try {
    // Create Managed Contract
    const txManaged = await splitterContract.createManagedContract(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 6_000_000 }
    );
    console.log(
      'Transaction submitted for createManagedContract:',
      txManaged.hash
    );

    const receiptManaged = await txManaged.wait();
    if (receiptManaged.status !== 1) {
      throw new Error(
        `Managed Contract creation transaction failed (Hash: ${txManaged.hash})`
      );
    }

    // Get the managed contract address
    const managedContractKey = `${holonName}_managed`;
    const managedAddress =
      await splitterContract.contractsByType(managedContractKey);

    // Create Zoned Contract
    const txZoned = await splitterContract.createZonedContract(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 10_000_000 }
    );
    console.log('Transaction submitted for createZonedContract:', txZoned.hash);

    const receiptZoned = await txZoned.wait();
    if (receiptZoned.status !== 1) {
      throw new Error(
        `Zoned Contract creation transaction failed (Hash: ${txZoned.hash})`
      );
    }

    // Get the zoned contract address
    const zonedContractKey = `${holonName}_zoned`;
    const zonedAddress =
      await splitterContract.contractsByType(zonedContractKey);

    return {
      success: true,
      managedAddress,
      zonedAddress,
    };
  } catch (error) {
    console.error('Error creating bundle contracts:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}
