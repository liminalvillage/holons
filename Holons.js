import { ethers } from 'ethers';
import * as fs from 'fs';

import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' assert { type: "json" };
import * as factory from './contracts/IHolonFactory.json' assert { type: "json" };

import * as managed from './contracts/Managed.json' assert { type: "json" };
import * as zoned from './contracts/Zoned.json' assert { type: "json" };
import * as splitter from './contracts/Splitter.json' assert { type: "json" };
import * as holons from './contracts/Holons.json' assert { type: "json" };

// "SplitterFactory": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
// "AppreciativeFactory": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
// "ZonedFactory": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
// "ManagedFactory": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
// "Managed": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
// "Holons": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
// "TestToken": "0x0165878A594ca255338adfa4d48449f69242Eb8F"

export default class Holons {
  constructor(bot, db, settings) {
    this.network = process.env.NETWORK;
    this.chainId = parseInt(process.env.CHAINID);
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.privateKey = process.env.WEB3KEY;
    this.provider = new ethers.JsonRpcProvider(process.env.WEB3PROVIDER);
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);

    // Fetch the deployment data: 
    const deploymentData = JSON.parse(fs.readFileSync('./contracts/deployment.json', 'utf-8'))[this.network];
    // Fetch the contract address
    const holonsAddress = deploymentData.Holons; // Assuming 'Holons' is the key for the contract address
    // Fetch the ABI
    const holonsABI = JSON.parse(fs.readFileSync('./contracts/Holons.json', 'utf-8')).abi; // Load ABI from the corresponding file

    console.log("Holons Contract Address: ", holonsAddress);
    console.log("HolonsABI: ", holonsABI);
    console.log("this.wallet: ", this.wallet);

    this.holonsContract = new ethers.Contract(
      holonsAddress,
      holonsABI,
      this.wallet
    );
    // console.log("this.holonsContract: ", this.holonsContract);
    // console.log("this.holonsContract.address: ", this.holonsContract.address);
    // console.log("Wallet address:", this.wallet.address);
    // console.log("Wallet Network:", this.network);

