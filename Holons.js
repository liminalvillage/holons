import { ethers } from 'ethers';

import * as appreciative from './contracts/Appreciative.json' assert { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' assert { type: "json" };
import * as managed from './contracts/Managed.json' assert { type: "json" };

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

    this.bot.command("listmembers", async (ctx) => {
      const chatID = ctx.message.chat.id;
      let address = await this.holonsContract.toAddress(chatID.toString());
      let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
      let members = await holon.listMembers();
      if (members.length > 0) {
        return ctx.reply(members.join(', '));
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
    let holonaddress = await this.holonsContract.toAddress(chatID.toString());
    let holon = new ethers.Contract(holonaddress, managed.default.abi, this.wallet);
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

  async createHolon(ctx) {
    try {
      const chatID = ctx.message.chat.id;
      let flavor = ctx.message.text.split(" ").slice(1).join(" ");
      if (flavor == "") {
        flavor = "Managed";
      }
      console.log(flavor);
      
      let address = await this.holonsContract.toAddress(chatID.toString());
      if (address !== '0x0000000000000000000000000000000000000000') {
        ctx.reply(`Holon address on ${this.network}: ${address}`);
      } else {
        const tx = await this.holonsContract.newHolon(flavor, chatID.toString(), flavor == "Zoned" ? 5 : 0, {
          gasLimit: 3000000,
          maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
          maxFeePerGas: ethers.parseUnits("30", "gwei"),
        });
        const receipt = await tx.wait();
        
        if (receipt.status !== 1) {
          return ctx.reply("Holon creation failed");
        } else {
          address = await this.holonsContract.toAddress(chatID.toString());
          ctx.reply(`${flavor} holon address on ${this.network}: ${address}`);
        }
        return address;
      }
    } catch (error) {
      console.error("Error creating holon:", error);
      ctx.reply("An error occurred while creating the holon.");
    }
  }

  async addMembers(ctx) {
    console.log("Adding members to holon");
    const id = ctx.message.chat.id;
    let holonaddress = await this.holonsContract.toAddress(id.toString());
    let users = await this.db.getAll(id.toString() + '/users');
    
    let successCount = 0;
    let failCount = 0;
    
    // Process members sequentially
    for (const user of users) {
        if (user.id != undefined) {
            try {
                // Add a small delay between transactions
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.addMember(holonaddress, user.id.toString());
                successCount++;
            } catch (error) {
                console.error(`Failed to add member ${user.id}:`, error);
                failCount++;
            }
        }
    }
    
    ctx.reply(`Finished processing members.\nSuccess: ${successCount}\nFailed: ${failCount}`);
  }

  async sendCommand(_holonaddress, _command, _args) {
    let holon = new ethers.Contract(_holonaddress, managed.default.abi, this.wallet);
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
      const tx = await this.holonsContract.newHolon("Managed", _name, 0, {
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

  async addMember(_holonaddress, _userid) {
    try {
        // Create contract instance with the correct ABI
        let holon = new ethers.Contract(_holonaddress, managed.default.abi, this.wallet);
        console.log('adding member to holon:', _holonaddress, _userid);
        
        // First check if member already exists
        const existingAddress = await holon.userIdToAddress(_userid.toString());
        if (existingAddress !== '0x0000000000000000000000000000000000000000') {
            console.log('member already exists: ', _userid);
            return true;
        }

        // Get the current nonce for this transaction
        const nonce = await this.wallet.getNonce();
        
        // Make sure we're passing the userId as a string
        const userId = _userid.toString();
        console.log('Adding member with userId:', userId);
        
        // Call the addMember(string) function explicitly
        const tx = await holon['addMember(string)'](userId, {
            gasLimit: 3000000,
            maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
            maxFeePerGas: ethers.parseUnits("30", "gwei"),
            nonce: nonce
        });
        
        console.log('Transaction sent:', tx.hash);
        
        // Wait for the transaction to be mined
        const receipt = await tx.wait();
        console.log(`Successfully added member ${userId}, transaction hash: ${receipt.hash}`);
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
}
