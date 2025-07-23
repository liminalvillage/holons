import { ethers } from 'ethers';
import * as fs from 'fs';
import { Scenes } from 'telegraf';
import * as utils from './utilities.js';

import * as appreciative from './contracts/Appreciative.json' with { type: "json" };
import * as appreciativefactory from './contracts/AppreciativeFactory.json' with { type: "json" };
import * as factory from './contracts/IHolonFactory.json' with { type: "json" };

import * as managed from './contracts/Managed.json' with { type: "json" };
import * as zoned from './contracts/Zoned.json' with { type: "json" };
import * as splitter from './contracts/Splitter.json' with { type: "json" };
import * as holons from './contracts/Holons.json' with { type: "json" };

// "SplitterFactory": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
// "AppreciativeFactory": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
// "ZonedFactory": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
// "ManagedFactory": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
// "Managed": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
// "Holons": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
// "TestToken": "0x0165878A594ca255338adfa4d48449f69242Eb8F"

import { createHolonBundle, createBundleContracts } from './utils/holonOperations.js';

export default class Holons {
  constructor(bot, db, settings) {
    this.network = process.env.NETWORK;
    this.chainId = parseInt(process.env.CHAINID);
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.ui = null; // Will be set by main app
    this.privateKey = process.env.WEB3KEY;
    this.provider = new ethers.JsonRpcProvider(process.env.WEB3PROVIDER);
    this.wallet = new ethers.Wallet(this.privateKey, this.provider);

    this.createHolonScene = new Scenes.BaseScene('create_holon_scene');
    this.createHolonScene.enter(async (ctx) => {
      const flavors = await this.holonsContract.listFlavors();
      const flavorIcons = {
        "Managed": "🔹",
        "Zoned": "🔶",
        "Splitter": "💱",
        "Appreciative": "💯"
      };
      const inlineKeyboard = [
        ...flavors.map(flavor => ([{ 
          text: `${flavorIcons[flavor] || "🔸"} ${flavor}`, 
          callback_data: `create_holon_${flavor}` 
        }])),
        [{ text: "◀️ Back", callback_data: "holons_back" }]
      ];
      if (ctx.callbackQuery) {
        await ctx.editMessageText("Select a holon type to create:", { reply_markup: { inline_keyboard: inlineKeyboard } }).catch(error => console.error("Error editing message:", error));
      } else {
        await ctx.reply("Select a holon type to create:", { reply_markup: { inline_keyboard: inlineKeyboard } });
      }
    });
    this.createHolonScene.action(/create_holon_(.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch()
      const flavor = ctx.match[1];
      await ctx.editMessageText(`You selected ${flavor}. Do you want to proceed with creation?`, {
          reply_markup: {
            inline_keyboard: [
            [{ text: "✅ Yes", callback_data: `confirm_holon_creation_${flavor}` }, { text: "❌ No", callback_data: "holons_back" }]
          ]}
      }).catch(error => console.error("Error editing message:", error));
    });
    this.createHolonScene.action(/confirm_holon_creation_(.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch()
      const flavor = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
      await ctx.editMessageText(`Creating ${flavor} holon... Please wait.`);
      try {
        const creatorUserId = userID.toString();
        const holonName = chatID.toString();
        const parameterValue = flavor.toLowerCase() === "zoned" ? 5 : 0;
        const txParams = [flavor, creatorUserId, holonName, parameterValue];
        const createTx = await this.executeTransaction(this.holonsContract, 'newHolon', txParams, { gasLimit: 5000000 });
        this.waitForTransaction(createTx, ctx, `${flavor} holon created on ${this.network}`);
        await ctx.editMessageText(`Transaction submitted for ${flavor} holon creation.\n\nYou will be notified when the holon is created.`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]] }
        });
      } catch (error) {
        console.error("Error creating holon:", error);
        await ctx.editMessageText(`Failed to create holon: ${error.message}`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]] }
        });
      }
      await ctx.scene.leave();
    });
    this.createHolonScene.action('cancel_create_holon', async (ctx) => {
      await ctx.answerCbQuery().catch()
      await ctx.editMessageText("Holon creation cancelled.", { reply_markup: { inline_keyboard: [[{ text: "◀️ Back to Menu", callback_data: "holons_back" }]] } });
      await ctx.scene.leave();
    });
    
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
        const contracts = await this.getHolonContracts(chatID, this.holonsContract, this.wallet);
        if (!contracts.success) {
            throw new Error(`Failed to get holon contracts: ${contracts.error}`);
        }

        const { managed, zoned } = contracts.contracts;
        // Now you have access to:
        // managed.contract - The Managed contract instance
        // managed.address - The Managed contract address
        // zoned.contract - The Zoned contract instance
        // zoned.address - The Zoned contract address
        
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
        
        const chatIdNormalized = `chat_${Math.abs(chatID)}`;
        let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;
        let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
        // let message = `🔷 HOLON ADDRESS 🔷\n\`${address}\`\n\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `Contract Balance: ${ethers.formatEther(contractBalance)}\n`;
        message += `Token Balances:\n\`\`\`\n${table}\n\`\`\``;
        
        // Add a back button if this was called from the menu
        if (ctx.callbackQuery) {
          return ctx.editMessageText(message, {
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
        const contracts = await this.getHolonContracts(chatID, this.holonsContract, this.wallet);
        if (!contracts.success) {
            throw new Error(`Failed to get holon contracts: ${contracts.error}`);
        }

        const { splitter, managed, zoned } = contracts.contracts;

        // Now you have access to:
        // managed.contract - The Managed contract instance
        // managed.address - The Managed contract address
        // zoned.contract - The Zoned contract instance
        // zoned.address - The Zoned contract address
        
        let holonAddress = managed.address;
        console.log("We are logging managed address: ", managed.address);
        console.log("We are logging zoned address: ", zoned.address);
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
    
    this.rewardScene = new Scenes.BaseScene('reward_scene');
    this.rewardScene.enter(async (ctx) => {
      await ctx.reply("Please enter the token address and amount to reward members.\nFormat: [token address] [amount]");
    });
    
    this.rewardScene.on('text', async (ctx) => {
      const chatID = utils.getChatId(ctx);
      // const args = ctx.message.text.split(" ").slice(1);
      const args = ctx.message.text.split(" ");
      
      if (args.length < 2) {
        await ctx.reply("Please provide both token address and amount.\nFormat: [token address] [amount]");
        return;
      }
      
      const tokenAddress = args[0];
      const amount = args[1];
      
      try {
        // Parse the amount with 18 decimals (adjust if needed)
        const parsedAmount = ethers.parseUnits(amount, 18);
        
        const contracts = await this.getHolonContracts(chatID, this.holonsContract, this.wallet);
        if (!contracts.success) {
            throw new Error(`Failed to get holon contracts: ${contracts.error}`);
        }
    
        const { splitter, managed, zoned } = contracts.contracts;
        console.log("splitter: ", splitter.address);
        console.log("managed: ", managed.address);
        console.log("zoned: ", zoned.address);
    
        // Check if this is an ETH transfer (tokenAddress is zero address)
        const isEthTransfer = tokenAddress === '0x0000000000000000000000000000000000000000';
    
        // Log network information
        console.log("Network:", this.network);
        console.log("Transaction sender (wallet) address:", this.wallet.address);
        
        // Get and log balances
        const senderBalance = await this.provider.getBalance(this.wallet.address);
        console.log("Sender balance:", ethers.formatEther(senderBalance), "ETH");
        
        const zonedBalance = await this.provider.getBalance(zoned.address);
        console.log("Zoned contract balance:", ethers.formatEther(zonedBalance), "ETH");
        
        // Calculate gas costs
        const gasPrice = await this.provider.getFeeData();
        console.log("Current gas price:", ethers.formatUnits(gasPrice.gasPrice, "gwei"), "gwei");
        
        // Set fixed gas limit for estimation
        const gasLimit = BigInt(300000);
        console.log("Using fixed gas limit:", gasLimit.toString());
        
        // Calculate total cost including gas
        const gasCost = gasLimit * gasPrice.gasPrice;
        const totalCost = isEthTransfer ? parsedAmount + gasCost : gasCost;
        console.log("Gas cost:", ethers.formatEther(gasCost), "ETH");
        console.log("Amount to send:", ethers.formatEther(parsedAmount), "ETH");
        console.log("Total cost (including gas):", ethers.formatEther(totalCost), "ETH");
        console.log("Raw values - Gas cost:", gasCost.toString());
        console.log("Raw values - Amount:", parsedAmount.toString());
        console.log("Raw values - Total:", totalCost.toString());
        console.log("Raw values - Balance:", senderBalance.toString());
        
        // Check if we have enough balance
        if (senderBalance < totalCost) {
            const neededEth = ethers.formatEther(totalCost);
            const haveEth = ethers.formatEther(senderBalance);
            throw new Error(`Insufficient balance. Need ${neededEth} ETH but have ${haveEth} ETH`);
        }
        
        if (!isEthTransfer) {
            // Handle ERC20 token transfer
            if (!ethers.isAddress(tokenAddress)) {
                throw new Error("Invalid token address provided");
            }

            console.log("tokenAddress:", tokenAddress);
    
            try {
              // Approve only the splitter contract to spend tokens
              let tokenContract = new ethers.Contract(tokenAddress, [
                  'function approve(address spender, uint256 amount) public returns (bool)',
                  'function allowance(address owner, address spender) public view returns (uint256)'
              ], this.wallet);

              console.log("Token contract: ", tokenContract.target);
              console.log("Splitter address from the reward scene, approval: ", splitter.address);
              // Check current allowance for splitter contract only
              const splitterAllowance = await tokenContract.allowance(this.wallet.address, splitter.address);
              
              if (splitterAllowance < parsedAmount) {
                  await ctx.reply("Approving token transfer for splitter contract...");
                  const approveTx = await tokenContract.approve(splitter.address, parsedAmount);
                  await approveTx.wait();
                  await ctx.reply('Splitter contract approval completed');
              }
          } catch (error) {
              console.error("Error during token approval:", error);
              throw new Error(`Failed to process token approval: ${error.message}`);
          }
        }
        
        await ctx.reply("Distributing reward... Please wait.");
        
        // Call reward function on both contracts
        // For ETH transfers, we need to include the value in the transaction
        const txOptions = {
            gasLimit: 3000000,
            maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
            maxFeePerGas: ethers.parseUnits("30", "gwei"),
            ...(isEthTransfer ? { value: parsedAmount } : {}) // Include value for ETH transfers
        };
    
        // Call reward function on the splitter contract only
        const splitterTx = await splitter.contract.reward(tokenAddress, parsedAmount, txOptions);
        this.waitForTransaction(
            splitterTx,
            ctx,
            `Reward of ${ethers.formatUnits(parsedAmount, 18)} ${isEthTransfer ? 'ETH' : 'tokens'} successfully distributed to holon members.`
        );
        
        // Provide immediate feedback
        await ctx.reply(`Transaction submitted. You will be notified when the reward of ${ethers.formatUnits(parsedAmount, 18)} ${isEthTransfer ? 'ETH' : 'tokens'} is distributed.`);
    } catch (error) {
        console.error("Error in reward function:", error);
        await ctx.reply("An error occurred while processing the reward: " + error.message);
        await ctx.scene.leave();
    }
  });
    
    this.assignMemberToZoneScene = new Scenes.BaseScene('assign_member_to_zone_scene');
    this.addMemberScene = new Scenes.BaseScene('add_member_scene');
    this.addExternalHolonScene = new Scenes.BaseScene('add_external_holon_scene');

    this.setupMemberAddScene();
    this.setupExternalHolonAddScene();

    const deploymentData = JSON.parse(fs.readFileSync('./contracts/deployment.json', 'utf-8'))[this.network];
    const holonsAddress = deploymentData.Holons;
    const holonsABI = JSON.parse(fs.readFileSync('./contracts/Holons.json', 'utf-8')).abi;
    console.log("Holons Contract Address: ", holonsAddress);
    console.log("Network: ", this.network);
    console.log("Bot wallet: ", this.wallet.address);
    this.holonsContract = new ethers.Contract(holonsAddress, holonsABI, this.wallet);

    this.setupBotCommands();
    this.setupCallbackHandlers();

    if (this.bot.stage) {
      this.bot.stage.register(this.createHolonScene);
      this.bot.stage.register(this.tokenBalanceScene);
      this.bot.stage.register(this.claimScene);
      this.bot.stage.register(this.rewardScene);
      this.bot.stage.register(this.assignMemberToZoneScene);
      this.bot.stage.register(this.addMemberScene);
      this.bot.stage.register(this.addExternalHolonScene);
    }
  }

  setupBotCommands() {
    this.bot.command("createholon", async (ctx) => this.createHolon(ctx));
    this.bot.command("addholons", async (ctx) => this.addHolonsBundle(ctx));
    this.bot.command("addmembers", async (ctx) => this.addMembersBundle(ctx));
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
   // this.bot.command("appreciate", async (ctx) => this.handleAppreciateCommand(ctx));
    this.bot.command("addtozone", async (ctx) => this.handleAddToZoneCommand(ctx));
    this.bot.command("setrewardfunction", async (ctx) => this.handleSetRewardFunction(ctx));
    this.bot.command("rewardpreview", async (ctx) => this.handleRewardPreview(ctx));
    
    this.bot.command("holons", async (ctx) => this.showHolonsMenu(ctx));

    this.bot.command("listmembers", async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const holonName = `chat_${Math.abs(chatID)}`;
      let holon = await this.getManagedContract(holonName);
      let membersLength = await holon.getSize();
      let members = [];
      console.log("members length from /listmembers: ", membersLength);
      for (let i = 0; i < membersLength; i++) {
        let member = await holon.userIds(i);
        members.push(member);
      }
      if (membersLength > 0) {
        const chatIdNormalized = `chat_${Math.abs(chatID)}`;
        let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;
        let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
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
        const chatIdNormalized = `chat_${Math.abs(chatID)}`;
        let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;
        let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
        ctx.reply(`${message}━━━━━━━━━━━━━━━━━━━━━━\n\nNo members found`);
      }
    });

    this.bot.command("sync", async (ctx) => {
      await this.addMembers(ctx);
      await this.syncScore(ctx);
    });

    this.bot.command("assignzone", async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("This chat does not have Zoned Holon functionality.");
      }
      await ctx.scene.enter('assign_member_to_zone_scene');
    });
  }

  setupCallbackHandlers() {
    // Specific zone-related action handlers
    this.bot.action('zone_prepare_move', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("Error answering CB query in zone_prepare_move:", e.message));
      try {
        await this.showZoneManagementView(ctx, 'prepare_move');
      } catch (error) {
        console.error("Error in zone_prepare_move handler:", error);
        await ctx.reply("An error occurred while preparing to move a member.").catch(e => console.log("Reply error", e.message));
      }
    });

    this.bot.action('zone_prepare_remove', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("Error answering CB query in zone_prepare_remove:", e.message));
      try {
        await this.showZoneManagementView(ctx, 'prepare_remove');
      } catch (error) {
        console.error("Error in zone_prepare_remove handler:", error);
        await ctx.reply("An error occurred while preparing to remove a member.").catch(e => console.log("Reply error", e.message));
      }
    });

    this.bot.action(/zone_select_member_to_move_([^_]+)_(\d+)/, async (ctx) => {
      const memberId = ctx.match[1];
      const originalZoneTelegramIndex = ctx.match[2]; // This is the display index (0-5)
      await this.promptForTargetZone(ctx, memberId, originalZoneTelegramIndex);
    });

    // Handler for moving federated holons to zones
    this.bot.action(/zone_select_federated_to_move_([^_]+)/, async (ctx) => {
      const federatedHolonId = ctx.match[1];
      // For federated holons, we don't have an original zone since they're not in zones yet
      // We'll use -1 to indicate they're coming from "not in zones"
      await this.promptForTargetZone(ctx, federatedHolonId, -1);
    });

    // Handler for executing the zone move
    this.bot.action(/zone_execute_move_([^_]+)_(\d+)_(\d+)/, async (ctx) => {
      const memberId = ctx.match[1];
      const targetZoneTelegramIndex = ctx.match[2];
      const originalZoneTelegramIndex = ctx.match[3];
      await this.executeZoneMove(ctx, memberId, targetZoneTelegramIndex, originalZoneTelegramIndex);
    });

    // Correctly placed handler for adding external Holons (moved earlier)
    this.bot.action('zone_add_external_holons_scene_enter', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("Error answering CBQ for add_external_holons_scene_enter:", e.message));
      ctx.scene.enter('add_external_holon_scene');
    });

    // Handler for removing the zoned member
    this.bot.action(/zone_confirm_remove_([^_]+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in zone_confirm_remove:", e.message));
      const memberId = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const senderUserId = utils.getUserId(ctx).toString();
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let memberDisplay = memberId;
    
      // Try to get a display name for the member
      try {
        const users = await this.db.getAll(chatID.toString() + '/users');
        const userMap = users.reduce((map, user) => {
          map[user.id.toString()] = user.username || user.id.toString();
          return map;
        }, {});
        memberDisplay = `@${userMap[memberId] || memberId}`;
      } catch {}
    
      try {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
          throw new Error("External contract not found for this chat.");
        }
    
        // Get the current zone from the contract
        const currentZone = Number(await zonedContract.zone(memberId));
    
        await ctx.editMessageText(
          `➖ Removing ${memberDisplay} from Zone ${currentZone}...`,
          { reply_markup: { inline_keyboard: [[{ text: "Processing...", callback_data: "noop" }]] } }
        ).catch(e => console.log("Edit error:", e.message));
    
        // Remove the member using the contract's removeFromZone function
        const data = zonedContract.interface.encodeFunctionData(
          "removeFromZone",
          [senderUserId, memberId]
        );
        const txRequest = {
          to: zonedContract.target,
          data,
          gasLimit: 3000000,
        };
        const tx = await this.wallet.sendTransaction(txRequest);
        this.waitForTransaction(
          tx,
          ctx,
          `Successfully removed ${memberDisplay} from zone. Tx: ${tx.hash}`
        );
        await ctx.reply(`Transaction submitted to remove ${memberDisplay} from zone. You'll be notified upon completion.`).catch(e => console.log("Error replying for remove submission:", e.message));
        // Refresh the main zone management view after submitting the transaction
        return this.showZoneManagementView(ctx);
      } catch (error) {
        console.error(`Error removing member ${memberId} from zone:`, error);
        await ctx.editMessageText(
          `❌ Failed to remove ${memberDisplay}: ${error.message}`,
          { reply_markup: { inline_keyboard: [[{ text: "◀️ Back to Zone Management", callback_data: "holons_manage_zones_view" }]] } }
        ).catch(e => console.log("Error editing message for remove failure:", e.message));
      }
    });

    // REMOVING UNIQUE TEST HANDLER
    // this.bot.action('__test_unique_callback_123__', async (ctx) => { ... });

    this.bot.action(/holons_(.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("Error answering CB query in main holons handler:", e.message));
      const action = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (!splitterContract || splitterContract.target === '0x0000000000000000000000000000000000000000') {
        if (action !== 'create' && action !== 'back') {
          return ctx.editMessageText("No holon exists for this chat. Create one first.", {
            reply_markup: { inline_keyboard: [[{ text: "🆕 Create Holon", callback_data: "holons_create" }]] }
          }).catch(e => console.log("Error editing message for no holon:", e.message));
        }
      }
      switch(action) {
        case 'create': await this.createHolon(ctx); break;
        case 'addmembers': await this.addMembersBundle(ctx); break;
        case 'smart_sync': await this.smartSync(ctx); break;
        case 'claim': await ctx.scene.enter('claim_scene'); break;
        case 'reward': await ctx.scene.enter('reward_scene'); break;
        case 'ethbalance': await this.ethBalance(ctx); break;
        case 'tokenbalance': await ctx.scene.enter('token_balance_scene'); break;
        case 'manage_members_view': 
          try { await this.showMemberManagementView(ctx, true); }
          catch (error) { /* ... error handling ... */ }
          break;
        case 'manage_zones_view': 
          try {
            console.log(`Zone management view requested for chatID: ${chatID}`);
            const zonedContract = await this.getZonedContract(chatIdNormalized);
            if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
              console.log(`No zoned contract found for ${chatIdNormalized}`);
              return ctx.editMessageText("This holon does not have Zoned functionality.", {
                reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]] }
              }).catch(e => console.log("Error editing message for no zoned functionality:", e.message));
            }
            console.log(`Zoned contract found: ${zonedContract.target}, showing zone management view`);
            await this.showZoneManagementView(ctx);
          } catch (error) {
            console.error("Error in manage_zones_view:", error);
            if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
              console.log("Zone management view: message not modified, answering callback");
              // Message not modified, just answer the callback query if possible
              if (ctx.callbackQuery) {
                await ctx.answerCbQuery().catch(e => console.log("CBQ Error for not modified:", e.message));
              }
            } else {
              // Real error occurred, try to provide feedback
              console.log("Zone management view: real error occurred, editing message");
              await ctx.editMessageText("Error loading zone management view.", {
                reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]] }
              }).catch(e => console.log("Edit error:", e.message));
            }
          }
          break;
        case 'manage_splitter_view':
          await this.displaySplitterManagementView(ctx);
          break;
        case 'flow_management':
          try { await this.showFlowManagementMenu(ctx, true); }
          catch (error) { console.error("Error in flow_management handler:", error); }
          break;
        case 'back':
          try { await this.showHolonsMenu(ctx, true); }
          catch (error) { /* ... error handling ... */ }
          break;
        default:
          console.log(`Unknown action in main holons handler: ${action}`);
          await ctx.reply("Unknown action").catch(e => console.log("Error replying to unknown action:", e.message));
      }
    });


    // === SPLITTER MANAGEMENT ACTION HANDLER===
  

    this.bot.action(/splitter_adj_live_(-?\d+)_(\d+)/, async (ctx) => {
      try { await ctx.answerCbQuery().catch(e => console.log("Splitter Adjust CBQ Error:", e.message)); } catch (e) { console.log("Error in answerCbQuery top for splitter_adj_live", e); }
      const adjustment = parseInt(ctx.match[1], 10);
      let previousInternalPercent = parseInt(ctx.match[2], 10);
      if (isNaN(previousInternalPercent) || previousInternalPercent < 0 || previousInternalPercent > 100) {
        previousInternalPercent = 50;
      }
      let newInternalPercent = previousInternalPercent + adjustment;
      if (newInternalPercent < 0) newInternalPercent = 0;
      if (newInternalPercent > 100) newInternalPercent = 100;
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let splitterAddress = "N/A";
      try {
        const splitterContract = await this.getSplitterContract(chatIdNormalized);
        if (splitterContract && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
          splitterAddress = splitterContract.target;
            } else {
          await ctx.editMessageText("Error: Splitter details unavailable.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back", callback_data: "holons_back"}]] } }).catch(e => console.log("E:", e.message)); return;
        }
      } catch (error) {
          await ctx.editMessageText("Error: Could not access splitter info.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back", callback_data: "holons_back"}]] } }).catch(e => console.log("E:", e.message)); return;
      }
      
      // Call the new helper function to update the view
      await this._updateSplitterManagementView(ctx, newInternalPercent, splitterAddress);
    });

    this.bot.action(/splitter_conf_live_set_(\d+)/, async (ctx) => {
      try { await ctx.answerCbQuery().catch(e => console.log("Confirm Split CBQ Error:", e.message)); } catch (e) { console.log("Error in answerCbQuery top for confirm_split", e); }
      
      const finalInternalPercent = parseInt(ctx.match[1],10);
      if (isNaN(finalInternalPercent) || finalInternalPercent < 0 || finalInternalPercent > 100) {
          
        await ctx.editMessageText("Error: Invalid percentage for setting split. Please try again.", {reply_markup: {inline_keyboard: [[{text: "Try Again", callback_data: "holons_manage_splitter_view"}]]}} ).catch(e => console.log("E:",e.message));
          return;
      }
      const finalExternalPercent = 100 - finalInternalPercent;
      
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      // const internalId = `${chatIdNormalized}_managed`; // No longer needed for setContractSplit
      // const externalId = `${chatIdNormalized}_zoned`;   // No longer needed for setContractSplit

      await ctx.editMessageText(`Setting split to: Managed ${finalInternalPercent}% / Zoned ${finalExternalPercent}%...`).catch(e => console.log("E:", e.message));
      try {
          const splitterContract = await this.getSplitterContract(chatIdNormalized);
          if (!splitterContract || splitterContract.target === '0x0000000000000000000000000000000000000000') {
              throw new Error("Splitter contract not found during set attempt.");
          }
        // const userIds = [internalId, externalId]; // Not needed for setContractSplit
        // const percentages = [finalInternalPercent, finalExternalPercent]; // Argument order for setContractSplit is direct
          const tx = await this.executeTransaction(splitterContract, 'setContractSplit', [finalInternalPercent, finalExternalPercent]);
          this.waitForTransaction(tx, ctx, `Split ratio set to Managed ${finalInternalPercent}% / Zoned ${finalExternalPercent}%!`);
          await ctx.reply("✅ Split ratio transaction submitted!").catch(e => console.log("E:", e.message));
          await this.showHolonsMenu(ctx, false);
          } catch (error) {
          console.error("Error executing setContractSplit in confirm handler:", error);
          await ctx.editMessageText(`❌ Error setting split: ${error.message}. Please try again.`, {reply_markup: {inline_keyboard: [[{text: "Try Again", callback_data: "holons_manage_splitter_view"}]]}}).catch(e => console.log("E:", e.message));
      }
    });
    // === END OF SPLITTER MANAGEMENT ACTION HANDLERS ===

    // Zone move execution handler
    this.bot.action(/zone_move_(\w+)_(\d+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in zone move:", e.message));
      
      const [memberId, targetZoneIndex, originalZoneIndex] = ctx.match.slice(1);
      await this.executeZoneMove(ctx, memberId, targetZoneIndex, originalZoneIndex);
    });

    // Reward function management handlers
    this.bot.action(/reward_function_(.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in reward function:", e.message));
      
      const action = ctx.match[1];
      
      switch(action) {
        case 'preview':
          await this.handleRewardPreview(ctx);
          break;
        case 'set':
          await this.showPolynomialParameterUI(ctx);
          break;
        default:
          await ctx.editMessageText("Unknown reward function action.").catch(e => console.log("Edit error:", e.message));
      }
    });

    // Polynomial parameter adjustment handlers
    this.bot.action(/poly_param_(.+)_(-?\d+)_(-?\d+)_(-?\d+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in poly param:", e.message));
      
      const param = ctx.match[1]; // 'a', 'b', or 'c'
      let a = parseInt(ctx.match[2]);
      let b = parseInt(ctx.match[3]);
      let c = parseInt(ctx.match[4]);
      
      // Adjust the selected parameter
      switch(param) {
        case 'a_inc': a = Math.min(20, a + 1); break;
        case 'a_dec': a = Math.max(-20, a - 1); break;
        case 'a_inc5': a = Math.min(20, a + 5); break;
        case 'a_dec5': a = Math.max(-20, a - 5); break;
        case 'b_inc': b = Math.min(50, b + 1); break;
        case 'b_dec': b = Math.max(-50, b - 1); break;
        case 'b_inc5': b = Math.min(50, b + 5); break;
        case 'b_dec5': b = Math.max(-50, b - 5); break;
        case 'c_inc': c = Math.min(100, c + 1); break;
        case 'c_dec': c = Math.max(0, c - 1); break;
        case 'c_inc5': c = Math.min(100, c + 5); break;
        case 'c_dec5': c = Math.max(0, c - 5); break;
      }
      
      await this.updatePolynomialParameterUI(ctx, a, b, c);
    });

    // Save polynomial parameters handler
    this.bot.action(/poly_save_(-?\d+)_(-?\d+)_(-?\d+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in poly save:", e.message));
      
      const a = parseInt(ctx.match[1]);
      const b = parseInt(ctx.match[2]);
      const c = parseInt(ctx.match[3]);
      
      await this.savePolynomialParameters(ctx, a, b, c);
    });

    // Handler for polynomial info/noop buttons
    this.bot.action(/poly_(noop|info_.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in poly noop:", e.message));
      // These buttons don't perform any action, just acknowledge the callback
    });

    // === MEMBER MANAGEMENT ACTION HANDLERS ===
    this.bot.action('member_sync_scores', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in member_sync_scores:", e.message));
      await ctx.editMessageText("🔄 Syncing scores to contract... Please wait.").catch(e => console.log("Edit error:", e.message));
      
      try {
        await this.syncScore(ctx);
        // Show updated member management view after sync
        setTimeout(async () => {
          await this.showMemberManagementView(ctx, true);
        }, 2000);
      } catch (error) {
        console.error("Error syncing scores:", error);
        await ctx.editMessageText(`❌ Error syncing scores: ${error.message}`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_manage_members_view" }]] }
        }).catch(e => console.log("Error edit:", e.message));
      }
    });

    this.bot.action('member_enter_add_scene', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in member_enter_add_scene:", e.message));
      await ctx.scene.enter('add_member_scene');
    });

    this.bot.action('member_prepare_remove', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in member_prepare_remove:", e.message));
      try {
        await this.showMemberManagementView(ctx, true, 'prepare_remove');
      } catch (error) {
        console.error("Error in member_prepare_remove:", error);
        await ctx.reply("Error loading remove mode.").catch(e => console.log("Reply error:", e.message));
      }
    });

    this.bot.action(/member_confirm_remove_(.+)/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in member_confirm_remove:", e.message));
      const memberId = ctx.match[1];
      await ctx.editMessageText(`➖ Removing member ${memberId}...`).catch(e => console.log("Edit error:", e.message));
      
      try {
        const success = await this.removeMemberFromManagedHolon(ctx, memberId);
        if (success) {
          // Show updated member management view after removal
          setTimeout(async () => {
            await this.showMemberManagementView(ctx, true);
          }, 2000);
        }
      } catch (error) {
        console.error("Error removing member:", error);
        await ctx.editMessageText(`❌ Error removing member: ${error.message}`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_manage_members_view" }]] }
        }).catch(e => console.log("Error edit:", e.message));
      }
    });

    // Handle increment/decrement actions for member scores
    this.bot.action(/^member_(increment|decrement|increment10|decrement10)_(.+)$/, async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("CBQ Error in member score adjustment:", e.message));
      const chatID = utils.getChatId(ctx);
      const action = ctx.match[1];
      const memberId = ctx.match[2];

      try {
        let settings = await this.getSettings(chatID);
        if (!settings.memberAdjustments) {
          settings.memberAdjustments = {};
        }

        const currentAdjustment = settings.memberAdjustments[memberId] || 0;
        
        if (action === 'increment') {
          settings.memberAdjustments[memberId] = currentAdjustment + 1;
        } else if (action === 'increment10') {
          settings.memberAdjustments[memberId] = currentAdjustment + 10;
        } else if (action === 'decrement') {
          settings.memberAdjustments[memberId] = currentAdjustment - 1;
        } else if (action === 'decrement10') {
          settings.memberAdjustments[memberId] = currentAdjustment - 10;
        }

        await this.setSettings(settings);

        // Refresh the member management view
        await this.showMemberManagementView(ctx, true);
      } catch (error) {
        console.error("Error adjusting member score:", error);
        await ctx.reply("Error adjusting member score: " + error.message).catch(e => console.log("Reply error:", e.message));
      }
    });
    // === END OF MEMBER MANAGEMENT ACTION HANDLERS ===
  }

  async _updateSplitterManagementView(ctx, internalPercent, splitterAddress) {
    // Calculate externalPercent based on the provided internalPercent
    const externalPercent = 100 - internalPercent;

    let message = `🔷 SPLITTER MANAGEMENT 🔷\n`;
    message += `Contract: \`${splitterAddress}\`\n`;
    message += `Current reward split: Internal ${internalPercent}% / Ecosystem ${externalPercent}%`;

    const keyboard = [
      [
        { text: "<<", callback_data: `splitter_adj_live_-10_${internalPercent}` },
        { text: "<", callback_data: `splitter_adj_live_-1_${internalPercent}` },
        { text: `${internalPercent}% / ${externalPercent}%`, callback_data: "noop" },
        { text: ">", callback_data: `splitter_adj_live_1_${internalPercent}` },
        { text: ">>", callback_data: `splitter_adj_live_10_${internalPercent}` }
      ],
      [{ text: "✅ Set This Split", callback_data: `splitter_conf_live_set_${internalPercent}` }],
      [{ text: "◀️ Back to Flow Management", callback_data: "holons_flow_management" }]
    ];

    try {
      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    } catch (error) {
      // Log specific error if message is not modified, otherwise log the full error
      if (error.response && error.response.error_code === 400 && error.response.description && error.response.description.includes('message is not modified')) {
        console.log("Splitter management view not modified.");
        // It's good practice to still answer the callback query to prevent the "loading" state on the button.
        if (ctx.callbackQuery) await ctx.answerCbQuery().catch(e => console.log("Error answering CBQ for unmodified message:", e.message));
      } else {
        console.error("Error editing message in _updateSplitterManagementView:", error);
      }
    }
  }

  async showFlowManagementMenu(ctx, edit = false) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    
    let splitterContract = null;
    let isZonedHolon = false;
    
    try {
      splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (splitterContract && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        if (zonedContract && zonedContract.target !== '0x0000000000000000000000000000000000000000') {
          isZonedHolon = true;
        }
      }
    } catch (error) {
      console.error("Error checking holon bundle for flow management menu:", error);
    }
    
    const holonExists = splitterContract !== null && splitterContract.target !== '0x0000000000000000000000000000000000000000';
    
    if (!holonExists) {
      const message = "No Holon detected for this chat. Please create one first.";
      const keyboard = [[{ text: "◀️ Back to Settings", callback_data: "settings_back" }]];
      
      if (edit || ctx.callbackQuery) {
        return ctx.editMessageText(message, { reply_markup: { inline_keyboard: keyboard } }).catch(e => console.log("Error:", e.message));
      } else {
        return ctx.reply(message, { reply_markup: { inline_keyboard: keyboard } }).catch(e => console.log("Error:", e.message));
      }
    }

    let message = `🌊 FLOW MANAGEMENT 🌊\n`;
    message += `\nContract: \`${splitterContract.target}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `Manage how value flows through your Holon:`;

    const keyboard = [
      [{ text: "💱 Split Flows", callback_data: "holons_manage_splitter_view" }],
      [{ text: "👥 Internal Flows", callback_data: "holons_manage_members_view" }],
      [{ text: "🔶 External Flows", callback_data: "holons_manage_zones_view" }],
      [{ text: "◀️ Back to Settings", callback_data: "settings_back" }]
    ];

    const menuMarkup = { reply_markup: { inline_keyboard: keyboard } };
    
    if (edit || ctx.callbackQuery) {
      try {
        return await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...menuMarkup
        });
      } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
          console.log('Flow management menu not modified, already displayed.');
          if (ctx.callbackQuery) await ctx.answerCbQuery().catch(e => console.log("E ans CBQ:", e.message));
          return;
        }
        console.log('Error editing flow management menu:', error);
        return ctx.reply(message, { parse_mode: 'Markdown', ...menuMarkup }).catch(e => console.log('Error replying to flow management menu fallback:', e.message));
      }
    } else {
      return ctx.reply(message, { parse_mode: 'Markdown', ...menuMarkup }).catch(e => console.log('Error showing flow management menu:', e.message));
    }
  }

  async showHolonsMenu(ctx, edit = false) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    
    let splitterContract = null;
    let isZonedHolon = false;
    
    try {
      splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (splitterContract && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        if (zonedContract && zonedContract.target !== '0x0000000000000000000000000000000000000000') {
          isZonedHolon = true;
        }
      }
    } catch (error) {
      console.error("Error checking holon bundle for menu:", error);
    }
    
    const holonExists = splitterContract !== null && splitterContract.target !== '0x0000000000000000000000000000000000000000';
    
    const menuKeyboard = [];

    if (holonExists) {
      // Buttons for an existing Holon
      menuKeyboard.push(
        [{ text: "🔄 Sync Scores", callback_data: "holons_smart_sync" }, { text: "💰 Claim Tokens", callback_data: "holons_claim" }],
        [{ text: "⚖️ ETH Balance", callback_data: "holons_ethbalance" }, { text: "🪙 Token Balance", callback_data: "holons_tokenbalance" }],
        [{ text: "◀️ Back", callback_data: "settings_back" }] // Changed text to ◀️ Back
      );
   
    } else {
      // Only show Create Holon button if no holon exists
      menuKeyboard.push(
        [{ text: "🆕 Create Holon", callback_data: "holons_create" }]
      );
      // Add the "Back to Settings" button here as well, with updated text
      menuKeyboard.push([{ text: "◀️ Back", callback_data: "settings_back" }]); // Changed text to ◀️ Back
    }

    let message;
    if (holonExists) {
      message = `🔷 HOLON ADDRESS 🔷\n\`${splitterContract.target}\`\n\n━━━━━━━━━━━━━━━━━━━━━━\nNetwork: ${this.network}\n\nSelect an action.`;
      // Optional: message += `\nTo create another Holon, use the /createholon command.`;
    } else {
      message = `No Holon detected for this chat.\nClick below to set one up or use /createholon.`;
    }
    
    const menuMarkup = menuKeyboard.length > 0 ? { reply_markup: { inline_keyboard: menuKeyboard } } : {};
    
    if (edit) {
      try {
        return await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...menuMarkup
        });
      } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
          console.log('Holons menu not modified, already displayed.');
          if (ctx.callbackQuery) await ctx.answerCbQuery().catch(e => console.log("E ans CBQ:", e.message));
          return;
        }
        console.log('Error editing holons menu:', error);
        return ctx.reply(message, { parse_mode: 'Markdown', ...menuMarkup }).catch(e => console.log('Error replying to holons menu fallback:', e.message));
      }
    } else {
      return ctx.reply(message, { parse_mode: 'Markdown', ...menuMarkup }).catch(e => console.log('Error showing holons menu:', e.message));
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

    const holonName = `chat_${Math.abs(chatID)}`;

    try {
      let holonAddress = await this.getManagedContract(holonName);
      // commenting out for now, as it makes debugging harder then neccessairy
      // const holonAddress = "0x0cea18A881E9D8767537F32C0A984ccFC9740BFD";
      // ^ fixing this instead
      // console.log("holonAddress from reward: ", holonAddress);
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);
      console.log("holon.target from reward: ", holon.target);

      // First, approve the holon contract to spend tokens
      let tokenContract = new ethers.Contract(tokenAddress, [
        'function approve(address spender, uint256 amount) public returns (bool)',
        'function allowance(address owner, address spender) public view returns (uint256)',
        'function balanceOf(address account) public view returns (uint256)',
        'function transfer(address recipient, uint256 amount) public returns (bool)',
        'function totalSupply() public view returns (uint256)',
        'function name() public view returns (string)',
        'function symbol() public view returns (string)',
        'function decimals() public view returns (uint8)'
      ], this.wallet);

      // Check current allowance
      const currentAllowance = await tokenContract.allowance(this.wallet.address, holonAddress);
      if (currentAllowance < amount) {
        const approveTx = await tokenContract.approve(holonAddress, amount);
        await approveTx.wait();
        console.log('Approval transaction completed');
      }
      const currentContractBalance = await tokenContract.balanceOf(tokenAddress);
      if (amount > currentContractBalance) {
        ctx.reply("Not enough tokens in the contract!");
      }

      // Now call the reward function 

      const data = holon.interface.encodeFunctionData('reward', [tokenAddress, amount]);
      
      // console.log("Data before sending the transaction: ", data);
      const tx = await this.wallet.sendTransaction({
        to: holon.target,
        data,
        gasLimit: 3000000,
        // maxPriorityFeePerGas: maxPriorityFee,
        // maxFeePerGas: maxFee,
      });
    
      // Don't await the transaction completion
      this.waitForTransaction(
        tx,
        ctx,
        `Claim successful! Transaction hash: ${tx.hash}`
      );
      
      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when the flow of ${ethers.formatUnits(amount, 18)} tokens is distributed.`);
    } catch (error) {
      console.error("Error in reward function:", error);
              ctx.reply("An error occurred while processing the flow: " + error.message);
      await ctx.scene.leave();
    }
  }

  async ethBalance(ctx) {
    const userID = utils.getUserId(ctx);
    const chatID = utils.getChatId(ctx);

    // ### Technical debt - it's fixed to Holon.sol at the moment. Decide what needs to happen in case of the zoned contract. 
    // Possibilities: 
    // Either we see if user is internal or external member and display balance based on that
    // Either we ask user if the request for balance is for internal or external members ( in chat )  
    const holonName = `chat_${Math.abs(chatID)}`;
    const managedHolonAddress = await this.getManagedContract(holonName);
    const address = managedHolonAddress.target;

    let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
    let balance = await holon.etherBalance(userID.toString());

    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

    let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
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

    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

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

    // ### Technical debt - it's fixed to Holon.sol at the moment. Decide what needs to happen in case of the zoned contract. 
    // Possibilities: 
    // Either we see if user is internal or external member and display balance based on that
    // Either we ask user if the request for balance is for internal or external members ( in chat )  
    const holonName = `chat_${Math.abs(chatID)}`;
    let managedHolonAddress = await this.getManagedContract(holonName);
    let address = managedHolonAddress.target;
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
    
    let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `Contract Balance: ${ethers.formatEther(contractBalance)}\n`;
    message += `Token Balances:\n\`\`\`\n${table}\n\`\`\``;
    
    // Add a back button if this was called from the menu
    if (ctx.callbackQuery) {
      return ctx.editMessageText(message, {
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
    
    // Get manual score adjustments
    const settings = await this.getSettings(chatID);
    const memberAdjustments = settings.memberAdjustments || {};

    let userids = users.map((user) => user.id.toString());
    // Format scores to ensure they're BigInts for the contract call
    let contractScores = users.map((user) => {
      const calculatedScore = Math.floor(
        (user.initiated?.length || 0) * (equation.initiated || 0) +
        (user.completed?.length || 0) * (equation.completed || 0) +
        (user.sent || 0) * (equation.sent || 0) +
        (user.received || 0) * (equation.received || 0) +
        (user.hours || 0) * (equation.hours || 0) +
        (user.collaboration || 0) * (equation.collaboration || 0) +
        (user.wants?.length || 0) * (equation.wants || 0) +
        (user.offers?.length || 0) * (equation.offers || 0)
      );
      
      // Apply manual adjustment
      const adjustment = memberAdjustments[user.id.toString()] || 0;
      const finalScore = Math.max(0, calculatedScore + adjustment); // Ensure non-negative
      
      return ethers.toBigInt(finalScore);
    });

    // let address = await this.holonsContract.toAddress(chatID.toString());

    const holonName = `chat_${Math.abs(chatID)}`;
    let holon = await this.getManagedContract(holonName);

    console.log("User IDs:", userids);
    console.log("Scores (for contract):", contractScores); // Log the BigInt array
    // For prettier logging of scores as strings:
    console.log("Scores (formatted for log):", contractScores.map(s => s.toString()));

    // Get function info to verify expected types
    const setAppreciationFunc = holon.interface.getFunction('setAppreciation');
    console.log("setAppreciation expected parameters:", 
    setAppreciationFunc.inputs.map(i => `${i.name}: ${i.type}`));

    // Technical debt #2 - modularize
    const feeData = await this.wallet.provider.getFeeData();
    const bufferMultiplier = BigInt(110);
    const divisor = BigInt(100);

    // // Apply the buffer to the fee values using native BigInt operations
    const maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * bufferMultiplier) / divisor;
    const maxFeePerGas = (feeData.maxFeePerGas * bufferMultiplier) / divisor;
    let data;

    try {
      // Same approach as in your working function

      // Specifically check for addMembers
      const addMembersFunc = holon.interface.getFunction('setAppreciation');
      if (addMembersFunc) {
        console.log("Found addMembers function with signature:");
        console.log(`  Inputs: ${addMembersFunc.inputs.map(i => i.type).join(', ')}`);
      } else {
        console.log("WARNING: addMembers function not found in contract ABI!");
      }

      data = holon.interface.encodeFunctionData('setAppreciation', [userids, contractScores]);
      // console.log("Wallet address:", await this.wallet.getAddress());
      // console.log("Wallet provider type:", this.wallet.provider.constructor.name);
      // console.log("Holon target: ", holon.target);
      // console.log("Encoded data:", data);
      
      // Technical debt #2 - modularize
      const tx = {
        to: holon.target,
        data: holon.interface.encodeFunctionData("setAppreciation", [userids, contractScores]),
        gasLimit: 4000000,
        maxFeePerGas,
        maxPriorityFeePerGas,
        nonce: await this.wallet.getNonce(),
      };

      const transactionResponse = await this.wallet.sendTransaction(tx);
      this.waitForTransaction(transactionResponse, ctx, `Successfully synced score for ${userids.length} members`);
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
      // Fetch current fee data from the provider
      const feeData = await this.wallet.provider.getFeeData();
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


      // Log what the encoded data should look like
      const encodedData = contract.interface.encodeFunctionData(method, 
      Array.isArray(args[0]) ? args[0] : args);
      // console.log("Expected encoded calldata:", encodedData);

  
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
    // Send only one initial message
    const initialMessage = await ctx.reply(`🛠️ Creating Holon Bundle... Please wait.`);
    
    try {
      // Log input parameters
      const chatID = utils.getChatId(ctx);
      const userID = utils.getUserId(ctx);
      
      console.log("Input parameters:");
      console.log("- chatID:", chatID, "(" + typeof chatID + ")");
      console.log("- userID:", userID, "(" + typeof userID + ")");
      
      const holonsAddress = this.holonsContract.target;
      console.log("Holons contract address:", holonsAddress);
      
      const creatorUserId = userID.toString();
      const holonName = `chat_${Math.abs(chatID)}`;
      const parameterValue = 5;
      
      console.log(`Creating holon bundle with name: ${holonName}`);

      // Create the bundle using the utility function
      const bundleResult = await createHolonBundle(
        this.holonsContract,
        creatorUserId,
        holonName,
        parameterValue
      );

      if (!bundleResult.success) {
        throw new Error(bundleResult.error);
      }

      const splitterAddress = bundleResult.bundleAddress;

      // Create Splitter Contract Instance
      const splitterContract = new ethers.Contract(
        splitterAddress, 
        [
          "function createManagedContract(string memory _creatorUserId, string memory _name, uint256 _parameterValue) external returns (address)",
          "function createZonedContract(string memory _creatorUserId, string memory _name, uint256 _parameterValue) external returns (address)",
          "function contractsByType(string memory _type) external view returns (address)"
        ], 
        this.wallet
      );
      console.log("Splitter contract instance created.");

      // Create the managed and zoned contracts using the utility function
      const contractsResult = await createBundleContracts(
        splitterContract,
        creatorUserId,
        holonName,
        parameterValue
      );

      if (!contractsResult.success) {
        throw new Error(contractsResult.error);
      }

      const { managedAddress, zonedAddress } = contractsResult;

      // Edit the initial message on final success
      await ctx.telegram.editMessageText(
        ctx.chat.id, 
        initialMessage.message_id, 
        null, // inline_message_id
        `✅✅✅ Holon Bundle initialization completed!\n` +
        `Bundle: ${splitterAddress}\n` +
        `Managed: ${managedAddress}\n` +
        `Zoned: ${zonedAddress}`, 
        { parse_mode: 'Markdown' }
      );
      
      // Return bundle information for potential chaining/logging
      return {
        success: true,
        bundleAddress: splitterAddress,
        managedAddress,
        zonedAddress
      }; 
      
    } catch (error) {
      console.error("========== ERROR CREATING HOLON ==========");
      console.error("Error:", error);
      console.error("Error message:", error.message);
      
      // More detailed error logging
      if (error.code) console.error("Error code:", error.code);
      if (error.stack) console.error("Stack trace:", error.stack);
      if (error.transactionHash) console.error("Failed Tx Hash:", error.transactionHash);
      if (error.receipt) console.error("Failed Tx Receipt:", error.receipt);
  
      // Edit the initial message on failure
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        initialMessage.message_id,
        null,
        `❌ Failed during holon creation process: ${error.message}`
      ).catch(editError => console.error("Error editing message on failure:", editError));
  
      return {
        success: false,
        error: error.message
      };
    }
  }

  async addMembersBundle(ctx) {
    console.log("addMembersBundle function called");
    const chatID = utils.getChatId(ctx);
    console.log("chatID from addMembers:", chatID);
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

    try {
      holonAddressManaged = await this.getManagedContract(holonName);
      console.log("holonAddressManaged from addMembersBundle: ", holonAddressManaged.target); // it's there, commenting it out 
      
    } catch (error) {
      console.error("Cannot find holon, in this case it's Managed!");
    }
    // console.log("Adding members to a managed holon address: ", holonAddressManaged); // it works, it's just managedHolon, it's not holonAddressManaged
    await ctx.reply(`Adding ${users.length} members to internal... Please wait.`);

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
      // console.log("Expected parameter types:", addMembersFunction.inputs.map(i => i.type))
      const data = holonAddressManaged.interface.encodeFunctionData('addMembers', [userIds]);

      // Debugging - checking the ABI: 

      // console.log("Contract ABI for Managed Contract:");
      // holonAddressManaged.interface.fragments.forEach(fragment => {
      //   if (fragment.type === 'function') {
      //     console.log(`Function: ${fragment.name}`);
      //     console.log(`Inputs: ${fragment.inputs.map(i => i.type).join(', ')}`);
      //   }
      // });

      // Specifically check for addMembers
      const addMembersFunc = holonAddressManaged.interface.getFunction('addMembers');
      if (addMembersFunc) {
        console.log("Found addMembers function with signature:");
        // console.log(`  Inputs: ${addMembersFunc.inputs.map(i => i.type).join(', ')}`);
      } else {
        console.log("WARNING: addMembers function not found in contract ABI!");
      }

      // console.log("data before sending: ", data);
      console.log("managed holon address before sending: ", holonAddressManaged.target);
      
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

  async addHolonsBundle(ctx) {
    let holonAddressZoned;
    console.log("addHolonBundle function called");
    const chatID = utils.getChatId(ctx);
    console.log("chatID from addMembers:", chatID);
    //TODO: Check if the user is a member of the group and it is authorized to add holons

    const userID = utils.getUserId(ctx); // Get the user ID of the person who initiated the command

    // Logic to understand if it's member trough delegation?
    // If it is: Write that only internal members can add members to the group. Add members in your root group.
    // Only the internal members can move external members trough zones!

    // If it isn't continue regularly
    // let users = await this.db.getAll(chatID.toString() + '/users'); // users variable seems unused in this function
    let userIdsParams = utils.getParameters(ctx);
    console.log("userIdsParams from addHolonBundle: ", userIdsParams);

    // if (!users || users.length === 0) { // Check based on userIdsParams instead if that's the input for holon IDs
    //   return ctx.reply("No users found in the database.");
    // }
    if (!userIdsParams) {
        return ctx.reply("Please provide the Holon IDs to add.");
    }

    const holonName = `chat_${Math.abs(chatID)}`;

    try {
      holonAddressZoned = await this.getZonedContract(holonName);
      if (!holonAddressZoned || holonAddressZoned.target === '0x0000000000000000000000000000000000000000'){
        await ctx.reply("Zoned Holon not found for this chat.");
        return;
      }
      console.log("holonAddressZoned from addHolonBundle: ", holonAddressZoned.target);
    } catch (error) {
      console.error("Cannot find holon, in this case it's Zoned!", error);
      await ctx.reply("Error finding Zoned Holon for this chat.");
      return;
    }

          await ctx.reply(`Adding holon(s) to external... Please wait.`);

    const holonIdsToAddArray = userIdsParams.split(' ').map(String); // Ensure this is an array of strings

    try {
      // Get the contract method directly
      // const addHolonFunction = holonAddressZoned.interface.getFunction('addMembers'); // This was for checking, not direct call

      // Log the expected parameter types for addMembers on Zoned contract
      const addMembersFuncInfo = holonAddressZoned.interface.getFunction('addMembers');
      if (addMembersFuncInfo) {
        // Remove console.log for expected parameters
      } else {
        // Remove console.log warning
      }

      // Ensure arguments are correctly structured as an array for encodeFunctionData
      const args = [userID.toString(), holonIdsToAddArray];

      const data = holonAddressZoned.interface.encodeFunctionData('addMembers', args);

      const tx = await this.wallet.sendTransaction({
        to: holonAddressZoned.target,
        data,
        gasLimit: 3000000,
        // maxPriorityFeePerGas: maxPriorityFee,
        // maxFeePerGas: maxFee,
        nonce: await this.wallet.getNonce()
      });

              this.waitForTransaction(tx, ctx, `Successfully initiated adding ${holonIdsToAddArray.length} holon(s) to external`);

        await ctx.reply(`Transaction submitted. You will be notified when holon(s) are added to external.`);
    } catch (error) {
      console.error("Transaction error in addHolonsBundle:", error);
              await ctx.reply(`Failed to add holon(s) to external: ${error.message}`);
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
    try {
      let holon = await this.getHolonContract(_holonAddress);
      
      // First check if member already exists
      const isMember = await holon.isMember(_memberAddress);
      if (isMember) {
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
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      throw error;
    }
  }

  // AddFederationMember - Helper function to add federation member to Zoned contract
  async addFederationMember(holonAddress, userID, federationId) {
    try {
      let holon = await this.getHolonContract(holonAddress);
      
      // Check if this is a Zoned holon by checking the flavor
      const flavor = await holon.flavor();
      if (flavor !== "Zoned") {
        throw new Error(`This holon is of type "${flavor}" and does not support federation members. Only "Zoned" holons have federation functionality.`);
      }

      // Use the executeTransaction method for consistency with other functions
      console.log("userId of the member that is added as federationMember:", String(userID));
      console.log("name of the member that is added as federationMember:", String(federationId));
      const tx = await this.executeTransaction(
        holon,
        'addMember(string,string)',
        [String(userID), String(federationId)]
      );
      
      // Wait for the transaction to be mined
      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
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
        return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only external holons have zone functionality.`);
      }
      
      await ctx.reply(`Moving member to zone ${zoneNumber}... Please wait.`);

      const tx = await this.executeTransaction(
        holon,
        'addToZone',
        [senderUserId, memberAddress, zoneNumber]
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
        ctx.reply("This command only works with external holons");
      } else {
        ctx.reply(`Failed to move member: ${error.message}`);
      }
    }
  }

  async showZones(ctx) {
    const chatID = utils.getChatId(ctx);

    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;
    
    try {
      // let holonAddress = await this.holonsContract.toAddress(chatID.toString());
      // if (holonAddress === '0x0000000000000000000000000000000000000000') {
      //   return ctx.reply("No holon exists for this chat");
      // }
      
      // let holon = await this.getHolonContract(holonAddress);
      const holonName = `chat_${Math.abs(chatID)}`;
      let holon = await this.getZonedContract(holonName);

      
      let holonAddress = holon.target;
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat");
      }

      // Check if this is a Zoned holon by checking the flavor
      // const flavor = await holon.flavor();
      // if (flavor !== "Zoned") {
      //   return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`);
      // }

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
              // Reverse the order of members within each zone
              zoneMembers.push({
                  zone: this.invertZone(i),
                  members: [...members].reverse().map(member => userMap[member] || member)                    // Map to user tags
              });
          }

          let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
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
      let holon = new ethers.Contract(holonAddress, managed.default.abi, this.wallet);

      // Call the getFlavor method to determine the holon type
      const flavor = await holon.flavor();

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
    try {
      // Convert chatID to string if it's not already
      const chatIDStr = chatID.toString();
      const holonAddress = await this.holonsContract.toAddress(chatIDStr);
      
      // Get the holon address for this chat
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return null;
      }
      
      let splitterContract = new ethers.Contract(holonAddress, splitter.default.abi, this.wallet);

      // The holon itself is the splitter in this case
      return splitterContract;
    } catch (error) {
      console.error('Error getting Splitter contract:', error);
      throw error;
    }
  }
    
  async getZonedContract(chatID) {
    try {
      // First get the Splitter contract
      const splitterContract = await this.getSplitterContract(chatID);
      
      if (!splitterContract) {
        return null;
      }
      const holonName = chatID + "_zoned";
      
      // Get the Zoned contract from the Splitter
      const zonedContractAddress = await splitterContract.contractsByType(holonName);
      const zonedContract = new ethers.Contract(zonedContractAddress, zoned.default.abi, this.wallet);
      return zonedContract;
    } catch (error) {
      console.error('Error getting Zoned contract:', error);
      throw error;
    }
  }
  
  // ### Technical debt - This should be moved to Utils:
  async logContractFunctions(contract) {
    if (!contract) {
      return;
    }
  
    // Remove all console.log statements
  }
  
  async getManagedContract(chatID) {
    try {
      // First get the Splitter contract
      const splitterContract = await this.getSplitterContract(chatID);
      console.log("splitter contract address: ", splitterContract.target);
      
      if (!splitterContract) {
        return null;
      }
      
      const holonName = chatID + "_managed"; 

      // Get the Managed contract from the Splitter
      const managedContractAddress = await splitterContract.contractsByType(holonName);
      const managedContract = new ethers.Contract(managedContractAddress, managed.default.abi, this.wallet);
      return managedContract;
    } catch (error) {
      console.error('Error getting Managed contract:', error);
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
  // #TODO: This was technical debt for the previous version
  // async setSplit(userTags, percentages, chatID) {
  //   try {
  //     // Ensure the lengths of userTags and percentages match
  //     if (userTags.length !== percentages.length) {
  //       throw new Error("User tags and percentages should be equal");
  //     }

  //     const holonAddress = await this.holonsContract.toAddress(chatID.toString());
  //     // console.log("holonAddress: ", holonAddress);
  //     const holon = await this.getHolonContract(holonAddress);

  //     // Retrieve all users from the database for the given chatID
  //     let users = await this.db.getAll(chatID.toString() + '/users');

  //     // Map user tags to user IDs and convert them to strings
  //     const userIds = userTags.map(tag => {
  //       // Remove the '@' symbol from the tag to match the username
  //       const username = tag.startsWith('@') ? tag.slice(1) : tag;
  //       const user = users.find(u => u.username === username);
  //       if (!user) {
  //         throw new Error(`User with tag ${tag} not found`);
  //       }
  //       return user.id.toString(); // Convert user ID to string
  //     });

  //     // Calculate the total percentage to ensure it sums to 100
  //     const totalPercentage = percentages.reduce((acc, val) => acc + val, 0);
  //     if (totalPercentage !== 100) {
  //       throw new Error("Total percentage should be 100");
  //     }

  //     const contractAddress = await this.holonsContract.getAddress();
  //     // Log contract information
  //     console.log("Contract Address:", contractAddress);
  //     // console.log("Contract ABI:", this.holonsContract.interface.fragments);

  //     // Execute the transaction with error handling
  //     try {
  //       const tx = await this.executeTransaction(
  //         holon,
  //         'setSplit',
  //         [userIds, percentages]
  //       );

  //       // Wait for the transaction to be mined
  //       await tx.wait();
  //       console.log("Split set successfully");
  //     } catch (transactionError) {
  //       console.error("Transaction failed:", transactionError);
  //       throw new Error("Failed to set split due to transaction error.");
  //     }
  //   } catch (error) {
  //     console.error("Error setting split:", error);
  //   }
  // }

  // Modified setSplit to accept parsed arguments instead of ctx
  async setSplit(userTags, percentages, chatID) { // Added chatID, but might not be needed here
    // Removed message parsing, as it's done in handleSetSplitCommand
    // const message = ctx.message.text;
    // const args = message.split(' ').slice(1);

    if (userTags.length === 0 || percentages.length === 0 || userTags.length !== percentages.length) {
      // Adjusted error message for clarity based on new input structure
      throw new Error("Invalid input format. Ensure you provide pairs like 'internal 10 external 90'.");
      // return ctx.reply("❌ Error: You must provide internal and external percentages.\nExample: /setsplit internal 10 external 90");
    }

    const data = {};
    // Use userTags and percentages directly
    for (let i = 0; i < userTags.length; i++) {
      const key = userTags[i]?.toLowerCase();
      const value = percentages[i]; // Already parsed to int in handleSetSplitCommand

      // Simplified validation as handleSetSplitCommand already parses ints
      if (!key || isNaN(value)) { // Keep isNaN check just in case
        throw new Error("Invalid format. Found non-number percentage or missing tag.");
        // return ctx.reply("❌ Error: Invalid format. Make sure both internal and external are followed by numbers.");
      }

      if (key === 'internal' || key === 'external') {
        data[key] = value;
      } else {
        // Handle unexpected tags if necessary, or ignore
      }
    }

    // Check both keys exist
    if (typeof data.internal !== 'number' || typeof data.external !== 'number') {
      throw new Error("Both 'internal' and 'external' values must be provided.");
      // return ctx.reply("❌ Error: Both 'internal' and 'external' values must be provided.");
    }

    // Check sum == 100
    if (data.internal + data.external !== 100) {
      const errorMsg = `The sum must be 100. You provided internal ${data.internal}% and external ${data.external}%.`;
      throw new Error(errorMsg); // Throw error
      // return ctx.reply(`❌ Error: ${errorMsg}`);
    }

    // ✅ All good - Instead of replying, return the data or a success indicator
    // We let handleSetSplitCommand handle the reply.
    // Optionally return the validated data if needed elsewhere
   // send the transaction to splitter contract
    return { internal: data.internal, external: data.external };
    // return ctx.reply(`✅ Split set successfully!\nInternal: ${data.internal}%\nExternal: ${data.external}%`);
  }

  async handleSetSplitCommand(ctx) {
    try {
      const chatID = utils.getChatId(ctx);
      const text = ctx.message.text;

      const args = text.split(' ').slice(1);

      const userTags = [];
      const percentages = [];

      // Basic check for even number of arguments
      if (args.length % 2 !== 0 || args.length === 0) {
          ctx.reply("Invalid format. Please provide pairs like 'internal 10 external 90'.");
          return;
      }

      for (let i = 0; i < args.length; i += 2) {
        const tag = args[i];
        const percentageStr = args[i + 1];
        const percentage = parseInt(percentageStr, 10);

        // Add validation during parsing in the handler
        if (isNaN(percentage)) {
            ctx.reply(`Invalid percentage value '${percentageStr}' for tag '${tag}'. Please provide numbers.`);
            return;
        }

        userTags.push(tag);
        percentages.push(percentage);
      }

      // Call the setSplit function with parsed data
      // No need to await if setSplit is purely synchronous validation now
      // Or keep await if it might do async operations later (like DB save)
      const validatedData = await this.setSplit(userTags, percentages, chatID);
      // send the transaction to splitter contract
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      const holon = await this.getHolonContract(holonAddress);
      const tx = await this.executeTransaction(
        holon,
        'setSplit',
        [validatedData, percentages]
      );
      await tx.wait();
      // If setSplit completes without throwing, we can reply with success
      // We can use the validatedData if needed
      ctx.reply(`✅ Split set successfully!\nInternal: ${validatedData.internal}%\nExternal: ${validatedData.external}%`);

    } catch (error) {
      // Catch errors thrown by setSplit or other issues
      console.error("Error handling setSplit command:", error.message); // Log the specific error message
      // Reply with the specific error message from setSplit
      ctx.reply(`❌ Error: ${error.message}`);
      // Old generic reply: ctx.reply("Failed to set split. Please check your input format.");
    }
  }

  async appreciateUsersByUsername(userTags, percentages, chatID, senderUserId) {
    try {
      // Ensure the lengths of usernames and percentages match
      if (userTags.length !== percentages.length) {
        throw new Error("userTags and percentages should be equal");
      }
  
      const holonAddress = await this.holonsContract.toAddress(chatID.toString());
      // console.log("holonAddress: ", holonAddress);
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
        return
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
    const telegramZone = parseInt(zoneStr, 10);
    const chatID = utils.getChatId(ctx);
    let holonID = null;

    try {
        const solidityZone = this.invertZone(telegramZone);

        // Here we need to introduce Zoned contract

        // const holonAddress = await this.holonsContract.toAddress(chatID.toString());

        const holonName = `chat_${Math.abs(chatID)}`;
        const holon = await this.getZonedContract(holonName);
        const holonAddress = holon.target;

        if (holonAddress === '0x0000000000000000000000000000000000000000') {
            return ctx.reply("No holon exists for this chat");
        }

        // const holon = await this.getHolonContract(holonAddress);
        
        // Check if this is actually a Zoned holon by checking the flavor
        const flavor = await holon.flavor();
        if (flavor !== "Zoned") {
            return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only external holons have zone functionality.`);
        }
        
        const users = await this.db.getAll(chatID.toString() + '/users');

        // Retrieve users by tags
        const senderUser = await this.getUserByTag(chatID, senderTag);
        const user = await this.getUserByTag(chatID, userTag);
      if (!user) {
        holonID = args[0]
      } else {
        holonID = user.id.toString();
      }

        await ctx.reply(`Adding user to zone ${telegramZone}... Please wait.`);

        const tx = await this.executeTransaction(
            holon,
            'addToZone',
        [senderUser.id.toString(), holonID, solidityZone]
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

  // TODO: This is debugging function: 

  /**
 * Utility that:
 *   • prints the calldata you are about to send
 *   • sends the tx
 *   • waits for the receipt
 *   • prints status / gas / revert reason (if any)
 */
  async traceTx(label, txReq, iface, signer) {
    console.log(`\n----- ${label} -----`);
    console.log("calldata        :", txReq.data);
    console.log("to              :", txReq.to);
  
    try {
      const tx = await signer.sendTransaction(txReq);
      const receipt = await tx.wait();
      console.log("status (1=ok/0=rev):", receipt.status);
      console.log("gasUsed         :", receipt.gasUsed.toString());
      console.log("----- end -----\n");
      return { tx, receipt };
    } catch (err) {
      // ------- 1. whatever the provider gave us -----------
      const revertData =
        err.error?.data ??      // ethers v6 (most JSON-RPCs)
        err.data ??             // ethers v5
        err.receipt?.revertReason;
  
      console.log("status          : 0 (revert)");
      console.log("revert data(raw):", revertData ?? "<none>");
  
      // ------- 2. if provider gave nothing, try a static call -----------
      let callRevert;
      if (!revertData) {
        try {
          await signer.provider.call(txReq); // will throw & include data
        } catch (callErr) {
          callRevert = callErr.error?.data ?? callErr.data;
          console.log("revert data(via call):", callRevert ?? "<none>");
        }
      }
  
      const dataToDecode = revertData || callRevert;
      if (dataToDecode && dataToDecode.startsWith("0x08c379a0")) {
        // require("reason") string => slice after function selector & offset
        const reasonHex = "0x" + dataToDecode.slice(138);
        try {
          const reasonStr = ethers.toUtf8String(reasonHex).trim();
          console.log("string reason  :", reasonStr);
        } catch { /* ignore */ }
      } else if (dataToDecode) {
        try {
          const decoded = iface.parseError(dataToDecode);
          console.log("decoded reason :", decoded?.name, decoded?.args);
        } catch { /* not a custom error */ }
      }
  
      console.log("----- end -----\n");
      const tx = err?.transaction ?? err?.tx;
      const receipt = err?.receipt;
      console.log("----- end -----\n");
      return { tx, receipt }; 
    }
  }

  async claim(ctx) {
    const chatID = utils.getChatId(ctx);
    const userID = utils.getUserId(ctx);
    
    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      let holon = await this.getManagedContract(holonName);
      if (holon.target === '0x0000000000000000000000000000000000000000') {
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
 
      // Execute the transaction using the contract's claim function
      console.log("userID.toString(): ", userID.toString());
      // let's add members here as well:

            // ------------- prepare calldata -------------
      // calldata
      const userIdStr = userID.toString();
      const dataAdd  = holon.interface.encodeFunctionData("addMember(string)", [userIdStr]);
      const dataClaim = holon.interface.encodeFunctionData("claim", [userIdStr, beneficiaryAddress]);

      // 1️⃣ addMember
      const { tx: addTx, receipt: addRcpt } = await this.traceTx(
        "addMember",
        { to: holon.target, data: dataAdd, gasLimit: 3_000_000 },
        holon.interface,
        this.wallet
      );

      if (!addRcpt || addRcpt.status !== 1) {   // 🔺 extra !addRcpt guard
        console.error("❌ addMember failed – aborting");
        return;
      }

      // async notification
      this.waitForTransaction(addTx, ctx, `Added member! Tx hash: ${addTx.hash}`);

      // 2️⃣ skip claim if already done
      const already = await holon.hasClaimed(userIdStr);
      if (already) {
        console.log("⏩ user already claimed, skipping");
        return;
      }

      // 3️⃣ claim
      const { tx: claimTx, receipt: claimRcpt } = await this.traceTx(
        "claim",
        { to: holon.target, data: dataClaim, gasLimit: 3_000_000 },
        holon.interface,
        this.wallet
      );

      if (!claimRcpt || claimRcpt.status !== 1) {  // 🔺 extra null guard
        console.error("❌ claim reverted");
        return;
      }

      this.waitForTransaction(claimTx, ctx, `Claim successful! Tx hash: ${claimTx.hash}`);
      
      // Provide immediate feedback
      return ctx.reply(`Transaction submitted. You will be notified when your claim is processed.`);
    } catch (error) {
      console.error("Error in claim:", error);
      return ctx.reply("Claim Failed: " + error.message);
    }
  }

  async listMembers(ctx) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    const managedContract = await this.getManagedContract(chatIdNormalized);
    let message = "";

    if (!managedContract) {
      message = "Error: Could not find managed contract";
    } else {
      let membersLength = await managedContract.getSize();
      let members = [];
      for (let i = 0; i < membersLength; i++) {
        let member = await managedContract.userIds(i);
        members.push(member);
      }
      message = `━━━━━━━━━━━━━━━━━━━━━━\n`;
      if (membersLength > 0) {
        message += `Members (${membersLength}):\n`;
        members.forEach((member, index) => {
          message += `${index + 1}. ${member}\n`;
        });
      } else {
        message += `No members found`;
      }
    }

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
      }
    });
  }

  async showZoneManagementView(ctx, mode = 'view') { // Mode: 'view', 'prepare_move', 'prepare_remove'
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let message = "🔶 External Management\n\n";
    const keyboard = [];

    if (mode === 'prepare_move') {
      message += "Select a member to move ➡️\n\n";
    } else if (mode === 'prepare_remove') {
      message += "Select a member to remove from their zone ➖\n\n";
    } else { // view mode
      message += "Click member for actions, or prepare batch move/remove.\n\n";
    }

    try {
      const zonedContract = await this.getZonedContract(chatIdNormalized);
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        message += "This Holon does not have external functionality.";
        keyboard.push([{ text: "◀️ Back to Flow Management", callback_data: "holons_flow_management" }]);
        if (ctx.callbackQuery) {
            return ctx.editMessageText(message, { reply_markup: { inline_keyboard: keyboard } }).catch(e => console.log("Error: ", e.message));
        } else {
            return ctx.reply(message, { reply_markup: { inline_keyboard: keyboard } }).catch(e => console.log("Error: ", e.message));
        }
      }

      const users = await this.db.getAll(chatID.toString() + '/users');
      const userMap = users.reduce((map, user) => {
        map[user.id] = user.username;
        return map;
      }, {});

      for (let i = 0; i <= 5; i++) {
        const solidityZone = this.invertZone(i);
        const zoneMembers = await zonedContract.getZoneMembers(solidityZone);
        // Do not show members from Zone 5 in prepare_remove mode as they are already "removed"
        const membersToDisplay = (mode === 'prepare_remove' && i === 5) ? [] : zoneMembers;
        
        keyboard.push([{ text: `Zone ${i} (${membersToDisplay.length})`, callback_data: `zone_header_${i}` }]); 
        
        if (membersToDisplay.length > 0) {
            const memberButtonObjects = await Promise.all(membersToDisplay.map(async (memberId) => {
                // Use utils.getHolonName to get the holon name, with ID in brackets as fallback
                let holonName;
                try {
                    holonName = await utils.getHolonName(this.db, memberId, ctx);
                    console.log("holonName from a function utils.getHolonName inside ShowZoneManagementView: ", holonName);
                } catch (error) {
                    console.warn(`Could not get holon name for ${memberId}:`, error.message);
                    holonName = `Holon ${memberId}`; // Fallback name
                }
                
                // Only show ID in brackets if the name is different from the ID
                const normalizedMemberId = utils.normalizeHolonId(memberId);
                const displayName = holonName === normalizedMemberId.toString() ? holonName : `${holonName} (${normalizedMemberId})`;
                
                let buttonText = displayName;
                let callbackData = `zone_member_${memberId}_${i}`;
                if (mode === 'prepare_move') {
                    buttonText += " ➡️";
                    callbackData = `zone_select_member_to_move_${memberId}_${i}`;
                } else if (mode === 'prepare_remove') {
                    buttonText += " ➖";
                    callbackData = `zone_confirm_remove_${memberId}_${i}`;
                }
                return { text: buttonText, callback_data: callbackData };
            }));
            // Change to one member button per row within zones
            for (const btn of memberButtonObjects) {
                keyboard.push([btn]);
            }
        }
      }

      // Add federated holons section
      try {
        const fedInfo = await this.db.holosphere.getFederation(chatID);
        const federatedWith = fedInfo && fedInfo.federation ? fedInfo.federation : [];
        
        if (federatedWith.length > 0) {
          keyboard.push([{ text: `🔗 Federated Holons (${federatedWith.length})`, callback_data: ' ' }]);
          
          for (const federatedHolonId of federatedWith) {
            // Try to get holon name, always show ID
            let holonName;
            try {
              holonName = await utils.getHolonName(this.db, federatedHolonId, ctx);
            } catch (error) {
              console.warn(`Could not get holon name for ${federatedHolonId}:`, error.message);
              holonName = null; // No name found
            }
            
            // Always show ID - either with name or just ID
            const displayName = holonName ? `${holonName} (${federatedHolonId})` : federatedHolonId.toString();
            
            let buttonText = displayName;
            let callbackData = `federated_holon_${federatedHolonId}`;
            
            
            if (mode === 'prepare_move') {
              buttonText += " ➡️";
              callbackData = `zone_select_federated_to_move_${federatedHolonId}`;
            } else if (mode === 'prepare_remove') {
              // Federated holons can't be removed from zones since they're not in zones yet
              buttonText += " (not in zones)";
              callbackData = ' ';
            }
            
            keyboard.push([{ text: buttonText, callback_data: callbackData }]);
          }
        }
      } catch (error) {
        console.warn('Error getting federated holons:', error);
      }

      if (mode === 'prepare_move') {
        keyboard.push([{ text: "❌ Cancel Move", callback_data: "holons_manage_zones_view" }]);
      } else if (mode === 'prepare_remove') {
        keyboard.push([{ text: "❌ Cancel Remove", callback_data: "holons_manage_zones_view" }]);
      } else { // view mode
        keyboard.push([
            { text: "➡️ Prepare Move", callback_data: "zone_prepare_move" },
            { text: "➖ Prepare Remove", callback_data: "zone_prepare_remove" }
        ]);
        keyboard.push([{ text: "🔗 Add External Holon(s)", callback_data: "zone_add_external_holons_scene_enter"}]);
        keyboard.push([
            { text: "🎯 Reward Function", callback_data: "reward_function_set" }
        ]);
      }
      keyboard.push([{ text: "◀️ Back to Flow Management", callback_data: "holons_flow_management" }]);
      
    // ... (rest of the edit/reply logic remains the same) ...
      if (ctx.callbackQuery) {
        return ctx.editMessageText(message, { 
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown' 
        }).catch(async (err) => { // Make catch async
            try {
              // Try to answer callback query regardless of error type to prevent "Unknown Action"
              await ctx.answerCbQuery("Error updating view. Please try again.").catch(e => {});
            } catch (e) { /*already handled or cannot answer*/ }
            // Optionally, send a new reply as a fallback if edit failed and it makes sense
            // await ctx.reply("Could not update view. " + err.message ).catch(e => console.log("DEBUG SHOW_ZONE_VIEW: Fallback reply error:", e.message));
        });
      } else {
        // This branch is for non-callback entries, e.g. direct command call to show this view
        return ctx.reply(message, { 
            reply_markup: { inline_keyboard: keyboard },
            parse_mode: 'Markdown'
        }).catch(e => {});
      }
    } catch (error) {
      console.error("Error displaying zone management:", error);
      // If an error happens before we even try to edit/reply, answer query if possible
      if (ctx.callbackQuery) {
          try { await ctx.answerCbQuery("Failed to load zone view.").catch(e => {}); } catch(e) {} 
      }
      // Avoid replying if headers might have been sent or if it's a complex state from a deeper issue
      // if (ctx && !ctx.headersSent) { 
      //   await ctx.reply("Error displaying zone management: " + error.message).catch(e => console.log("Error replying ZMV general error:", e.message));
      // }
      return; 
    }
  }

  async showMemberManagementView(ctx, edit = false, mode = 'view') { // Mode: 'view', 'prepare_remove'
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let message = "👥 Internal Management\n\n";
    const keyboard = [];

    if (mode === 'prepare_remove') {
      message += "Select a member to remove ➖\n\n";
    } else { // view mode
              message += "Manage your internal members.\n\n";
    }

    try {
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract || managedContract.target === '0x0000000000000000000000000000000000000000') {
        message += "Error: Could not find internal contract for this chat.";
        keyboard.push([{ text: "◀️ Back to Flow Management", callback_data: "holons_flow_management" }]);
      } else {
        let membersLength = Number(await managedContract.getSize());
        let members = [];
        if (membersLength > 0) {
            for (let i = 0; i < membersLength; i++) {
                let memberId = await managedContract.userIds(i);
                members.push(memberId);
            }
        }

        const usersFromDB = await this.db.getAll(chatID.toString() + '/users');
        const userMap = usersFromDB.reduce((map, user) => {
          map[user.id.toString()] = user.username; // Ensure DB user ID is string for map key
          return map;
        }, {});

        if (members.length === 0) {
          message += "No members in internal yet.";
        } else {
          // Get value equation for score calculation
          const equation = await this.settings.getValueEquation(chatID);
          
          // Calculate total score for percentage calculations
          let totalCalculatedScore = 0;
          let totalContractScore = 0;
          const memberData = [];
          
          for (const memberId of members) {
            let calculatedScore = 0;
            let contractScore = 0;
            
            // Always calculate fresh score from database using current value equation
            try {
              const user = usersFromDB.find(u => u.id.toString() === memberId.toString());
              
              if (user) {
                // Calculate base score from current user data and equation
                calculatedScore = Math.floor(
                  (user.initiated?.length || 0) * (equation.initiated || 0) +
                  (user.completed?.length || 0) * (equation.completed || 0) +
                  (user.sent || 0) * (equation.sent || 0) +
                  (user.received || 0) * (equation.received || 0) +
                  (user.hours || 0) * (equation.hours || 0) +
                  (user.collaboration || 0) * (equation.collaboration || 0) +
                  (user.wants?.length || 0) * (equation.wants || 0) +
                  (user.offers?.length || 0) * (equation.offers || 0)
                );
              }
            } catch (e) {
              // Silently continue if score calculation fails
            }
            
            // Try to fetch from smart contract
            try {
              const memberScore = await managedContract.appreciation(memberId.toString());
              contractScore = Number(memberScore.toString());
            } catch (contractError) {
              // Silently continue if contract fetch fails
            }
            
            // Store the base calculated score (from value equation) and contract score
            memberData.push({ 
              id: memberId, 
              calculatedScore,  // This is the fresh score from value equation
              contractScore 
            });
            totalCalculatedScore += calculatedScore;
            totalContractScore += contractScore;
          }

          if (mode !== 'prepare_remove') {
            message += "Current members, scores & flow percentages:\n";
            message += `📊 Calculated Total: ${totalCalculatedScore} | Contract Total: ${totalContractScore}\n\n`;
          }
          
          // Get manual score adjustments
          const settings = await this.getSettings(chatID);
          const memberAdjustments = settings.memberAdjustments || {};

          // Display members with scores and percentages
          for (const member of memberData) {
            // Apply manual adjustments to the current calculated score (from value equation)
            const adjustment = memberAdjustments[member.id] || 0;
            const adjustedScore = member.calculatedScore + adjustment;
            
            if (mode === 'prepare_remove') {
              // Simple display for remove mode
              let buttonText = `@${userMap[member.id] || member.id} ➖`;
              let callbackData = `member_confirm_remove_${member.id}`;
              keyboard.push([{ text: buttonText, callback_data: callbackData }]);
            } else {
              // Interactive score adjustment mode
              const percentage = totalCalculatedScore > 0 ? Math.round((adjustedScore / (totalCalculatedScore + Object.values(memberAdjustments).reduce((a, b) => a + b, 0))) * 100) : 0;
              const contractPercentage = totalContractScore > 0 ? Math.round((member.contractScore / totalContractScore) * 100) : 0;
              
              // Member name with both percentages
              keyboard.push([{
                text: `@${userMap[member.id] || member.id} (local ${percentage}%, contract ${contractPercentage}%)`,
                callback_data: 'noop'
              }]);
              
              // Score adjustment row: <<, <, score (%), >, >>
              keyboard.push([
                { text: '<<', callback_data: `member_decrement10_${member.id}` },
                { text: '<', callback_data: `member_decrement_${member.id}` },
                { text: `${adjustedScore} (${percentage}%)`, callback_data: 'noop' },
                { text: '>', callback_data: `member_increment_${member.id}` },
                { text: '>>', callback_data: `member_increment10_${member.id}` }
              ]);
              
              // Separator
              keyboard.push([{
                text: '━━━━━━━━━━━━━━━',
                callback_data: 'noop'
              }]);
            }
          }
        }
      }
      
      if (mode === 'prepare_remove') {
        keyboard.push([{ text: "❌ Cancel Remove", callback_data: "holons_manage_members_view" }]); 
      } else { // 'view' mode buttons
        keyboard.push([
            { text: "➕ Add Member(s)", callback_data: "member_enter_add_scene" },
            { text: "➖ Prepare Remove", callback_data: "member_prepare_remove" }
        ]);
        keyboard.push([
            { text: "🔄 Sync Scores to Contract", callback_data: "member_sync_scores" }
        ]);
        keyboard.push([
            { text: "🎁 Reward Members", callback_data: "holons_reward" }
        ]);
        keyboard.push([
            { text: "⚖️ Value Equation", callback_data: "settings_equation" }
        ]);
      }
      keyboard.push([{ text: "◀️ Back to Flow Management", callback_data: "holons_flow_management" }]);

      const replyMarkup = { inline_keyboard: keyboard };
      if (edit || ctx.callbackQuery) { // Prefer edit if it's a callback query context
        return ctx.editMessageText(message, { reply_markup: replyMarkup, parse_mode: 'Markdown' }).catch(err => {
            if (err.response && err.response.error_code === 400 && err.response.description.includes('message is not modified')) {
                if(ctx.callbackQuery) ctx.answerCbQuery().catch(e => {});
            } else { 
                console.error("Error editing member management view:", err); 
                // Fallback if edit fails for other reasons
                ctx.reply(message, { reply_markup: replyMarkup, parse_mode: 'Markdown' }).catch(e => {});
            }
        });
      } else {
        return ctx.reply(message, { reply_markup: replyMarkup, parse_mode: 'Markdown' });
      }
    } catch (error) {
      console.error("Error in showMemberManagementView:", error);
      await ctx.reply("Error displaying member management: " + error.message).catch(e => {});
      return; 
    }
  }

  async smartSync(ctx) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    await ctx.reply("🔄 Smart Sync initiated...").catch(e => {});

    try {
      // 1. Check and Add Members if necessary
      await ctx.reply("🔍 Checking member counts...").catch(e => {});
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract || managedContract.target === '0x0000000000000000000000000000000000000000') {
        await ctx.reply("❌ Managed Holon contract not found. Cannot perform Smart Sync.").catch(e => console.log("Error replying no managed contract:", e.message));
        return;
      }

      const dbUsers = await this.db.getAll(chatID.toString() + '/users');
      if (!dbUsers || dbUsers.length === 0) {
        await ctx.reply("ℹ️ No users found in the database to sync.").catch(e => console.log("Error replying no db users:", e.message));
        // Decide if we should still sync scores (e.g. to remove appreciation for non-existent users if contract supports it)
        // For now, we'll proceed to syncScore which might handle empty arrays gracefully or as intended.
      }

      const contractMemberCount = Number(await managedContract.getSize());
      const dbMemberCount = dbUsers ? dbUsers.length : 0;

      if (dbMemberCount !== contractMemberCount) {
        await ctx.reply(`ℹ️ Member count mismatch (DB: ${dbMemberCount}, Contract: ${contractMemberCount}). Adding/updating internal members...`).catch(e => console.log("Error replying member mismatch:", e.message));
        // addMembersBundle sends its own replies regarding transaction submission
        await this.addMembersBundle(ctx); 
        // We might want a small delay or a more robust way to wait for addMembersBundle completion if syncScore depends on immediate update
        // For now, this will await the submission of addMembersBundle transaction.
        await ctx.reply("✅ Member synchronization step submitted.").catch(e => console.log("Error replying member sync submitted:", e.message));
      } else {
        await ctx.reply("✅ Member counts match. Proceeding to score sync.").catch(e => console.log("Error replying member counts match:", e.message));
      }

      // 2. Sync Scores
      await ctx.reply("📊 Syncing scores...").catch(e => console.log("Error replying syncing scores:", e.message));
      // syncScore sends its own replies regarding transaction submission
      await this.syncScore(ctx);
      await ctx.reply("✅ Score synchronization step submitted.").catch(e => console.log("Error replying score sync submitted:", e.message));

      await ctx.reply("🏁 Smart Sync process steps submitted. You will receive notifications for each transaction.").catch(e => console.log("Error replying smart sync complete:", e.message));

    } catch (error) {
      console.error("Error during Smart Sync:", error);
      await ctx.reply(`❌ Error during Smart Sync: ${error.message}`).catch(e => console.log("Error replying smart sync error:", e.message));
    }
  }

  async setupMemberAddScene() {
    this.addMemberScene = new Scenes.BaseScene('add_member_scene');
    this.addMemberScene.enter(async (ctx) => {
      await ctx.reply(
        "Enter User ID(s) of the member(s) to add to internal, space-separated:\n" +
        "(These are usually numeric Telegram User IDs)"
      );
    });
    this.addMemberScene.on('text', async (ctx) => {
      const userIdsString = ctx.message.text.trim();
      if (!userIdsString) {
        await ctx.reply("No User IDs provided. Please try again or type /cancel.");
        return ctx.scene.reenter();
      }
      
      const tempCtx = { ...ctx, message: { ...ctx.message, text: `/addmembers ${userIdsString}` } }; // Mock context for getParameters
      
      await ctx.reply(`➕ Adding provided User ID(s) to internal...`).catch(e => console.log("E:", e.message));
      await this.addMembersBundle(tempCtx); 
      await ctx.scene.leave();
      await this.showHolonsMenu(ctx, false); // Go back to main menu after adding
    });
    this.addMemberScene.command('cancel', async (ctx) => {
      await ctx.reply('Cancelled adding members.').catch(e => console.log("E:", e.message));
      await ctx.scene.leave();
      await this.showHolonsMenu(ctx, false);
    });
    // Registration will be in constructor
  }

  async removeMemberFromManagedHolon(ctx, memberIdToRemove) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;

    try {
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract || managedContract.target === '0x0000000000000000000000000000000000000000') {
        throw new Error("Internal contract not found for this chat.");
      }

      // Try to remove member directly by their ID (same format as when adding)
      const tx = await this.executeTransaction(
        managedContract,
        'removeMember',
        [memberIdToRemove.toString()]
      );

      this.waitForTransaction(tx, ctx, `Successfully submitted removal of member ${memberIdToRemove}`);
      return true; // Indicate submission success
    } catch (error) {
      console.error(`Error in removeMemberFromManagedHolon for ${memberIdToRemove}:`, error);
      await ctx.reply(`❌ Failed to initiate removal for member ${memberIdToRemove}: ${error.message}`).catch(e => console.log("E:", e.message));
      return false; // Indicate failure
    }
  }

  async promptForTargetZone(ctx, memberId, originalZoneTelegramIndex) {
    await ctx.answerCbQuery().catch(e => console.log("Error answering CBQ in promptForTargetZone:", e.message));

    const chatID = utils.getChatId(ctx);
    
    // Determine if this is a federated holon or local member
    const isFederatedHolon = originalZoneTelegramIndex === -1;
    
    let memberDisplay;
    if (isFederatedHolon) {
      // For federated holons, use getHolonName to get the display name
      try {
        const holonName = await utils.getHolonName(this.db, memberId, ctx);
        memberDisplay = holonName || memberId.toString();
      } catch (error) {
        console.warn(`Could not get holon name for ${memberId}:`, error.message);
        memberDisplay = memberId.toString();
      }
    } else {
      // For local members, use the existing user lookup logic
    const users = await this.db.getAll(chatID.toString() + '/users');
    const userMap = users.reduce((map, user) => {
      map[user.id.toString()] = user.username || user.id.toString();
      return map;
    }, {});
      memberDisplay = `@${userMap[memberId] || memberId}`;
    }

    let message;
    if (isFederatedHolon) {
      message = `Moving federated holon ${memberDisplay} to a zone.
Select the TARGET zone:`;
    } else {
      message = `Moving member ${memberDisplay} (currently in Zone ${originalZoneTelegramIndex}).
Select the TARGET zone:`;
    }
    
    const keyboard = [];

    for (let i = 0; i <= 5; i++) {
      if (i === parseInt(originalZoneTelegramIndex)) { // parseInt to be safe
        keyboard.push([{ text: `➡️ Zone ${i} (Current)`, callback_data: `zone_noop_current_${i}` }]);
      } else {
        keyboard.push([{ text: `🎯 Zone ${i}`, callback_data: `zone_execute_move_${memberId}_${i}_${originalZoneTelegramIndex}` }]);
      }
    }
    keyboard.push([{ text: "❌ Cancel Move", callback_data: "holons_manage_zones_view" }]);

    try {
      await ctx.editMessageText(message, { 
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown' 
      });
    } catch (error) {
      console.error("Error in promptForTargetZone:", error);
      await ctx.reply("Error displaying target zone selection.").catch(e => console.log("Reply error", e.message));
    }
  }

  async setupExternalHolonAddScene() {
    this.addExternalHolonScene.enter(async (ctx) => {
      await ctx.reply(
        "Enter space-separated Holon ID(s) to add as members to this holon ecosystem:\n" 
      ).catch(e => console.log("Error replying in addExternalHolonScene enter:", e.message));
    });

    this.addExternalHolonScene.on('text', async (ctx) => {
      const holonIdsString = ctx.message.text.trim();
      if (!holonIdsString) {
        await ctx.reply("No Holon IDs provided. Please try again or type /cancel.").catch(e => console.log("E:", e.message));
        return ctx.scene.reenter();
      }
      const holonIdsToAddArray = holonIdsString.split(' ');
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      const senderUserId = utils.getUserId(ctx).toString();

      await ctx.reply(`🔗 Adding ${holonIdsToAddArray.length} external Holon(s)...`).catch(e => console.log("E:", e.message));

      try {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
          await ctx.reply("Error: External contract not found for this chat.").catch(e => console.log("E:", e.message));
          await ctx.scene.leave();
          return this.showZoneManagementView(ctx); 
        }

        // Was before, but data is being empty
        // const tx = await this.executeTransaction(
        //   zonedContract,
        //   'addMembers',
        //   [senderUserId, holonIdsToAddArray] 
        // );
        // Explicitly encode the function data
        const data = zonedContract.interface.encodeFunctionData(
          'addMembers',
          [senderUserId, holonIdsToAddArray]
        );
        console.log("Data:", data);
        console.log("SenderUserId:", senderUserId); // Should be string
        console.log("HolonIdsArray:", holonIdsToAddArray); // Array of string or address?

        // Send the transaction directly
        const tx = await this.wallet.sendTransaction({
          to: zonedContract.target,
          data,
          gasLimit: 3000000,
          nonce: await this.wallet.getNonce()
        });

        this.waitForTransaction(tx, ctx, `Successfully submitted request to add ${holonIdsToAddArray.length} external Holon(s).`);
        
      } catch (error) {
        console.error("Error adding external Holons:", error);
        await ctx.reply(`❌ Failed to add external Holons: ${error.message}`).catch(e => console.log("E reply err:",e.message));
      }
      await ctx.scene.leave();
      // Call showZoneManagementView without edit=true to send a new message after scene, or manage state to allow edit
      await this.showZoneManagementView(ctx); 
    });

    this.addExternalHolonScene.command('cancel', async (ctx) => {
      await ctx.reply('Cancelled adding external Holons.').catch(e => console.log("E:", e.message));
      await ctx.scene.leave();
      await this.showZoneManagementView(ctx); 
    });
  }

  async executeZoneMove(ctx, memberId, targetZoneTelegramIndex, originalZoneTelegramIndex) {
    await ctx.answerCbQuery().catch(e => console.log("Error answering CBQ in executeZoneMove:", e.message));
    const chatID = utils.getChatId(ctx);
    const senderUserId = utils.getUserId(ctx).toString(); // User initiating the move
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;

    // Determine if this is a federated holon or local member
    const isFederatedHolon = originalZoneTelegramIndex === -1;
    
    let memberDisplay;
    if (isFederatedHolon) {
      // For federated holons, use getHolonName to get the display name
      try {
        const holonName = await utils.getHolonName(this.db, memberId, ctx);
        memberDisplay = holonName || memberId.toString();
      } catch (error) {
        console.warn(`Could not get holon name for ${memberId}:`, error.message);
        memberDisplay = memberId.toString();
      }
    } else {
      // For local members, use the existing user lookup logic
    const users = await this.db.getAll(chatID.toString() + '/users');
    const userMap = users.reduce((map, user) => {
      map[user.id.toString()] = user.username || user.id.toString();
      return map;
    }, {});
      memberDisplay = `@${userMap[memberId] || memberId}`;
    }

    let moveMessage;
    if (isFederatedHolon) {
      moveMessage = `➡️ Moving federated holon ${memberDisplay} to Zone ${targetZoneTelegramIndex}... Please wait.`;
    } else {
      moveMessage = `➡️ Moving ${memberDisplay} from Zone ${originalZoneTelegramIndex} to Zone ${targetZoneTelegramIndex}... Please wait.`;
    }

    await ctx.editMessageText(
      moveMessage,
      { reply_markup: { inline_keyboard: [[{ text: "Processing...", callback_data: "noop" }]] } }
    ).catch(e => console.log("Error editing message for move start:", e.message));

    try {
      const zonedContract = await this.getZonedContract(chatIdNormalized);
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        throw new Error("External contract not found for this chat.");
      }

      const solidityTargetZone = this.invertZone(parseInt(targetZoneTelegramIndex, 10));

      console.log(`Executing move: sender=${senderUserId}, member=${memberId}, targetSolidityZone=${solidityTargetZone} (from Telegram Zone ${targetZoneTelegramIndex})`);

      // Assuming 'addToZone' is the correct method for moving, as per existing patterns.
      // It typically takes (sender, memberToMove, targetZone)
      // Was before but it was returning empty string for the data encoded
      // const tx = await this.executeTransaction(
      //   zonedContract,
      //   'addToZone',
      //   [senderUserId, memberId, solidityTargetZone]
      // );
      // Manually encoding the data so we find a solution
      // 1. Encode the function data manually
      const data = zonedContract.interface.encodeFunctionData(
        "addToZone",
        [senderUserId, memberId, solidityTargetZone]
      );
      console.log("move between the zones, senderUserId: ", senderUserId);
      console.log("move between the zones, memberId: ", memberId);
      console.log("move between the zones, solidityTargetZone", solidityTargetZone);
      // 2. Prepare the transaction object
      const txRequest = {
        to: zonedContract.target, // or zonedContract.address depending on ethers version
        data,
        gasLimit: 3000000,
        // Add any other options you need (nonce, gasPrice, etc.)
      };

      // 3. Send the transaction using the wallet
      const tx = await this.wallet.sendTransaction(txRequest);

      this.waitForTransaction(
        tx,
        ctx,
        `Successfully submitted move for ${memberDisplay} to Zone ${targetZoneTelegramIndex}. Tx: ${tx.hash}`
      );
      
      // Provide immediate feedback on submission, waitForTransaction will provide final status
      await ctx.reply(`Transaction submitted to move ${memberDisplay} to Zone ${targetZoneTelegramIndex}. You'll be notified upon completion.`).catch(e => console.log("Error replying for move submission:", e.message));
      // Refresh the main zone management view after submitting the transaction
      return this.showZoneManagementView(ctx);

    } catch (error) {
      console.error(`Error executing zone move for member ${memberId}:`, error);
      await ctx.editMessageText(
        `❌ Failed to move ${memberDisplay}: ${error.message}`,
        { reply_markup: { inline_keyboard: [[{ text: "◀️ Back to Zone Management", callback_data: "holons_manage_zones_view" }]] } }
      ).catch(e => console.log("Error editing message for move failure:", e.message));
      // No automatic refresh on error, user can go back.
    }
  }

  async displaySplitterManagementView(ctx) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let splitterAddress = "N/A";
    let internalPercent = 50; // Default

    try {
      const splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (splitterContract && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
        splitterAddress = splitterContract.target;
        try {
          const internalPBigInt = await splitterContract.internalContractSplitPercentage();
          // const externalPBigInt = await splitterContract.externalContractSplitPercentage(); // Not strictly needed if deriving
          
          internalPercent = parseInt(internalPBigInt.toString(), 10);

          if (isNaN(internalPercent) || internalPercent < 0 || internalPercent > 100) {
              console.warn(`Fetched initial internalPercent ${internalPercent} is invalid. Defaulting to 50.`);
              internalPercent = 50;
          }
        } catch (e) {
          console.log(`Initial percentage fetch using direct contract methods failed, defaulting to 50:`, e.message);
          internalPercent = 50;
        }
      } else {
        await ctx.editMessageText("Splitter contract not found for this chat.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back to Flow Management", callback_data: "holons_flow_management"}]]}}).catch(e => console.log("DisplaySplitterView Error Edit (no contract): ", e.message));
        return;
      }
    } catch (error) {
      console.error("Error getting splitter contract for displaySplitterView:", error);
      await ctx.editMessageText("Error accessing splitter details.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back to Flow Management", callback_data: "holons_flow_management"}]]}}).catch(e => console.log("DisplaySplitterView Error Edit (contract access): ", e.message));
      return;
    }

    // Call the helper function to display the view
    await this._updateSplitterManagementView(ctx, internalPercent, splitterAddress);
  }

  // Polynomial Reward Function Management Methods

  async handleSetRewardFunction(ctx) {
    const args = ctx.message.text.split(" ").slice(1);
    if (args.length < 3) {
      return ctx.reply(
        "Usage: /setrewardfunction [a] [b] [c]\n" +
        "Sets the polynomial coefficients for reward distribution across zones.\n" +
        "The formula is: reward_percentage = (a * zone^2 + b * zone + c)\n" +
        "Where zone ranges from 0 (highest) to n-1 (lowest)\n" +
        "Example: /setrewardfunction 5 -10 50"
      );
    }

    const [aStr, bStr, cStr] = args;
    const a = parseInt(aStr);
    const b = parseInt(bStr);
    const c = parseInt(cStr);

    if (isNaN(a) || isNaN(b) || isNaN(c)) {
      return ctx.reply("All parameters must be valid integers");
    }

    const chatID = utils.getChatId(ctx);
    const senderUserId = utils.getUserId(ctx).toString();

    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("This chat does not have a Zoned Holon. Only Zoned Holons support polynomial reward functions.");
      }

      await ctx.reply(`Setting polynomial reward function parameters...\nFormula: ${a} * zone² + ${b} * zone + ${c}\nPlease wait.`);

      const tx = await this.executeTransaction(
        zonedContract,
        'setRewardFunction',
        [senderUserId, a, b, c]
      );

      this.waitForTransaction(
        tx,
        ctx,
        `Polynomial reward function updated! Parameters: a=${a}, b=${b}, c=${c}`
      );

      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when the polynomial reward function is updated.`);

      // Show the preview of new reward distribution
      setTimeout(async () => {
        await this.showRewardPreview(ctx, a, b, c);
      }, 2000);

    } catch (error) {
      console.error("Error setting reward function:", error);
      await ctx.reply("Failed to set reward function: " + error.message);
    }
  }

  async handleRewardPreview(ctx) {
    const chatID = utils.getChatId(ctx);

    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("This chat does not have a Zoned Holon. Only Zoned Holons support polynomial reward functions.");
      }

      // Get current polynomial parameters
      const [a, b, c] = await Promise.all([
        zonedContract.a(),
        zonedContract.b(),
        zonedContract.c()
      ]);

      const nzones = await zonedContract.nzones();
      
      await this.showRewardPreview(ctx, Number(a), Number(b), Number(c), Number(nzones));

    } catch (error) {
      console.error("Error getting reward preview:", error);
      await ctx.reply("Failed to get reward preview: " + error.message);
    }
  }

  async showRewardPreview(ctx, a, b, c, nzones = null) {
    try {
      const chatID = utils.getChatId(ctx);
      
      if (nzones === null) {
        const holonName = `chat_${Math.abs(chatID)}`;
        const zonedContract = await this.getZonedContract(holonName);
        nzones = Number(await zonedContract.nzones());
      }

      let previewText = `🎯 **Polynomial Reward Function Preview**\n\n`;
      previewText += `📐 **Formula:** ${a} × zone² + ${b} × zone + ${c}\n\n`;
      previewText += `🏆 **Zone Reward Distribution:**\n`;
      
      let totalWeight = 0;
      const zoneWeights = [];

      // Calculate weights for each zone
      for (let zone = 0; zone < nzones; zone++) {
        const weight = Math.max(0, a * zone * zone + b * zone + c);
        zoneWeights.push(weight);
        totalWeight += weight;
      }

      // Show percentage distribution
      if (totalWeight > 0) {
        for (let zone = 0; zone < nzones; zone++) {
          const percentage = ((zoneWeights[zone] / totalWeight) * 100).toFixed(2);
          const telegramZone = this.invertZone(zone, nzones);
          previewText += `Zone ${telegramZone}: ${percentage}% (weight: ${zoneWeights[zone]})\n`;
        }
      } else {
        previewText += `⚠️ Warning: All zones have zero or negative weights!\n`;
        for (let zone = 0; zone < nzones; zone++) {
          const weight = a * zone * zone + b * zone + c;
          const telegramZone = this.invertZone(zone, nzones);
          previewText += `Zone ${telegramZone}: weight = ${weight}\n`;
        }
      }

      previewText += `\n📊 **Total Weight:** ${totalWeight}`;
      previewText += `\n🔢 **Total Zones:** ${nzones}`;
      
      await ctx.reply(previewText, { parse_mode: 'Markdown' });

    } catch (error) {
      console.error("Error showing reward preview:", error);
      await ctx.reply("Failed to show reward preview: " + error.message);
    }
  }

  // Helper method to convert between Solidity zone index and Telegram display zone
  invertZone(zone, nzones = 6) {
    // Solidity uses 0 as highest zone, Telegram displays 0 as highest
    // So zone 0 in Solidity = Zone 0 in Telegram (highest)
    // zone 5 in Solidity = Zone 5 in Telegram (lowest)
    return zone;
  }

  // Interactive Polynomial Parameter UI Methods

  async showPolynomialParameterUI(ctx) {
    const chatID = utils.getChatId(ctx);

    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("This chat does not have a Zoned Holon. Only Zoned Holons support polynomial reward functions.");
      }

      // Get current polynomial parameters
      let a, b, c;
      try {
        [a, b, c] = await Promise.all([
          zonedContract.a(),
          zonedContract.b(),
          zonedContract.c()
        ]);
        a = Number(a);
        b = Number(b);
        c = Number(c);
      } catch (error) {
        // Default values if contract doesn't have them set
        a = 0;
        b = 0;
        c = 50;
      }

      await this.updatePolynomialParameterUI(ctx, a, b, c, true);

    } catch (error) {
      console.error("Error showing polynomial parameter UI:", error);
    }
  }

  async updatePolynomialParameterUI(ctx, a, b, c, isNew = false) {
    const chatID = utils.getChatId(ctx);

    try {
      // Generate the zone distribution chart
      const chartPath = await this.generateZoneDistributionChart(a, b, c, chatID);
      
      // Create the parameter control keyboard
      const keyboard = this.createPolynomialParameterKeyboard(a, b, c);

      const message =
                     `📐 **Formula:** ${a} × zone² + ${b} × zone + ${c}\n\n` +
                     `Use the controls below to adjust parameters and see the live preview:`;

      if (isNew) {
        await ctx.replyWithPhoto(
          { source: fs.createReadStream(chartPath) },
          {
            caption: message,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
          }
        );
      } else {
        await ctx.editMessageMedia(
          {
            type: 'photo',
            media: { source: fs.createReadStream(chartPath) },
            caption: message,
            parse_mode: 'Markdown'
          },
          { reply_markup: { inline_keyboard: keyboard } }
        );
      }

    } catch (error) {
      console.error("Error updating polynomial parameter UI:", error);
    }
  }

  createPolynomialParameterKeyboard(a, b, c) {
    const keyboard = [];

    // Parameter A controls
    keyboard.push([
      { text: `A: ${a}`, callback_data: `poly_info_a` }
    ]);
    keyboard.push([
      { text: "--", callback_data: `poly_param_a_dec5_${a}_${b}_${c}` },
      { text: "-", callback_data: `poly_param_a_dec_${a}_${b}_${c}` },
      { text: `${a}`, callback_data: `poly_noop` },
      { text: "+", callback_data: `poly_param_a_inc_${a}_${b}_${c}` },
      { text: "++", callback_data: `poly_param_a_inc5_${a}_${b}_${c}` }
    ]);

    // Parameter B controls
    keyboard.push([
      { text: `B: ${b}`, callback_data: `poly_info_b` }
    ]);
    keyboard.push([
      { text: "--", callback_data: `poly_param_b_dec5_${a}_${b}_${c}` },
      { text: "-", callback_data: `poly_param_b_dec_${a}_${b}_${c}` },
      { text: `${b}`, callback_data: `poly_noop` },
      { text: "+", callback_data: `poly_param_b_inc_${a}_${b}_${c}` },
      { text: "++", callback_data: `poly_param_b_inc5_${a}_${b}_${c}` }
    ]);

    // Parameter C controls
    keyboard.push([
      { text: `C: ${c}`, callback_data: `poly_info_c` }
    ]);
    keyboard.push([
      { text: "--", callback_data: `poly_param_c_dec5_${a}_${b}_${c}` },
      { text: "-", callback_data: `poly_param_c_dec_${a}_${b}_${c}` },
      { text: `${c}`, callback_data: `poly_noop` },
      { text: "+", callback_data: `poly_param_c_inc_${a}_${b}_${c}` },
      { text: "++", callback_data: `poly_param_c_inc5_${a}_${b}_${c}` }
    ]);

    // Action buttons
    keyboard.push([
      { text: "💾 Save Parameters", callback_data: `poly_save_${a}_${b}_${c}` }
    ]);
    keyboard.push([
      { text: "◀️ Back to External Flows", callback_data: "holons_manage_zones_view" }
    ]);

    return keyboard;
  }

  async savePolynomialParameters(ctx, a, b, c) {
    const chatID = utils.getChatId(ctx);
    const senderUserId = utils.getUserId(ctx).toString();

    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        return ctx.editMessageText("This chat does not have a Zoned Holon. Only Zoned Holons support polynomial reward functions.");
      }

      await ctx.editMessageText(`💾 Saving polynomial parameters...\nFormula: ${a} × zone² + ${b} × zone + ${c}\nPlease wait.`);

      const tx = await this.executeTransaction(
        zonedContract,
        'setRewardFunction',
        [senderUserId, a, b, c]
      );

      this.waitForTransaction(
        tx,
        ctx,
        `✅ Polynomial reward function updated!\nParameters: a=${a}, b=${b}, c=${c}`
      );

      // Provide immediate feedback
      await ctx.reply(`Transaction submitted. You will be notified when the polynomial reward function is updated.`);

      // Return to zone management after a brief delay
      setTimeout(async () => {
        await this.showZoneManagementView(ctx);
      }, 3000);

    } catch (error) {
      console.error("Error saving polynomial parameters:", error);
      await ctx.editMessageText("Failed to save polynomial parameters: " + error.message);
    }
  }

  // UI Integration Methods
  setUIInstance(uiInstance) {
    this.ui = uiInstance;
  }

  async generateZoneDistributionChart(a, b, c, chatID) {
    if (!this.ui) {
      throw new Error('UI instance not available for chart generation');
    }

    try {
      const holonName = `chat_${Math.abs(chatID)}`;
      const zonedContract = await this.getZonedContract(holonName);
      
      let nzones = 6; // Default
      if (zonedContract && zonedContract.target !== '0x0000000000000000000000000000000000000000') {
        try {
          nzones = Number(await zonedContract.nzones());
        } catch (error) {
          console.log('Could not get nzones from contract, using default:', error.message);
        }
      }

      return await this.ui.getZoneDistributionChart(a, b, c, nzones, chatID);
    } catch (error) {
      console.error('Error generating zone distribution chart:', error);
      throw error;
    }
  }

  // Helper methods for settings management
  async getSettings(chatID) {
    return await this.settings.getSettings(chatID);
  }

  async setSettings(settings) {
    return await this.settings.setSettings(settings);
  }
  // Check if the -id has associated smart contract address ( bundle is created )

  async checkGroupAddress(federationID) {
    try {
        // Convert federationID to string and normalize it for the contract
        const groupId = `chat_${Math.abs(federationID)}`;
        
        // Get the address from the toAddress mapping
        const address = await this.holonsContract.toAddress(groupId);
        
        // Check if the address is not the zero address
        const exists = address !== '0x0000000000000000000000000000000000000000';
        
        return {
            exists,
            address: exists ? address : null
        };
    } catch (error) {
        console.error("Error checking group address:", error);
        return {
            exists: false,
            address: null,
            error: error.message
        };
    }
}

//  technical debt - modularize this

async createHolonBundle(holonsContract, creatorUserId, holonName, parameterValue) {
  try {
    // 1. Create the Holon Bundle (Splitter)
    const txBundle = await holonsContract.newHolonBundle(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 15_000_000 }
    );
    console.log("Transaction submitted for newHolonBundle:", txBundle.hash);
    
    const receiptBundle = await txBundle.wait();
    console.log("newHolonBundle transaction confirmed:", receiptBundle.status === 1 ? 'Success' : 'Failed');
    if (receiptBundle.status !== 1) {
      throw new Error(`Holon Bundle creation transaction failed (Hash: ${txBundle.hash})`);
    }

    // 2. Get the bundle address from the transaction receipt events
    let splitterAddress;
    for (const log of receiptBundle.logs) {
      try {
        const parsedLog = holonsContract.interface.parseLog(log);
        if (parsedLog && parsedLog.name === "HolonBundleCreated") {
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
      console.log(`Retrieving Splitter address mapped in Holons contract for holonName: ${holonName}`);
      splitterAddress = await holonsContract.toAddress(holonName);
      console.log(`Retrieved Splitter Address from Holons mapping: ${splitterAddress}`);
    }

    // Check if splitterAddress is valid
    if (!splitterAddress || splitterAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`Failed to retrieve a valid Splitter address for ${holonName} after bundle creation.`);
    }

    return {
      success: true,
      bundleAddress: splitterAddress
    };

  } catch (error) {
    console.error("Error creating holon bundle:", error);
    return {
      success: false,
      error: error.message
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
async createBundleContracts(splitterContract, creatorUserId, holonName, parameterValue) {
  try {
    // Create Managed Contract
    const txManaged = await splitterContract.createManagedContract(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 6_000_000 }
    );
    console.log("Transaction submitted for createManagedContract:", txManaged.hash);
    
    const receiptManaged = await txManaged.wait();
    if (receiptManaged.status !== 1) {
      throw new Error(`Managed Contract creation transaction failed (Hash: ${txManaged.hash})`);
    }

    // Get the managed contract address
    const managedContractKey = `${holonName}_managed`;
    const managedAddress = await splitterContract.contractsByType(managedContractKey);

    // Create Zoned Contractd
    const txZoned = await splitterContract.createZonedContract(
      creatorUserId,
      holonName,
      parameterValue,
      { gasLimit: 10_000_000 }
    );
    console.log("Transaction submitted for createZonedContract:", txZoned.hash);
    
    const receiptZoned = await txZoned.wait();
    if (receiptZoned.status !== 1) {
      throw new Error(`Zoned Contract creation transaction failed (Hash: ${txZoned.hash})`);
    }

    // Get the zoned contract address
    const zonedContractKey = `${holonName}_zoned`;
    const zonedAddress = await splitterContract.contractsByType(zonedContractKey);

    return {
      success: true,
      managedAddress,
      zonedAddress
    };

  } catch (error) {
    console.error("Error creating bundle contracts:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

async getHolonContracts(holonId, holonsContract, wallet) {
  try {
      // Define ABIs
      const splitterABI = JSON.parse(fs.readFileSync('./contracts/Splitter.json', 'utf-8')).abi;
      const zonedABI = JSON.parse(fs.readFileSync('./contracts/Zoned.json', 'utf-8')).abi;
      const managedABI = JSON.parse(fs.readFileSync('./contracts/Managed.json', 'utf-8')).abi;  // Added Managed ABI


      // Check if the holon has a bundle
      const groupInfo = await this.checkGroupAddress(holonId);
      console.log("Holon bundle info:", groupInfo);

      if (!groupInfo.exists) {
          console.log("Holon does not have a bundle yet");
          return {
              success: false,
              error: "Holon does not have a bundle",
              contracts: null
          };
      }

      // Get the Splitter contract instance
      const splitterAddress = groupInfo.address;
      const splitterContract = new ethers.Contract(splitterAddress, splitterABI, wallet);
      console.log("getHolonContracts has a splitter address & contract: ", splitterAddress);

      // Get the Zoned contract address from the Splitter
      const zonedContractKey = `chat_${Math.abs(holonId)}_zoned`;
      const zonedAddress = await splitterContract.contractsByType(zonedContractKey);
      const zonedContract = new ethers.Contract(zonedAddress, zonedABI, wallet);

      // Get all contract keys and addresses for debugging
      const [keys, addresses] = await splitterContract.getContractAddresses();
      console.log("All contracts in Splitter:");
      for (let i = 0; i < keys.length; i++) {
          console.log(`Key: ${keys[i]}, Address: ${addresses[i]}`);
      }

      // Get specific contract info
      const managedContractKey = `chat_${Math.abs(holonId)}_managed`;
      const managedAddress = await splitterContract.contractsByType(managedContractKey);
      const managedContract = new ethers.Contract(managedAddress, managedABI, wallet);

      return {
          success: true,
          contracts: {
              splitter: {
                  address: splitterAddress,
                  contract: splitterContract
              },
              zoned: {
                  address: zonedAddress,
                  contract: zonedContract
              },
              managed: {
                  address: managedAddress,
                  contract: managedContract // You would need to add the Managed ABI to instantiate this
              }
          }
      };

  } catch (error) {
      console.error("Error getting holon contracts:", error);
      return {
          success: false,
          error: error.message,
          contracts: null
      };
  }
}


}
