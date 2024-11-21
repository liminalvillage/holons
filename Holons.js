import { ethers } from 'ethers';

import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' assert { type: "json" };
import * as managed from './contracts/Managed.json' assert { type: "json" };
import * as zoned from './contracts/Zoned.json' assert { type: "json" };
import * as splitter from './contracts/Splitter.json' assert { type: "json" };

import * as factory from './contracts/IHolonFactory.json' assert { type: "json" };
import * as holons from './contracts/Holons.json' assert { type: "json" };

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
    
    this.holonsContract = new ethers.Contract(
      holons.default.networks[this.chainId].address,
      holons.default.abi,
      this.wallet
    );

    console.log("Wallet address:", this.wallet.address);
    console.log("Wallet Network:", this.network);

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


    this.bot.command("listmembers", async (ctx) => {
      const chatID = ctx.message.chat.id;
      let address = await this.holonsContract.toAddress(chatID.toString());
      let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
      let members = await holon.listMembers();
      if (members.length > 0) {
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
    const amount = ethers.parseUnits(args[1], 18); // Assuming 18 decimals, adjust if needed
    const chatID = ctx.message.chat.id;

    try {
      let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);

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
    
    let users = await this.db.getAll(chatID.toString() + '/users');
    if (!users || users.length === 0) {
      return ctx.reply("No users found in the database.");
    }
    
    let userIds = users.map(user => user.id.toString());
    
    console.log("User IDs:", userIds);

    let address = await this.holonsContract.toAddress(chatID.toString());
    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
    
    // Get token balance for the contract itself
    let tokenContract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], this.provider);
    let contractBalance = await tokenContract.balanceOf(address);

    let balances = await Promise.all(userIds.map(async userId => 
      await holon.tokenBalance(userId, tokenAddress)
    ));
    
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

  async claim(ctx) {
    const chatID = ctx.message.chat.id;
    const userID = ctx.message.from.id;
    let holonAddress = await this.holonsContract.toAddress(chatID.toString());
    let holon = await this.getHolonContract(holonAddress);
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 1) {
      return ctx.reply(`Usage: /claim [your wallet address on ${this.network}]`);
    }
    const address = args[0];
    
    try {
      const tx = await holon.claim(userID.toString(), address, {
        gasLimit: 3000000,
        maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
        maxFeePerGas: ethers.parseUnits("30", "gwei"),
      });
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        return ctx.reply("Claim Successful");
      } else {
        return ctx.reply("Claim Failed");
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
    const defaultOptions = {
      gasLimit: 3000000,
      maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
      maxFeePerGas: ethers.parseUnits("30", "gwei"),
    };

    try {
      const nonce = await this.wallet.getNonce();
      
      // Check if method exists on contract
      if (typeof contract[method] !== 'function') {
        throw new Error(`Method ${method} not found on contract`);
      }

      // Use proper method calling syntax
      const tx = await contract[method](...args, {
        ...defaultOptions,
        ...options,
        nonce
      });

      return tx;
    } catch (error) {
      console.error(`Error executing ${method}:`, error);
      throw error;
    }
  }

  async createHolon(ctx) {
    try {
      const chatID = ctx.message.chat.id;
      const args = ctx.message.text.split(" ").slice(1);
      const flavor = args[0]; // First parameter is always the holon type
      
      if (!flavor) {
        return ctx.reply(
          "Please specify a holon type. Use /holontypes to see available types.\n" +
          "Usage: /createholon [type]"
        );
      }

      let currentAddress = await this.holonsContract.toAddress(chatID.toString());
      const holonExists = currentAddress !== '0x0000000000000000000000000000000000000000';

      const flavors = await this.holonsContract.listFlavors();
      if (!flavors.includes(flavor)) {
        return ctx.reply(`Invalid holon type "${flavor}". Available types:\n${flavors.join('\n')}`);
      }

      // Handle existing holon case
      if (holonExists) {
        const isConfirmed = args.includes("confirm");
        if (!isConfirmed) {
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

      // Create new holon - this will automatically replace any existing holon for this chatID
      const createTx = await this.executeTransaction(
        this.holonsContract,
        'newHolon',
        [flavor, chatID.toString(), flavor === "Zoned" ? 5 : 0]
      );

      await this.waitForTransaction(
        createTx, 
        ctx,
        `${flavor} holon created on ${this.network}`
      );

      const newAddress = await this.holonsContract.toAddress(chatID.toString());
      return ctx.reply(`Holon address: ${newAddress}`);

    } catch (error) {
      console.error("Error creating holon:", error);
      ctx.reply(`Failed to create holon: ${error.message}`);
    }
  }

  async addMembers(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    const chatID = ctx.message.chat.id;
    
    if (args.length === 0) {
      return ctx.reply(
        "Usage: /addmembers [ethereum_address1] [ethereum_address2] ...\n" +
        "Example: /addmembers 0x123... 0x456..."
      );
    }

    try {
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat. Create one first with /createholon");
      }

      const holon = await this.getHolonContract(holonAddress);
      
      // Validate all addresses first
      const invalidAddresses = args.filter(addr => !ethers.isAddress(addr));
      if (invalidAddresses.length > 0) {
        return ctx.reply(
          "Invalid Ethereum addresses detected:\n" +
          invalidAddresses.join('\n') +
          "\n\nPlease provide valid addresses."
        );
      }

      await ctx.reply(`Adding ${args.length} members... Please wait.`);
      
      let results = [];
      for (const address of args) {
        try {
          // Check if already a member
          const isMember = await holon.isMember(address);
          if (isMember) {
            results.push(`${address}: Already a member`);
            continue;
          }

          const tx = await this.executeTransaction(
            holon,
            'addMember(address)',
            [address]
          );
          
          await this.waitForTransaction(tx);
          results.push(`${address}: Added successfully`);
          
          // Add delay between transactions
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          results.push(`${address}: Failed - ${error.message}`);
        }
      }

      // Send results in batches to avoid message length limits
      const batchSize = 10;
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        await ctx.reply(batch.join('\n'));
      }

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
  

  async addMember(_holonAddress, _memberAddress) {
    try {
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
      console.error("Error in addMember:", error);
      if (error.transaction) {
        console.error("Transaction details:", {
          to: error.transaction.to,
          from: error.transaction.from,
          data: error.transaction.data
        });
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
        await holon.zoneCount();
      } catch (error) {
        return ctx.reply("This command only works with Zoned holons");
      }

      // Try to get zones - this will only work for Zoned holons
      try {
        const zoneCount = await holon.zoneCount();
        let zoneMembers = [];
        
        for (let i = 0; i < zoneCount; i++) {
          const members = await holon.listZoneMembers(i);
          zoneMembers.push({
            zone: i,
            members: members
          });
        }

        let message = "Zone Members:\n";
        zoneMembers.forEach(zone => {
          message += `\nZone ${zone.zone}:\n`;
          if (zone.members.length === 0) {
            message += "- Empty\n";
          } else {
            zone.members.forEach(member => {
              message += `- ${member}\n`;
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
      // First try with Managed ABI
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);
      
      // Try to detect the holon type
      try {
        // Check if it's a Zoned holon
        await holon.zoneCount();
        return new ethers.Contract(holonAddress, zoned.default.abi, this.wallet);
      } catch {
        try {
          // Check if it's a Splitter holon
          await holon.shares();
          return new ethers.Contract(holonAddress, splitter.default.abi, this.wallet);
        } catch {
          // Default to Managed if no special features detected
          return holon;
        }
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
}
