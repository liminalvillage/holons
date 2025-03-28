import { Markup } from 'telegraf';

class CapitalGame {
    constructor(bot, settings) {
        this.bot = bot;
        this.settings = settings;
        this.games = new Map(); // Store active games by chatID
        
        // Register commands
        this.bot.command('capital', (ctx) => this.startGame(ctx));
        //this.bot.command('join', (ctx) => this.joinGame(ctx));
        this.bot.command('status', (ctx) => this.handleShowStatus(ctx));
        
        // Register action handlers for inline buttons
        this.bot.action('join_game', (ctx) => this.joinGame(ctx));
        this.bot.action('start_round', (ctx) => this.startRound(ctx));
        this.bot.action(/transform_(.+)/, (ctx) => this.handleTransformation(ctx));
        this.bot.action(/trade_(.+)/, (ctx) => this.handleTrade(ctx));
        this.bot.action(/goal_(.+)/, (ctx) => this.handleGoalContribution(ctx));
        this.bot.action('show_status', (ctx) => this.handleShowStatus(ctx));
        this.bot.action('show_rules', (ctx) => this.handleShowRules(ctx));
    }

    shuffleEvents() {
        const events = [
            { name: 'Economic Crash', effect: { type: 'financial', amount: -2 } },
            { name: 'Cultural Renaissance', effect: { type: 'cultural', amount: 3 } },
            { name: 'Biodiversity Collapse', effect: { type: 'living', amount: -2, mitigation: { spiritual: 1, financial: 1 } } },
            { name: 'Networking Opportunity', effect: { type: 'social', cost: 2, gain: { type: 'financial', amount: 3 } } },
            { name: 'Knowledge Exchange', effect: { type: 'intellectual', trade: 'experiential', ratio: 1 } }
        ];

        // Fisher-Yates shuffle
        for (let i = events.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [events[i], events[j]] = [events[j], events[i]];
        }

        return events;
    }

    async startGame(ctx) {
        const chatId = ctx.chat.id;
        
        if (this.games.has(chatId)) {
            return ctx.reply('A game is already in progress in this chat!');
        }

        const game = {
            players: new Map(),
            currentPlayer: null,
            communityGoals: this.generateCommunityGoals(),
            events: this.shuffleEvents(),
            round: 1,
            status: 'waiting' // waiting, active, completed
        };

        this.games.set(chatId, game);

        const markup = Markup.inlineKeyboard([
            Markup.button.callback('Join Game', 'join_game'),
            Markup.button.callback('Start Round', 'start_round')
        ]);

        ctx.reply('🎮 8 Forms of Capital Game\nWaiting for players to join...', markup);
    }

    async joinGame(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(chatId);

        if (!game) {
            return ctx.reply('No game is currently active. Start a new game with /capital.');
        }

        if (game.players.has(userId)) {
            return ctx.reply('You have already joined the game.');
        }

        game.players.set(userId, {
            username: ctx.from.username || ctx.from.first_name,
            capitals: this.generateInitialCapital()
        });

        ctx.reply(`Welcome to the game, ${ctx.from.first_name}!`);
    }

    async startRound(ctx) {
        const chatId = ctx.chat.id;
        const game = this.games.get(chatId);

        if (!game || game.status !== 'waiting') {
            return ctx.reply('Cannot start a new round. Either no game is active or the game is already in progress.');
        }

        if (game.players.size < 2) {
            return ctx.reply('At least two players are required to start the round.');
        }

        game.status = 'active';
        game.currentPlayer = Array.from(game.players.keys())[0]; // Set the first player as the current player

        ctx.reply('The round has started! It\'s time for the first player to take action.');
        this.showPlayerTurnOptions(chatId);
    }

    generateInitialCapital() {
        // Example starting profiles
        const profiles = [
            { financial: 5, social: 3, cultural: 2, material: 2, living: 3, intellectual: 2, spiritual: 1, experiential: 2 },
            { financial: 3, social: 2, cultural: 5, material: 1, living: 2, intellectual: 3, spiritual: 2, experiential: 2 },
            // Add more profiles as needed
        ];

        // Randomly select a profile for each player
        return profiles[Math.floor(Math.random() * profiles.length)];
    }

