/**
 * @fileoverview 8 Forms of Capital game for community economic simulation.
 * @module src/CapitalGame
 */

import { Markup } from 'telegraf';

/**
 * Interactive game simulating the 8 Forms of Capital economic model.
 *
 * @class CapitalGame
 * @description A multiplayer game where players manage 8 types of capital
 * (financial, social, cultural, material, living, intellectual, spiritual,
 * experiential) through transformations, trades, and community goal contributions.
 * Supports multiple victory conditions: individual, balanced, and community.
 */
class CapitalGame {
    constructor(bot, settings) {
        this.bot = bot;
        this.settings = settings;
        this.games = new Map(); // Store active games by holonId
        this.pendingTrades = new Map(); // Store pending trade states

        // Capital types for reference
        this.capitalTypes = ['financial', 'social', 'cultural', 'material', 'living', 'intellectual', 'spiritual', 'experiential'];

        // Register commands
        this.bot.command('capital', (ctx) => this.startGame(ctx));
        this.bot.command('status', (ctx) => this.handleShowStatus(ctx));
        this.bot.command('endgame', (ctx) => this.endGame(ctx));

        // Register action handlers for inline buttons
        this.bot.action('join_game', (ctx) => this.joinGame(ctx));
        this.bot.action('start_round', (ctx) => this.startRound(ctx));

        // Menu navigation
        this.bot.action('menu_transform', (ctx) => this.showTransformMenu(ctx));
        this.bot.action('menu_trade', (ctx) => this.showTradeMenu(ctx));
        this.bot.action('menu_goals', (ctx) => this.showGoalsMenu(ctx));
        this.bot.action('back_to_main', (ctx) => this.backToMainMenu(ctx));
        this.bot.action('noop', (ctx) => ctx.answerCbQuery());

        // Transformation handlers
        this.bot.action(/transform_(.+)/, (ctx) => this.handleTransformation(ctx));

        // Trade flow handlers
        this.bot.action(/trade_select_(.+)/, (ctx) => this.handleTradeSelectCapital(ctx));
        this.bot.action(/trade_target_(.+)/, (ctx) => this.handleTradeSelectTarget(ctx));
        this.bot.action(/trade_request_(.+)/, (ctx) => this.handleTradeSelectRequest(ctx));
        this.bot.action(/trade_confirm_(.+)/, (ctx) => this.handleTradeConfirm(ctx));
        this.bot.action(/trade_accept_(.+)/, (ctx) => this.handleTradeAccept(ctx));
        this.bot.action(/trade_decline_(.+)/, (ctx) => this.handleTradeDecline(ctx));
        this.bot.action('trade_cancel', (ctx) => this.handleTradeCancel(ctx));

        // Goal flow handlers
        this.bot.action(/goal_select_(.+)/, (ctx) => this.handleGoalSelect(ctx));
        this.bot.action(/goal_contribute_(.+)/, (ctx) => this.handleGoalContribution(ctx));
        this.bot.action('goal_cancel', (ctx) => this.handleGoalCancel(ctx));

        // Info handlers
        this.bot.action('show_status', (ctx) => this.handleShowStatus(ctx));
        this.bot.action('show_rules', (ctx) => this.handleShowRules(ctx));
    }

    shuffleEvents() {
        const events = [
            { name: 'Economic Downturn', effect: { type: 'financial', amount: -2 }, description: 'Market instability affects everyone' },
            { name: 'Cultural Festival', effect: { type: 'cultural', amount: 2 }, description: 'A celebration brings the community together' },
            { name: 'Environmental Challenge', effect: { type: 'living', amount: -1 }, description: 'Natural resources become scarce' },
            { name: 'Knowledge Sharing', effect: { type: 'intellectual', amount: 2 }, description: 'A wise teacher visits the community' },
            { name: 'Social Gathering', effect: { type: 'social', amount: 2 }, description: 'Community bonds strengthen' },
            { name: 'Spiritual Awakening', effect: { type: 'spiritual', amount: 2 }, description: 'A moment of collective reflection' },
            { name: 'Material Abundance', effect: { type: 'material', amount: 2 }, description: 'Resources become plentiful' },
            { name: 'Adventure Opportunity', effect: { type: 'experiential', amount: 2 }, description: 'New experiences await' }
        ];

        // Fisher-Yates shuffle
        for (let i = events.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [events[i], events[j]] = [events[j], events[i]];
        }

        return events;
    }