    this.setupBotCommands();
  }

  setupBotCommands() {
    this.bot.command("createholon", async (ctx) => this.createHolon(ctx));
    this.bot.command("addmembers", async (ctx) => this.addMembers(ctx));
    this.bot.command("syncscore", async (ctx) => this.syncScore(ctx));
    this.bot.command("claim", async (ctx) => this.claim(ctx));
    this.bot.command("reward", async (ctx) => this.reward(ctx));
    this.bot.command("ethbalance", async (ctx) => this.ethBalance(ctx));
    this.bot.command("tokenbalance", async (ctx) => this.tokenBalance(ctx));
    this.bot.command("sendCommand", async (ctx) => this.sendCommand(ctx));
    this.bot.command("holontypes", async (ctx) => this.showHolonTypes(ctx));
    this.bot.command("movezone", async (ctx) => this.moveToZone(ctx));
    this.bot.command("zones", async (ctx) => this.showZones(ctx));
    this.bot.command("setshares", async (ctx) => this.setShares(ctx));
    this.bot.command("setsplit", async (ctx) => this.handleSetSplitCommand(ctx));
    this.bot.command("appreciate", async(ctx) => this.handleAppreciateCommand(ctx));
    this.bot.command("addtozone", async (ctx) => this.handleAddToZoneCommand(ctx));

    this.bot.command("listmembers", async (ctx) => {
      const chatID = ctx.message.chat.id;
      let address = await this.holonsContract.toAddress(chatID.toString());
      console.log("address from listmembers command: ", address);
      let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
      // holon.listMembers() does not actually exist - there is alternative getter function we could call - userIds
      // let members = await holon.listMembers();
      let membersLength = await holon.getSize();
      let members = [];
      console.log("members length from /listmembers: ", membersLength);
      for(let i = 0; i< membersLength; i++){
        let member = await holon.userIds(i);
        members.push(member);
      }
      // console.log("listing members from /listmembers command: ", members);
      if (membersLength > 0) {
        let message = "Members:\n";
        members.forEach((member, index) => {
          message += `${index + 1}. ${member}\n`;
        });
        return ctx.reply(message);
      } else {
        ctx.reply("No members found");
      }
    });

    this.bot.command("sync", async (ctx) => {
      await this.createHolon(ctx);
      await this.addMembers(ctx);
      await this.syncScore(ctx);
    });
  }

  async reward(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
      return ctx.reply("Usage: /reward [token address] [amount]");
    }

    const tokenAddress = args[0];
    console.log("tokenAddress from reward(): ", tokenAddress);
    const amount = ethers.parseUnits(args[1], 18); // Assuming 18 decimals, adjust if needed
    const chatID = ctx.message.chat.id;

    try {
      let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      // commenting out for now, as it makes debugging harder then neccessairy
      // const holonAddress = "0x0cea18A881E9D8767537F32C0A984ccFC9740BFD";
      // ^ fixing this instead
      console.log("holonAddress from reward: ", holonAddress);
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);
      console.log("holon.target from reward: ", holon.target);

      // First, approve the holon contract to spend tokens
      let tokenContract = new ethers.Contract(tokenAddress, [
        'function approve(address spender, uint256 amount) public returns (bool)',
        'function allowance(address owner, address spender) public view returns (uint256)'
      ], this.wallet);

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(this.wallet.address, holonAddress);
      if (currentAllowance < amount ) {
        const approveTx = await tokenContract.approve(holonAddress, amount);
        await approveTx.wait();
        console.log('Approval transaction completed');
      }

      // Now call the reward function 
      const tx = await holon.reward(tokenAddress, amount, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });

      const receipt = await tx.wait();

      if (receipt.status === 1) {
        ctx.reply(`Reward of ${ethers.formatUnits(amount, 18)} tokens successfully distributed to holon members.`);
      } else {
        ctx.reply("Failed to distribute reward. Please try again.");
      }
    } catch (error) {
      console.error("Error in reward function:", error);
      ctx.reply("An error occurred while processing the reward: " + error.message);
    }
  }

  async ethBalance(ctx) {
    const userID = ctx.message.from.id;
    const chatID = ctx.message.chat.id;
    let address = await this.holonsContract.toAddress(chatID.toString());
    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
    let balance = await holon.etherBalance(userID.toString());

    ctx.reply("Eth Balance: " + ethers.formatEther(balance));
  }

  async tokenBalance(ctx) {
    const chatID = ctx.message.chat.id;
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 1) {
      return ctx.reply("Usage: /tokenbalance [token address]");
    }
    const tokenAddress = args[0];
    console.log("tokenAddress from tokenBalance(): ", tokenAddress);
    
    let users = await this.db.getAll(chatID.toString() + '/users');
    if (!users || users.length === 0) {
      return ctx.reply("No users found in the database.");
    }
    
    let userIds = users.map(user => user.id.toString());
    
    console.log("User IDs from tokenBalance():", userIds);

    let address = await this.holonsContract.toAddress(chatID.toString());
    
    // commenting out at the moment, as it's making debugging harder than it should be
    // placing this instead
    // const address = "0x0cea18A881E9D8767537F32C0A984ccFC9740BFD";
    console.log("address from tokenBalance(): ", address);
                                             //?
    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
    console.log("holon.target from tokenBalance()", holon.target);
    // Get token balance for the contract itself
    let tokenContract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], this.provider);
    console.log("tokenContract from tokenBalance(): ", tokenContract.target);
    let contractBalance = await tokenContract.balanceOf(address);
    console.log("contractBalance from tokenBalance(): ", contractBalance);

    // let balances = await Promise.all(userIds.map(async userId => 
    //   await holon.tokenBalance(userId, tokenAddress)
    // ));

    let balances = await Promise.all(userIds.map(async userId => 
      await holon.tokenBalance(userId, tokenAddress)
    ));
    
    console.log("balances from tokenBalance(): ", balances);
    
    let table = "User ID | Token Balance\n" +
                "--------|---------------\n" +
                userIds.map((userId, index) => 
                  `${userId.padEnd(8)} | ${ethers.formatEther(balances[index])}`
                ).join('\n');
    
    ctx.reply(
      `Contract Balance: ${ethers.formatEther(contractBalance)}\n` +
      `Token Balances:\n\`\`\`\n${table}\n\`\`\``, 
      { parse_mode: 'Markdown' }
    );
  }

  async syncScore(ctx) {
    const chatID = ctx.message.chat.id;
    let users = await this.db.getAll(chatID.toString() + '/users')
    if (!users) return ctx.reply("No users found");
    const equation = await this.settings.getValueEquation(chatID)

    let userids = users.map((user) => user.id.toString());
    let scores = users.map((user) => {
      return (
        user.initiated.length * equation.initiated +
        user.completed.length * equation.completed +
        user.sent * equation.sent +
        user.received * equation.received +
        user.hours * equation.hours +
        user.collaboration * equation.collaboration +
        user.wants.length * equation.wants +
        user.offers.length * equation.offers
      );
    });

    let address = await this.holonsContract.toAddress(chatID.toString());
    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);

    try {
      const tx = await holon.setAppreciation(userids, scores, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        ctx.reply("Sync Successful");
      } else {
        ctx.reply("Sync Failed");
      }
    } catch (error) {
      console.error("Error in syncScore:", error);
      ctx.reply("Sync Failed: " + error.message);
    }
  }

  // we were having an issues with this method
  // async claim(ctx) {
  //   const chatID = ctx.message.chat.id;
  //   const userID = ctx.message.from.id;
  //   let holonAddress = await this.holonsContract.toAddress(chatID.toString());
  //   let holon = await this.getHolonContract(holonAddress);
  //   const args = ctx.message.text.split(" ").slice(1);
  //   if (args.length < 1) {
  //     return ctx.reply(`Usage: /claim [your wallet address on ${this.network}]`);
  //   }
  //   const address = args[0];
    
  //   try {
  //     console.log("from claim() userID.toString(): ", userID.toString());
  //     const tx = await holon.claim(userID.toString(), address, {
  //       gasLimit: 3000000,
  //       maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
  //       maxFeePerGas: ethers.parseUnits("30", "gwei"),
  //     });
  //     const receipt = await tx.wait();
      
  //     if (receipt.status === 1) {
  //       return ctx.reply("Claim Successful");
  //     } else {
  //       return ctx.reply("Claim Failed");
  //     }
  //   } catch (error) {
  //     console.error("Error in claim:", error);
  //     return ctx.reply("Claim Failed: " + error.message);
  //   }
  // }
  
  // potentionally corrected one
  async claim(ctx) {
    const chatID = ctx.message.chat.id;
    const userID = ctx.message.from.id;
    
    try {
      let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat. Create one first with /createholon");
      }
  
      const args = ctx.message.text.split(" ").slice(1);
      if (args.length < 1) {
        return ctx.reply(`Usage: /claim [your wallet address on ${this.network}]`);
      }
  
      const beneficiaryAddress = args[0];
      
      // Validate the Ethereum address
      if (!ethers.isAddress(beneficiaryAddress)) {
        return ctx.reply("Please provide a valid Ethereum address");
      }
  
      let holon = await this.getHolonContract(holonAddress);
      
      console.log("Claiming for userID:", userID.toString());
      console.log("Beneficiary address:", beneficiaryAddress);
  
      // Execute the transaction using the contract's claim function
      const tx = await this.executeTransaction(
        holon,
        'claim',
        [userID.toString(), beneficiaryAddress],
        {
          gasLimit: 3000000,
          maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
          maxFeePerGas: ethers.parseUnits("30", "gwei"),
        }
      );
      
      await ctx.reply("Transaction submitted. Waiting for confirmation...");
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        return ctx.reply(`Claim successful!\nTransaction hash: ${receipt.hash}`);
      } else {
        return ctx.reply("Claim failed during execution");
      }
    } catch (error) {
      console.error("Error in claim:", error);
      return ctx.reply("Claim Failed: " + error.message);
    }
  }

  async waitForTransaction(tx, context, successMessage) {
    try {
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        if (successMessage) {
          await context.reply(successMessage);
        }
        return receipt;
      } else {
        throw new Error("Transaction failed");
      }
    } catch (error) {
      console.error("Transaction error:", error);
      if (context) {
        await context.reply(`Transaction failed: ${error.message}`);
      }
      throw error;
    }
  }

  async executeTransaction(contract, method, args, options = {}) {
    try {
      // Fetch current fee data from the provider
      const feeData = await this.wallet.provider.getFeeData();
      console.log("feeData: ", feeData);
      // Define a buffer multiplier (10% buffer in this case)

      console.log("maxPriorityFeePerGas: ", feeData.maxPriorityFeePerGas);
      console.log("maxFeePerGas: ", feeData.maxFeePerGas);
      
      // Use standard math operations with BigInt values
      const bufferMultiplier = BigInt(110);
      const divisor = BigInt(100);

      // Apply the buffer to the fee values using native BigInt operations
      const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * bufferMultiplier) / divisor;
      const maxFeePerGas = (feeData.maxFeePerGas * bufferMultiplier) / divisor;
      
      const defaultOptions = {
        gasLimit: 3000000,
        maxPriorityFeePerGas,
        maxFeePerGas,
      };
  
      const nonce = await this.wallet.getNonce();
      console.log("nonce: ", nonce);
      
      // Verify that the method exists on the contract
      if (typeof contract[method] !== 'function') {
        throw new Error(`Method ${method} not found on contract`);
      }
  
      // Execute the contract method with the updated fee parameters and nonce
      const tx = await contract[method](...args, {
        ...defaultOptions,
        // ...options,
        nonce
      });
  
      return tx;
    } catch (error) {
      console.error(`Error executing ${method}:`, error);
      throw error;
    }
  }
  

  async createHolon(ctx) {
    console.log("======== createHolon function called ========");
    try {
      // Log input parameters
      const chatID = ctx.message.chat.id;
      const userID = ctx.message.from.id;
      const args = ctx.message.text.split(" ").slice(1);
      const flavor = args[0]; // First parameter is always the holon type
      
      console.log("Input parameters:");
      console.log("- chatID:", chatID, "(" + typeof chatID + ")");
      console.log("- userID:", userID, "(" + typeof userID + ")");
      console.log("- args:", args);
      console.log("- flavor:", flavor, "(" + typeof flavor + ")");
      
      if (!flavor) {
        console.log("No flavor specified, returning early");
        return ctx.reply(
          "Please specify a holon type. Use /holontypes to see available types.\n" +
          "Usage: /createholon [type]"
        );
      }
      
      // Check Holons contract status
      let currentAddress = this.holonsContract.target;
      console.log("Holons contract details:");
      console.log("- Holons contract address:", currentAddress);
      // console.log("- Contract interface:", Object.keys(this.holonsContract.interface.functions));
      
      const holonExists = currentAddress !== '0x0000000000000000000000000000000000000000';
      console.log("- holonExists:", holonExists);
  
      // Verify flavor is supported
      console.log("Checking supported flavors...");
      const flavors = await this.holonsContract.listFlavors();
      console.log("- Available flavors:", flavors);
      console.log("- Is flavor supported:", flavors.includes(flavor));
      
      if (!flavors.includes(flavor)) {
        console.log("Flavor not supported, returning early");
        return ctx.reply(`Invalid holon type "${flavor}". Available types:\n${flavors.join('\n')}`);
      }
  
      // Handle existing holon case
      if (holonExists) {
        const isConfirmed = args.includes("confirm");
        console.log("- isConfirmed:", isConfirmed);
        
        if (!isConfirmed) {
          console.log("Confirmation required, returning early");
          return ctx.reply(
            `⚠️ WARNING: A holon already exists at ${currentAddress}\n\n` +
            `Creating a new ${flavor} holon will replace the existing one.\n` +
            `All existing members, balances, and data will be inaccessible!\n\n` +
            `To confirm, reply with /createholon ${flavor} confirm`
          );
        }
  
        await ctx.reply(`Creating new ${flavor} holon to replace existing one... Please wait.`);
      } else {
        await ctx.reply(`Creating ${flavor} holon... Please wait.`);
      }
  
      // Prepare transaction parameters
      const creatorUserId = userID.toString();
      const holonName = chatID.toString();
      const parameterValue = flavor.toLowerCase() === "zoned" ? 5 : 0;
      
      console.log("Preparing transaction with parameters:");
      console.log("- flavor:", flavor);
      console.log("- creatorUserId:", creatorUserId);
      console.log("- holonName:", holonName);
      console.log("- parameterValue:", parameterValue);
      
      // Check if flavor is registered correctly
      try {
        const flavorAddress = await this.holonsContract.newFlavor(flavor);
        console.log("- Flavor address for", flavor, ":", flavorAddress);
      } catch (error) {
        console.log("Error checking flavor address:", error.message);
      }
      
      // Execute transaction
      console.log("Executing transaction...");
      const txParams = [flavor, creatorUserId, holonName, parameterValue];
      console.log("- txParams:", txParams);
      
      // Add logs for executeTransaction internals
      console.log("- Contract:", this.holonsContract.target);
      console.log("- Method:", 'newHolon');
      console.log("- Function signature:", this.holonsContract.interface.getFunction('newHolon').format());
      
      const createTx = await this.executeTransaction( 
        this.holonsContract,
        'newHolon',
        txParams,
        { gasLimit: 5000000 } // Increase gas limit for complex contracts
      );
      
      console.log("Transaction submitted:");
      console.log("- txHash:", createTx.hash);
      console.log("- from:", createTx.from);
      console.log("- to:", createTx.to);
      console.log("- data:", createTx.data);
      console.log("- gasLimit:", createTx.gasLimit.toString());
  
      // Wait for transaction
      console.log("Waiting for transaction confirmation...");
      await this.waitForTransaction(
        createTx, 
        ctx,
        `${flavor} holon created on ${this.network}`
      );
      console.log("Transaction confirmed");
  
      // Verify the result
      console.log("Verifying results...");
      const newAddress = await this.holonsContract.toAddress(holonName);
      console.log("- New holon address from toAddress mapping:", newAddress);
      
      if (newAddress === '0x0000000000000000000000000000000000000000') {
        console.log("WARNING: Holon address is zero, storage operation may have failed");
      }
      
      return ctx.reply(`Holon address: ${newAddress}`);
  
    } catch (error) {
      console.error("========== ERROR CREATING HOLON ==========");
      console.error("Error object:", error);
      console.error("Error message:", error.message);
      
      // Extract more error details if available
      if (error.error) console.error("Inner error:", error.error);
      if (error.data) console.error("Error data:", error.data);
      if (error.code) console.error("Error code:", error.code);
      if (error.transaction) console.error("Transaction details:", error.transaction);
      if (error.receipt) console.error("Transaction receipt:", error.receipt);
      
      ctx.reply(`Failed to create holon: ${error.message}`);
    }
  }

  // async addMembers(ctx) {
  //   console.log("addMembers function called");
  //   const args = ctx.message.text.split(" ").slice(1);
  //   const chatID = ctx.message.chat.id;
    
  //   if (args.length === 0) {
  //     return ctx.reply(
  //       "Usage: /addmembers [ethereum_address1] [ethereum_address2] ...\n" +
  //       "Example: /addmembers 0x123... 0x456..."
  //     );
  //   }

  //   try {
  //     const holonAddress = await this.holonsContract.toAddress(chatID.toString());
  //     console.log("from addMembers(), holonAddress: ", holonAddress);
  //     if (holonAddress === '0x0000000000000000000000000000000000000000') {
  //       return ctx.reply("No holon exists for this chat. Create one first with /createholon");
  //     }

  //     const holon = await this.getHolonContract(holonAddress);
  //     // console.log("holon: ", holon);
      
  //     // Validate all addresses first
  //     // const invalidAddresses = args.filter(addr => !ethers.isAddress(addr));
  //     // if (invalidAddresses.length > 0) {
  //     //   return ctx.reply(
  //     //     "Invalid Ethereum addresses detected:\n" +
  //     //     invalidAddresses.join('\n') +
  //     //     "\n\nPlease provide valid addresses."
  //     //   );
  //     // }

  //     await ctx.reply(`Adding ${args.length} members... Please wait.`);
      
  //     let results = [];
  //     for (const address of args) {
  //       console.log("Member that is being added: ", address);
  //       try {
  //         // Check if already a member
  //         const isMember = await holon.isMember(address);
  //         if (isMember) {
  //           results.push(`${address}: Already a member`);
  //           continue;
  //         }
          
  //         // adding a single member
  //         // const tx = await this.executeTransaction(
  //         //   holon,
  //         //   'addMember(string)',
  //         //   [address]
  //         // );

  //         // adding multiple memebers
  //         const tx = await this.executeTransaction(
  //           holon,
  //           'addMembers(string[])',
  //           ["test", "test1"]
  //         );
          
  //         await this.waitForTransaction(tx);
  //         results.push(`${address}: Added successfully`);
          
  //         // Add delay between transactions
  //         await new Promise(resolve => setTimeout(resolve, 2000));
  //       } catch (error) {
  //         results.push(`${address}: Failed - ${error.message}`);
  //       }
  //     }

  //     // Send results in batches to avoid message length limits
  //     const batchSize = 10;
  //     for (let i = 0; i < results.length; i += batchSize) {
  //       const batch = results.slice(i, i + batchSize);
  //       await ctx.reply(batch.join('\n'));
  //     }

  //   } catch (error) {
  //     console.error("Error in addMembers:", error);
  //     ctx.reply(`Failed to process members: ${error.message}`);
  //   }
  // }
  // better version:
  async addMembers(ctx) {
    console.log("addMembers function called");
    const args = ctx.message.text.split(" ").slice(1);
    const chatID = ctx.message.chat.id;
    const userID = ctx.message.from.id.toString(); // Get the user ID of the person who initiated the command
    
    // if (args.length === 0) {
    //   return ctx.reply(
    //     "Usage: /addmembers [ethereum_address1] [ethereum_address2] ...\n" +
    //     "Example: /addmembers 0x123... 0x456..."
    //   );
    // }

    let users = await this.db.getAll(chatID.toString() + '/users');
    let userIds = users.map(user => user.id.toString());

    console.log("Users that we found from addMembers(): ", users);
    if (!users || users.length === 0) {
      return ctx.reply("No users found in the database.");
    }

    try {
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      console.log("from addMembers(), holonAddress: ", holonAddress);
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat. Create one first with /createholon");
      }

      const holon = await this.getHolonContract(holonAddress);

      // Determine if the holon is zoned by checking the flavor
      const flavor = await holon.flavor();
      const isZoned = (flavor === "Zoned");

      console.log("adding members to a holon address: ", holonAddress);
      await ctx.reply(`Adding ${users.length} members... Please wait.`);

      let results = [];
      try {
        const tx = await this.executeTransaction(
          holon,
          'addMembers',
          isZoned ? [userID, userIds] : [userIds] // Include userID if holon is zoned
        );

        await this.waitForTransaction(tx);
        results.push(`Successfully added ${userIds.length} members`);
      } catch (error) {
        console.error("Transaction error:", error);
        results.push(`Failed to add members: ${error.message}`);
      }

      // Send results
      await ctx.reply(results.join('\n'));

    } catch (error) {
      console.error("Error in addMembers:", error);
      ctx.reply(`Failed to process members: ${error.message}`);
    }
  }

  async sendCommand(_holonaddress, _command, _args) {
    let holon = await this.getHolonContract(_holonaddress);
    try {
      const tx = await holon[_command](..._args, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });
      return await tx.wait();
    } catch (error) {
      console.error("Error in sendCommand:", error);
      return error;
    }
  }

  async newFlavor(_flavorname, _flavoraddress) {
    try {
      const tx = await this.holonsContract.newFlavor(_flavorname, _flavoraddress, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });
      return await tx.wait();
    } catch (error) {
      console.error("Error in newFlavor:", error);
      return error;
    }
  }

  async newHolon(_name, _parameter) {
    try {
      const tx = await this.holonsContract.newHolon("Managed3", _name, 0, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });
      return await tx.wait();
    } catch (error) {
      console.error("Error in newHolon:", error);
      return error;
    }
  }

  async getFlavorAddress(_name) {
    return await this.holonsContract.getFlavorAddress(_name);
  }

  async listFlavors() {
    return await this.holonsContract.listFlavors();
  }

  async listHolons() {
    return await this.holonsContract.listHolons();
  }

  async listHolonsOf(_address) {
    return await this.holonsContract.listHolonsOf(_address);
  }
  
  // AddMember
  async addMember(_holonAddress, _memberAddress) {
    console.log("addMember is being called!")
    try {
      console.log('before adding a member to holon:');
      let holon = await this.getHolonContract(_holonAddress);
      console.log('adding member to holon:', _holonAddress, _memberAddress);
      
      // First check if member already exists
      const isMember = await holon.isMember(_memberAddress);
      if (isMember) {
        console.log('member already exists: ', _memberAddress);
        return true;
      }

      // Get the current nonce for this transaction
      const nonce = await this.wallet.getNonce();
      
      // Call the addMember(address) function explicitly
      const tx = await holon['addMember(address)'](_memberAddress, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
        nonce: nonce
      });
      
      console.log('Transaction sent:', tx.hash);
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      console.log(`Successfully added member ${_memberAddress}, transaction hash: ${receipt.hash}`);
      return receipt;
    } catch (error) {
      console.log("Error in add member!");
      // console.error("Error in addMember:", error.message);
      if (error.transaction) {
        // console.error("Transaction details:", {
        //   to: error.transaction.to,
        //   from: error.transaction.from,
        //   data: error.transaction.data
        // });
        console.log("It's error in transaction, definitely!");
      }
      throw error;
    }
  }

  async showHolonTypes(ctx) {
    try {
      const flavors = await this.holonsContract.listFlavors();
      const message = "Available Holon Types:\n" + 
                     flavors.join('\n') + 
                     "\n\nTo create a holon, use:\n/createholon [type]";
      ctx.reply(message);
    } catch (error) {
      console.error("Error fetching holon types:", error);
      ctx.reply("Error fetching holon types");
    }
  }

  async moveToZone(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
      return ctx.reply(
        "Usage: /movezone [ethereum_address] [zone_number]\n" +
        "Example: /movezone 0x123... 2"
      );
    }

    const [memberAddress, zoneNumberStr] = args;
    const zoneNumber = parseInt(zoneNumberStr);
    const chatID = ctx.message.chat.id;

    if (!ethers.isAddress(memberAddress)) {
      return ctx.reply(`Invalid Ethereum address: ${memberAddress}`);
    }

    if (isNaN(zoneNumber) || zoneNumber < 0) {
      return ctx.reply("Zone number must be a non-negative integer");
    }

    try {
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat");
      }

      const holon = await this.getHolonContract(holonAddress);
      
      // Check if this is actually a Zoned holon
      try {
        await holon.zoneCount();
      } catch (error) {
        return ctx.reply("This command only works with Zoned holons");
      }

      await ctx.reply(`Moving member to zone ${zoneNumber}... Please wait.`);

      const tx = await this.executeTransaction(
        holon,
        'moveToZone',
        [memberAddress, zoneNumber]
      );

      await this.waitForTransaction(
        tx,
        ctx,
        `Successfully moved ${memberAddress} to zone ${zoneNumber}`
      );

    } catch (error) {
      console.error("Error moving to zone:", error);
      if (error.message.includes("not a zoned")) {
        ctx.reply("This command only works with Zoned holons");
      } else {
        ctx.reply(`Failed to move member: ${error.message}`);
      }
    }
  }

  async showZones(ctx) {
    const chatID = ctx.message.chat.id;
    
    try {
      let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      let holon = await this.getHolonContract(holonAddress);

      // Check if this is a Zoned holon
      try {
        await holon.nzones();
      } catch (error) {
        console.log("Error happened while calling holon.nzones() in `showZones`", error);
        return ctx.reply("This command only works with Zoned holons");
      }

        // Retrieve all users from the database for the given chatID
        const users = await this.db.getAll(chatID.toString() + '/users');
        const userMap = users.reduce((map, user) => {
            map[user.id] = user.username; // Assuming user.id is the address and user.username is the tag
            return map;
        }, {});

        // Try to get zones - this will only work for Zoned holons
        try {
            const zoneCount = Number(await holon.nzones()); // Convert BigInt to Number
            let zoneMembers = [];
            // Reverse the order of zones
            for (let i = zoneCount; i >= 0; i--) {
                const members = await holon.getZoneMembers(i);
                console.log(`Zone ${i} members from the contract:`, members);
                // Reverse the order of members within each zone
                zoneMembers.push({
                    zone: this.invertZone(i),
                    members: [...members].reverse().map(member => userMap[member] || member)                    // Map to user tags
                });
            }

            let message = "Zone Members:\n";
            zoneMembers.forEach(zone => {
                message += `\nZone ${zone.zone}:\n`;
                if (zone.members.length === 0) {
                    message += "- Empty\n";
                } else {
                    zone.members.forEach(member => {
                        message += `- @${member}\n`;
                    });
                }
            });

            ctx.reply(message);
        } catch (error) {
            if (error.message.includes("not a zoned")) {
                ctx.reply("This command only works with Zoned holons");
            } else {
                throw error;
            }
        }
    } catch (error) {
        console.error("Error showing zones:", error);
        ctx.reply("Failed to show zones: " + error.message);
    }
  }

  async getHolonContract(holonAddress) {
    try {
      console.log("from getHolonContract() - Trying to fetch holon contract...");
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);

      // Call the getFlavor method to determine the holon type
      const flavor = await holon.flavor();
      console.log(`from getHolonContract() - Detected flavor: ${flavor}`);

      switch (flavor) {
        case "Zoned":
          return new ethers.Contract(holonAddress, zoned.default.abi, this.wallet);
        case "Splitter":
          return new ethers.Contract(holonAddress, splitter.default.abi, this.wallet);
        case "Appreciative":
          return new ethers.Contract(holonAddress, appreciative.default.abi, this.wallet);
        default:
          return holon; // Default to Managed
      }
    } catch (error) {
      console.error("Error getting holon contract:", error);
      throw error;
    }
  }

  async setShares(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
      return ctx.reply(
        "Usage: /setshares [ethereum_address] [shares]\n" +
        "Example: /setshares 0x123... 50"
      );
    }

    const [memberAddress, sharesStr] = args;
    const shares = parseInt(sharesStr);
    const chatID = ctx.message.chat.id;

    try {
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      const holon = await this.getHolonContract(holonAddress);

      // Check if this is a Splitter holon
      try {
        await holon.shares();
      } catch (error) {
        return ctx.reply("This command only works with Splitter holons");
      }

      const tx = await this.executeTransaction(
        holon,
        'setShares',
        [memberAddress, shares]
      );

      await this.waitForTransaction(
        tx,
        ctx,
        `Successfully set shares for ${memberAddress} to ${shares}`
      );

    } catch (error) {
      console.error("Error setting shares:", error);
      ctx.reply(`Failed to set shares: ${error.message}`);
    }
  }

  async setSplit(userTags, percentages, chatID) {
    try {
      // Ensure the lengths of userTags and percentages match
      if (userTags.length !== percentages.length) {
        throw new Error("User tags and percentages should be equal");
      }

      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      console.log("holonAddress: ", holonAddress);
      const holon = await this.getHolonContract(holonAddress);

      // Retrieve all users from the database for the given chatID
      let users = await this.db.getAll(chatID.toString() + '/users');

      // Map user tags to user IDs and convert them to strings
      const userIds = userTags.map(tag => {
        // Remove the '@' symbol from the tag to match the username
        const username = tag.startsWith('@') ? tag.slice(1) : tag;
        const user = users.find(u => u.username === username);
        if (!user) {
          throw new Error(`User with tag ${tag} not found`);
        }
        return user.id.toString(); // Convert user ID to string
      });

      // Calculate the total percentage to ensure it sums to 100
      const totalPercentage = percentages.reduce((acc, val) => acc + val, 0);
      if (totalPercentage !== 100) {
        throw new Error("Total percentage should be 100");
      }

      const contractAddress = await this.holonsContract.getAddress();
      // Log contract information
      console.log("Contract Address:", contractAddress);
      console.log("Contract ABI:", this.holonsContract.interface.fragments);

      // Execute the transaction with error handling
      try {
        const tx = await this.executeTransaction(
          holon,
          'setSplit',
          [userIds, percentages]
        );

        // Wait for the transaction to be mined
        await tx.wait();
        console.log("Split set successfully");
      } catch (transactionError) {
        console.error("Transaction failed:", transactionError);
        throw new Error("Failed to set split due to transaction error.");
      }
    } catch (error) {
      console.error("Error setting split:", error);
    }
  }

  async handleSetSplitCommand(ctx) {
    try {
      const chatID = ctx.message.chat.id;
      const text = ctx.message.text;

      // Remove the command part and split the rest of the message
      const args = text.split(' ').slice(1);

      // Separate user tags and percentages
      const userTags = [];
      const percentages = [];

      for (let i = 0; i < args.length; i += 2) {
        userTags.push(args[i]);
        percentages.push(parseInt(args[i + 1], 10));
      }

      // Call the setSplit function with parsed data
      await this.setSplit(userTags, percentages, chatID);

      ctx.reply("Split set successfully.");
    } catch (error) {
      console.error("Error handling setSplit command:", error);
      ctx.reply("Failed to set split. Please check your input format.");
    }
  }

  async appreciateUsersByUsername(userTags, percentages, chatID, senderUserId) {
    try {
      // Ensure the lengths of usernames and percentages match
      if (userTags.length !== percentages.length) {
        throw new Error("userTags and percentages should be equal");
      }
  
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      console.log("holonAddress: ", holonAddress);
      const holon = await this.getHolonContract(holonAddress);
  
      // Retrieve all users from the database for the given chatID
      let users = await this.db.getAll(chatID.toString() + '/users');
  
      // Map userTags to user IDs and convert them to strings
      const userIds = userTags.map(tag => {
        // Remove the '@' symbol from the tag to match the username
        const username = tag.startsWith('@') ? tag.slice(1) : tag;
        const user = users.find(u => u.username === username);
        if (!user) {
          throw new Error(`User with tag ${tag} not found`);
        }
        return user.id.toString(); // Convert user ID to string
      });
  
      // For single appreciations, don't check for 100% total
      if (userTags.length > 1) {
        // Calculate the total percentage to ensure it sums to 100
        const totalPercentage = percentages.reduce((acc, val) => acc + val, 0);
        if (totalPercentage !== 100) {
          throw new Error("Total percentage should be 100");
        }
      }
  
      // Execute the transaction for each user
      for (let i = 0; i < userIds.length; i++) {
        try {
          const tx = await this.executeTransaction(
            holon,
            'appreciate',
            [senderUserId.toString(), userIds[i], percentages[i]]
          );
          // Wait for the transaction to be mined
          await tx.wait();
          console.log(`Appreciation set successfully for user ${userTags[i]} by ${senderUserId}`);
        } catch (transactionError) {
          console.error("Transaction failed:", transactionError);
          throw new Error("Failed to set appreciation due to transaction error.");
        }
      }
    } catch (error) {
      console.error("Error setting appreciation:", error);
      throw error; // Re-throw the error to handle it in the calling function
    }
  }

  async handleAppreciateCommand(ctx) {
    try {
      const chatID = ctx.message.chat.id;
      const text = ctx.message.text;

      // Remove the command part and split the rest of the message
      const args = text.split(' ').slice(1);

      // Separate usernames and percentages
      const usernames = [];
      const percentages = [];

      for (let i = 0; i < args.length; i += 2) {
        usernames.push(args[i]);
        percentages.push(parseInt(args[i + 1], 10));
      }

      // Call the appreciateUsersByUsername function with parsed data
      await this.appreciateUsersByUsername(usernames, percentages, chatID, ctx.message.from.id);

      ctx.reply("Appreciation set successfully.");
    } catch (error) {
      console.error("Error handling appreciate command:", error);
      ctx.reply("Failed to set appreciation. Please check your input format.");
    }
  }

  // Utility function to invert the zone
  invertZone(telegramZone) {
    if (telegramZone < 0 || telegramZone > 5) {
        throw new Error("Zone must be an integer between 0 and 5");
    }
    return 5 - telegramZone;
  }

  // Utility function to retrieve user by tag
  async getUserByTag(chatID, tag) {
      // Retrieve all users from the database for the given chatID
      const users = await this.db.getAll(chatID.toString() + '/users');
      const username = tag.startsWith('@') ? tag.slice(1) : tag;
      const user = users.find(u => u.username === username);
      if (!user) {
          throw new Error(`User with tag ${tag} not found`);
      }
      return user;
  }

  async handleAddToZoneCommand(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
        return ctx.reply(
            "Usage: /addtozone [userId][zone]. Zones are from 0(highest) to 5(lowest)\n" +
            "Example: /addtozone @user 0"
        );
    }

    const senderTag = `@${ctx.from.username}`;
    const userTag = args[0];
    const zoneStr = args[1];
    console.log("Parsed command arguments:", { senderTag, userTag, zoneStr });
    const telegramZone = parseInt(zoneStr, 10);
    const chatID = ctx.message.chat.id;

    try {
        const solidityZone = this.invertZone(telegramZone);

        const holonAddress = await this.holonsContract.toAddress(chatID.toString());
        if (holonAddress === '0x0000000000000000000000000000000000000000') {
            return ctx.reply("No holon exists for this chat");
        }

        const holon = await this.getHolonContract(holonAddress);
        const users = await this.db.getAll(chatID.toString() + '/users');

        // Retrieve users by tags
        const senderUser = await this.getUserByTag(chatID, senderTag);
        const user = await this.getUserByTag(chatID, userTag);

        await ctx.reply(`Adding user to zone ${telegramZone}... Please wait.`);

        const tx = await this.executeTransaction(
            holon,
            'addToZone',
            [senderUser.id.toString(), user.id.toString(), solidityZone]
        );

        await this.waitForTransaction(
            tx,
            ctx,
            `Successfully added ${userTag} to zone ${telegramZone}`
        );

    } catch (error) {
        console.error("Error adding to zone:", error);
        ctx.reply(`Failed to add to zone: ${error.message}`);
    }
  }
}