    generateCommunityGoals() {
        return [
            {
                name: 'Build Community Center',
                requirements: {
                    social: 10,
                    material: 5,
                    financial: 5
                },
                progress: {}
            },
            {
                name: 'Start Local Market',
                requirements: {
                    financial: 8,
                    social: 6,
                    cultural: 4
                },
                progress: {}
            },
            {
                name: 'Educational Program',
                requirements: {
                    intellectual: 8,
                    experiential: 6,
                    social: 4
                },
                progress: {}
            }
        ];
    }

    async handleTransformation(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(chatId);
        const [fromCapital, toCapital] = ctx.match[1].split('_');

        if (!game || game.status !== 'active') {
            return ctx.reply('No active game in progress.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.reply('It\'s not your turn!');
        }

        const player = game.players.get(userId);
        const rules = this.getTransformationRules(fromCapital, toCapital);

        if (!rules) {
            return ctx.reply('Invalid transformation combination.');
        }

        if (player.capitals[fromCapital] < rules.cost) {
            return ctx.reply(`Not enough ${fromCapital} capital! You need ${rules.cost}.`);
        }

        // Apply transformation
        player.capitals[fromCapital] -= rules.cost;
        player.capitals[toCapital] += rules.gain;

        await ctx.reply(
            `Transformation complete!\n` +
            `📊 Spent ${rules.cost} ${fromCapital} capital\n` +
            `📈 Gained ${rules.gain} ${toCapital} capital`
        );

        // Move to next player
        this.moveToNextPlayer(chatId);
    }

    getTransformationRules(from, to) {
        const rules = {
            'experiential_financial': { cost: 2, gain: 3, name: 'Workshop' },
            'social_intellectual': { cost: 3, gain: 2, name: 'Collaboration' },
            'cultural_spiritual': { cost: 2, gain: 3, name: 'Ritual' },
            'material_financial': { cost: 3, gain: 4, name: 'Selling' },
            'financial_material': { cost: 4, gain: 5, name: 'Investment' },
            'living_experiential': { cost: 2, gain: 3, name: 'Immersion' },
            'intellectual_cultural': { cost: 3, gain: 4, name: 'Creative Expression' },
            'spiritual_social': { cost: 2, gain: 3, name: 'Community Building' }
        };
        return rules[`${from}_${to}`];
    }

    checkWinConditions(game, player) {
        // Check for individual victory (30 points in one capital)
        for (const [capital, amount] of Object.entries(player.capitals)) {
            if (amount >= 30) return { winner: player, type: 'individual' };
        }

        // Check for balanced victory
        const isBalanced = Object.values(player.capitals).every(amount => amount >= 5);
        if (isBalanced) return { winner: 'all', type: 'balanced' };

        // Check for community victory
        const goalsCompleted = game.communityGoals.every(goal => this.isGoalComplete(goal));
        if (goalsCompleted) return { winner: 'all', type: 'community' };

        return null;
    }

    async handleTrade(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(chatId);
        const [offerCapital, requestCapital, targetUserId] = ctx.match[1].split('_');

        if (!game || game.status !== 'active') {
            return ctx.reply('No active game in progress.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.reply('It\'s not your turn!');
        }

        const player = game.players.get(userId);
        const targetPlayer = game.players.get(targetUserId);

        if (!targetPlayer) {
            return ctx.reply('Invalid target player.');
        }

        // Standard trade rate is 2:1
        const tradeCost = 2;
        const tradeGain = 1;

        if (player.capitals[offerCapital] < tradeCost) {
            return ctx.reply(`Not enough ${offerCapital} capital for trade!`);
        }

        // Execute trade
        player.capitals[offerCapital] -= tradeCost;
        player.capitals[requestCapital] += tradeGain;
        targetPlayer.capitals[requestCapital] -= tradeGain;
        targetPlayer.capitals[offerCapital] += tradeCost;

        await ctx.reply(
            `Trade completed with ${targetPlayer.username}!\n` +
            `📤 You gave: ${tradeCost} ${offerCapital}\n` +
            `📥 You received: ${tradeGain} ${requestCapital}`
        );

        this.moveToNextPlayer(chatId);
    }