    async startGame(ctx) {
        const holonId = ctx.chat.id;

        if (this.games.has(holonId)) {
            return ctx.reply('A game is already in progress in this chat! Use /endgame to end it first.');
        }

        const game = {
            players: new Map(),
            currentPlayer: null,
            communityGoals: this.generateCommunityGoals(),
            events: this.shuffleEvents(),
            round: 1,
            status: 'waiting' // waiting, active, completed
        };

        this.games.set(holonId, game);

        const markup = Markup.inlineKeyboard([
            [Markup.button.callback('Join Game', 'join_game')],
            [Markup.button.callback('Start Round', 'start_round')]
        ]);

        ctx.reply(
            '8 Forms of Capital Game\n\n' +
            'A multiplayer economic simulation where you manage 8 types of capital:\n' +
            'Financial, Social, Cultural, Material, Living, Intellectual, Spiritual, Experiential\n\n' +
            'Victory Conditions:\n' +
            '- Individual: Get 30 of any capital\n' +
            '- Balanced: All players have 5+ of each capital\n' +
            '- Community: Complete all 3 goals\n\n' +
            'Waiting for players to join... (minimum 2 players)',
            markup
        );
    }

    async joinGame(ctx) {
        console.log('[CapitalGame] joinGame called');
        try {
            const holonId = ctx.chat.id;
            const userId = ctx.from.id;
            const game = this.games.get(holonId);
            console.log('[CapitalGame] holonId:', holonId, 'userId:', userId, 'game exists:', !!game);

            if (!game) {
                return ctx.answerCbQuery('No game is currently active. Start a new game with /capital.');
            }

            if (game.status !== 'waiting') {
                return ctx.answerCbQuery('Game already in progress! Wait for the next game.');
            }

            if (game.players.has(userId)) {
                return ctx.answerCbQuery('You have already joined the game.');
            }

            const capitals = this.generateInitialCapital();
            game.players.set(userId, {
                username: ctx.from.username || ctx.from.first_name,
                capitals
            });

            const playerList = Array.from(game.players.values()).map(p => p.username).join(', ');

            await ctx.answerCbQuery('You joined the game!');
            await this.bot.telegram.sendMessage(
                holonId,
                `${ctx.from.first_name} joined the game!\n\nPlayers: ${playerList} (${game.players.size} total)`
            );
        } catch (error) {
            console.error('[CapitalGame] joinGame error:', error);
        }
    }

    async startRound(ctx) {
        const holonId = ctx.chat.id;
        const game = this.games.get(holonId);

        if (!game) {
            return ctx.answerCbQuery('No game active. Start one with /capital');
        }

        if (game.status !== 'waiting') {
            return ctx.answerCbQuery('Game already in progress!');
        }

        if (game.players.size < 2) {
            return ctx.answerCbQuery('At least 2 players are required!');
        }

        game.status = 'active';
        game.currentPlayer = Array.from(game.players.keys())[0];

        await ctx.answerCbQuery('Game started!');
        await this.bot.telegram.sendMessage(holonId, 'The game has started! Round 1 begins now.');
        this.showPlayerTurnOptions(holonId);
    }

    generateInitialCapital() {
        // 8 profiles, each emphasizing a different capital type
        const profiles = [
            // Financial focus - The Entrepreneur
            { financial: 6, social: 2, cultural: 2, material: 3, living: 2, intellectual: 2, spiritual: 1, experiential: 2 },
            // Social focus - The Networker
            { financial: 2, social: 6, cultural: 3, material: 2, living: 2, intellectual: 2, spiritual: 2, experiential: 1 },
            // Cultural focus - The Artist
            { financial: 2, social: 3, cultural: 6, material: 1, living: 2, intellectual: 2, spiritual: 3, experiential: 1 },
            // Material focus - The Builder
            { financial: 3, social: 2, cultural: 1, material: 6, living: 3, intellectual: 2, spiritual: 1, experiential: 2 },
            // Living focus - The Steward
            { financial: 1, social: 2, cultural: 2, material: 3, living: 6, intellectual: 2, spiritual: 2, experiential: 2 },
            // Intellectual focus - The Scholar
            { financial: 2, social: 2, cultural: 2, material: 1, living: 2, intellectual: 6, spiritual: 2, experiential: 3 },
            // Spiritual focus - The Sage
            { financial: 1, social: 3, cultural: 3, material: 1, living: 2, intellectual: 2, spiritual: 6, experiential: 2 },
            // Experiential focus - The Adventurer
            { financial: 2, social: 2, cultural: 2, material: 2, living: 3, intellectual: 2, spiritual: 1, experiential: 6 }
        ];

        return { ...profiles[Math.floor(Math.random() * profiles.length)] };
    }

