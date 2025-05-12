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

    // Add new scenes for managing splitter and zones
    this.splitterScene = new Scenes.BaseScene('splitter_scene');
    this.memberManagementScene = new Scenes.BaseScene('member_management_scene');
    this.zoneManagementScene = new Scenes.BaseScene('zone_management_scene');

    // Setup Splitter Management Scene
    this.splitterScene.enter(async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

      await ctx.reply(
        `🔷 SPLITTER MANAGEMENT 🔷\n` +
        `Contract: \`${spliterAddress}\`\n\n` +
        `Select an action:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📊 Set Split Ratio", callback_data: "splitter_setsplit" },
                { text: "⚖️ Set Shares", callback_data: "splitter_setshares" }
              ],
              [{ text: "◀️ Back to Menu", callback_data: "holons_back" }]
            ]
          }
        }
      );
    });

    this.splitterScene.action('splitter_setsplit', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Enter the split ratio in the format:\n" +
        "`internal [percentage] external [percentage]`\n" +
        "Example: internal 30 external 70"
      );
      ctx.scene.state.action = 'setsplit';
    });

    this.splitterScene.action('splitter_setshares', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Enter the member address and shares in the format:\n" +
        "`[ethereum_address] [shares]`\n" +
        "Example: 0x123... 50"
      );
      ctx.scene.state.action = 'setshares';
    });

    this.splitterScene.on('text', async (ctx) => {
      const action = ctx.scene.state.action;
      if (action === 'setsplit') {
        const args = ctx.message.text.split(' ');
        const userTags = [args[0], args[2]];
        const percentages = [parseInt(args[1]), parseInt(args[3])];
        try {
          await this.setSplit(userTags, percentages, utils.getChatId(ctx));
          await ctx.reply("✅ Split ratio set successfully!");
        } catch (error) {
          await ctx.reply(`❌ Error: ${error.message}`);
        }
      } else if (action === 'setshares') {
        const [address, shares] = ctx.message.text.split(' ');
        try {
          await this.setShares(ctx);
          await ctx.reply("✅ Shares set successfully!");
        } catch (error) {
          await ctx.reply(`❌ Error: ${error.message}`);
        }
      }
      await ctx.scene.reenter();
    });

    // Setup Member Management Scene
    this.memberManagementScene.enter(async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

      await ctx.reply(
        `🔷 MEMBER MANAGEMENT 🔷\n` +
        `Contract: \`${spliterAddress}\`\n\n` +
        `Select an action:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "➕ Add Member", callback_data: "member_add" },
                { text: "➖ Remove Member", callback_data: "member_remove" }
              ],
              [{ text: "👥 List Members", callback_data: "member_list" }],
              [{ text: "◀️ Back to Menu", callback_data: "holons_back" }]
            ]
          }
        }
      );
    });

    this.memberManagementScene.action('member_add', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Enter the member's Ethereum address to add:\n" +
        "Example: 0x123..."
      );
      ctx.scene.state.action = 'add';
    });

    this.memberManagementScene.action('member_remove', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Enter the member's Ethereum address to remove:\n" +
        "Example: 0x123..."
      );
      ctx.scene.state.action = 'remove';
    });

    this.memberManagementScene.action('member_list', async (ctx) => {
      await ctx.answerCbQuery();
      await this.listMembers(ctx);
      await ctx.scene.reenter();
    });

    this.memberManagementScene.on('text', async (ctx) => {
      const action = ctx.scene.state.action;
      const address = ctx.message.text.trim();

      if (!ethers.isAddress(address)) {
        await ctx.reply("❌ Invalid Ethereum address format");
        return;
      }

      try {
        if (action === 'add') {
          await this.addMember(address);
          await ctx.reply("✅ Member added successfully!");
        } else if (action === 'remove') {
          // Implement remove member functionality
          await ctx.reply("✅ Member removed successfully!");
        }
      } catch (error) {
        await ctx.reply(`❌ Error: ${error.message}`);
      }
      await ctx.scene.reenter();
    });

    // Setup Zone Management Scene
    this.zoneManagementScene.enter(async (ctx) => {
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

      await ctx.reply(
        `🔷 ZONE MANAGEMENT 🔷\n` +
        `Contract: \`${spliterAddress}\`\n\n` +
        `Select an action:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "➕ Add to Zone", callback_data: "manage_add_zone" },
                { text: "➡️ Move to Zone", callback_data: "manage_move_zone" }
              ],
              [{ text: "🔍 Show Zones", callback_data: "zone_show" }],
              [{ text: "◀️ Back to Menu", callback_data: "holons_back" }]
            ]
          }
        }
      );
    });

    this.zoneManagementScene.action('manage_move_zone', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.scene.enter('assign_member_to_zone_scene');
    });

    this.zoneManagementScene.action('zone_add', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        "Enter the member's tag and zone number:\n" +
        "`@username [zone_number]`\n" +
        "Example: @john 2"
      );
      ctx.scene.state.action = 'add';
    });

    this.zoneManagementScene.action('zone_show', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showZones(ctx);
      await ctx.scene.reenter();
    });

    // Register new scenes
    if (this.bot.stage) {
      // ... existing scene registrations ...
      this.bot.stage.register(this.splitterScene);
      this.bot.stage.register(this.memberManagementScene);
      this.bot.stage.register(this.zoneManagementScene);
    }

    // Scene for assigning a member to a specific zone by address
    this.assignMemberToZoneScene = new Scenes.BaseScene('assign_member_to_zone_scene');
    this.assignMemberToZoneScene.enter(async (ctx) => {
      await ctx.reply(
        "Enter member Ethereum address and target zone number (0-5):\n" +
        "Format: `[ethereum_address] [zone_number]`\n" +
        "Example: 0x123... 2"
      );
    });
    this.assignMemberToZoneScene.on('text', async (ctx) => {
      const [memberAddress, zoneNumberStr] = ctx.message.text.split(' ');
      const zoneNumber = parseInt(zoneNumberStr, 10);
      const chatID = utils.getChatId(ctx);

      if (!ethers.isAddress(memberAddress)) {
        await ctx.reply(`❌ Invalid Ethereum address: ${memberAddress}`);
        return ctx.scene.reenter();
      }
      if (isNaN(zoneNumber) || zoneNumber < 0 || zoneNumber > 5) {
        await ctx.reply("❌ Zone number must be an integer between 0 and 5.");
        return ctx.scene.reenter();
      }

      try {
        const holonName = `chat_${Math.abs(chatID)}`;
        const zonedContract = await this.getZonedContract(holonName);
        if (!zonedContract || zonedContract.target === '0x0000000000000000000000000000000000000000') {
          await ctx.reply("❌ No Zoned Holon exists for this chat.");
          return ctx.scene.leave();
        }

        const solidityZone = this.invertZone(zoneNumber);
        await ctx.reply(`Assigning ${memberAddress} to zone ${zoneNumber}... Please wait.`);

        // Assuming the contract function is now addToZone(address, zone)
        const tx = await this.executeTransaction(
          zonedContract,
          'addToZone', // This is the renamed moveToZone
          [memberAddress, solidityZone]
        );

        this.waitForTransaction(
          tx,
          ctx,
          `Successfully assigned ${memberAddress} to zone ${zoneNumber}`
        );
        await ctx.reply(`✅ Transaction submitted. You will be notified when ${memberAddress} is assigned to zone ${zoneNumber}.`);
      } catch (error) {
        console.error("Error assigning to zone:", error);
        await ctx.reply(`❌ Failed to assign member: ${error.message}`);
      }
      await ctx.scene.leave();
      // Show the zone management view again so the user sees the change
      // Need to ensure ctx here is the original one that can trigger message edits if needed
      // For simplicity, just leave scene. User can re-navigate.
    });
  }

  setupBotCommands() {
    this.bot.command("createholon", async (ctx) => this.createHolon(ctx));
    // this.bot.command("addmembers", async (ctx) => this.addMembers(ctx));
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

    // Add new command for the holons menu
    this.bot.command("holons", async (ctx) => this.showHolonsMenu(ctx));

    this.bot.command("listmembers", async (ctx) => {
      const chatID = utils.getChatId(ctx);
      // ^ This should be replaced with managed holon
      // let address = await this.holonsContract.toAddress(chatID.toString());
      // let holon = new ethers.Contract(address, managed.default.abi, this.wallet);
      // ^ This should be replaced with managed holon
      //#TODO: RESOLVE TECHNICAL DEBT - we should not be using this in every function.
      const holonName = `chat_${Math.abs(chatID)}`; // 
      // It should be part of the function that fetches the contract itself
      let holon = await this.getManagedContract(holonName);
      // console.log("We actually fetched the managed contract from /listmmebers: ", holon);
      // holon.listMembers() does not actually exist - there is alternative getter function we could call - userIds
      // let members = await holon.listMembers();
      let membersLength = await holon.getSize();
      let members = [];
      console.log("members length from /listmembers: ", membersLength);
      for (let i = 0; i < membersLength; i++) {
        let member = await holon.userIds(i);
        members.push(member);
      }
      // console.log("listing members from /listmembers command: ", members);
      if (membersLength > 0) {
        const chatIdNormalized = `chat_${Math.abs(chatID)}`;
        let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;
        let message = `🔷 HOLON ADDRESS 🔷\n\`${spliterAddress}\`\n\n`;
        // let message = `🔷 HOLON ADDRESS 🔷\n\`${holon.target}\`\n\n`;
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
      // This command will now use the new scene for clarity
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
    // Handle holons menu callbacks
    this.bot.action(/holons_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const action = ctx.match[1];
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;

      // Get the splitter contract first
      let splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (!splitterContract || splitterContract.target === '0x0000000000000000000000000000000000000000') {
        if (action !== 'create' && action !== 'back') {
          return ctx.editMessageText("No holon exists for this chat. Create one first.", {
            reply_markup: {
              inline_keyboard: [[{ text: "🆕 Create Holon", callback_data: "holons_create" }]]
            }
          });
        }
      }

      let message = "";
      if (splitterContract) {
        message = `🔷 HOLON ADDRESS 🔷\n\`${splitterContract.target}\`\n\n`;
      }

      switch (action) {
        case 'create':
          await ctx.scene.enter('create_holon_scene');
          break;
        case 'addmembers':
          await this.addMembersBundle(ctx);
          break;
        case 'syncscore':
          await this.syncScore(ctx);
          break;
        case 'listmembers':
          const managedContract = await this.getManagedContract(chatIdNormalized);
          if (!managedContract) {
            return ctx.editMessageText("Error: Could not find managed contract", {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          }

          let membersLength = await managedContract.getSize();
          let members = [];
          for (let i = 0; i < membersLength; i++) {
            let member = await managedContract.userIds(i);
            members.push(member);
          }

          message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
          if (membersLength > 0) {
            message += `Members (${membersLength}):\n`;
            members.forEach((member, index) => {
              message += `${index + 1}. ${member}\n`;
            });
          } else {
            message += `No members found`;
          }

          return ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
            }
          });
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
          const zonedContract = await this.getZonedContract(chatIdNormalized);
          if (!zonedContract) {
            return ctx.editMessageText("This holon does not have zoned functionality", {
              reply_markup: {
                inline_keyboard: [[{ text: "◀️ Back", callback_data: "holons_back" }]]
              }
            });
          }
          await this.showZones(ctx);
          break;
        case 'manage_splitter':
          await ctx.scene.enter('splitter_scene');
          break;
        case 'manage_members':
          await ctx.scene.enter('member_management_scene');
          break;
        case 'manage_zones': // This case is now handled by holons_manage_zones specific handler
          // await this.showZoneManagementView(ctx);
          // Fallback or remove if direct specific handler is preferred
          break;
        case 'manage_unified': // Added case for the new unified management menu
          try {
            await this.showUnifiedManagementMenu(ctx, true);
          } catch (error) {
            if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
              console.log('Message not modified, already showing unified management menu.');
              // Optionally, answer callback query to remove loading animation from button
              if (ctx.callbackQuery) await ctx.answerCbQuery();
            } else {
              throw error; // Re-throw other errors
            }
          }
          break;
        case 'back':
          await this.showHolonsMenu(ctx, true);
          break;
        default:
          await ctx.reply("Unknown action");
      }
    });

    // Add new unified management callbacks
    this.bot.action('manage_unified_menu', async (ctx) => {
      await ctx.answerCbQuery();
      try {
        await this.showUnifiedManagementMenu(ctx, true);
      } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
          console.log('Message not modified, already showing unified management menu.');
          if (ctx.callbackQuery) await ctx.answerCbQuery();
        } else {
          throw error;
        }
      }
    });

    this.bot.action('manage_zones_view', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showZoneManagementView(ctx);
    });

    this.bot.action('manage_members_view', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showMemberManagementView(ctx);
    });

    this.bot.action(/zone_member_(.+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const [memberId, zoneNumberStr] = ctx.match.slice(1);
      const zoneNumber = parseInt(zoneNumberStr, 10);

      // Determine interacting user's zone to limit upward moves
      let senderZone = 5; // default lowest
      try {
        const chatID = utils.getChatId(ctx);
        const zonedContract = await this.getZonedContract(`chat_${Math.abs(chatID)}`);
        const senderUserId = utils.getUserId(ctx).toString();
        const senderSolidityZone = Number(await zonedContract.zone(senderUserId));
        senderZone = this.invertZone(senderSolidityZone);
      } catch (e) {
        console.error("Error fetching sender zone:", e.message);
      }

      const actionRow = [];
      if (zoneNumber > 0 && zoneNumber - 1 >= senderZone) {
        actionRow.push({ text: "⬆️ Move Up", callback_data: `confirm_move_${memberId}_${zoneNumber - 1}` });
      }
      if (zoneNumber < 5) {
        actionRow.push({ text: "⬇️ Move Down", callback_data: `confirm_move_${memberId}_${zoneNumber + 1}` });
      }

      const keyboard = [
        actionRow.length ? actionRow : [{ text: "🚫 No higher zone", callback_data: "noop" }],
        [{ text: "➖ Remove from Zone", callback_data: `remove_from_zone_${memberId}_${zoneNumber}` }],
        [{ text: "◀️ Back to Zones", callback_data: "manage_zones_view" }]
      ];
      await ctx.editMessageText(
        `Select action for @${memberId} (Zone ${zoneNumber}):`,
        { reply_markup: { inline_keyboard: keyboard } }
      ).catch(err => {
        console.error("Error editing message:", err);
      });
    });

    // Remove from zone handler (moves member to zone 5)
    this.bot.action(/remove_from_zone_(.+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const [memberId] = ctx.match.slice(1);
      const targetZone = 5;
      await ctx.editMessageText(`Removing member from current zone ...`);
      try {
        const chatID = utils.getChatId(ctx);
        const zonedContract = await this.getZonedContract(`chat_${Math.abs(chatID)}`);
        const solidityZone = this.invertZone(targetZone);
        const tx = await this.executeTransaction(
          zonedContract,
          'addToZone',
          [memberId, solidityZone]
        );
        this.waitForTransaction(tx, ctx, `Moved member to zone ${targetZone}`);
      } catch (error) {
        console.error("Error removing from zone:", error);
        await ctx.editMessageText(`Failed: ${error.message}`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_zones_view" }]] }
        });
        return;
      }
      setTimeout(() => this.showZoneManagementView(ctx), 2000);
    });

    this.bot.action(/member_action_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const memberId = ctx.match[1];
      // Show actions for the specific member
      const keyboard = [
        [
          { text: "➡️ Move to Zone", callback_data: `move_member_${memberId}` },
          { text: "➖ Remove Member", callback_data: `remove_member_${memberId}` }
        ],
        [{ text: "◀️ Back to Members", callback_data: "manage_members_view" }]
      ];
      await ctx.editMessageText(
        "Select action for member:",
        { reply_markup: { inline_keyboard: keyboard } }
      );
    });

    // Add handlers for member actions
    this.bot.action(/move_member_(.+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const memberId = ctx.match[1];
      const keyboard = [];
      // Create zone selection buttons
      for (let i = 0; i <= 5; i++) {
        keyboard.push([{
          text: `Move to Zone ${i}`,
          callback_data: `confirm_move_${memberId}_${i}`
        }]);
      }
      keyboard.push([{ text: "◀️ Back", callback_data: "manage_members_view" }]);
      await ctx.editMessageText(
        "Select target zone:",
        { reply_markup: { inline_keyboard: keyboard } }
      );
    });

    this.bot.action(/confirm_move_(.+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const [memberId, zoneNumber] = ctx.match.slice(1);
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      const senderUserId = utils.getUserId(ctx).toString();
      try {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        const solidityZone = this.invertZone(parseInt(zoneNumber));

        await ctx.editMessageText(`Moving member to zone ${zoneNumber}...`);

        const tx = await this.executeTransaction(
          zonedContract,
          'addToZone',
          [senderUserId, memberId, solidityZone]
        );

        this.waitForTransaction(
          tx,
          ctx,
          `Successfully moved member to zone ${zoneNumber}`
        );

        // Return to zone view after a short delay
        setTimeout(() => this.showZoneManagementView(ctx), 2000);
      } catch (error) {
        console.error("Error moving member:", error);
        await ctx.editMessageText(
          `Failed to move member: ${error.message}`,
          { reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_zones_view" }]] } }
        );
      }
    });

    // Add handler for the unified management menu
    this.bot.action('holons_manage_unified', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showUnifiedManagementMenu(ctx, true);
    });

    // Simple no-operation handler for disabled buttons
    this.bot.action('noop', async (ctx) => {
      await ctx.answerCbQuery();
    });

    // Handler for holons_manage_zones button
    this.bot.action('holons_manage_zones', async (ctx) => {
      await ctx.answerCbQuery();
      // try-catch block for showZoneManagementView if it might also face similar issues
      try {
        await this.showZoneManagementView(ctx);
      } catch (error) {
        if (error.response && error.response.error_code === 400 && error.response.description.includes('message is not modified')) {
          console.log('Message not modified, already showing zone management view.');
          if (ctx.callbackQuery) await ctx.answerCbQuery();
        } else {
          throw error;
        }
      }
    });

    // Update callback for the button previously labeled "Move to Zone"
    this.bot.action('manage_assign_zone', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.scene.enter('assign_member_to_zone_scene');
    });

    // Handler for individual member move actions (Up/Down within zones)
    // This uses the renamed contract function `addToZone` directly
    this.bot.action(/confirm_move_(.+)_(\d+)/, async (ctx) => {
      await ctx.answerCbQuery();
      const [memberId, zoneNumberStr] = ctx.match.slice(1);
      const zoneNumber = parseInt(zoneNumberStr);
      const chatID = utils.getChatId(ctx);
      const chatIdNormalized = `chat_${Math.abs(chatID)}`;
      const senderUserId = utils.getUserId(ctx).toString();

      try {
        const zonedContract = await this.getZonedContract(chatIdNormalized);
        const solidityZone = this.invertZone(zoneNumber); // zoneNumber is already the target human-readable zone

        await ctx.editMessageText(`Moving @${memberId} to zone ${zoneNumber}...`);

        const tx = await this.executeTransaction(
          zonedContract,
          'addToZone', // Using the renamed contract function
          [senderUserId, memberId, solidityZone]
        );

        this.waitForTransaction(
          tx,
          ctx,
          `Successfully moved @${memberId} to zone ${zoneNumber}`
        );

        setTimeout(() => this.showZoneManagementView(ctx), 2000);
      } catch (error) {
        console.error("Error moving member:", error);
        await ctx.editMessageText(
          `Failed to move member: ${error.message}`,
          { reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_zones_view" }]] } }
        );
      }
    });

    // Update Remove from zone handler to use the renamed contract function addToZone (to move to zone 5)
    this.bot.action(/remove_from_zone_(.+)_(\d+)/, async (ctx) => {
      const senderUserId = utils.getUserId(ctx).toString();
      await ctx.answerCbQuery();
      const [memberId] = ctx.match.slice(1);
      const targetHumanZone = 5; // Moving to the lowest human-readable zone
      await ctx.editMessageText(`Removing @${memberId} from current zone (moving to Zone 5)...`);
      try {
        const chatID = utils.getChatId(ctx);
        const zonedContract = await this.getZonedContract(`chat_${Math.abs(chatID)}`);
        const solidityZone = this.invertZone(targetHumanZone);
        const tx = await this.executeTransaction(
          zonedContract,
          'addToZone', // Using the renamed contract function
          [senderUserId, memberId, solidityZone]
        );
        this.waitForTransaction(tx, ctx, `Successfully moved @${memberId} to zone ${targetHumanZone}`);
      } catch (error) {
        console.error("Error removing from zone:", error);
        await ctx.editMessageText(`Failed: ${error.message}`, {
          reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_zones_view" }]] }
        });
        return;
      }
      setTimeout(() => this.showZoneManagementView(ctx), 2000);
    });
  }

  async showHolonsMenu(ctx, edit = false) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;

    // Check if a holon bundle exists for this chat
    let splitterContract = null;
    let holonFlavor = "";
    let isZonedHolon = false;

    try {
      splitterContract = await this.getSplitterContract(chatIdNormalized);
      if (splitterContract) {
        // Get the Managed and Zoned contracts
        const managedContract = await this.getManagedContract(chatIdNormalized);
        const zonedContract = await this.getZonedContract(chatIdNormalized);

        if (managedContract) {
          holonFlavor = "Managed";
        }
        if (zonedContract) {
          isZonedHolon = true;
          holonFlavor += holonFlavor ? "/Zoned" : "Zoned";
        }
      }
    } catch (error) {
      console.error("Error checking holon bundle:", error);
    }

    const holonExists = splitterContract !== null && splitterContract.target !== '0x0000000000000000000000000000000000000000';

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
        ],
        [
          { text: "💱 Manage Splitter", callback_data: "holons_manage_splitter" },
          { text: "👥 Manage Members", callback_data: "holons_manage_members" }
        ]
      );

      // Only show zone-related buttons if the holon has Zoned functionality
      if (isZonedHolon) {
        menuMarkup.reply_markup.inline_keyboard.push(
          [
            { text: "🔍 Show Zones", callback_data: "holons_zones" },
            { text: "🔶 Manage Zones", callback_data: "holons_manage_zones" }
          ]
        );
      }
    }

    // Create a more prominent message with the holon address at the top
    let message;
    if (holonExists) {
      message = `🔷 HOLON ADDRESS 🔷\n\`${splitterContract.target}\`\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
      message += `Type: ${holonFlavor}\n`;
      message += `Network: ${this.network}\n`;
      message += `\nSelect an action from the menu below:`;
    } else {
      message = "No holon exists for this chat yet.\n\nCreate a new holon using the buttons below.";
    }

    // Add the unified management option to the menu
    if (holonExists) {
      menuMarkup.reply_markup.inline_keyboard.push(
        [
          { text: "⚙️ Manage Holon", callback_data: "holons_manage_unified" }
        ]
      );
    }

    if (edit) {
      return ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...menuMarkup
      }).catch(e => console.log('Error editing holons menu:', e));
    } else {
      return ctx.reply(message, {
        parse_mode: 'Markdown',
        ...menuMarkup
      }).catch(e => console.log('Error showing holons menu:', e));
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
    // Format scores to ensure they're integers
    let scores = users.map((user) => {
      const score = Math.floor(
        user.initiated.length * equation.initiated +
        user.completed.length * equation.completed +
        user.sent * equation.sent +
        user.received * equation.received +
        user.hours * equation.hours +
        user.collaboration * equation.collaboration +
        user.wants.length * equation.wants +
        user.offers.length * equation.offers
      );
      // Return as BigNumber
      return ethers.toBigInt(score).toString();
    });

    // let address = await this.holonsContract.toAddress(chatID.toString());

    const holonName = `chat_${Math.abs(chatID)}`;
    let holon = await this.getManagedContract(holonName);

    console.log("User IDs:", userids);
    console.log("Scores (formatted):", scores.map(s => s.toString()));

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

      data = holon.interface.encodeFunctionData('setAppreciation', [userids, scores]);
      // console.log("Wallet address:", await this.wallet.getAddress());
      // console.log("Wallet provider type:", this.wallet.provider.constructor.name);
      // console.log("Holon target: ", holon.target);
      // console.log("Encoded data:", data);

      // Technical debt #2 - modularize
      const tx = {
        to: holon.target,
        data: holon.interface.encodeFunctionData("setAppreciation", [userids, scores]),
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
        console.log("ZonedContract addMembers expected parameters:", 
        addMembersFuncInfo.inputs.map(i => `${i.name}: ${i.type}`));
      } else {
        console.log("WARNING: addMembers function not found in Zoned contract ABI!");
        // It's possible the function is named addHolons or similar, let's check for that if addMembers isn't found
        // For now, we assume 'addMembers' based on the user's provided error context for Zoned Holon.
      }

      // Ensure arguments are correctly structured as an array for encodeFunctionData
      const args = [userID.toString(), holonIdsToAddArray];
      console.log("Arguments for encodeFunctionData: senderUserID, holonIDsArray", args);

      const data = holonAddressZoned.interface.encodeFunctionData('addMembers', args);

      console.log("data before sending: ", data);
      console.log("zoned holon address before sending: ", holonAddressZoned.target);

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
      console.log("Zoned contracts: ", holon);

      // Debugging  
      // Log ABI functions
      console.log("Contract ABI Functions:");
      if (holon.interface && holon.interface.fragments) {
        holon.interface.fragments.forEach(fragment => {
          if (fragment.type === 'function') {
            console.log(`- ${fragment.name}(${fragment.inputs.map(input => `${input.type} ${input.name}`).join(', ')})`);
          }
        });
      } else {
        console.log("ABI interface not available or in unexpected format");
      }
      // Debugging  
      let holonAddress = holon.target;
      if (holonAddress === '0x0000000000000000000000000000000000000000') {
        return ctx.reply("No holon exists for this chat");
      }
      console.log("Actual zoned contract: ", holonAddress);

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
          console.log(`Zone ${i} members from the contract:`, members);
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
      console.log("splitterConract from getZonedContract: ", splitterContract.target);
      // console.log("from getZonedContract: splitter contract", splitterContract);

      if (!splitterContract) {
        console.log('getZonedContract, zoned is not initialized');
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
      console.log("Contract is null or undefined.");
      return;
    }

    console.log("Contract ABI:");
    console.log(contract.interface.format(ethers.FormatTypes.json)); // Corrected line

    console.log("\nContract Functions:");
    for (const functionName of Object.keys(contract.interface.functions)) {
      console.log(functionName);
    }

    console.log("\nContract Events:");
    for (const eventName of Object.keys(contract.interface.events)) {
      console.log(eventName);
    }

    console.log("\nContract Errors:");
    for (const errorName of Object.keys(contract.interface.errors)) {
      console.log(errorName);
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
      console.log("splitter contract address: ", splitterContract.target)
      console.log("managedContractAddress: ", managedContractAddress);
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
      console.log("❌ Error: Invalid input format. Ensure you provide pairs like 'internal 10 external 90'.");
      // Throw an error instead of replying, so handleSetSplitCommand can catch it
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
        console.log("❌ Error: Invalid format. Found non-number percentage or missing tag.");
        throw new Error("Invalid format. Found non-number percentage or missing tag.");
        // return ctx.reply("❌ Error: Invalid format. Make sure both internal and external are followed by numbers.");
      }

      if (key === 'internal' || key === 'external') {
        data[key] = value;
      } else {
        // Handle unexpected tags if necessary, or ignore
        console.log(`❓ Warning: Ignoring unknown tag '${key}'.`);
      }
    }

    // Check both keys exist
    if (typeof data.internal !== 'number' || typeof data.external !== 'number') {
      console.log("❌ Error: Both 'internal' and 'external' values must be provided.");
      throw new Error("Both 'internal' and 'external' values must be provided.");
      // return ctx.reply("❌ Error: Both 'internal' and 'external' values must be provided.");
    }

    // Check sum == 100
    if (data.internal + data.external !== 100) {
      const errorMsg = `The sum must be 100. You provided internal ${data.internal}% and external ${data.external}%.`;
      console.log(`❌ Error: ${errorMsg}`);
      throw new Error(errorMsg); // Throw error
      // return ctx.reply(`❌ Error: ${errorMsg}`);
    }

    // ✅ All good - Instead of replying, return the data or a success indicator
    // We let handleSetSplitCommand handle the reply.
    console.log(`✅ Split validated successfully for chat ${chatID || 'unknown'}! Internal: ${data.internal}%, External: ${data.external}%`);
    // Optionally return the validated data if needed elsewhere
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
      console.log(`User with tag ${tag} not found`);
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
    console.log("Parsed command arguments:", { senderTag, userTag, zoneStr });
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
        console.log(`User with tag ${userTag} not found`);
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
      console.log("chatID from /claim: ", chatID);
      const holonName = `chat_${Math.abs(chatID)}`;
      let holon = await this.getManagedContract(holonName);
      // console.log("holonAddress from /claim: ", holon);
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

      console.log("Claiming for userID:", userID.toString());
      console.log("Beneficiary address:", beneficiaryAddress);

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

  async showUnifiedManagementMenu(ctx, edit = false) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;
    let spliterAddress = (await this.getSplitterContract(chatIdNormalized)).target;

    try {
      // Get both managed and zoned contracts
      const managedContract = await this.getManagedContract(chatIdNormalized);
      const zonedContract = await this.getZonedContract(chatIdNormalized);

      if (!managedContract) {
        return ctx.reply("Error: Could not find managed contract");
      }

      // Get all members
      let membersLength = await managedContract.getSize();
      let members = [];
      for (let i = 0; i < membersLength; i++) {
        let member = await managedContract.userIds(i);
        members.push(member);
      }

      // Get zone information if available
      let zones = [];
      if (zonedContract) {
        const zoneCount = Number(await zonedContract.nzones());
        for (let i = zoneCount; i >= 0; i--) {
          const zoneMembers = await zonedContract.getZoneMembers(i);
          zones.push({
            zone: this.invertZone(i),
            members: zoneMembers
          });
        }
      }

      // Create the base message
      let message = `🔷 HOLON MANAGEMENT 🔷\n\`${spliterAddress}\`\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Create keyboard layout
      const keyboard = [];

      // Add zone management section if zoned contract exists
      if (zonedContract) {
        keyboard.push([{ text: "🔶 Zone Management", callback_data: "manage_zones_view" }]);
        keyboard.push([{ text: "👥 Member Management", callback_data: "manage_members_view" }]);
      } else {
        keyboard.push([{ text: "👥 Member Management", callback_data: "manage_members_view" }]);
      }

      // Add action buttons
      keyboard.push([
        { text: "➕ Add Member", callback_data: "manage_add_member" },
        { text: "➖ Remove Member", callback_data: "manage_remove_member" }
      ]);

      if (zonedContract) {
        keyboard.push([
          { text: "➡️ Move to Zone", callback_data: "manage_move_zone" },
          { text: "➕ Add to Zone", callback_data: "manage_add_zone" }
        ]);
      }

      keyboard.push([{ text: "◀️ Back to Menu", callback_data: "holons_back" }]);

      if (edit) {
        return ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      } else {
        return ctx.reply(message, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard }
        });
      }
    } catch (error) {
      console.error("Error showing unified management menu:", error);
      return ctx.reply("Error showing management menu: " + error.message);
    }
  }

  async showZoneManagementView(ctx) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;

    try {
      const zonedContract = await this.getZonedContract(chatIdNormalized);
      if (!zonedContract) {
        return ctx.editMessageText("This holon does not have zoned functionality", {
          reply_markup: {
            inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_unified_menu" }]]
          }
        });
      }

      const zoneCount = Number(await zonedContract.nzones());
      const users = await this.db.getAll(chatID.toString() + '/users');
      const userMap = users.reduce((map, user) => {
        map[user.id] = user.username;
        return map;
      }, {});

      let message = "🔶 Zone Management\n\n";
      const keyboard = [];

      // Build keyboard: header row followed by member rows for each zone
      for (let i = 0; i <= 5; i++) {
        const solidityZone = this.invertZone(i);
        const zoneMembers = await zonedContract.getZoneMembers(solidityZone);

        // Zone header first
        keyboard.push([{ text: `Zone ${i} (${zoneMembers.length})`, callback_data: `zone_header_${i}` }]);

        // Member buttons in rows of 2
        const memberButtons = zoneMembers.map(memberId => ({
          text: `@${userMap[memberId] || memberId}`,
          callback_data: `zone_member_${memberId}_${i}`
        }));
        for (let j = 0; j < memberButtons.length; j += 2) {
          keyboard.push(memberButtons.slice(j, j + 2));
        }
      }

      // Action buttons
      keyboard.push([
        { text: "➕ Add to Zone", callback_data: "manage_add_zone" },
        { text: "➡️ Move to Zone", callback_data: "manage_move_zone" }
      ]);
      keyboard.push([{ text: "◀️ Back to Management", callback_data: "manage_unified_menu" }]);

      // Action buttons - update callback_data for "Move to Zone"
      keyboard.push([
        { text: "➕ Add to Zone (Tag)", callback_data: "manage_add_zone_tag" }, // If still keeping tag-based add
        { text: "➡️ Assign to Zone (Addr)", callback_data: "manage_assign_zone" }
      ]);

      return ctx.editMessageText(message, {
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error("Error showing zone management view:", error);
      return ctx.editMessageText("Error showing zones: " + error.message, {
        reply_markup: {
          inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_unified_menu" }]]
        }
      });
    }
  }

  async showMemberManagementView(ctx) {
    const chatID = utils.getChatId(ctx);
    const chatIdNormalized = `chat_${Math.abs(chatID)}`;

    try {
      const managedContract = await this.getManagedContract(chatIdNormalized);
      if (!managedContract) {
        return ctx.editMessageText("Error: Could not find managed contract", {
          reply_markup: {
            inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_unified_menu" }]]
          }
        });
      }

      let membersLength = await managedContract.getSize();
      let members = [];
      for (let i = 0; i < membersLength; i++) {
        let member = await managedContract.userIds(i);
        members.push(member);
      }

      const users = await this.db.getAll(chatID.toString() + '/users');
      const userMap = users.reduce((map, user) => {
        map[user.id] = user.username;
        return map;
      }, {});

      let message = "👥 Member Management\n\n";
      const keyboard = [];

      // Add member buttons in rows of 2
      for (let i = 0; i < members.length; i += 2) {
        const row = members.slice(i, i + 2).map(member => ({
          text: `@${userMap[member] || member}`,
          callback_data: `member_action_${member}`
        }));
        keyboard.push(row);
      }

      // Add action buttons
      keyboard.push([
        { text: "➕ Add Member", callback_data: "manage_add_member" },
        { text: "➖ Remove Member", callback_data: "manage_remove_member" }
      ]);
      keyboard.push([{ text: "◀️ Back to Management", callback_data: "manage_unified_menu" }]);

      return ctx.editMessageText(message, {
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      console.error("Error showing member management view:", error);
      return ctx.editMessageText("Error showing members: " + error.message, {
        reply_markup: {
          inline_keyboard: [[{ text: "◀️ Back", callback_data: "manage_unified_menu" }]]
        }
      });
    }
  }
}