    async handleGoalContribution(ctx) {
        const chatId = ctx.chat.id;
        const userId = ctx.from.id;
        const game = this.games.get(chatId);
        const [goalIndex, capitalType, amount] = ctx.match[1].split('_');

        if (!game || game.status !== 'active') {
            return ctx.reply('No active game in progress.');
        }

        if (game.currentPlayer !== userId) {
            return ctx.reply('It\'s not your turn!');
        }

        const player = game.players.get(userId);
        const goal = game.communityGoals[parseInt(goalIndex)];

        if (!goal) {
            return ctx.reply('Invalid goal selected.');
        }

        const contributionAmount = parseInt(amount);
        if (player.capitals[capitalType] < contributionAmount) {
            return ctx.reply(`Not enough ${capitalType} capital to contribute!`);
        }

        // Initialize progress if needed
        if (!goal.progress[capitalType]) {
            goal.progress[capitalType] = 0;
        }

        // Make contribution
        player.capitals[capitalType] -= contributionAmount;
        goal.progress[capitalType] += contributionAmount;

        await ctx.reply(
            `Contribution made to "${goal.name}"!\n` +
            `📊 Contributed: ${contributionAmount} ${capitalType}\n` +
            `🎯 Goal progress: ${goal.progress[capitalType]}/${goal.requirements[capitalType]}`
        );

        this.moveToNextPlayer(chatId);
    }

    moveToNextPlayer(chatId) {
        const game = this.games.get(chatId);
        if (!game) return;

        const players = Array.from(game.players.keys());
        const currentIndex = players.indexOf(game.currentPlayer);
        const nextIndex = (currentIndex + 1) % players.length;
        game.currentPlayer = players[nextIndex];

        // Check if round is complete
        if (nextIndex === 0) {
            this.updateGameStatus(chatId);
        } else {
            this.showPlayerTurnOptions(chatId);
        }
    }

    async showPlayerTurnOptions(chatId) {
        const game = this.games.get(chatId);
        if (!game) return;

        const player = game.players.get(game.currentPlayer);
        const buttons = [];

        // Group 1: Transformations
        const transformations = [
            ['experiential', 'financial'],
            ['social', 'intellectual'],
            ['cultural', 'spiritual'],
            ['material', 'financial'],
            ['financial', 'material'],
            ['living', 'experiential'],
            ['intellectual', 'cultural'],
            ['spiritual', 'social']
        ];

        // Create transformation buttons row by row
        const transformButtons = transformations.map(([from, to]) => 
            Markup.button.callback(
                `🔄 ${from} ➡️ ${to}`,
                `transform_${from}_${to}`
            )
        );

        // Group 2: Trades
        const capitals = ['financial', 'social', 'cultural', 'material', 'living', 'intellectual', 'spiritual', 'experiential'];
        
        const tradeButtons = capitals.map(capital =>
            Markup.button.callback(
                `💱 Trade ${capital}`,
                `trade_select_${capital}`
            )
        );

        // Group 3: Community Goals
        const goalButtons = game.communityGoals.map((goal, index) => {
            const progress = Object.entries(goal.progress)
                .reduce((sum, [_, value]) => sum + value, 0);
            const total = Object.values(goal.requirements)
                .reduce((sum, value) => sum + value, 0);
                
            return Markup.button.callback(
                `🎯 ${goal.name} (${progress}/${total})`,
                `goal_${index}`
            );
        });

        // Group 4: Status and Info
        const infoButtons = [
            Markup.button.callback('📊 Show Game Status', 'show_status'),
            Markup.button.callback('ℹ️ Show Rules', 'show_rules')
        ];

        // Organize buttons into a keyboard layout
        const keyboard = [
            // Header showing current player and round
            [{ text: `🎮 ${player.username}'s Turn - Round ${game.round}`, callback_data: 'noop' }],
            
            // Current capitals status
            [{ text: 'Current Capitals:', callback_data: 'noop' }],
            ...Object.entries(player.capitals).map(([capital, amount]) => 
                [{ text: `${capital}: ${amount}`, callback_data: 'noop' }]
            ),
            
            // Action buttons in groups
            [{ text: '🔄 Transformations', callback_data: 'noop' }],
            ...this.chunk(transformButtons, 2),
            
            [{ text: '💱 Trading', callback_data: 'noop' }],
            ...this.chunk(tradeButtons, 2),
            
            [{ text: '🎯 Community Goals', callback_data: 'noop' }],
            ...this.chunk(goalButtons, 1),
            
            [{ text: 'ℹ️ Information', callback_data: 'noop' }],
            infoButtons
        ];

        const markup = Markup.inlineKeyboard(keyboard.flat());

        await this.bot.telegram.sendMessage(
            chatId,
            `🎮 Turn Summary for ${player.username}\n\n` +
            `Round: ${game.round}\n` +
            `Current Capitals:\n` +
            Object.entries(player.capitals)
                .map(([capital, amount]) => `${capital}: ${amount}`)
                .join('\n') +
            '\n\nChoose your action:',
            { reply_markup: markup }
        );
    }