    generateCommunityGoals() {
        const allGoals = [
            {
                name: 'Community Center',
                requirements: { social: 8, material: 5, financial: 4 },
                progress: {}
            },
            {
                name: 'Local Market',
                requirements: { financial: 7, social: 5, cultural: 3 },
                progress: {}
            },
            {
                name: 'Education Program',
                requirements: { intellectual: 7, experiential: 5, social: 3 },
                progress: {}
            },
            {
                name: 'Nature Reserve',
                requirements: { living: 7, spiritual: 4, material: 4 },
                progress: {}
            },
            {
                name: 'Arts Festival',
                requirements: { cultural: 7, social: 4, experiential: 4 },
                progress: {}
            },
            {
                name: 'Wisdom Circle',
                requirements: { spiritual: 6, intellectual: 5, social: 4 },
                progress: {}
            }
        ];

        // Shuffle and pick 3
        for (let i = allGoals.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allGoals[i], allGoals[j]] = [allGoals[j], allGoals[i]];
        }

        return allGoals.slice(0, 3);
    }

    getTransformationRules() {
        return {
            'experiential_financial': { cost: 2, gain: 3, name: 'Workshop' },
            'social_intellectual': { cost: 3, gain: 2, name: 'Collaboration' },
            'cultural_spiritual': { cost: 2, gain: 3, name: 'Ritual' },
            'material_financial': { cost: 3, gain: 4, name: 'Trade Goods' },
            'financial_material': { cost: 4, gain: 5, name: 'Investment' },
            'living_experiential': { cost: 2, gain: 3, name: 'Nature Immersion' },
            'intellectual_cultural': { cost: 3, gain: 4, name: 'Creative Work' },
            'spiritual_social': { cost: 2, gain: 3, name: 'Community Building' },
            'social_experiential': { cost: 2, gain: 2, name: 'Group Adventure' },
            'intellectual_financial': { cost: 3, gain: 3, name: 'Consulting' },
            'cultural_social': { cost: 2, gain: 2, name: 'Cultural Event' },
            'material_living': { cost: 3, gain: 2, name: 'Garden Project' }
        };
    }

    // ================== TRANSFORMATION HANDLERS ==================

    async handleTransformation(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);
        const [fromCapital, toCapital] = ctx.match[1].split('_');

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const player = game.players.get(userId);
        const rules = this.getTransformationRules();
        const rule = rules[`${fromCapital}_${toCapital}`];

        if (!rule) {
            return ctx.answerCbQuery('Invalid transformation.');
        }

        if (player.capitals[fromCapital] < rule.cost) {
            return ctx.answerCbQuery(`Need ${rule.cost} ${fromCapital}!`);
        }

        // Apply transformation
        player.capitals[fromCapital] -= rule.cost;
        player.capitals[toCapital] += rule.gain;

        await ctx.answerCbQuery('Transformation complete!');
        await ctx.editMessageText(
            `${rule.name} Transformation Complete!\n\n` +
            `Spent: ${rule.cost} ${fromCapital}\n` +
            `Gained: ${rule.gain} ${toCapital}`
        );

        this.moveToNextPlayer(holonId);
    }

    // ================== TRADE HANDLERS ==================

    async handleTradeSelectCapital(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);
        const offerCapital = ctx.match[1];

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const player = game.players.get(userId);
        if (player.capitals[offerCapital] < 2) {
            return ctx.answerCbQuery(`Need at least 2 ${offerCapital} to trade!`);
        }

        // Store pending trade state
        const tradeKey = `${holonId}_${userId}`;
        this.pendingTrades.set(tradeKey, {
            offerCapital,
            step: 'select_target'
        });

        // Show target player selection
        const otherPlayers = Array.from(game.players.entries())
            .filter(([id]) => id !== userId);

        if (otherPlayers.length === 0) {
            return ctx.answerCbQuery('No other players to trade with!');
        }

        const buttons = otherPlayers.map(([id, p]) =>
            Markup.button.callback(p.username, `trade_target_${id}`)
        );
        buttons.push(Markup.button.callback('Cancel', 'trade_cancel'));

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `Trading: ${offerCapital} (you have ${player.capitals[offerCapital]})\n\n` +
            `Select player to trade with:`,
            Markup.inlineKeyboard(this.chunk(buttons, 2))
        );
    }

    async handleTradeSelectTarget(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const targetUserId = parseInt(ctx.match[1]);
        const tradeKey = `${holonId}_${userId}`;
        const pendingTrade = this.pendingTrades.get(tradeKey);
        const game = this.games.get(holonId);

        if (!pendingTrade) {
            return ctx.answerCbQuery('Trade expired. Start again.');
        }

        if (!game) {
            this.pendingTrades.delete(tradeKey);
            return ctx.answerCbQuery('Game not found.');
        }

        pendingTrade.targetUserId = targetUserId;
        pendingTrade.step = 'select_request';

        const targetPlayer = game.players.get(targetUserId);

        // Show capitals the target has (at least 1)
        const availableCapitals = this.capitalTypes.filter(c => targetPlayer.capitals[c] >= 1);

        const buttons = availableCapitals.map(capital =>
            Markup.button.callback(`${capital} (${targetPlayer.capitals[capital]})`, `trade_request_${capital}`)
        );
        buttons.push(Markup.button.callback('Cancel', 'trade_cancel'));

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `Trading ${pendingTrade.offerCapital} with ${targetPlayer.username}\n\n` +
            `What capital do you want in return?\n(You give 2, receive 1)`,
            Markup.inlineKeyboard(this.chunk(buttons, 2))
        );
    }

    async handleTradeSelectRequest(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const requestCapital = ctx.match[1];
        const tradeKey = `${holonId}_${userId}`;
        const pendingTrade = this.pendingTrades.get(tradeKey);
        const game = this.games.get(holonId);

        if (!pendingTrade || !game) {
            return ctx.answerCbQuery('Trade expired.');
        }

        const player = game.players.get(userId);
        const targetPlayer = game.players.get(pendingTrade.targetUserId);

        pendingTrade.requestCapital = requestCapital;
        pendingTrade.step = 'confirm';

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `Trade Confirmation\n\n` +
            `You give: 2 ${pendingTrade.offerCapital}\n` +
            `You receive: 1 ${requestCapital}\n` +
            `Trading with: ${targetPlayer.username}\n\n` +
            `${targetPlayer.username} must accept this trade.`,
            Markup.inlineKeyboard([
                [Markup.button.callback('Send Trade Request', `trade_confirm_${pendingTrade.targetUserId}`)],
                [Markup.button.callback('Cancel', 'trade_cancel')]
            ])
        );
    }

    async handleTradeConfirm(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const tradeKey = `${holonId}_${userId}`;
        const pendingTrade = this.pendingTrades.get(tradeKey);
        const game = this.games.get(holonId);

        if (!pendingTrade || !game) {
            return ctx.answerCbQuery('Trade expired.');
        }

        const player = game.players.get(userId);
        const targetPlayer = game.players.get(pendingTrade.targetUserId);

        // Create trade request with unique ID
        const tradeRequestId = `${holonId}_${Date.now()}`;
        this.pendingTrades.set(tradeRequestId, {
            ...pendingTrade,
            initiatorId: userId,
            holonId,
            status: 'pending_acceptance'
        });

        // Clear the initiator's pending trade
        this.pendingTrades.delete(tradeKey);

        await ctx.answerCbQuery('Trade request sent!');
        await ctx.editMessageText('Trade request sent! Waiting for acceptance...');

        // Send acceptance request to the group
        await this.bot.telegram.sendMessage(
            holonId,
            `Trade Request!\n\n` +
            `${player.username} wants to trade with ${targetPlayer.username}:\n` +
            `Offers: 2 ${pendingTrade.offerCapital}\n` +
            `Wants: 1 ${pendingTrade.requestCapital}\n\n` +
            `${targetPlayer.username}, do you accept?`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('Accept', `trade_accept_${tradeRequestId}`),
                    Markup.button.callback('Decline', `trade_decline_${tradeRequestId}`)
                ]
            ])
        );
    }

    async handleTradeAccept(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const tradeRequestId = ctx.match[1];
        const pendingTrade = this.pendingTrades.get(tradeRequestId);
        const game = this.games.get(holonId);

        if (!pendingTrade) {
            return ctx.answerCbQuery('Trade has expired.');
        }

        if (!game || game.status !== 'active') {
            this.pendingTrades.delete(tradeRequestId);
            return ctx.answerCbQuery('Game is no longer active.');
        }

        // Only the target player can accept
        if (userId !== pendingTrade.targetUserId) {
            return ctx.answerCbQuery('Only the trade recipient can accept!');
        }

        const initiator = game.players.get(pendingTrade.initiatorId);
        const target = game.players.get(pendingTrade.targetUserId);

        // Verify both players still have the required capitals
        if (initiator.capitals[pendingTrade.offerCapital] < 2) {
            this.pendingTrades.delete(tradeRequestId);
            await ctx.answerCbQuery('Trade failed!');
            return ctx.editMessageText('Trade cancelled: Initiator no longer has enough capital.');
        }
        if (target.capitals[pendingTrade.requestCapital] < 1) {
            this.pendingTrades.delete(tradeRequestId);
            await ctx.answerCbQuery('Trade failed!');
            return ctx.editMessageText('Trade cancelled: You no longer have enough capital.');
        }

        // Execute trade
        initiator.capitals[pendingTrade.offerCapital] -= 2;
        initiator.capitals[pendingTrade.requestCapital] += 1;
        target.capitals[pendingTrade.requestCapital] -= 1;
        target.capitals[pendingTrade.offerCapital] += 2;

        this.pendingTrades.delete(tradeRequestId);

        await ctx.answerCbQuery('Trade accepted!');
        await ctx.editMessageText(
            `Trade Completed!\n\n` +
            `${initiator.username} gave 2 ${pendingTrade.offerCapital}\n` +
            `${target.username} gave 1 ${pendingTrade.requestCapital}`
        );

        this.moveToNextPlayer(holonId);
    }

    async handleTradeDecline(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const tradeRequestId = ctx.match[1];
        const pendingTrade = this.pendingTrades.get(tradeRequestId);

        if (!pendingTrade) {
            return ctx.answerCbQuery('Trade has expired.');
        }

        // Either participant can decline
        if (userId !== pendingTrade.targetUserId && userId !== pendingTrade.initiatorId) {
            return ctx.answerCbQuery('Only trade participants can decline.');
        }

        this.pendingTrades.delete(tradeRequestId);

        await ctx.answerCbQuery('Trade declined.');
        await ctx.editMessageText('Trade was declined.');

        // Show turn options again (turn not consumed)
        this.showPlayerTurnOptions(holonId);
    }

    async handleTradeCancel(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const tradeKey = `${holonId}_${userId}`;

        this.pendingTrades.delete(tradeKey);

        await ctx.answerCbQuery('Trade cancelled.');
        await ctx.editMessageText('Trade cancelled.');

        this.showPlayerTurnOptions(holonId);
    }

    // ================== GOAL HANDLERS ==================

    async handleGoalSelect(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);
        const goalIndex = parseInt(ctx.match[1]);

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const goal = game.communityGoals[goalIndex];
        const player = game.players.get(userId);

        if (!goal) {
            return ctx.answerCbQuery('Invalid goal.');
        }

        if (this.isGoalComplete(goal)) {
            return ctx.answerCbQuery('This goal is already complete!');
        }

        // Show contribution options
        const buttons = [];
        for (const [capitalType, required] of Object.entries(goal.requirements)) {
            const currentProgress = goal.progress[capitalType] || 0;
            const remaining = required - currentProgress;
            const playerHas = player.capitals[capitalType];

            if (remaining > 0 && playerHas > 0) {
                // Offer 1, 2, or max
                const maxContribute = Math.min(playerHas, remaining);
                for (let amount = 1; amount <= Math.min(3, maxContribute); amount++) {
                    buttons.push(
                        Markup.button.callback(
                            `${amount} ${capitalType}`,
                            `goal_contribute_${goalIndex}_${capitalType}_${amount}`
                        )
                    );
                }
            }
        }

        if (buttons.length === 0) {
            return ctx.answerCbQuery('You cannot contribute to this goal.');
        }

        buttons.push(Markup.button.callback('Cancel', 'goal_cancel'));

        // Build progress display
        const progressDisplay = Object.entries(goal.requirements)
            .map(([cap, req]) => `${cap}: ${goal.progress[cap] || 0}/${req}`)
            .join('\n');

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `${goal.name}\n\n` +
            `Progress:\n${progressDisplay}\n\n` +
            `Select contribution:`,
            Markup.inlineKeyboard(this.chunk(buttons, 3))
        );
    }

    async handleGoalContribution(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);
        const [goalIndex, capitalType, amountStr] = ctx.match[1].split('_');
        const amount = parseInt(amountStr);

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const player = game.players.get(userId);
        const goal = game.communityGoals[parseInt(goalIndex)];

        if (!goal) {
            return ctx.answerCbQuery('Invalid goal.');
        }

        if (player.capitals[capitalType] < amount) {
            return ctx.answerCbQuery(`Not enough ${capitalType}!`);
        }

        // Initialize progress if needed
        if (!goal.progress[capitalType]) {
            goal.progress[capitalType] = 0;
        }

        // Make contribution
        player.capitals[capitalType] -= amount;
        goal.progress[capitalType] += amount;

        const isComplete = this.isGoalComplete(goal);

        await ctx.answerCbQuery('Contribution made!');
        await ctx.editMessageText(
            `Contributed to "${goal.name}"!\n\n` +
            `Gave: ${amount} ${capitalType}\n` +
            `Progress: ${goal.progress[capitalType]}/${goal.requirements[capitalType]}` +
            (isComplete ? '\n\nGoal completed!' : '')
        );

        this.moveToNextPlayer(holonId);
    }

    async handleGoalCancel(ctx) {
        const holonId = ctx.chat.id;

        await ctx.answerCbQuery('Cancelled.');
        await ctx.editMessageText('Goal contribution cancelled.');

        this.showPlayerTurnOptions(holonId);
    }

    // ================== GAME FLOW ==================

    moveToNextPlayer(holonId) {
        const game = this.games.get(holonId);
        if (!game) return;

        const players = Array.from(game.players.keys());
        const currentIndex = players.indexOf(game.currentPlayer);
        const nextIndex = (currentIndex + 1) % players.length;
        game.currentPlayer = players[nextIndex];

        // Check if round is complete (wrapped back to first player)
        if (nextIndex === 0) {
            this.endRound(holonId);
        } else {
            this.showPlayerTurnOptions(holonId);
        }
    }

    async endRound(holonId) {
        const game = this.games.get(holonId);
        if (!game) return;

        // Check win conditions for ALL players
        const winCondition = this.checkWinConditions(game);

        if (winCondition) {
            game.status = 'completed';
            await this.announceWinners(holonId, winCondition);
            // Clean up after delay
            setTimeout(() => this.cleanupGame(holonId), 60000);
        } else {
            game.round += 1;
            await this.startNextRound(holonId);
        }
    }

    async startNextRound(holonId) {
        const game = this.games.get(holonId);
        if (!game) return;

        // Apply random event (after round 1)
        if (game.round > 1 && game.events.length > 0) {
            await this.applyRandomEvent(holonId);
        }

        await this.bot.telegram.sendMessage(holonId, `Round ${game.round} begins!`);
        this.showPlayerTurnOptions(holonId);
    }

    async applyRandomEvent(holonId) {
        const game = this.games.get(holonId);
        if (!game || game.events.length === 0) return;

        const event = game.events.pop();
        if (!event) return;

        let effectDescription = '';

        // Apply effect to all players
        for (const [_, player] of game.players) {
            const capitalType = event.effect.type;
            const change = event.effect.amount;

            player.capitals[capitalType] = Math.max(0, player.capitals[capitalType] + change);
        }

        const changeText = event.effect.amount > 0
            ? `+${event.effect.amount}`
            : `${event.effect.amount}`;

        await this.bot.telegram.sendMessage(
            holonId,
            `Event: ${event.name}\n\n` +
            `${event.description}\n\n` +
            `Effect: ${changeText} ${event.effect.type} for all players`
        );
    }

    checkWinConditions(game) {
        // Check for individual victory - ANY player with 30+ in one capital
        for (const [playerId, player] of game.players) {
            for (const [capital, amount] of Object.entries(player.capitals)) {
                if (amount >= 30) {
                    return { winner: player, winnerId: playerId, type: 'individual', capital };
                }
            }
        }

        // Check for balanced victory - ALL players must have 5+ of each capital
        const allBalanced = Array.from(game.players.values()).every(player =>
            Object.values(player.capitals).every(amount => amount >= 5)
        );
        if (allBalanced) {
            return { winner: 'all', type: 'balanced' };
        }

        // Check for community victory - all goals completed
        const goalsCompleted = game.communityGoals.every(goal => this.isGoalComplete(goal));
        if (goalsCompleted) {
            return { winner: 'all', type: 'community' };
        }

        return null;
    }

    isGoalComplete(goal) {
        return Object.entries(goal.requirements).every(([capital, requiredAmount]) => {
            return (goal.progress[capital] || 0) >= requiredAmount;
        });
    }

    async announceWinners(holonId, winCondition) {
        let message;

        if (winCondition.type === 'individual') {
            message = `Congratulations ${winCondition.winner.username}!\n\n` +
                `Individual Victory achieved with ${winCondition.capital} capital reaching 30+!\n\n` +
                `The game will reset in 1 minute.`;
        } else if (winCondition.type === 'balanced') {
            message = `Congratulations to all players!\n\n` +
                `Balanced Victory achieved - everyone has 5+ of each capital type!\n\n` +
                `The game will reset in 1 minute.`;
        } else if (winCondition.type === 'community') {
            message = `Congratulations to the community!\n\n` +
                `Community Victory achieved - all goals have been completed!\n\n` +
                `The game will reset in 1 minute.`;
        }

        await this.bot.telegram.sendMessage(holonId, message);
    }

    // ================== UI METHODS ==================

    async showPlayerTurnOptions(holonId) {
        const game = this.games.get(holonId);
        if (!game || game.status !== 'active') return;

        const player = game.players.get(game.currentPlayer);

        // Compact capital display
        const capitalSummary = Object.entries(player.capitals)
            .map(([c, a]) => `${c.substring(0, 3)}: ${a}`)
            .join(' | ');

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Transform Capital', 'menu_transform')],
            [Markup.button.callback('Trade with Player', 'menu_trade')],
            [Markup.button.callback('Contribute to Goal', 'menu_goals')],
            [
                Markup.button.callback('Status', 'show_status'),
                Markup.button.callback('Rules', 'show_rules')
            ]
        ]);

        await this.bot.telegram.sendMessage(
            holonId,
            `${player.username}'s Turn (Round ${game.round})\n\n` +
            `Capitals: ${capitalSummary}\n\n` +
            `Choose an action:`,
            keyboard
        );
    }

    async showTransformMenu(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const player = game.players.get(userId);
        const rules = this.getTransformationRules();

        // Only show transformations the player can afford
        const availableTransforms = Object.entries(rules)
            .filter(([key, rule]) => {
                const [from] = key.split('_');
                return player.capitals[from] >= rule.cost;
            })
            .map(([key, rule]) => {
                const [from, to] = key.split('_');
                return Markup.button.callback(
                    `${rule.name} (${from} -> ${to})`,
                    `transform_${key}`
                );
            });

        if (availableTransforms.length === 0) {
            return ctx.answerCbQuery('No transformations available!');
        }

        availableTransforms.push(Markup.button.callback('Back', 'back_to_main'));

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            'Transformations\n\nConvert one capital type to another:',
            Markup.inlineKeyboard(this.chunk(availableTransforms, 1))
        );
    }

    async showTradeMenu(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const player = game.players.get(userId);

        // Only show capitals with enough to trade (need 2)
        const tradeableCapitals = this.capitalTypes.filter(c => player.capitals[c] >= 2);

        if (tradeableCapitals.length === 0) {
            return ctx.answerCbQuery('No capitals with 2+ to trade!');
        }

        const buttons = tradeableCapitals.map(capital =>
            Markup.button.callback(`${capital} (${player.capitals[capital]})`, `trade_select_${capital}`)
        );
        buttons.push(Markup.button.callback('Back', 'back_to_main'));

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            'Trading\n\nSelect capital to offer (costs 2, receive 1):',
            Markup.inlineKeyboard(this.chunk(buttons, 2))
        );
    }

    async showGoalsMenu(ctx) {
        const holonId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(holonId);

        if (!game || game.status !== 'active') {
            return ctx.answerCbQuery('No active game.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.answerCbQuery("It's not your turn!");
        }

        const buttons = game.communityGoals.map((goal, index) => {
            const progress = Object.entries(goal.requirements)
                .reduce((sum, [cap, req]) => sum + Math.min(goal.progress[cap] || 0, req), 0);
            const total = Object.values(goal.requirements).reduce((sum, v) => sum + v, 0);
            const complete = this.isGoalComplete(goal);

            return Markup.button.callback(
                `${complete ? '[DONE] ' : ''}${goal.name} (${progress}/${total})`,
                complete ? 'noop' : `goal_select_${index}`
            );
        });
        buttons.push(Markup.button.callback('Back', 'back_to_main'));

        await ctx.answerCbQuery();
        await ctx.editMessageText(
            'Community Goals\n\nContribute capital to complete these goals:',
            Markup.inlineKeyboard(this.chunk(buttons, 1))
        );
    }

    async backToMainMenu(ctx) {
        const holonId = ctx.chat.id;

        await ctx.answerCbQuery();
        await ctx.deleteMessage();
        this.showPlayerTurnOptions(holonId);
    }

    async handleShowStatus(ctx) {
        const holonId = ctx.chat.id;
        const game = this.games.get(holonId);

        if (!game) {
            return ctx.reply('No active game. Start one with /capital');
        }

        let statusMessage = `Game Status (Round ${game.round})\n\n`;

        // Players and their capitals
        statusMessage += 'Players:\n';
        for (const [id, player] of game.players) {
            const isCurrent = id === game.currentPlayer ? ' <- current turn' : '';
            statusMessage += `\n${player.username}${isCurrent}\n`;
            Object.entries(player.capitals).forEach(([capital, amount]) => {
                statusMessage += `  ${capital}: ${amount}\n`;
            });
        }

        // Community Goals
        statusMessage += '\nCommunity Goals:\n';
        game.communityGoals.forEach(goal => {
            const complete = this.isGoalComplete(goal) ? '[DONE] ' : '';
            statusMessage += `\n${complete}${goal.name}:\n`;
            Object.entries(goal.requirements).forEach(([capital, required]) => {
                const progress = goal.progress[capital] || 0;
                statusMessage += `  ${capital}: ${progress}/${required}\n`;
            });
        });

        if (typeof ctx.answerCbQuery === 'function') {
            await ctx.answerCbQuery();
        }
        await ctx.reply(statusMessage);
    }

    async handleShowRules(ctx) {
        const rulesMessage =
            'Game Rules\n\n' +
            'Capital Types:\n' +
            'Financial, Social, Cultural, Material, Living, Intellectual, Spiritual, Experiential\n\n' +
            'Actions on Your Turn:\n' +
            '1. Transform - Convert one capital to another\n' +
            '2. Trade - Exchange with another player (2:1 ratio)\n' +
            '3. Contribute - Add to community goals\n\n' +
            'Victory Conditions:\n' +
            '- Individual: Get 30+ of any capital\n' +
            '- Balanced: All players have 5+ of each\n' +
            '- Community: Complete all 3 goals\n\n' +
            'Trading:\n' +
            '- You give 2, receive 1\n' +
            '- Other player must accept';

        if (typeof ctx.answerCbQuery === 'function') {
            await ctx.answerCbQuery();
        }
        await ctx.reply(rulesMessage);
    }

    // ================== GAME MANAGEMENT ==================

    async endGame(ctx) {
        const holonId = ctx.chat.id;
        const game = this.games.get(holonId);

        if (!game) {
            return ctx.reply('No game is currently active.');
        }

        this.cleanupGame(holonId);
        ctx.reply('Game has been ended. Start a new one with /capital');
    }

    cleanupGame(holonId) {
        this.games.delete(holonId);

        // Clean up pending trades for this holon
        for (const [key] of this.pendingTrades) {
            if (key.startsWith(`${holonId}_`)) {
                this.pendingTrades.delete(key);
            }
        }

        console.log(`[CapitalGame] Cleaned up game for holon ${holonId}`);
    }

    // Helper function to chunk arrays for keyboard rows
    chunk(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}

export default CapitalGame;
