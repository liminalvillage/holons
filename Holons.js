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
      await ctx.answerCbQuery();
      const flavor = ctx.match[1];
      await ctx.editMessageText(`You selected ${flavor}. Do you want to proceed with creation?`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yes", callback_data: `confirm_holon_creation_${flavor}` }, { text: "❌ No", callback_data: "holons_back" }]
          ]}
      }).catch(error => console.error("Error editing message:", error));
    });
    this.createHolonScene.action(/confirm_holon_creation_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
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
      await ctx.answerCbQuery();
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
    this.bot.command("appreciate", async (ctx) => this.handleAppreciateCommand(ctx));
    this.bot.command("addtozone", async (ctx) => this.handleAddToZoneCommand(ctx));
    
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
            const zonedContract = await this.getZonedContract(chatIdNormalized);
            if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
              // It's important to await ctx.answerCbQuery() before returning or editing, if not done at the top of the main handler
              // await ctx.answerCbQuery().catch(e => console.log("CBQ Error in no zoned func", e.message));
              return ctx.editMessageText("This holon does not have Zoned functionality.", {
                reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]] }
              }).catch(e => console.log("Error editing message for no zoned functionality:", e.message));
            }
            await this.showZoneManagementView(ctx);
          } catch (error) {
            // Simplified catch block for now to pass linter
            if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
            } else {
              // Optionally, provide a generic error message to the user if safe to do so
               await ctx.reply("An error occurred while trying to manage zones.").catch(e => console.log("Reply error", e.message));
            }
          }
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
    this.bot.action('direct_manage_splitter', async (ctx) => {
      await ctx.answerCbQuery().catch(e => console.log("Initial Display CBQ Error:", e.message));
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let splitterAddress = "N/A";
      let internalPercent = 50; // Default
      let externalPercent = 50; // Default

      try {
        const splitterContract = await this.getSplitterContract(chatIdNormalized);
        if (splitterContract && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
          splitterAddress = splitterContract.target;
          try {
            const internalPBigInt = await splitterContract.internalContractSplitPercentage();
            const externalPBigInt = await splitterContract.externalContractSplitPercentage(); // Fetch external too for consistency
            
            internalPercent = parseInt(internalPBigInt.toString(), 10);
            externalPercent = parseInt(externalPBigInt.toString(), 10);

            if (isNaN(internalPercent) || internalPercent < 0 || internalPercent > 100) {
                console.warn(`Fetched initial internalPercent ${internalPercent} is invalid. Defaulting to 50.`);
                internalPercent = 50;
                externalPercent = 50; // Recalculate if internal defaulted
            }
            // Optionally, verify if internalPercent + externalPercent === 100 from contract, or trust internal and derive external
            // For now, we will display what contract gives for both, but adjustments will modify internal and derive external.

          } catch (e) {
            console.log(`Initial percentage fetch using direct contract methods failed, defaulting to 50/50:`, e.message);
            internalPercent = 50;
            externalPercent = 50;
          }
        } else {
          await ctx.editMessageText("Splitter contract not found for this chat.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back", callback_data: "holons_back"}]]}}).catch(e => console.log("Initial Display Error Edit (no contract): ", e.message));
          return;
        }
      } catch (error) {
        console.error("Error getting splitter contract for initial display:", error);
        await ctx.editMessageText("Error accessing splitter details.", { reply_markup: { inline_keyboard: [[{text: "◀️ Back", callback_data: "holons_back"}]]}}).catch(e => console.log("Initial Display Error Edit (contract access): ", e.message));
        return;
      }

      // The UI will adjust based on internalPercent, external will be derived for proposals
      let message = `🔷 SPLITTER MANAGEMENT 🔷\n`;
      message += `Contract: \`${splitterAddress}\`\n`;
      message += `Adjust Internal (Managed) / External (Zoned) Split:\n\n`;
      message += `Current Contract Setting: Managed ${internalPercent}% / Zoned ${externalPercent}%`;
      // For the interactive part, we start with the fetched internalPercent
      const currentUiInternalPercent = internalPercent; 
      const currentUiExternalPercent = 100 - currentUiInternalPercent;

      const keyboard = [
        [
          { text: "<< (-10)", callback_data: `splitter_adj_live_-10_${currentUiInternalPercent}` },
          { text: "< (-1)", callback_data: `splitter_adj_live_-1_${currentUiInternalPercent}` },
          { text: `${currentUiInternalPercent}% / ${currentUiExternalPercent}%`, callback_data: "noop" }, // This will be the one changing
          { text: "> (+1)", callback_data: `splitter_adj_live_1_${currentUiInternalPercent}` },
          { text: ">> (+10)", callback_data: `splitter_adj_live_10_${currentUiInternalPercent}` }
        ],
        [{ text: "✅ Set This Split", callback_data: `splitter_conf_live_set_${currentUiInternalPercent}` }],
        [{ text: "◀️ Back to Menu", callback_data: "holons_back" }]
      ];
      await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } }).catch(e => console.log("E Splitter initial display edit (Scene-less): ", e.message));
    });

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
      const newExternalPercent = 100 - newInternalPercent;
      let message = `🔷 SPLITTER MANAGEMENT 🔷\nContract: \`${splitterAddress}\`\nAdjust Internal (Managed) / External (Zoned) Split:\n\nProposed: Managed ${newInternalPercent}% / Zoned ${newExternalPercent}%`;
     
      const keyboard = [
        [
          { text: "<< (-10)", callback_data: `splitter_adj_live_-10_${newInternalPercent}` },
          { text: "< (-1)", callback_data: `splitter_adj_live_-1_${newInternalPercent}` },
          { text: `${newInternalPercent}% / ${newExternalPercent}%`, callback_data: "noop" },
          { text: "> (+1)", callback_data: `splitter_adj_live_1_${newInternalPercent}` },
          { text: ">> (+10)", callback_data: `splitter_adj_live_10_${newInternalPercent}` }
        ],
        [{ text: "✅ Set This Split", callback_data: `splitter_conf_live_set_${newInternalPercent}` }],
        [{ text: "◀️ Back to Menu", callback_data: "holons_back" }]
      ];
      const newReplyMarkup = { inline_keyboard: keyboard };
      try {
        await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: newReplyMarkup });
        
      } catch (error) {
            console.error("Error editing message in splitter_adj_live:", error);
      }
    });

    this.bot.action(/splitter_conf_live_set_(\d+)/, async (ctx) => {
      try { await ctx.answerCbQuery().catch(e => console.log("Confirm Split CBQ Error:", e.message)); } catch (e) { console.log("Error in answerCbQuery top for confirm_split", e); }
      
      const finalInternalPercent = parseInt(ctx.match[1],10);
      if (isNaN(finalInternalPercent) || finalInternalPercent < 0 || finalInternalPercent > 100) {
          
        await ctx.editMessageText("Error: Invalid percentage for setting split. Please try again.", {reply_markup: {inline_keyboard: [[{text: "Try Again", callback_data: "direct_manage_splitter"}]]}} ).catch(e => console.log("E:",e.message));
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
          await ctx.editMessageText(`❌ Error setting split: ${error.message}. Please try again.`, {reply_markup: {inline_keyboard: [[{text: "Try Again", callback_data: "direct_manage_splitter"}]]}}).catch(e => console.log("E:", e.message));
      }
    });
    // === END OF SPLITTER MANAGEMENT ACTION HANDLERS ===
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
        [{ text: "🎁 Reward Members", callback_data: "holons_reward" }, { text: "⚖️ ETH Balance", callback_data: "holons_ethbalance" }],
        [{ text: "🪙 Token Balance", callback_data: "holons_tokenbalance" }],
        [{ text: "💱 Split Rewards", callback_data: "direct_manage_splitter" }],
        [{ text: "👥 Internal Rewards", callback_data: "holons_manage_members_view" }],
        [{ text: "🔶 Ecosystem Management", callback_data: "holons_manage_zones_view" }]
      );
   
    } else {
      // Only show Create Holon button if no holon exists
      menuKeyboard.push(
        [{ text: "🆕 Create Holon", callback_data: "holons_create" }]
      );
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

    let userids = users.map((user) => user.id.toString());
    // Format scores to ensure they're BigInts for the contract call
    let contractScores = users.map((user) => {
      const scoreValue = Math.floor(
        user.initiated.length * equation.initiated +
        user.completed.length * equation.completed +
        user.sent * equation.sent +
        user.received * equation.received +
        user.hours * equation.hours +
        user.collaboration * equation.collaboration +
        user.wants.length * equation.wants +
        user.offers.length * equation.offers
      );
      return ethers.toBigInt(scoreValue);
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
      const chatID = ctx.message.chat.id;
      const userID = ctx.message.from.id;
  
      console.log("Input parameters:");
      console.log("- chatID:", chatID, "(" + typeof chatID + ")");
      console.log("- userID:", userID, "(" + typeof userID + ")");
  
      const holonsAddress = this.holonsContract.target;
      console.log("Holons contract address:", holonsAddress);
  
      const creatorUserId = userID.toString();
      const holonName = `chat_${Math.abs(chatID)}`;
      const parameterValue = 5; 
      
      console.log(`Creating holon bundle with name: ${holonName}`);
  
      // 1. Create the Holon Bundle (Splitter) - with higher gas limit
      const txBundle = await this.holonsContract.newHolonBundle(
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
  
      // 2. Read the bundle address directly from the transaction receipt events
      let splitterAddress;
      for (const log of receiptBundle.logs) {
        // Look for the relevant event that contains the new address
        try {
          // Assuming the event is emitted with the bundle address
          const parsedLog = this.holonsContract.interface.parseLog(log);
          if (parsedLog && parsedLog.name === "HolonBundleCreated") {
            splitterAddress = parsedLog.args.bundleAddress;
            console.log(`Found Splitter address from event: ${splitterAddress}`);
            break;
          }
        } catch (e) {
          // Not all logs can be parsed by this interface
          continue;
        }
      }
  
      // Fallback: try to get address from contract mapping if event parsing failed
      if (!splitterAddress) {
        console.log(`Retrieving Splitter address mapped in Holons contract for holonName: ${holonName}`);
        splitterAddress = await this.holonsContract.toAddress(holonName);
        console.log(`Retrieved Splitter Address from Holons mapping: ${splitterAddress}`);
      }
  
      // Check if splitterAddress is valid before proceeding
      if (!splitterAddress || splitterAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error(`Failed to retrieve a valid Splitter address for ${holonName} after bundle creation.`);
      }
  
      // 3. Create Splitter Contract Instance
      // Make sure you're using the correct ABI for the Splitter contract
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
  
      // 4. Create Managed Contract with higher gas limit
      console.log(`Calling createManagedContract on ${splitterAddress} with user ${creatorUserId}, name ${holonName}, param ${parameterValue}`);
      const txManaged = await splitterContract.createManagedContract(
        creatorUserId, 
        holonName, 
        parameterValue, 
        { gasLimit: 6_000_000 }
      ); 
      console.log("Transaction submitted for createManagedContract:", txManaged.hash);
  
      const receiptManaged = await txManaged.wait();
      console.log("createManagedContract transaction confirmed:", receiptManaged.status === 1 ? 'Success' : 'Failed');
      if (receiptManaged.status !== 1) {
        throw new Error(`Managed Contract creation transaction failed (Hash: ${txManaged.hash})`);
      }
  
      // Get the managed contract address
      const managedContractKey = `${holonName}_managed`;
      const managedAddress = await splitterContract.contractsByType(managedContractKey);
      console.log(`Managed contract address: ${managedAddress}`);
  
      // 5. Create Zoned Contract with higher gas limit
      console.log(`Calling createZonedContract on ${splitterAddress} with user ${creatorUserId}, name ${holonName}, param ${parameterValue}`);
      const txZoned = await splitterContract.createZonedContract(
        creatorUserId, 
        holonName, 
        parameterValue, 
        { gasLimit: 10_000_000 }
      ); 
      console.log("Transaction submitted for createZonedContract:", txZoned.hash);
  
      const receiptZoned = await txZoned.wait();
      console.log("createZonedContract transaction confirmed:", receiptZoned.status === 1 ? 'Success' : 'Failed');
      if (receiptZoned.status !== 1) {
        throw new Error(`Zoned Contract creation transaction failed (Hash: ${txZoned.hash})`);
      }
  
      // Get the zoned contract address
      const zonedContractKey = `${holonName}_zoned`;
      const zonedAddress = await splitterContract.contractsByType(zonedContractKey);
      console.log(`Zoned contract address: ${zonedAddress}`);
  
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

    await ctx.reply(`Adding holon(s) to federation... Please wait.`);

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

      this.waitForTransaction(tx, ctx, `Successfully initiated adding ${holonIdsToAddArray.length} holon(s)`);

      await ctx.reply(`Transaction submitted. You will be notified when holon(s) are added.`);
    } catch (error) {
      console.error("Transaction error in addHolonsBundle:", error);
      await ctx.reply(`Failed to add holon(s): ${error.message}`);
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
        ctx.reply("This command only works with Zoned holons");
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
            return ctx.reply(`This holon is of type "${flavor}" and does not support zones. Only "Zoned" holons have zone functionality.`);
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

      const data = holon.interface.encodeFunctionData('claim', [userID.toString(), beneficiaryAddress]);
      
      const tx = await this.wallet.sendTransaction({
        to: holon.target,
        data,
        gasLimit: 3000000,
        // maxPriorityFeePerGas: maxPriorityFee,
        // maxFeePerGas: maxFee,
        nonce: await this.wallet.getNonce()
      });
      // const tx = await this.executeTransaction(
      //   holon,
      //   'claim',
      //   [userID.toString(), beneficiaryAddress],
      //   {
      //     gasLimit: 3000000,
      //     maxPriorityFeePerGas: ethers.parseUnits("3", "gwei"),
      //     maxFeePerGas: ethers.parseUnits("30", "gwei"),
      //   }
      // );
      
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
    let message = "🔶 Zone Management\n\n";
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
        message += "This Holon does not have Zoned functionality.";
        keyboard.push([{ text: "◀️ Back", callback_data: "holons_back" }]);
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
            const memberButtonObjects = membersToDisplay.map(memberId => {
                let buttonText = `@${userMap[memberId] || memberId}`;
                let callbackData = `zone_member_${memberId}_${i}`;
                if (mode === 'prepare_move') {
                    buttonText += " ➡️";
                    callbackData = `zone_select_member_to_move_${memberId}_${i}`;
                } else if (mode === 'prepare_remove') {
                    buttonText += " ➖";
                    callbackData = `zone_confirm_remove_${memberId}_${i}`;
                }
                return { text: buttonText, callback_data: callbackData };
            });
            // Change to one member button per row within zones
            for (const btn of memberButtonObjects) {
                keyboard.push([btn]);
            }
        }
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
        // Restore original callback_data
        keyboard.push([{ text: "🔗 Add External Holon(s)", callback_data: "zone_add_external_holons_scene_enter"}]); 
      }
      keyboard.push([{ text: "◀️ Back", callback_data: "holons_back" }]);
      
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
    let message = "👥 Member Management\n\n";
    const keyboard = [];

    if (mode === 'prepare_remove') {
      message += "Select a member to remove ➖\n\n";
    } else { // view mode
      message += "Manage your Holon members.\n\n";
    }

    try {
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract || managedContract.target === '0x0000000000000000000000000000000000000000') {
        message += "Error: Could not find Managed Holon contract for this chat.";
        keyboard.push([{ text: "◀️ Back", callback_data: "holons_back" }]);
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
          message += "No members in this Holon yet.";
        } else {
          if (mode !== 'prepare_remove') message += "Current members & scores:\n";
          // Change to one member button per row
          for (const memberId of members) {
            let score = 0; // Default score
            try {
              // Assuming 'appreciations' is the public mapping or getter for scores
              const memberScore = await managedContract.appreciations(memberId.toString());
              score = memberScore.toString(); // Convert BigNumber to string
            } catch (e) {
              console.warn(`Could not fetch score for member ${memberId}: ${e.message}`);
            }

            let buttonText = `@${userMap[memberId] || memberId} (Score: ${score})`;
            let callbackData = `member_action_${memberId}`;
            if (mode === 'prepare_remove') {
              buttonText += " ➖";
              callbackData = `member_confirm_remove_${memberId}`;
            }
            keyboard.push([{ text: buttonText, callback_data: callbackData }]);
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
      }
      keyboard.push([{ text: "◀️ Back", callback_data: "holons_back" }]);

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
        await ctx.reply(`ℹ️ Member count mismatch (DB: ${dbMemberCount}, Contract: ${contractMemberCount}). Adding/updating members...`).catch(e => console.log("Error replying member mismatch:", e.message));
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
        "Enter User ID(s) of the member(s) to add to the Managed Holon, space-separated:\n" +
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
      
      await ctx.reply(`➕ Adding provided User ID(s) to Managed Holon...`).catch(e => console.log("E:", e.message));
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
    // Send initial feedback immediately, don't edit over it with further status updates from this func
    // await ctx.reply(`➖ Attempting to remove member ${memberIdToRemove} from Managed Holon...`).catch(e => console.log("E:",e.message));

    try {
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract || managedContract.target === '0x0000000000000000000000000000000000000000') {
        throw new Error("Managed Holon contract not found for this chat.");
      }

      const memberAddress = await managedContract.userIdToAddress(memberIdToRemove.toString());
      if (!memberAddress || memberAddress === '0x0000000000000000000000000000000000000000') {
         // Try to find address from DB as a fallback if not directly on contract (e.g. if user never interacted with contract but is in DB)
        const dbUsers = await this.db.getAll(chatID.toString() + '/users');
        const userFromDb = dbUsers.find(u => u.id.toString() === memberIdToRemove.toString());
        if(userFromDb && userFromDb.address) {
            // This assumes your DB stores an eth_address for the user if they registered one
            // This part is speculative based on typical bot structures; adjust if your DB schema is different.
            // For now, if not found via userIdToAddress, we assume it's an issue.
             console.warn(`Could not find Ethereum address for member ID ${memberIdToRemove} via contract. DB lookup not implemented here.`);
        }
        throw new Error(`Could not find Ethereum address for member ID ${memberIdToRemove} via contract's userIdToAddress. Has this member been added with an address before?`);
      }

      console.log(`Attempting to remove member Address: ${memberAddress} (from ID: ${memberIdToRemove}) from Managed Holon: ${managedContract.target}`);

      const tx = await this.executeTransaction(
        managedContract,
        'removeMember',
        [memberAddress]
      );

      this.waitForTransaction(tx, ctx, `Successfully submitted removal of member ${memberIdToRemove} (Address: ${memberAddress.substring(0,6)}...)`);
      // The waitForTransaction will send the success message to ctx upon completion.
      // No need for an additional ctx.reply here for the transaction itself.
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
    const users = await this.db.getAll(chatID.toString() + '/users');
    const userMap = users.reduce((map, user) => {
      map[user.id.toString()] = user.username || user.id.toString();
      return map;
    }, {});
    const memberDisplay = `@${userMap[memberId] || memberId}`;

    let message = `Moving member ${memberDisplay} (currently in Zone ${originalZoneTelegramIndex}).
Select the TARGET zone:`;
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
        "Enter space-separated Holon ID(s) to add as members to this Zoned Holon:\n" +
        "(e.g., chat_12345 another_holon_address)"
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
          await ctx.reply("Error: Zoned Holon contract not found for this chat.").catch(e => console.log("E:", e.message));
          await ctx.scene.leave();
          return this.showZoneManagementView(ctx); 
        }

        const tx = await this.executeTransaction(
          zonedContract,
          'addMembers',
          [senderUserId, holonIdsToAddArray] 
        );

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

    const users = await this.db.getAll(chatID.toString() + '/users');
    const userMap = users.reduce((map, user) => {
      map[user.id.toString()] = user.username || user.id.toString();
      return map;
    }, {});
    const memberDisplay = `@${userMap[memberId] || memberId}`;

    await ctx.editMessageText(
      `➡️ Moving ${memberDisplay} from Zone ${originalZoneTelegramIndex} to Zone ${targetZoneTelegramIndex}... Please wait.`,
      { reply_markup: { inline_keyboard: [[{ text: "Processing...", callback_data: "noop" }]] } }
    ).catch(e => console.log("Error editing message for move start:", e.message));

    try {
      const zonedContract = await this.getZonedContract(chatIdNormalized);
      if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
        throw new Error("Zoned Holon contract not found for this chat.");
      }

      const solidityTargetZone = this.invertZone(parseInt(targetZoneTelegramIndex, 10));

      console.log(`Executing move: sender=${senderUserId}, member=${memberId}, targetSolidityZone=${solidityTargetZone} (from Telegram Zone ${targetZoneTelegramIndex})`);

      // Assuming 'addToZone' is the correct method for moving, as per existing patterns.
      // It typically takes (sender, memberToMove, targetZone)
      const tx = await this.executeTransaction(
        zonedContract,
        'addToZone',
        [senderUserId, memberId, solidityTargetZone]
      );

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
}
