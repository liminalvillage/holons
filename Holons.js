import { ethers } from 'ethers';
import * as fs from 'fs';
import { Scenes } from 'telegraf';
import * as utils from './utilities.js';

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

    // Create scenes for text input
    this.createHolonScene = new Scenes.BaseScene('create_holon_scene');
    this.createHolonScene.enter(async (ctx) => {
      const flavors = await this.holonsContract.listFlavors();
      
      // Map of icons for each holon type
      const flavorIcons = {
        "Managed": "🔹",
        "Zoned": "🔶",
        "Splitter": "💱",
        "Appreciative": "💯"
      };
      
      // Create inline keyboard with holon types and a back button
      const inlineKeyboard = [
        ...flavors.map(flavor => ([{ 
          text: `${flavorIcons[flavor] || "🔸"} ${flavor}`, 
          callback_data: `create_holon_${flavor}` 
        }])),
        // Add a back button at the bottom
        [{ text: "◀️ Back", callback_data: "holons_back" }]
      ];
      
      // If this is from a callback query, edit the message
      if (ctx.callbackQuery) {
        await ctx.editMessageText(
          "Select a holon type to create:",
          {
            reply_markup: {
              inline_keyboard: inlineKeyboard
            }
          }
        ).catch(error => {
          console.error("Error editing message:", error);
        });
      } else {
        // Otherwise send a new message (first entry)
        await ctx.reply(
          "Select a holon type to create:",
          {
            reply_markup: {
              inline_keyboard: inlineKeyboard
            }
          }
        );
      }
    });
    
    this.createHolonScene.action(/create_holon_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const flavor = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
      
      await ctx.editMessageText(
        `You selected ${flavor}. Do you want to proceed with creation?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes", callback_data: `confirm_holon_creation_${flavor}` },
                { text: "❌ No", callback_data: "holons_back" }
              ]
            ]
          }
        }
      ).catch(error => {
        console.error("Error editing message:", error);
      });
    });
    
    this.createHolonScene.action(/confirm_holon_creation_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const flavor = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
      
      // Edit the message to show creation in progress
      await ctx.editMessageText(`Creating ${flavor} holon... Please wait.`);
      
      try {
        const creatorUserId = userID.toString();
        const holonName = chatID.toString();
        const parameterValue = flavor.toLowerCase() === "zoned" ? 5 : 0;
        
        const txParams = [flavor, creatorUserId, holonName, parameterValue];
        
        const createTx = await this.executeTransaction( 
          this.holonsContract,
          'newHolon',
          txParams,
          { gasLimit: 5000000 }
        );
        
        // Don't await the transaction completion
        this.waitForTransaction(
          createTx, 
          ctx,
          `${flavor} holon created on ${this.network}`
        );
        
        // Update the message with transaction status
        await ctx.editMessageText(
          `Transaction submitted for ${flavor} holon creation.\n\nYou will be notified when the holon is created.`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]]
            }
          }
        );
        
      } catch (error) {
        console.error("Error creating holon:", error);
        await ctx.editMessageText(
          `Failed to create holon: ${error.message}`,
          {
            reply_markup: {
              inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]]
            }
          }
        );
      }
      
      await ctx.scene.leave();
    });
    
    this.createHolonScene.action('cancel_create_holon', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        "Holon creation cancelled.",
        {
          reply_markup: {
            inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]]
          }
        }
      );
      await ctx.scene.leave();
    });
    
    // Create token balance scene
    this.tokenBalanceScene = new Scenes.BaseScene('token_balance_scene');
    this.tokenBalanceScene.enter(async (ctx) => {
      await ctx.reply("Please enter the token address to check balance:");
    });
    
    this.tokenBalanceScene.on('text', async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const tokenAddress = ctx.message.text.trim();
      
      // Validate the token address
      if (!ethers.isAddress(tokenAddress)) {
        await ctx.reply("Invalid token address. Please enter a valid Ethereum address.");
        return;
      }
      
      try {
        let address = await this.holonsContract.toAddress(chatID.toString());
        let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
        
        // Get token balance for the contract itself
        let tokenContract = new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], this.provider);
        let contractBalance = await tokenContract.balanceOf(address);
        
        let users = await this.db.getAll(chatID.toString() + '/users');
        if (!users || users.length === 0) {
          await ctx.reply("No users found in the database.");
          await ctx.scene.leave();
          return;
        }
        
        let userIds = users.map(user => user.id.toString());
        
        let balances = await Promise.all(userIds.map(async userId => 
          await holon.tokenBalance(userId, tokenAddress)
        ));
        
        let table = "User ID | Token Balance\n" +
                    "--------|---------------\n" +
                    userIds.map((userId, index) => 
                      `${userId.padEnd(8)} | ${ethers.formatEther(balances[index])}`
                    ).join('\n');
        
        let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `Contract Balance: ${ethers.formatEther(contractBalance)}\n`;
        message += `Token Balances:\n\`\`\`\n${table}\n\`\`\``;
        
        // Add a back button if this was called from the menu
        if (ctx.callbackQuery) {
          return ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
            }
          });
        } else {
          ctx.reply(message, { parse_mode: 'Markdown' });
        }
        
        await ctx.scene.leave();
      } catch (error) {
        console.error("Error checking token balance:", error);
        await ctx.reply("Error checking token balance: " + error.message);
        await ctx.scene.leave();
      }
    });
    
    // Create claim scene
    this.claimScene = new Scenes.BaseScene('claim_scene');
    this.claimScene.enter(async (ctx) => {
      await ctx.reply(`Please enter your wallet address on ${this.network} to claim tokens:`);
    });
    
    this.claimScene.on('text', async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
      const beneficiaryAddress = ctx.message.text.trim();
      
      // Validate the Ethereum address
      if (!ethers.isAddress(beneficiaryAddress)) {
        await ctx.reply("Please provide a valid Ethereum address");
        return;
      }
      
      try {
        let holonAddress = await this.holonsContract.toAddress(chatID.toString());
        if (holonAddress === '0x0000000000000000000000000000000000000000') {
          await ctx.reply("No holon exists for this chat. Create one first with /createholon");
          await ctx.scene.leave();
          return;
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
        
        // Don't await the transaction completion
        this.waitForTransaction(
          tx,
          ctx,
          `Claim successful! Transaction hash: ${tx.hash}`
        );
        
        // Provide immediate feedback
        return ctx.reply(`Transaction submitted. You will be notified when your claim is processed.`);
      } catch (error) {
        console.error("Error in claim:", error);
        return ctx.reply("Claim Failed: " + error.message);
      }
    });
    
    // Create reward scene
    this.rewardScene = new Scenes.BaseScene('reward_scene');
    this.rewardScene.enter(async (ctx) => {
      await ctx.reply("Please enter the token address and amount to reward members.\nFormat: [token address] [amount]");
    });
    
    this.rewardScene.on('text', async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const args = ctx.message.text.split(" ").slice(1);
      
      if (args.length < 2) {
        await ctx.reply("Please provide both token address and amount.\nFormat: [token address] [amount]");
        return;
      }
      
      const tokenAddress = args[0];
      const amount = args[1];
      
      // Validate the token address
      if (!ethers.isAddress(tokenAddress)) {
        await ctx.reply("Invalid token address. Please enter a valid Ethereum address.");
        return;
      }
      
      try {
        // Parse the amount with 18 decimals (adjust if needed)
        const parsedAmount = ethers.parseUnits(amount, 18);
        
        let holonAddress = await this.holonsContract.toAddress(chatID.toString());
        let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);
        
        // First, approve the holon contract to spend tokens
        let tokenContract = new ethers.Contract(tokenAddress, [
          'function approve(address spender, uint256 amount) public returns (bool)',
          'function allowance(address owner, address spender) public view returns (uint256)'
        ], this.wallet);
        
        // Check current allowance
        const currentAllowance = await tokenContract.allowance(this.wallet.address, holonAddress);
        if (currentAllowance < parsedAmount) {
          await ctx.reply("Approving token transfer...");
          const approveTx = await tokenContract.approve(holonAddress, parsedAmount);
          await approveTx.wait();
          await ctx.reply('Approval transaction completed');
        }
        
        await ctx.reply("Distributing reward... Please wait.");
        
        // Now call the reward function 
        const tx = await holon.reward(tokenAddress, parsedAmount, {
          gasLimit: 3000000,
          maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
          maxFeePerGas: ethers.parseUnits("30", "gwei"),
        });
        
        // Don't await the transaction completion
        this.waitForTransaction(
          tx,
          ctx,
          `Reward of ${ethers.formatUnits(parsedAmount, 18)} tokens successfully distributed to holon members.`
        );
        
        // Provide immediate feedback
        await ctx.reply(`Transaction submitted. You will be notified when the reward of ${ethers.formatUnits(parsedAmount, 18)} tokens is distributed.`);
      } catch (error) {
        console.error("Error in reward function:", error);
        await ctx.reply("An error occurred while processing the reward: " + error.message);
        await ctx.scene.leave();
      }
    });
    
    // Add scenes to bot stage if it exists
    if (this.bot.stage) {
      this.bot.stage.register(this.createHolonScene);
      this.bot.stage.register(this.tokenBalanceScene);
      this.bot.stage.register(this.claimScene);
      this.bot.stage.register(this.rewardScene);
    }

    // Fetch the deployment data: 
    const deploymentData = JSON.parse(fs.readFileSync('./contracts/deployment.json', 'utf-8'))[this.network];
    // Fetch the contract address
    const holonsAddress = deploymentData.Holons; // Assuming 'Holons' is the key for the contract address
    // Fetch the ABI
    const holonsABI = JSON.parse(fs.readFileSync('./contracts/Holons.json', 'utf-8')).abi; // Load ABI from the corresponding file

    console.log("Holons Contract Address: ", holonsAddress);
    console.log("Network: ", this.network);
    console.log("Bot wallet: ", this.wallet.address);

    this.holonsContract = new ethers.Contract(
      holonsAddress,
      holonsABI,
      this.wallet
    );
   

    this.setupBotCommands();
    this.setupCallbackHandlers();
  }

  setupBotCommands() {
    this.bot.command("createholon", async (ctx) => this.createHolon(ctx));
    // this.bot.command("addmembers", async (ctx) => this.addMembers(ctx));
    this.bot.command("addmembersBundle", async (ctx) => this.addMembersBundle(ctx));
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
    
    // Add new command for the holons menu
    this.bot.command("holons", async (ctx) => this.showHolonsMenu(ctx));

    this.bot.command("listmembers", async (ctx) => {
      const chatID = utils.getChatId(ctx);
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
        let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `Members (${membersLength}):\n`;
        for (let i = 0; i < members.length; i++) {
          const member = members[i];
          try {
            const user = await this.db.get('users', member);
            if (user && user.first_name) {
              message += `${i + 1}: ${user.first_name} ${user.last_name ? user.last_name.charAt(0) + '.' : ''} (${member})\n`;
            } else {
              message += `${i + 1}: ${member}\n`;
            }
          } catch (error) {
            message += `${i + 1}: ${member}\n`;
          }
        }
        return ctx.reply(message);
      } else {
        ctx.reply(`🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n━━━━━━━━━━━━━━━━━━━━━━\n\nNo members found`);
      }
    });

    this.bot.command("sync", async (ctx) => {
      await this.createHolon(ctx);
      await this.addMembers(ctx);
      await this.syncScore(ctx);
    });
  }

  setupCallbackHandlers() {
    // Handle holons menu callbacks
    this.bot.action(/holons_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const action = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      
      switch(action) {
        case 'create':
          await ctx.scene.enter('create_holon_scene');
          break;
        case 'addmembers':
          await this.addMembers(ctx);
          break;
        case 'syncscore':
          await this.syncScore(ctx);
          break;
        case 'listmembers':
          let address = await this.holonsContract.toAddress(chatID.toString());
          let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
          let membersLength = await holon.getSize();
          let members = [];
          for(let i = 0; i< membersLength; i++){
            let member = await holon.userIds(i);
            members.push(member);
          }
          if (membersLength > 0) {
            let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
            message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
            message += `Members (${membersLength}):\n`;
            members.forEach((member, index) => {
              message += `${index + 1}. ${member}\n`;
            });
            return ctx.editMessageText(message, {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          } else {
            ctx.editMessageText(`🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n━━━━━━━━━━━━━━━━━━━━━━\n\nNo members found`, {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          }
          break;
        case 'claim':
          await ctx.scene.enter('claim_scene');
          break;
        case 'reward':
          await ctx.scene.enter('reward_scene');
          break;
        case 'ethbalance':
          await this.ethBalance(ctx);
          break;
        case 'tokenbalance':
          await ctx.scene.enter('token_balance_scene');
          break;
        case 'zones':
          // Check if the holon is of the "Zoned" type before showing zones
          try {
            const holonAddress = await this.holonsContract.toAddress(chatID.toString());
            if (holonAddress === '0x0000000000000000000000000000000000000000') {
              return ctx.editMessageText("No holon exists for this chat", {
                reply_markup: {
                  inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
                }
              });
            }
            
            const holon = await this.getHolonContract(holonAddress);
            const flavor = await holon.flavor();
            
            if (flavor === "Zoned") {
              await this.showZones(ctx);
            } else {
              return ctx.editMessageText(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`, {
                reply_markup: {
                  inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
                }
              });
            }
          } catch (error) {
            console.error("Error checking holon type:", error);
            return ctx.editMessageText("Error checking holon type", {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          }
          break;
        case 'back':
          await this.showHolonsMenu(ctx, true);
          break;
        default:
          await ctx.reply("Unknown action");
      }
    });
  }

  async showHolonsMenu(ctx, edit = false) {
    const chatID = utils.getChatId(ctx);
    
    // Check if a holon exists for this chat
    let holonAddress = '0x0000000000000000000000000000000000000000';
    let isZonedHolon = false;
    let holonFlavor = "";
    
    try {
      holonAddress = await this.holonsContract.toAddress(chatID.toString());
      
      // Check if the holon is of the "Zoned" type
      if (holonAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const holon = await this.getHolonContract(holonAddress);
          holonFlavor = await holon.flavor();
          isZonedHolon = (holonFlavor === "Zoned");
          console.log(`Holon flavor: ${holonFlavor}, isZonedHolon: ${isZonedHolon}`);
        } catch (error) {
          console.error("Error checking holon flavor:", error);
        }
      }
    } catch (error) {
      console.error("Error checking holon address:", error);
    }
    
    const holonExists = holonAddress !== '0x0000000000000000000000000000000000000000';
    
    const menuMarkup = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🆕 Create Holon", callback_data: "holons_create" }
          ]
        ]
      }
    };
    
    // Only show these options if a holon exists
    if (holonExists) {
      // Common buttons for all holon types
      menuMarkup.reply_markup.inline_keyboard.push(
        [
          { text: "➕ Add Members", callback_data: "holons_addmembers" },
          { text: "👥 List Members", callback_data: "holons_listmembers" }
        ],
        [
          { text: "🔄 Sync Score", callback_data: "holons_syncscore" },
          { text: "💰 Claim Tokens", callback_data: "holons_claim" }
        ],
        [
          { text: "🎁 Reward Members", callback_data: "holons_reward" },
          { text: "⚖️ ETH Balance", callback_data: "holons_ethbalance" }
        ],
        [
          { text: "🪙 Token Balance", callback_data: "holons_tokenbalance" }
        ]
      );
      
      // Only show zone-related buttons if the holon is of the "Zoned" type
      if (isZonedHolon) {
        menuMarkup.reply_markup.inline_keyboard.push(
          [
            { text: "🔍 Show Zones", callback_data: "holons_zones" }
          ]
        );
      }
    }
    
    // Create a more prominent message with the holon address at the top
    let message;
    if (holonExists) {
      message = `🔷 HOLON ADDRESS 🔷\n\`${holonAddress}\`\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `Type: ${holonFlavor}\n`;
      message += `Network: ${this.network}\n`;
      message += `\nSelect an action from the menu below:`;
    } else {
      message = "No holon exists for this chat yet.\n\nCreate a new holon using the buttons below.";
    }
    
    if (edit) {
      return ctx.editMessageText(message, menuMarkup)
        .catch(e => console.log('Error editing holons menu:', e));
    } else {
      return ctx.reply(message, menuMarkup)
        .catch(e => console.log('Error showing holons menu:', e));
    }
  }

  async reward(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 2) {
      return ctx.reply("Usage: /reward [token address] [amount]");
    }

    const tokenAddress = args[0];
    console.log("tokenAddress from reward(): ", tokenAddress);
    const amount = ethers.parseUnits(args[1], 18); // Assuming 18 decimals, adjust if needed
    const chatID = utils.getChatId(ctx);

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

      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        `Reward of ${ethers.formatUnits(amount, 18)} tokens successfully distributed to holon members.`
      );
      
      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when the reward of ${ethers.formatUnits(amount, 18)} tokens is distributed.`);
    } catch (error) {
      console.error("Error in reward function:", error);
      ctx.reply("An error occurred while processing the reward: " + error.message);
      await ctx.scene.leave();
    }
  }

  async ethBalance(ctx) {
    const userID = utils.getUserId(ctx);
    const chatID = utils.getChatId(ctx);
    let address = await this.holonsContract.toAddress(chatID.toString());
    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
    let balance = await holon.etherBalance(userID.toString());

    let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `Eth Balance: ${ethers.formatEther(balance)}`;
    
    // Add a back button if this was called from the menu
    if (ctx.callbackQuery) {
      return ctx.editMessageText(message, {
        reply_markup: {
          inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
        }
      });
    } else {
      ctx.reply(message);
    }
  }

  async tokenBalance(ctx) {
    const chatID = utils.getChatId(ctx);
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
    
    let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `Contract Balance: ${ethers.formatEther(contractBalance)}\n`;
    message += `Token Balances:\n\`\`\`\n${table}\n\`\`\``;
    
    // Add a back button if this was called from the menu
    if (ctx.callbackQuery) {
      return ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
        }
      });
    } else {
      ctx.reply(message, { parse_mode: 'Markdown' });
    }
  }

  async syncScore(ctx) {
    const chatID = utils.getChatId(ctx);
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
      
      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        "Sync Successful"
      );
      
      // Provide immediate feedback
      await ctx.reply("Transaction submitted. You will be notified when the sync is completed.");
    } catch (error) {
      console.error("Error in syncScore:", error);
      ctx.reply("Sync Failed: " + error.message);
    }
  }
  
  async waitForTransaction(tx, context, successMessage) {
    try {
      // Don't await the transaction here, instead handle it asynchronously
      tx.wait().then(async (receipt) => {
        if (receipt.status === 1) {
          if (successMessage && context) {
            context.reply(`✅ Transaction completed: ${successMessage} ${tx.hash}`);
            // const newAddress = await this.holonsContract.toAddress(utils.getChatId(context).toString());
            // context.reply('New holon address: ' + newAddress);
          }
          return receipt;
        } else {
          if (context) {
            context.reply("❌ Transaction failed during execution");
          }
          console.error("Transaction failed with status 0");
        }
      }).catch(error => {
        console.error("Transaction error:", error);
        if (context) {
          context.reply(`❌ Transaction failed: ${error.message}`);
        }
      });
      
      // Return the transaction immediately
      return tx;
    } catch (error) {
      console.error("Error setting up transaction wait:", error);
      if (context) {
        context.reply(`❌ Error setting up transaction: ${error.message}`);
      }
      throw error;
    }
  }

  async executeTransaction(contract, method, args, options = {}) {
    try {
      // Fetch current fee data from the provider
      const feeData = await this.wallet.provider.getFeeData();
      // console.log("📌 Fee Data: ", feeData);
      // // Define a buffer multiplier (10% buffer in this case)

      // console.log("maxPriorityFeePerGas: ", feeData.maxPriorityFeePerGas);
      // console.log("maxFeePerGas: ", feeData.maxFeePerGas);

      // // Validate contract instance
      // console.log("📌 Contract Address from execute transaction:", contract.target || contract.address);
      // if (!contract.target && !contract.address) {
      //     throw new Error("Contract instance does not have a valid address!");
      // }

      // // Validate arguments
      // console.log("📌 Arguments Passed:", args);
      // console.log("📌 Type of args:", typeof args, "Array check:", Array.isArray(args));

      // // Validate ABI
      // console.log("📌 Contract ABI from executeTranasction():", contract.interface.fragments.map(f => f.name));
      // if (!contract.interface.fragments.some(f => f.name === method)) {
      //     throw new Error(`"${method}" is not in the contract ABI!`);
      // }
      // console.log("📌 Executing transaction on contract:", contract?.target);
      // console.log("📌 ABI:", contract?.interface?.fragments);
      // console.log("📌 Arguments:", args);

      // // Check if contract address is valid
      // const contractCode = await this.wallet.provider.getCode(contract.address);
      // console.log("📌 Code at Address:", contractCode);
      // if (contractCode === "0x") {
      //     throw new Error("Invalid contract address! It is an externally owned account (EOA) and not a contract.");
      // }
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

      // Debugging issues with bundles
      // Log the contract object
      // console.log("Contract:", contract);

      // // Log the available methods on the contract (to check if the method exists)
      // console.log("Contract methods:", Object.keys(contract));

      // // Log the method being called
      // console.log("Method:", method);

      // // Log whether the method exists and is a function
      // console.log("Is method valid:", typeof contract[method] === "function");

      // // Log the arguments being passed
      // console.log("Arguments:", args);

      // // Check if args is an array
      // console.log("Is args an array:", Array.isArray(args));

      // // Check if args is undefined or null
      // console.log("Args type:", typeof args, args === null ? "null" : "not null");
      // Debugging issues with bundles

      // Log what the encoded data should look like
      const encodedData = contract.interface.encodeFunctionData(method, 
      Array.isArray(args[0]) ? args[0] : args);
      console.log("Expected encoded calldata:", encodedData);

  
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
      
      // Get contract address and check interface
      const holonsAddress = this.holonsContract.target;
      console.log("Holons contract address:", holonsAddress);
      
      // Debug contract interface
      console.log("Contract inspection:");
      console.log("- Contract target:", this.holonsContract.target);
      console.log("- Has interface:", !!this.holonsContract.interface);
      
      if (this.holonsContract.interface) {
        console.log("- Interface fragments:", this.holonsContract.interface.fragments.map(f => f.name));
        
        if (this.holonsContract.interface.functions) {
          console.log("- Functions:", Object.keys(this.holonsContract.interface.functions));
        } else {
          console.log("- No functions property on interface");
        }
      }
      
      // Prepare transaction parameters
      const creatorUserId = userID.toString();
      //#TODO: Technical debt 1 - Revisit this as it was created in order to evade Solidity strings .concat issues, but the question is did we need it in the first place
      // as we used chat_id + managed / zoned in contractsByType mapping, but we could have used simple getManaged, getZoned contract.
      // It's definitely possible to get those contract, as Holons.sol have mapping of chatId -> Splitter address. From specific splitter we can just call getManaged
      // and getZoned contract
      const holonName = `chat_${Math.abs(chatID)}`;
      const parameterValue = 5;
      
      await ctx.reply(`Creating ${flavor} holon... Please wait.`);
      
      // Use a direct approach with encoded function call
      console.log("Creating function data manually");
      
      // Try using the encodeFunctionData method
      let encodedData;
      try {
        console.log("Encoding function data for newHolonBundle");
        encodedData = this.holonsContract.interface.encodeFunctionData(
          "newHolonBundle", 
          [creatorUserId, holonName, parameterValue]
        );
        console.log("Encoded data:", encodedData);
      } 
      catch (encodeError) {
        console.error("Error encoding function data:", encodeError);
      }
      
      // Send transaction using the signer directly
      await ctx.reply(`Submitting transaction...`);
      const signer = this.holonsContract.runner;
      
      if (!signer) {
        return ctx.reply(`Error: No signer attached to contract. Cannot submit transaction.`);
      }

      console.log("About to send transaction with data:", {
        to: holonsAddress,
        dataLength: encodedData ? encodedData.length : 0,
        dataPreview: encodedData ? encodedData.substring(0, 66) + '...' : 'none',
        gasLimit: 10_000_000
      });

      // Add this debugging before sending the transaction
      console.log("Contract connection check:");
      console.log("- Contract has runner:", !!this.holonsContract.runner);
      console.log("- Contract has provider:", !!this.holonsContract.provider);

      try {
        await this.holonsContract.newHolonBundle.staticCall(creatorUserId, holonName, parameterValue, { gasLimit: 10_000_000 })
      } catch (simulationError) { 
        console.error("Simulation error:", simulationError);
      }
      
      const tx = await this.holonsContract.newHolonBundle(creatorUserId, holonName, parameterValue, { gasLimit: 10_000_000 })


      console.log("Transaction submitted:", tx.hash);
      await ctx.reply(`Transaction submitted: ${tx.hash}\nWaiting for confirmation...`);
      
      const receipt = await tx.wait();
      console.log("Transaction confirmed:", receipt);
      
      return ctx.reply(`✅ Holon creation transaction completed!\nHash: ${tx.hash}`);
      
    } catch (error) {
      console.error("========== ERROR CREATING HOLON ==========");
      console.error("Error:", error);
      console.error("Error message:", error.message);
      
      // More detailed error logging
      if (error.code) console.error("Error code:", error.code);
      if (error.stack) console.error("Stack trace:", error.stack);
      
      return ctx.reply(`Failed to create holon: ${error.message}`);
    }
  }
  // #TOOD: Previous. Delete once we create an alternative
  async addMembers(ctx) {
    console.log("addMembers function called");
    const chatID = utils.getChatId(ctx);
    const userID = utils.getUserId(ctx); // Get the user ID of the person who initiated the command
    
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

        // Don't await the transaction completion
        this.waitForTransaction(tx, ctx, `Successfully added ${userIds.length} members`);
        
        // Provide immediate feedback
        results.push(`Transaction submitted. You will be notified when members are added.`);
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
  //#TODO: Write new implementation here
  async addMembersBundle(ctx){
    console.log("addMembersBundle function called");
    const chatID = utils.getChatId(ctx);
    console.log("initial chatID:", chatID);
    const userID = utils.getUserId(ctx); // Get the user ID of the person who initiated the command

    // Logic to understand if it's member trough delegation?
    // If it is: Write that only internal members can add members to the group. Add members in your root group.
    // Only the internal members can move external members trough zones!

    // If it isn't continue regularly
    let users = await this.db.getAll(chatID.toString() + '/users');
    let userIds = users.map(user => user.id.toString());

    let holonAddressManaged;

    console.log("Users that we found from addMembers(): ", users);
    if (!users || users.length === 0) {
      return ctx.reply("No users found in the database.");
    }
    // const holonName = `${Math.abs(chatID)}`;
    // const holonName = chatID;
    const holonName = `chat_${Math.abs(chatID)}`;

    try{
       holonAddressManaged = await this.getManagedContract(holonName);
      //  console.log("holonAddressManaged from addMembersBundle: ", holonAddressManaged); // it's there, commenting it out 
      
    }catch(error){
      console.error("Cannot find holon, in this case it's Managed!");
    }
    // console.log("Adding members to a managed holon address: ", holonAddressManaged); // it works, it's just managedHolon, it's not holonAddressManaged
    await ctx.reply(`Adding ${users.length} members... Please wait.`);

    let results = [];
    try {
      // Commenting it out for the moment, sending transaction manually
      // const tx = await this.executeTransaction(
      //   holonAddressManaged,
      //   'addMembers',
      //   userIds
      // );

      // Get the contract method directly
      const addMembersFunction = holonAddressManaged.interface.getFunction('addMembers');
      
      // Log the expected parameter types
      console.log("Expected parameter types:", addMembersFunction.inputs.map(i => i.type))
      const data = holonAddressManaged.interface.encodeFunctionData('addMembers', [userIds]);

      // Debugging - checking the ABI: 

      console.log("Contract ABI for Managed Contract:");
      holonAddressManaged.interface.fragments.forEach(fragment => {
        if (fragment.type === 'function') {
          console.log(`Function: ${fragment.name}`);
          console.log(`Inputs: ${fragment.inputs.map(i => i.type).join(', ')}`);
        }
      });

      // Specifically check for addMembers
      const addMembersFunc = holonAddressManaged.interface.getFunction('addMembers');
      if (addMembersFunc) {
        console.log("Found addMembers function with signature:");
        console.log(`  Inputs: ${addMembersFunc.inputs.map(i => i.type).join(', ')}`);
      } else {
        console.log("WARNING: addMembers function not found in contract ABI!");
      }

      console.log("data before sending: ", data);
      const tx = await this.wallet.sendTransaction({
        to: holonAddressManaged.target,
        data,
        gasLimit: 3000000,
        // maxPriorityFeePerGas: maxPriorityFee,
        // maxFeePerGas: maxFee,
        nonce: await this.wallet.getNonce()
      });

      // Don't await the transaction completion
      this.waitForTransaction(tx, ctx, `Successfully added ${userIds.length} members`);
      
      // Provide immediate feedback
      results.push(`Transaction submitted. You will be notified when members are added.`);
    } catch (error) {
      console.error("Transaction error:", error);
      results.push(`Failed to add members: ${error.message}`);
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
      
      // Map of icons for each holon type
      const flavorIcons = {
        "Managed": "🔹",
        "Zoned": "🔶",
        "Splitter": "💱",
        "Appreciative": "💯"
      };
      
      // Create a formatted list with icons
      const flavorsList = flavors.map(flavor => 
        `${flavorIcons[flavor] || "🔸"} ${flavor}`
      ).join('\n');
      
      const message = "🔷 Available Holon Types 🔷\n\n" + 
                     flavorsList + 
                     "\n\n📝 To create a holon, use:\n/createholon [type]";
      
      // Add a back button if this was called from the menu
      if (ctx.callbackQuery) {
        return ctx.editMessageText(message, {
          reply_markup: {
            inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
          }
        });
      } else {
        ctx.reply(message);
      }
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
    const chatID = utils.getChatId(ctx);

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
      
      // Check if this is actually a Zoned holon by checking the flavor
      const flavor = await holon.flavor();
      if (flavor !== "Zoned") {
        return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`);
      }
      
      await ctx.reply(`Moving member to zone ${zoneNumber}... Please wait.`);

      const tx = await this.executeTransaction(
        holon,
        'moveToZone',
        [memberAddress, zoneNumber]
      );

      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        `Successfully moved ${memberAddress} to zone ${zoneNumber}`
      );
      
      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when the member is moved to zone ${zoneNumber}.`);

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
    const chatID = utils.getChatId(ctx);
    
    try {
      let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat");
      }
      
      let holon = await this.getHolonContract(holonAddress);

      // Check if this is a Zoned holon by checking the flavor
      const flavor = await holon.flavor();
      if (flavor !== "Zoned") {
        return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`);
      }

      // Retrieve all users from the database for the given chatID
      const users = await this.db.getAll(chatID.toString() + '/users');
      const userMap = users.reduce((map, user) => {
          map[user.id] = user.username; // Assuming user.id is the address and user.username is the tag
          return map;
      }, {});

      // Get zones from the Zoned holon
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

          let message = `🔷 HOLON ADDRESS 🔷\n\`${holonAddress}\`\n\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
          message += "Zone Members:\n";
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

          // Add a back button if this was called from the menu
          if (ctx.callbackQuery) {
            return ctx.editMessageText(message, {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          } else {
            ctx.reply(message);
          }
      } catch (error) {
          console.error("Error retrieving zone members:", error);
          ctx.reply("Failed to retrieve zone members: " + error.message);
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
  //#TODO: Those functions should be moved to helper.js: 
  //#TODO: Related to technical debt 1
  async getSplitterContract(chatID) {
    console.log(`Getting Splitter contract for chat ID: ${chatID}`);
    
    try {
      // Convert chatID to string if it's not already
      const chatIDStr = chatID.toString();
      const holonAddress = await this.holonsContract.toAddress(chatIDStr);
      console.log(`Splitter holon address for chat ${chatIDStr}: ${holonAddress}`);
      // Get the holon address for this chat
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        console.log('No holon exists for this chat, in this case it is Splitter!');
        return null;
      }
      // console.log("getSplitterContract() - holonAddress: ", holonAddress);
      // console.log("getSplitterContract() - splitter default ABI: ", splitter.default.abi);
      // console.log("getSplitterContract() - this.wallet: ", this.wallet)
      let splitterContract = new ethers.Contract(holonAddress, splitter.default.abi, this.wallet);
      // console.log("Splitter contract:", splitterContract);  It's there

      // The holon itself is the splitter in this case
      return splitterContract;
    } catch (error) {
      console.error('Error getting Splitter contract:', error);
      throw error;
    }
  }
  async getZonedContract(chatID) {
    console.log(`Getting Zoned contract for chat ID: ${chatID}`);
    
    try {
      // First get the Splitter contract
      const splitterContract = await this.getSplitterContract(chatID);
      console.log("from getZonedContract: splitter contract", splitterContract);
      
      if (!splitterContract) {
        console.log('getZonedContract, zoned is not initialized');
        return null;
      }
      // const holonName = `chat_${Math.abs(chatID)}`;// 
      const holonName = `chat_${Math.abs(chatID)}_zoned`;// 
      
      // Get the Zoned contract from the Splitter
      return await splitterContract.contractsByType(holonName);
    } catch (error) {
      console.error('Error getting Zoned contract:', error);
      throw error;
    }
  }
  async getManagedContract(chatID) {
    console.log(`Getting Managed contract for chat ID: ${chatID}`);
    
    try {
      // First get the Splitter contract
      const splitterContract = await this.getSplitterContract(chatID);
      // console.log("getManagedContract, we succesfully got splitter contract:" , splitter); // works
      console.log("getManagedContract, chatID: ", chatID);
      
      if (!splitterContract) {
        console.log('getManagedContract, splitter is not initialized');
        return null;
      }
      // const holonName = `${Math.abs(chatID)}`;
      const holonName = chatID + "_managed"; 
      // const holonName = chatID; 
      // console.log("Holon name from getManagedContract:", holonName);

      // Get the Managed contract from the Splitter
      // console.log("Splitter ABI: ", splitter.default.abi); // It's there
      const managedContractAddress = await splitterContract.contractsByType(holonName);
      const managedContract = new ethers.Contract(managedContractAddress, managed.default.abi, this.wallet);
      // console.log("Actual managed contract is there: ", managedContract); // It's there
      return managedContract;
    } catch (error) {
      console.error('Error getting Zoned contract:', error);
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
    const chatID = utils.getChatId(ctx);

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

      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        `Successfully set shares for ${memberAddress} to ${shares}`
      );
      
      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when shares are set for ${memberAddress}.`);

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
      const chatID = utils.getChatId(ctx);
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
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
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
      await this.appreciateUsersByUsername(usernames, percentages, chatID, userID);

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
    const chatID = utils.getChatId(ctx);

    try {
        const solidityZone = this.invertZone(telegramZone);

        const holonAddress = await this.holonsContract.toAddress(chatID.toString());
        if (holonAddress === '0x0000000000000000000000000000000000000000') {
            return ctx.reply("No holon exists for this chat");
        }

        const holon = await this.getHolonContract(holonAddress);
        
        // Check if this is actually a Zoned holon by checking the flavor
        const flavor = await holon.flavor();
        if (flavor !== "Zoned") {
            return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`);
        }
        
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

        // Don't await the transaction completion
        this.waitForTransaction(
            tx,
            ctx,
            `Successfully added ${userTag} to zone ${telegramZone}`
        );
        
        // Provide immediate feedback
        await ctx.reply(`Transaction submitted. You will be notified when ${userTag} is added to zone ${telegramZone}.`);

    } catch (error) {
        console.error("Error adding to zone:", error);
        ctx.reply(`Failed to add to zone: ${error.message}`);
    }
  }

  async claim(ctx) {
    const chatID = utils.getChatId(ctx);
    const userID = utils.getUserId(ctx);
    
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
      
      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        `Claim successful! Transaction hash: ${tx.hash}`
      );
      
      // Provide immediate feedback
      return ctx.reply(`Transaction submitted. You will be notified when your claim is processed.`);
    } catch (error) {
      console.error("Error in claim:", error);
      return ctx.reply("Claim Failed: " + error.message);
    }
  }
}