    // Helper function to chunk arrays
    chunk(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    async handleShowStatus(ctx) {
        const chatId = ctx.chat.id;
        const game = this.games.get(chatId);
        
        if (!game) return;

        let statusMessage = '📊 Game Status\n\n';
        
        // Players and their capitals
        statusMessage += '👥 Players:\n';
        for (const [_, player] of game.players) {
            statusMessage += `\n${player.username}:\n`;
            Object.entries(player.capitals).forEach(([capital, amount]) => {
                statusMessage += `${capital}: ${amount}\n`;
            });
        }

        // Community Goals
        statusMessage += '\n🎯 Community Goals:\n';
        game.communityGoals.forEach(goal => {
            statusMessage += `\n${goal.name}:\n`;
            Object.entries(goal.requirements).forEach(([capital, required]) => {
                const progress = goal.progress[capital] || 0;
                statusMessage += `${capital}: ${progress}/${required}\n`;
            });
        });

        await ctx.reply(statusMessage);
    }

    async handleShowRules(ctx) {
        const rulesMessage = 
            '📋 Game Rules:\n\n' +
            '1. Each player starts with different amounts of 8 types of capital\n' +
            '2. On your turn, you can:\n' +
            '   - Transform one type of capital to another\n' +
            '   - Trade capitals with other players\n' +
            '   - Contribute to community goals\n\n' +
            '🏆 Victory Conditions:\n' +
            '- Individual: Accumulate 30 of any capital\n' +
            '- Balanced: Have at least 5 of each capital\n' +
            '- Community: Complete all community goals\n\n' +
            '💱 Trading Rules:\n' +
            '- Standard trade rate is 2:1\n' +
            '- Both players must agree to trade\n\n' +
            '🔄 Transformation Rules:\n' +
            '- Different conversion rates apply\n' +
            '- Some transformations are more efficient than others';

        await ctx.reply(rulesMessage);
    }

    isGoalComplete(goal) {
        // Check if a community goal is complete
        return Object.entries(goal.requirements).every(([capital, requiredAmount]) => {
            return goal.progress[capital] >= requiredAmount;
        });
    }

    updateGameStatus(chatId) {
        const game = this.games.get(chatId);
        if (!game) return;

        // Check if the game should progress to the next round or end
        const winCondition = this.checkWinConditions(game, game.players.get(game.currentPlayer));
        if (winCondition) {
            game.status = 'completed';
            this.announceWinners(chatId, game);
        } else {
            game.round += 1;
            game.status = 'active';
            this.startNextRound(chatId);
        }
    }

    announceWinners(chatId, game) {
        const winCondition = this.checkWinConditions(game, game.players.get(game.currentPlayer));
        if (winCondition) {
            if (winCondition.type === 'individual') {
                this.bot.telegram.sendMessage(chatId, `🎉 Congratulations ${winCondition.winner.username}! You have won the game with an individual victory!`);
            } else if (winCondition.type === 'balanced') {
                this.bot.telegram.sendMessage(chatId, '🎉 Congratulations to all players! You have achieved a balanced victory!');
            } else if (winCondition.type === 'community') {
                this.bot.telegram.sendMessage(chatId, '🎉 Congratulations to the community! All goals have been completed!');
            }
        }
    }

    startNextRound(chatId) {
        const game = this.games.get(chatId);
        if (!game) return;

        // Logic to start the next round
        // e.g., reset player actions, shuffle events, etc.
        this.bot.telegram.sendMessage(chatId, `Round ${game.round} has started!`);
        this.showPlayerTurnOptions(chatId);
    }
}

export default CapitalGame;