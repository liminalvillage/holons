/**
 * @fileoverview User Interface components for HolonsBot.
 * @module src/UI
 */
import puppeteer from 'puppeteer';
import i18next from 'i18next';
import * as utils from './utilities.js';
import fs from 'fs';
import { Markup } from 'telegraf';
import {
  getDisplayName,
  getHolonName,
  createPaddedCaption,
  getQuestHolon,
} from './utilities.js';
import QRCode from 'qrcode';
import { colorFromCategory } from '@holons/core/categories';

const DASHBOARD_ADDRESS =
  process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

let browser = null;
let browserAvailable = false;

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Page pool: pages are partitioned by viewport class so each stays warm for
// similar work. One page per class (max=1) bounds memory and serializes
// concurrent screenshot calls of the same class — no two callers ever drive
// the same page at the same time. Different classes run in parallel.
const pagePools = new Map(); // class -> { page, busy, queue: [resolve...] }

function getPool(klass) {
  let pool = pagePools.get(klass);
  if (!pool) {
    pool = { page: null, busy: false, queue: [] };
    pagePools.set(klass, pool);
  }
  return pool;
}

async function acquirePage(klass) {
  const pool = getPool(klass);
  if (pool.busy) {
    // Same-class request in flight — queue and wait.
    return new Promise(resolve => pool.queue.push(resolve));
  }
  pool.busy = true;
  if (pool.page && !pool.page.isClosed()) {
    return pool.page;
  }
  pool.page = await browser.newPage();
  return pool.page;
}

function releasePage(klass, { discard = false } = {}) {
  const pool = pagePools.get(klass);
  if (!pool) return;
  if (discard && pool.page) {
    const dead = pool.page;
    pool.page = null;
    dead.close().catch(() => {});
  }
  if (pool.queue.length > 0) {
    const next = pool.queue.shift();
    // Pool stays busy — handing off ownership to the next waiter.
    Promise.resolve().then(async () => {
      if (!pool.page || pool.page.isClosed()) {
        try {
          pool.page = await browser.newPage();
        } catch (e) {
          pool.busy = false;
          // Reject by resolving with null so caller can fail soft.
          next(null);
          return;
        }
      }
      next(pool.page);
    });
  } else {
    pool.busy = false;
  }
}

async function closePagePool() {
  for (const pool of pagePools.values()) {
    if (pool.page) {
      try {
        await pool.page.close();
      } catch {}
    }
    pool.page = null;
    pool.queue = [];
    pool.busy = false;
  }
  pagePools.clear();
}

function viewportClassFor(onElement) {
  if (onElement.includes('quest-card')) return 'quest-card';
  if (
    onElement.includes('table-container') ||
    onElement.includes('quest-list') ||
    onElement.includes('status-table') ||
    onElement === 'table' ||
    onElement.includes('modern-table')
  ) {
    return 'table';
  }
  return 'default';
}

/**
 * User Interface class for generating visual outputs and display commands.
 *
 * @class UI
 * @description Handles all visual output generation including leaderboards, dashboards,
 * quest images, QR codes, and various board displays. Uses Puppeteer for HTML-to-image
 * rendering when available.
 *
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Settings} settings - Settings module instance
 * @property {Expenses|null} expensesInstance - Expenses module reference
 * @property {Map<string, {name: string, timestamp: number}>} holonNameCache - Cache for holon names
 * @property {number} holonNameCacheExpiry - Cache TTL in milliseconds
 *
 * @example
 * const ui = new UI(bot, db, settings);
 * ui.expensesInstance = expensesModule;
 * // UI commands are now available: /leaderboard, /dashboard, etc.
 */
class UI {
  /**
   * Creates a new UI instance and registers display commands.
   * @constructor
   * @param {Telegraf} bot - The Telegraf bot instance
   * @param {DB} db - The database instance
   * @param {Settings} settings - The settings module instance
   */
  constructor(bot, db, settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.expensesInstance = null;

    this.holonNameCache = new Map();
    this.holonNameCacheExpiry = 10 * 60 * 1000;
    this.cacheCleanupInterval = setInterval(
      () => this.cleanupHolonNameCache(),
      5 * 60 * 1000
    );
    //=========== UI COMMANDS ===============

    //Set up a command to display the appreciation score for each user
    this.bot.command(
      [
        'leaderboard',
        'appreciation',
        'credits',
        'scores',
        'score',
        'points',
        'rank',
        'status',
      ],
      async ctx => this.leaderboard(ctx)
    );
    this.bot.command(
      [
        'fiorini',
        'apprezzamento',
        'crediti',
        'punti',
        'punteggio',
        'punteggi',
        'classifica',
        'stato',
      ],
      async ctx => this.leaderboard(ctx)
    );

    // Set up a command to display the quests
    this.bot.command(['tasks', 'todos'], ctx => this.questboard(ctx));
    this.bot.command(['compiti', 'missioni'], ctx => this.questboard(ctx));

    // Set up a command to display the requests
    this.bot.command(['requests', 'wishes'], ctx => this.requestsboard(ctx));
    this.bot.command('offers', ctx => this.offersboard(ctx));

    this.bot.command(['richieste', 'sogni', 'bisogni'], ctx =>
      this.requestsboard(ctx)
    );
    this.bot.command('offerte', ctx => this.offersboard(ctx));

    this.bot.command(['bulletin', 'billboard', 'board'], ctx =>
      this.bulletinboard(ctx)
    );
    this.bot.command(['bacheca', 'lavagna'], ctx => this.bulletinboard(ctx));

    // Event board command
    this.bot.command(['eventboard', 'calendario'], ctx => this.eventboard(ctx));

    this.bot.command('values', ctx => this.valuescloud(ctx));
    this.bot.command('needs', ctx => this.needscloud(ctx));
    this.bot.command('cloud', ctx => this.valuescloud(ctx));

    this.bot.command('dashboard', async ctx => {
      const holonId = ctx.message.chat.id;
      const userId = ctx.from?.id;
      const language = await this.settings.getLanguage(holonId);

      // Get public key from keyManager if available
      let dashboardHolonId = holonId;
      const keyManager = this.db.keyManager;
      if (keyManager) {
        try {
          dashboardHolonId = await keyManager.getPublicKey(holonId);
        } catch (err) {
          console.warn('Failed to get public key for dashboard:', err.message);
        }
      }

      const dashboardUrl = `${DASHBOARD_ADDRESS}/${dashboardHolonId}/?user=${userId}`;

      try {
        // Generate QR code
        const qrCodePath = `./temp/qr_dashboard_${holonId}.png`;

        // Ensure temp directory exists
        if (!fs.existsSync('./temp')) {
          fs.mkdirSync('./temp', { recursive: true });
        }

        // Generate QR code as PNG
        await QRCode.toFile(qrCodePath, dashboardUrl, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        // Send QR code image with caption and button
        await ctx.replyWithPhoto(
          { source: fs.createReadStream(qrCodePath) },
          {
            caption: createPaddedCaption(''),
            reply_markup: Markup.inlineKeyboard([
              Markup.button.url(
                i18next.t('Open Dashboard', { lng: language }),
                dashboardUrl
              ),
            ]).reply_markup,
          }
        );

        // Clean up the temporary QR code file
        fs.unlinkSync(qrCodePath);
      } catch (error) {
        console.error('Error generating QR code:', error);
        // Fallback to original behavior if QR generation fails
        ctx.reply(
          'Holonic Dashboard',
          Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open Dashboard', { lng: language }),
              dashboardUrl
            ),
          ])
        );
      }
    });
  }

  // Get optimized Puppeteer launch options for emoji support
  getPuppeteerLaunchOptions() {
    return {
      headless: 'new',
      // Tall quest boards (1400x3000+) legitimately need >8s to lay out and
      // rasterize on low-RAM hosts, so an aggressive fast-fail kills healthy
      // renders mid-capture. Genuinely stuck commands still hit the recovery
      // path (discard page, relaunch browser), just slower.
      protocolTimeout: 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        // '--disable-images', // Disabled: breaks emoji rendering
        // Emoji and font rendering support
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        // Enable emoji fonts
        '--enable-features=FontAccess',
        '--disable-web-security', // Allow access to system fonts
        '--allow-running-insecure-content',
        // Force enable color emoji
        '--force-color-profile=srgb',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    };
  }

  async init() {
    // Initialize browser on startup (skip if DISABLE_PUPPETEER is set)
    if (process.env.DISABLE_PUPPETEER === 'true') {
      browserAvailable = false;
      console.log('Puppeteer disabled via env — text-only mode');
      return;
    }
    try {
      if (!browser || !browser.connected) {
        console.log('Initializing Puppeteer browser...');
        browser = await puppeteer.launch(this.getPuppeteerLaunchOptions());
        browserAvailable = true;
        console.log('Browser initialized successfully');
      }
    } catch (error) {
      browserAvailable = false;
      console.warn(
        '⚠️  Browser initialization failed - running in text-only mode'
      );
      console.warn('   Image generation features will be disabled.');
      console.warn('   Reason:', error.message);
    }
  }

  isBrowserAvailable() {
    return browserAvailable && browser && browser.connected;
  }

  setExpensesInstance(expensesInstance) {
    this.expensesInstance = expensesInstance;
  }

  async closeBrowser() {
    await closePagePool();
    if (browser) {
      try {
        console.log('Closing Puppeteer browser...');
        await browser.close();
        browser = null;
        console.log('Browser closed successfully');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }

  async leaderboard(ctx) {
    const holonId = ctx.message.chat.id;
    const users = await this.db.holosphere.getAll(holonId.toString(), 'users');
    const language = await this.settings.getLanguage(holonId);

    // Assuming Expenses class instance is available via this.bot.expenses
    // If not, this needs to be instantiated or passed to UI class constructor
    const expensesInstance = this.expensesInstance;
    if (!expensesInstance) {
      console.error(
        'Expenses instance not available in UI.js for leaderboard calculation.'
      );
      ctx.reply(
        'Error calculating leaderboard: Expenses module not accessible.'
      );
      return;
    }

    // Calculate user scores using the Settings class method
    this.getRankTable(users, holonId, expensesInstance)
      .then(path => {
        if (path) {
          ctx
            .replyWithPhoto(
              { source: fs.createReadStream(path) },
              {
                caption: createPaddedCaption(''),
                ...Markup.inlineKeyboard([
                  Markup.button.url(
                    i18next.t('Open Dashboard', { lng: language }),
                    `${DASHBOARD_ADDRESS}/${holonId}/status`
                  ),
                ]),
              }
            )
            .catch(err =>
              console.error('Error sending leaderboard photo:', err)
            );
        } else {
          ctx.reply(
            i18next.t('leaderboardgenerror', { lng: language }) ||
              'Could not generate leaderboard image.'
          );
        }
      })
      .catch(err => {
        console.error('Error in getRankTable promise chain:', err);
        ctx.reply(
          i18next.t('leaderboarderror', { lng: language }) ||
            'An error occurred while generating the leaderboard.'
        );
      });
    return;
  }

  async getRankTable(users, holonId, expensesInstance) {
    const language = await this.settings.getLanguage(holonId);
    const rows = [];

    // Get currencies from settings
    const settings = await this.settings.getSettings(holonId);
    const currencies = settings.currencies || [];

    // Scores + normalized shares come from the one shared core pipeline
    // (calculateUserScores → computeHolonUserScores). `percentage` is already
    // strictly positive, monotonic and sums to 100% — identical to the web
    // leaderboard and the flow/splitter distribution. No re-normalizing here.
    const sortedUsers = await this.settings.calculateUserScores(
      users,
      holonId,
      expensesInstance
    );

    for (let i = 0; i < sortedUsers.length; i++) {
      const user = sortedUsers[i];
      const rankIcon =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const scoreClass = i < 3 ? 'top-performer' : '';

      // Get currency balances for this user
      const currencyBalances = [];
      if (currencies.length > 0 && expensesInstance) {
        for (const currency of currencies) {
          try {
            const balance = await expensesInstance.getUserCurrencyBalance(
              holonId,
              user.id,
              currency
            );
            currencyBalances.push(balance);
          } catch (e) {
            console.error(
              `Error getting balance for ${currency} for user ${user.id}:`,
              e
            );
            currencyBalances.push(0);
          }
        }
      }

      // Build currency cells HTML
      const currencyCells = currencyBalances
        .map(
          balance =>
            `<td class="currency-cell">
          <span class="stat-value">${balance.toFixed(2)}</span>
        </td>`
        )
        .join('');

      // Score is already calculated and part of the user object in sortedUsers
      const row = `<tr class="${scoreClass}">
        <td class="rank-cell">
          <div class="rank-container">
            <span class="rank-icon">${rankIcon}</span>
          </div>
        </td>
        <td class="name-cell">
          <div class="user-info">
            <div class="user-details">
              <span class="user-name">${getDisplayName(user)}</span>
              ${user.username ? `<span class="user-handle">@${user.username}</span>` : ''}
            </div>
          </div>
        </td>
        <td class="stat-cell">
          <span class="stat-value">${user.aggregates?.initiated ?? (user.initiated?.length || 0)}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value">${user.aggregates?.completed ?? (user.completed?.length || 0)}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value" style="white-space: normal; word-wrap: break-word;">${user.aggregates?.sent ?? (user.sent || 0)}</span>
        </td>
        <td class="stat-cell">
          <span class="stat-value" style="white-space: normal; word-wrap: break-word;">${user.aggregates?.received ?? (user.received || 0)}</span>
        </td>
        ${currencyCells}
        <td class="score-cell">
          <span class="score-value">${user.score.toFixed(1)}</span>
        </td>
        <td class="score-cell">
          <span class="score-value">${(user.percentage ?? 0).toFixed(1)}%</span>
        </td>
      </tr>`;

      rows.push(row);
    }

    // Build currency headers
    const currencyHeaders = currencies
      .map(currency => `<th class="stat-header">${currency.toUpperCase()}</th>`)
      .join('');

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="rank-header">${i18next.t('rank', { lng: language })}</th>
              <th class="name-header">${i18next.t('name', { lng: language })}</th>
              <th class="stat-header">${i18next.t('tasksinitiated', { lng: language })}</th>
              <th class="stat-header">${i18next.t('taskscompleted', { lng: language })}</th>
              <th class="stat-header" style="white-space: normal; word-wrap: break-word;">${i18next.t('appreciation_sent', { lng: language, defaultValue: 'Appreciation Sent' })}</th>
              <th class="stat-header" style="white-space: normal; word-wrap: break-word;">${i18next.t('appreciation_received', { lng: language, defaultValue: 'Appreciation Received' })}</th>
              ${currencyHeaders}
              <th class="score-header">${i18next.t('score', { lng: language })}</th>
              <th class="score-header">${i18next.t('share', { lng: language, defaultValue: 'Share' })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/rank' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }
  async bulletinboard(ctx) {
    if (!this.db) return;

    try {
      const holonId = ctx.message.chat.id;
      const language = await this.settings.getLanguage(holonId);
      const isTopic = ctx.message.is_topic_message;
      const threadId = isTopic ? ctx.message.message_thread_id : null;

      const users = await this.db.holosphere.getAll(
        holonId.toString(),
        'users'
      );
      let quests = await this.db.holosphere.getAll(
        holonId.toString(),
        'quests'
      );

      // If in a topic, filter quests by message_thread_id
      if (isTopic && threadId) {
        quests = quests.filter(quest => quest.message_thread_id === threadId);
      }

      // Wait for the table image to be generated
      const path = await this.getBulletinTable(users, quests, holonId);

      if (!path) {
        ctx.reply(
          i18next.t('bulletinboardgenerror', { lng: language }) ||
            'Could not generate bulletin board image.'
        );
        return;
      }

      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open in Holons', { lng: language }),
              `${DASHBOARD_ADDRESS}/${holonId}/offers`
            ),
          ]),
        }
      );
    } catch (err) {
      console.error('Error in bulletinboard:', err);
      const language = await this.settings
        .getLanguage(ctx.message.chat.id)
        .catch(() => 'en');
      ctx.reply(
        i18next.t('bulletinboardgenerror', { lng: language }) ||
          'Could not generate bulletin board image.'
      );
    }
  }

  async valuescloud(ctx) {
    const holonId = ctx.message.chat.id;
    let values = [];
    const language = await this.settings.getLanguage(holonId);

    const entities = ctx.message.entities;
    let mentions = entities.filter(
      entity => entity.type === 'mention' || entity.type === 'text_mention'
    );
    mentions = mentions.map(entity =>
      ctx.message.text.substring(
        entity.offset + 1,
        entity.offset + entity.length
      )
    );

    let users = await this.db.holosphere.getAll(holonId.toString(), 'users');
    //only select the mentioned users

    if (mentions.length > 0)
      users = users.filter(user => mentions.includes(user.username));

    for (let i = 0; i < users.length; i++) {
      values = values.concat(users[i].values);
    }

    if (!this.isBrowserAvailable()) {
      await ctx.reply(
        i18next.t(
          'Image generation is not available. Please try the dashboard.',
          { lng: language }
        )
      );
      return;
    }

    let page = null;
    try {
      page = await browser.newPage();
      const path = './images/valuecloud' + utils.getholonId(ctx) + '.png';
      page.setContent(fs.readFileSync('./html/cloud.html', 'utf8'));
      await page.addScriptTag({
        content: `
            const words = ${JSON.stringify(values)};
            window.myWordCloud.update(getWords(words));
        `,
      });

      await page.waitForSelector('svg');

      // Screenshot the word cloud
      const svgElement = await page.$('svg');
      await svgElement.screenshot({
        path: path,
      });
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${holonId}/values/`
            ),
          ]),
        }
      );
    } catch (error) {
      console.error('Error generating values cloud:', error);
      await ctx.reply(
        i18next.t('Error generating values cloud. Please try again.', {
          lng: language,
        })
      );
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.error('Error closing page:', closeError);
        }
      }
    }
  }
  async needscloud(ctx) {
    let needs = [];
    const holonId = ctx.message.chat.id;
    const language = await this.settings.getLanguage(holonId);
    const entities = ctx.message.entities;
    let mentions = entities.filter(
      entity => entity.type === 'mention' || entity.type === 'text_mention'
    );
    mentions = mentions.map(entity =>
      ctx.message.text.substring(
        entity.offset + 1,
        entity.offset + entity.length
      )
    );

    let users = await this.db.holosphere.getAll(holonId.toString(), 'users');
    //only select the mentioned users

    if (mentions.length > 0)
      users = users.filter(user => mentions.includes(user.username));

    for (let i = 0; i < users.length; i++) {
      needs = needs.concat(users[i].needs);
    }

    if (!this.isBrowserAvailable()) {
      await ctx.reply(
        i18next.t(
          'Image generation is not available. Please try the dashboard.',
          { lng: language }
        )
      );
      return;
    }

    let page = null;
    try {
      page = await browser.newPage();
      const path = './images/needscloud' + utils.getholonId(ctx) + '.png';
      page.setContent(fs.readFileSync('./html/cloud.html', 'utf8'));
      await page.addScriptTag({
        content: `
            const words = ${JSON.stringify(needs)};
            window.myWordCloud.update(getWords(words));
        `,
      });
      await page.waitForSelector('svg');

      // Screenshot the word cloud
      const svgElement = await page.$('svg');
      await svgElement.screenshot({
        path: path,
      });
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${holonId}/needs/`
            ),
          ]),
        }
      );
    } catch (error) {
      console.error('Error generating needs cloud:', error);
      await ctx.reply(
        i18next.t('Error generating needs cloud. Please try again.', {
          lng: language,
        })
      );
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (closeError) {
          console.error('Error closing page:', closeError);
        }
      }
    }
  }

  // Set up a command to display the quests
  async questboard(ctx) {
    if (!this.db) return;

    try {
      // Get a list of incomplete quests
      const holonId = ctx.message.chat.id;
      const language = await this.settings.getLanguage(holonId);
      const isTopic = ctx.message.is_topic_message;
      const threadId = isTopic ? ctx.message.message_thread_id : null;

      // holosphere.getAll resolves to Array<T>.
      let quests =
        (await this.db.holosphere.getAll(holonId.toString(), 'quests')) ?? [];

      // Filter by type and status. Federated holograms (source holon !==
      // current) are kept — they render with the cyan-glow style so they're
      // visually distinct from local tasks (matches holons's Tasks view).
      quests = quests.filter(
        quest =>
          (quest.type === 'task' ||
            quest.type === 'hologram' ||
            quest.type === 'recurring') &&
          (quest.status === 'ongoing' || quest.status === 'scheduled')
      );

      // If in a topic, filter further by message_thread_id
      if (isTopic && threadId) {
        quests = quests.filter(quest => quest.message_thread_id === threadId);
      }

      // Check if there are any quests to display
      if (!quests || quests.length === 0) {
        await ctx.reply(
          i18next.t('noquests', { lng: language }) || 'No tasks to display.'
        );
        return;
      }

      // Create inline keyboard buttons
      const inline_keyboard_buttons = quests.map(quest => {
        const title =
          typeof quest.title === 'string'
            ? quest.title.substring(0, 50)
            : 'Untitled Quest';
        // Get the source holon: prefer _hologram.sourceHolon for resolved holograms, then quest.holon/chat, fallback to holonId
        const sourceHolon =
          quest._hologram?.sourceHolon || getQuestHolon(quest) || holonId;
        const cbData = 'view_original_quest_' + sourceHolon + '_' + quest.id;
        if (cbData.length > 64)
          return [
            Markup.button.callback(
              title,
              'view_original_quest_' +
                sourceHolon +
                '_' +
                String(quest.id).slice(
                  0,
                  64 - ('view_original_quest_' + sourceHolon + '_').length
                )
            ),
          ];
        return [Markup.button.callback(title, cbData)];
      });

      inline_keyboard_buttons.push([
        Markup.button.url(
          i18next.t('Open Dashboard', { lng: language }),
          `${DASHBOARD_ADDRESS}/${holonId}/tasks`
        ),
      ]);

      // Try to generate the table image
      try {
        const path = await this.getQuestsTable(quests, holonId, ctx);

        if (path) {
          // Send the photo with buttons
          await ctx.replyWithPhoto(
            { source: fs.createReadStream(path) },
            {
              caption: createPaddedCaption(''),
              ...Markup.inlineKeyboard(inline_keyboard_buttons),
            }
          );
        } else {
          // Image generation failed, send just the buttons
          await ctx.reply(
            i18next.t('questboard', { lng: language }) || 'Task Board:',
            Markup.inlineKeyboard(inline_keyboard_buttons)
          );
        }
      } catch (imageError) {
        console.error('Error generating quest board image:', imageError);
        // Image generation failed, send just the buttons
        await ctx.reply(
          i18next.t('questboard', { lng: language }) || 'Task Board:',
          Markup.inlineKeyboard(inline_keyboard_buttons)
        );
      }
    } catch (err) {
      console.error('Error in questboard:', err);
      const language = await this.settings
        .getLanguage(ctx.message.chat.id)
        .catch(() => 'en');
      ctx.reply(
        i18next.t('questboardgenerror', { lng: language }) ||
          'Could not generate quest board image.'
      );
    }
  }

  async requestsboard(ctx) {
    if (!this.db) return;

    try {
      // Get a list of requests
      const holonId = ctx.message.chat.id;
      const language = await this.settings.getLanguage(holonId);
      const isTopic = ctx.message.is_topic_message;
      const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Get requests from quests collection using holosphere.getAll with holograms
      const allQuests =
        (await this.db.holosphere.getAll(holonId.toString(), 'quests')) || [];
      let requests = allQuests.filter(quest => quest.type === 'request');

      // If in a topic, filter further by message_thread_id
      if (isTopic && threadId) {
        requests = requests.filter(
          quest => quest.message_thread_id === threadId
        );
      }

      // Wait for the table image to be generated
      const path = await this.getRequestsTable(requests, holonId);

      if (!path) {
        ctx.reply(
          i18next.t('requestsboardgenerror', { lng: language }) ||
            'Could not generate requests board image.'
        );
        return;
      }

      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${holonId}/offers`
            ),
          ]),
        }
      );
    } catch (err) {
      console.error('Error in requestsboard:', err);
      const language = await this.settings
        .getLanguage(ctx.message.chat.id)
        .catch(() => 'en');
      ctx.reply(
        i18next.t('requestsboardgenerror', { lng: language }) ||
          'Could not generate requests board image.'
      );
    }
  }

  async offersboard(ctx) {
    if (!this.db) return;

    try {
      // Get a list of offers
      const holonId = ctx.message.chat.id;
      const language = await this.settings.getLanguage(holonId);
      const isTopic = ctx.message.is_topic_message;
      const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Get offers from quests collection using holosphere.getAll with holograms
      const allQuests =
        (await this.db.holosphere.getAll(holonId.toString(), 'quests')) || [];
      let offers = allQuests.filter(quest => quest.type === 'offer');

      // If in a topic, filter further by message_thread_id
      if (isTopic && threadId) {
        offers = offers.filter(quest => quest.message_thread_id === threadId);
      }

      // Wait for the table image to be generated
      const path = await this.getOffersTable(offers, holonId);

      if (!path) {
        ctx.reply(
          i18next.t('offersboardgenerror', { lng: language }) ||
            'Could not generate offers board image.'
        );
        return;
      }

      // Send the image
      await ctx.replyWithPhoto(
        { source: fs.createReadStream(path) },
        {
          caption: createPaddedCaption(''),
          ...Markup.inlineKeyboard([
            Markup.button.url(
              i18next.t('Open Dashboard', { lng: language }),
              `${DASHBOARD_ADDRESS}/${holonId}/offers/`
            ),
          ]),
        }
      );
    } catch (err) {
      console.error('Error in offersboard:', err);
      const language = await this.settings
        .getLanguage(ctx.message.chat.id)
        .catch(() => 'en');
      ctx.reply(
        i18next.t('offersboardgenerror', { lng: language }) ||
          'Could not generate offers board image.'
      );
    }
  }

  // Fast quest image generation with aggressive optimizations
  async getQuestImage(quest, holonId, isHologram = false) {
    // PERFORMANCE OPTIMIZATION: Skip heavy operations for faster generation
    const useSimplifiedMode =
      process.env.QUEST_IMAGE_FAST_MODE === 'true' || false;

    if (useSimplifiedMode) {
      return this.getSimplifiedQuestImage(quest, holonId, isHologram);
    }

    // Cache frequently used data to avoid repeated database calls
    const cachedLanguage =
      this.languageCache?.get(holonId) ||
      (await this.settings.getLanguage(holonId));
    if (!this.languageCache) this.languageCache = new Map();
    this.languageCache.set(holonId, cachedLanguage);

    // Check if this is a hologram by examining the quest's origin
    const questHolonId = getQuestHolon(quest);
    if (
      !isHologram &&
      questHolonId &&
      questHolonId.toString() !== holonId.toString()
    ) {
      isHologram = true;
    }
    // Also check for meta information indicating it's from another chat
    if (!isHologram && quest._meta && quest._meta.origin_chat_name) {
      isHologram = true;
    }

    // OPTIMIZED: Simple date formatting without timezone complexity
    const formatDate = timestamp => {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleDateString(cachedLanguage, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    // Status icon mapping
    const statusIcons = {
      ongoing: '🔄',
      completed: '✅',
      scheduled: '📅',
      stopped: '🛑',
    };

    // Type icon mapping
    const typeIcons = {
      task: '📋',
      quest: '⚔️',
      event: '📅',
      offer: '🎁',
      request: '🙏',
      todo: '✔️',
      mission: '🎯',
      hologram: '👻',
      recurring: '🔄',
    };

    const statusIcon = statusIcons[quest.status] || '❓';
    const typeIcon = typeIcons[quest.type] || '📝';

    // OPTIMIZED: Build minimal HTML structure for speed
    let infoRows = '';

    // Header with type, status badges, and initiator
    infoRows += `
      <div class="quest-header">
        <span class="quest-type">${typeIcon} ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}</span>
        <span class="quest-initiator-name">by ${getDisplayName(quest.initiator)}</span>
        <span class="quest-status">${statusIcon} ${quest.status}</span>
      </div>
    `;

    // Check if we have an image to determine layout
    let imageDataUrl = null;
    if (quest.picture) {
      try {
        // Telegram photo file_ids vary by DC/version (AgAC, AgAD, AAMC,
        // BAAL, ...). Treat anything that isn't already an http(s) or
        // data: URL as a file_id and resolve it via getFileLink — the
        // browser can't render a raw file_id in <img src>.
        if (
          /^https?:\/\//i.test(quest.picture) ||
          quest.picture.startsWith('data:')
        ) {
          imageDataUrl = quest.picture;
        } else {
          const fileUrl = await this.bot.telegram.getFileLink(quest.picture);
          const response = await fetch(fileUrl.href);
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const base64 = buffer.toString('base64');
          const mimeType = response.headers.get('content-type') || 'image/jpeg';
          imageDataUrl = `data:${mimeType};base64,${base64}`;
        }
      } catch (error) {
        console.log(
          'Failed to convert quest image:',
          error?.message || error,
          'picture prefix:',
          String(quest.picture).slice(0, 16)
        );
        imageDataUrl = null;
      }
    }

    // If we have an image, use side-by-side layout
    if (imageDataUrl) {
      infoRows += `
        <div class="quest-content-with-image">
          <div class="quest-info-side">
            <div class="quest-title">${quest.title}</div>
      `;
    } else {
      // No image, use full-width layout
      infoRows += `
        <div class="quest-title">${quest.title}</div>
      `;
    }

    // PERFORMANCE: Only add essential sections to reduce HTML complexity

    // Description if available (truncate for performance)
    if (quest.description) {
      const truncatedDesc =
        quest.description.length > 100
          ? quest.description.substring(0, 100) + '...'
          : quest.description;
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📝</div>
          <div class="section-content">${truncatedDesc}</div>
        </div>
      `;
    }

    // Participants (show names with time tracking, limit for performance)
    if (quest.participants && quest.participants.length > 0) {
      const maxParticipantsToShow = 5; // Limit for performance
      const participantsToShow = quest.participants.slice(
        0,
        maxParticipantsToShow
      );
      const participantBadges = participantsToShow
        .map(u => {
          const hours = quest.timeTracking && quest.timeTracking[u.id];
          if (hours && hours > 0) {
            return `<span class="participant-name">${getDisplayName(u)} (${hours.toFixed(2)}h)</span>`;
          }
          return `<span class="participant-name">${getDisplayName(u)}</span>`;
        })
        .join(' ');

      const extraCount =
        quest.participants.length > maxParticipantsToShow
          ? ` +${quest.participants.length - maxParticipantsToShow} more`
          : '';

      infoRows += `
        <div class="quest-section">
          <div class="section-label">🙋‍♂</div>
          <div class="section-content participants">${participantBadges}${extraCount}</div>
        </div>
      `;
    }

    // Appreciation (show names, limit for performance)
    if (quest.appreciation && quest.appreciation.length > 0) {
      const maxAppreciationsToShow = 5; // Limit for performance
      const appreciationsToShow = quest.appreciation.slice(
        0,
        maxAppreciationsToShow
      );
      const appreciationBadges = appreciationsToShow
        .map(u => `<span class="participant-name">${getDisplayName(u)}</span>`)
        .join(' ');

      const extraCount =
        quest.appreciation.length > maxAppreciationsToShow
          ? ` +${quest.appreciation.length - maxAppreciationsToShow} more`
          : '';

      infoRows += `
        <div class="quest-section">
          <div class="section-label">👍</div>
          <div class="section-content">${appreciationBadges}${extraCount}</div>
        </div>
      `;
    }

    // Dependencies (if any)
    if (quest.dependencies && quest.dependencies.length > 0) {
      try {
        const depHolonId = getQuestHolon(quest);
        const deps = await Promise.all(
          quest.dependencies.map(async id => {
            const dep = await this.db.holosphere.get(depHolonId, 'quests', id);
            return dep?.title || '';
          })
        );
        const dependencyTitles = deps.filter(d => d).join(', ');
        if (dependencyTitles) {
          infoRows += `
            <div class="quest-section">
              <div class="section-label">🔗</div>
              <div class="section-content">${dependencyTitles}</div>
            </div>
          `;
        }
      } catch (error) {
        // Silently skip dependencies if there's an error
      }
    }

    // Timing information (simplified)
    if (quest.when) {
      infoRows += `
        <div class="quest-section">
          <div class="section-label">📅</div>
          <div class="section-content">${formatDate(quest.when)}</div>
        </div>
      `;
    }

    // Close the layout sections
    if (imageDataUrl) {
      infoRows += `
          </div>
          <div class="quest-image-side">
            <img src="${imageDataUrl}" alt="Quest image" class="quest-side-image" />
          </div>
        </div>
      `;
    }

    // SKIP HEAVY OPERATIONS FOR PERFORMANCE:
    // - Skip timezone calculations
    // - Skip dependency lookups
    // - Skip checklist queries
    // - Skip complex time tracking calculations

    // Determine CSS classes based on quest status
    let containerClasses = 'quest-card-container';
    containerClasses += ` ${quest.status}`;

    if (quest.participants && quest.participants.length > 0) {
      containerClasses += ' has-participants';
    }

    if (quest.type === 'hologram' || isHologram) {
      containerClasses += ' hologram';
    }

    // Get hologram source name with timeout
    let hologramBadge = '';
    if (isHologram) {
      let hologramSource = '';

      // First try meta information
      if (quest._meta && quest._meta.origin_chat_name) {
        hologramSource = quest._meta.origin_chat_name;
      }
      // Then try to get actual holon name with timeout using utility function
      else {
        const holonSrcId = getQuestHolon(quest);
        if (holonSrcId) {
          try {
            // Check cache first for performance
            const cacheKey = `holon_name_${holonSrcId}`;
            const cached = this.holonNameCache.get(cacheKey);

            if (cached && cached.expires > Date.now()) {
              hologramSource = cached.value;
            } else {
              // Add timeout to holon name lookup using the utility function
              const holonNamePromise = getHolonName(this.db, holonSrcId, null);

              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error('Holon name lookup timeout')),
                  2000
                )
              );

              // Use the utility function result directly, it has its own fallback logic
              const nameFromUtil = await Promise.race([
                holonNamePromise,
                timeoutPromise,
              ]);
              hologramSource = nameFromUtil || 'Unknown Holon';

              // Cache the result with expiry timestamp (no individual setTimeout)
              this.holonNameCache.set(cacheKey, {
                value: hologramSource,
                expires: Date.now() + this.holonNameCacheExpiry,
              });
            }
          } catch (e) {
            hologramSource = 'External Holon';
          }
        }
      }

      // Show badge for meaningful holon names (not generic fallbacks or chat IDs)
      if (
        hologramSource &&
        hologramSource.trim() !== '' &&
        !hologramSource.startsWith('Holon ') &&
        hologramSource !== 'Unknown Holon' &&
        hologramSource !== 'External Holon'
      ) {
        hologramBadge = `<div class="hologram-badge">📡 ${hologramSource}</div>`;
      }
    }

    // OPTIMIZED: Minimal HTML structure
    const element = `
      <div class="${containerClasses}">
        <div class="quest-card">
          ${infoRows}
          <div class="quest-footer">
            <div class="quest-id">ID: #${quest.id}</div>
            <div class="quest-date">Created: ${formatDate(quest.created || quest.date)}</div>
          </div>
          ${hologramBadge}
        </div>
      </div>
    `;

    // Include source chat/holon ID and hologram status in filename for unique identification
    const sourceIdentifier = holonId ? holonId.toString() : 'unknown';
    const hologramSuffix = isHologram ? '_hologram' : '';
    const path = `./images/quest${quest.id}_from_${sourceIdentifier}${hologramSuffix}.png`;

    // PERFORMANCE: Cache theme data to avoid repeated lookups
    const cachedTheme =
      this.themeCache?.get(holonId) || (await this.settings.getTheme(holonId));
    if (!this.themeCache) this.themeCache = new Map();
    this.themeCache.set(holonId, cachedTheme);

    const html = await this.generateHtml(element, cachedTheme);
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.quest-card-container'
    );
    return _ssResult !== null ? path : null;
  }

  // Helper function to convert picture file_id to HTML with embedded base64
  async getSimplePictureHtml(picture) {
    try {
      let imageDataUrl;
      if (/^https?:\/\//i.test(picture) || picture.startsWith('data:')) {
        imageDataUrl = picture;
      } else {
        // Telegram file_id — resolve to a fetchable URL and inline as base64.
        const fileUrl = await this.bot.telegram.getFileLink(picture);
        const response = await fetch(fileUrl.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        imageDataUrl = `data:${mimeType};base64,${base64}`;
      }

      return `<div class="simple-picture"><img src="${imageDataUrl}" alt="Quest image" class="simple-quest-image" /></div>`;
    } catch (error) {
      console.log(
        'Failed to convert simple quest image:',
        error?.message || error,
        'picture prefix:',
        String(picture).slice(0, 16)
      );
      return '';
    }
  }

  // Ultra-fast simplified quest image for immediate updates
  async getSimplifiedQuestImage(quest, holonId, isHologram = false) {
    const statusIcon =
      quest.status === 'completed'
        ? '✅'
        : quest.status === 'stopped'
          ? '🛑'
          : quest.status === 'scheduled'
            ? '📅'
            : '🔄';

    const typeIcon =
      quest.type === 'task' ? '📋' : quest.type === 'event' ? '📅' : '⚔️';

    // Minimal HTML for maximum speed
    const element = `
      <div class="simple-quest-card">
        <div class="simple-header">
          <span class="simple-type">${typeIcon}</span>
          <span class="simple-status">${statusIcon}</span>
        </div>
        <div class="simple-title">${quest.title}</div>
        ${quest.picture ? await this.getSimplePictureHtml(quest.picture) : ''}
        <div class="simple-footer">
          <span class="simple-participants">🙋‍♂ ${quest.participants?.length || 0}</span>
          <span class="simple-appreciation">👍 ${quest.appreciation?.length || 0}</span>
          ${quest.dependencies?.length > 0 ? `<span class="simple-dependencies">🔗 ${quest.dependencies.length}</span>` : ''}
        </div>
      </div>
    `;

    // Include source chat/holon ID and hologram status in filename for unique identification
    const sourceIdentifier = holonId ? holonId.toString() : 'unknown';
    const hologramSuffix = isHologram ? '_hologram' : '';
    const path = `./images/quest_simple_${quest.id}_from_${sourceIdentifier}${hologramSuffix}.png`;

    // Use minimal CSS for speed
    const simpleCss = `
      .simple-quest-card {
        width: 300px;
        padding: 20px;
        background: #2c3e50;
        border-radius: 10px;
        color: white;
        font-family: Arial, sans-serif;
      }
      .simple-header {
        display: flex;
        justify-content: space-between;
        font-size: 24px;
        margin-bottom: 10px;
      }
      .simple-title {
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 15px;
        color: #ecf0f1;
      }
      .simple-picture {
        margin: 10px 0;
        text-align: center;
      }
      .simple-quest-image {
        max-width: 100%;
        max-height: 200px;
        border-radius: 8px;
        object-fit: cover;
      }
      .simple-footer {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        color: #95a5a6;
      }
    `;

    const html = await this.generateHtml(element, simpleCss);
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.simple-quest-card'
    );
    return _ssResult !== null ? path : null;
  }

  async getBulletinTable(users, quests, holonId) {
    const language = await this.settings.getLanguage(holonId);
    const rows = [];

    // Get quest-based offers and requests
    const questOffers = quests.filter(
      quest => quest.type === 'offer' && quest.status !== 'completed'
    );
    const questRequests = quests.filter(
      quest => quest.type === 'request' && quest.status !== 'completed'
    );

    // Create a map to combine user profile data with quest data
    const userMap = new Map();

    // First, add users from user profiles
    for (const user of users) {
      const userId = user.id;
      userMap.set(userId, {
        user: user,
        // A member's profile "wants" are their declared needs; there is no
        // profile-offers field — offers come from quests (type 'offer').
        profileWants: user.needs || [],
        profileOffers: [],
        questRequests: [],
        questOffers: [],
      });
    }

    // Then, add quest-based offers and requests
    for (const quest of questOffers) {
      if (quest.initiator && quest.initiator.id) {
        const userId = quest.initiator.id;
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            user: quest.initiator,
            profileWants: [],
            profileOffers: [],
            questRequests: [],
            questOffers: [],
          });
        }
        userMap.get(userId).questOffers.push(quest.title);
      }
    }

    for (const quest of questRequests) {
      if (quest.initiator && quest.initiator.id) {
        const userId = quest.initiator.id;
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            user: quest.initiator,
            profileWants: [],
            profileOffers: [],
            questRequests: [],
            questOffers: [],
          });
        }
        userMap.get(userId).questRequests.push(quest.title);
      }
    }

    // Generate rows for users who have any wants or offers
    for (const [, userData] of userMap) {
      const totalWants =
        userData.profileWants.length + userData.questRequests.length;
      const totalOffers =
        userData.profileOffers.length + userData.questOffers.length;

      if (totalWants > 0 || totalOffers > 0) {
        // Combine profile wants and quest requests
        const allWants = [...userData.profileWants, ...userData.questRequests];
        const wantsList =
          allWants.length > 0
            ? allWants
                .map(
                  want =>
                    `<span class="item-text" style="font-size: 18px;">${want}</span>`
                )
                .join('<br/>')
            : '<span class="no-items" style="font-size: 18px;">-</span>';

        // Combine profile offers and quest offers
        const allOffers = [...userData.profileOffers, ...userData.questOffers];
        const offersList =
          allOffers.length > 0
            ? allOffers
                .map(
                  offer =>
                    `<span class="item-text" style="font-size: 18px;">${offer}</span>`
                )
                .join('<br/>')
            : '<span class="no-items" style="font-size: 18px;">-</span>';

        const row = `<tr class="bulletin-row">
          <td class="name-cell-compact">
            <div class="user-info-compact" style="font-size: 18px;">
              <div class="user-name-compact" style="font-size: 20px; font-weight: bold;">${getDisplayName(userData.user)}</div>
            </div>
          </td>
          <td class="wants-cell-expanded">
            <div class="items-container-expanded" style="font-size: 18px;">
              ${wantsList}
            </div>
          </td>
          <td class="offers-cell-expanded">
            <div class="items-container-expanded" style="font-size: 18px;">
              ${offersList}
            </div>
          </td>
        </tr>`;

        rows.push(row);
      }
    }

    // Handle empty case
    if (rows.length === 0) {
      rows.push(`<tr class="empty-row">
        <td colspan="3" class="empty-cell">
          <div class="empty-message">No offers or requests found. Create some with /offer [description] or /request [description]</div>
        </td>
      </tr>`);
    }

    const element = `<div class="status-table-container" style="font-size: 18px;">
      <div class="table-wrapper">
        <table class="status-table bulletin-table" style="font-size: 18px;">
          <colgroup>
            <col style="width: 12%;">
            <col style="width: 44%;">
            <col style="width: 44%;">
          </colgroup>
          <thead>
            <tr>
              <th class="name-header-compact" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('name', { lng: language })}</th>
              <th class="wants-header-expanded" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Wants', { lng: language })}</th>
              <th class="offers-header-expanded" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Offers', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/offersneeds' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }

  async getCreditTable(creditMatrix, userArray, holonId) {
    const language = await this.settings.getLanguage(holonId);
    const rows = [];
    userArray.forEach((user, index) => {
      const credits = creditMatrix[index]
        .map((credit, creditIndex) => {
          const color =
            credit > 0
              ? 'color: #28a745;'
              : credit < 0
                ? 'color: #dc3545;'
                : '';
          return `<td style="text-align: center; white-space: normal; word-wrap: break-word; ${color}">${credit.toFixed(2)}</td>`;
        })
        .join('');
      const total = creditMatrix[index].reduce((a, b) => a + b, 0);
      const totalColor =
        total > 0 ? 'color: #28a745;' : total < 0 ? 'color: #dc3545;' : '';
      const row = `<tr>
          <td style="text-align: center; white-space: normal; word-wrap: break-word;">${user}</td>
          ${credits}
          <td style="text-align: center; white-space: normal; word-wrap: break-word; ${totalColor}">${total.toFixed(2)}</td>
        </tr>`;
      rows.push(row);
    });

    const headers = userArray
      .map(
        (user, index) =>
          `<th scope="col" style="writing-mode: vertical-rl; text-orientation: mixed; text-align: center; white-space: normal; word-wrap: break-word;">${user}</th>`
      )
      .join('');
    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th scope="col" style="text-align: center; white-space: normal; word-wrap: break-word;">${i18next.t('User', { lng: language })}</th>
              ${headers}
              <th scope="col" style="text-align: center; white-space: normal; word-wrap: break-word;">${i18next.t('Total', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/creditMatrix' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }

  async getQuestsTable(quests, holonId, ctx) {
    // Big boards make slow, unreadably tall chat pictures — skip the image
    // and let the caller fall back to the buttons-only reply.
    const MAX_QUESTS_FOR_IMAGE = 13;
    if (quests.length > MAX_QUESTS_FOR_IMAGE) {
      console.log(
        `Quest board has ${quests.length} quests (> ${MAX_QUESTS_FOR_IMAGE}), skipping image generation`
      );
      return null;
    }

    const language = await this.settings.getLanguage(holonId);
    const settings = await this.settings.getSettings(holonId);
    const isDark = (settings?.theme || 'dark') !== 'light';

    // Holons-aligned palette. Dark mirrors holons's gray-900/800/700 stack
    // with indigo accent; light keeps the prior light look.
    const p = isDark
      ? {
          bg: '#111827', // page surface (gray-900)
          cardBorder: 'rgba(255,255,255,0.06)',
          cardShadow: '0 1px 3px rgba(0,0,0,0.4)',
          titleColor: '#ffffff',
          titleCompletedColor: '#9ca3af',
          subtitleColor: '#9ca3af',
          descColor: '#d1d5db',
          countColor: '#9ca3af',
          checkboxIdleBg: 'rgba(255,255,255,0.08)',
          checkboxIdleFg: '#d1d5db',
          pillBg: 'rgba(255,255,255,0.08)',
          pillFg: '#d1d5db',
          hologramBg: 'rgba(59,130,246,0.18)',
          hologramFg: '#93c5fd',
        }
      : {
          bg: '#f3f4f6',
          cardBorder: 'rgba(0,0,0,0.06)',
          cardShadow: '0 1px 3px rgba(0,0,0,0.08)',
          titleColor: '#111827',
          titleCompletedColor: '#4b5563',
          subtitleColor: '#6b7280',
          descColor: '#4b5563',
          countColor: '#374151',
          checkboxIdleBg: 'rgba(0,0,0,0.12)',
          checkboxIdleFg: '#374151',
          pillBg: 'rgba(0,0,0,0.1)',
          pillFg: '#374151',
          hologramBg: 'rgba(59,130,246,0.18)',
          hologramFg: '#1e40af',
        };

    const cards = [];
    for (const quest of quests) {
      let provenanceText = '';
      let isHologram = false;

      // Source holon: prefer the resolver-attached _hologram.sourceHolon,
      // then _meta.origin_chat_name, then the legacy holon/chat fields.
      const sourceHolonId =
        quest._hologram?.sourceHolon ?? getQuestHolon(quest);

      if (
        quest._hologram?.isHologram ||
        quest._meta?.origin_chat_name ||
        (sourceHolonId && sourceHolonId.toString() !== holonId.toString())
      ) {
        isHologram = true;
        if (quest._meta?.origin_chat_name) {
          provenanceText = quest._meta.origin_chat_name;
        } else if (sourceHolonId) {
          // getHolonName returns the literal strings 'External Holon' /
          // 'Unknown Holon' when it can't resolve a real name. Treat those
          // as no-name and show the actual holon ID instead — that's the
          // origin the user actually wants to see.
          let resolved = '';
          try {
            resolved =
              (await utils.getHolonName(this.db, sourceHolonId, ctx)) || '';
          } catch (e) {
            console.warn(
              `Could not get holon name for holon ${sourceHolonId}:`,
              e
            );
          }
          const isGenericFallback =
            !resolved.trim() ||
            resolved === 'External Holon' ||
            resolved === 'Unknown Holon';
          provenanceText = isGenericFallback
            ? `${i18next.t('holon_prefix', { lng: language, defaultValue: 'Holon' })} ${sourceHolonId}`
            : resolved;
        } else {
          provenanceText = i18next.t('hologram', {
            lng: language,
            defaultValue: 'Hologram',
          });
        }
      }

      const completed = quest.status === 'completed';
      const cardBg = colorFromCategory(quest.category, quest.type, isDark);
      const checkboxBg = completed ? '#10b981' : p.checkboxIdleBg;
      const checkboxFg = completed ? '#ffffff' : p.checkboxIdleFg;
      const checkIcon = completed
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>'
        : quest.type === 'event' || quest.when
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>'
          : quest.type === 'recurring' || quest.status === 'recurring'
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';

      const titleStyle = completed
        ? `text-decoration: line-through; color: ${p.titleCompletedColor};`
        : `color: ${p.titleColor};`;

      const categoryPill = quest.category
        ? `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:13px;background:${p.pillBg};color:${p.pillFg};font-weight:500;">${escapeHtml(quest.category)}</span>`
        : '';

      const hologramPill = isHologram
        ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:9999px;font-size:13px;font-weight:500;background:${p.hologramBg};color:${p.hologramFg};">📡 ${escapeHtml(provenanceText)}</span>`
        : '';

      const participantCount = quest.participants?.length || 0;
      const appreciationCount = quest.appreciation?.length || 0;
      const counts = [
        participantCount
          ? `<span style="white-space:nowrap;">👥 ${participantCount}</span>`
          : '',
        appreciationCount
          ? `<span style="white-space:nowrap;">👍 ${appreciationCount}</span>`
          : '',
      ]
        .filter(Boolean)
        .join('');

      const description = quest.description
        ? `<div style="font-size:14px;color:${p.descColor};line-height:1.4;max-height:2.8em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:4px;">${escapeHtml(quest.description)}</div>`
        : '';

      cards.push(`<div class="quest-card-item${isHologram ? ' hologram' : ''}" style="background-color:${cardBg};border-radius:12px;padding:14px 16px;margin:8px 0;border:1px solid ${p.cardBorder};box-shadow:${p.cardShadow};">
  <div style="display:flex;align-items:center;gap:14px;">
    <div style="width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${checkboxBg};color:${checkboxFg};flex-shrink:0;">${checkIcon}</div>
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:18px;font-weight:700;${titleStyle}">${escapeHtml(quest.title || 'Untitled')}</span>
        ${categoryPill}
        ${hologramPill}
      </div>
      ${description}
    </div>
    <div style="display:flex;align-items:center;gap:12px;font-size:14px;color:${p.countColor};flex-shrink:0;">${counts}</div>
  </div>
</div>`);
    }

    const element = `<div class="quest-list-container" style="background:${p.bg};padding:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;width:1100px;box-sizing:border-box;">
  <div style="font-size:22px;font-weight:700;color:${p.titleColor};margin-bottom:8px;">${escapeHtml(i18next.t('Quests', { lng: language }))}</div>
  <div style="font-size:13px;color:${p.subtitleColor};margin-bottom:14px;">👥 ${escapeHtml(i18next.t('People', { lng: language }))} · 👍 ${escapeHtml(i18next.t('Appreciation', { lng: language }))}</div>
  ${cards.join('\n')}
</div>`;

    const path = './images/quests' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.quest-list-container'
    );
    return _ssResult !== null ? path : null;
  }

  async getRolesTable(roles, holonId) {
    const language = await this.settings.getLanguage(holonId);
    const rows = [];

    if (roles.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message" style="font-size: 18px; text-align: center;">No roles found. Create one with /addrole [role name]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const participantsList =
          role.participants && role.participants.length > 0
            ? role.participants
                .map(
                  participant =>
                    `<span class="participant-name" style="font-size: 18px;">${getDisplayName(participant)}</span>`
                )
                .join(' ')
            : '<span class="no-participants" style="font-size: 18px;">-</span>';

        const row = `<tr class="role-row">
            <td class="role-cell">
              <div class="role-info" style="font-size: 18px; text-align: center;">
                <span class="role-title" style="font-size: 22px; font-weight: bold;">${role.title}</span>
                ${role.description ? `<div class="role-description" style="font-size: 16px;">${role.description}</div>` : ''}
              </div>
            </td>
            <td class="participants-cell">
              <div class="participants-info" style="font-size: 18px; text-align: center;">
                ${participantsList}
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container" style="font-size: 18px; background: transparent !important; border: none !important; box-shadow: none !important;">
      <div class="table-wrapper">
        <table class="status-table" style="font-size: 18px; background: transparent !important; border: none !important;">
          <thead>
            <tr>
              <th class="role-header" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('Roles', { lng: language })}</th>
              <th class="participants-header" style="font-size: 20px; font-weight: bold; text-align: center;">${i18next.t('People', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/roles' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }

  async getRequestsTable(requests, holonId) {
    const language = await this.settings.getLanguage(holonId);

    const rows = [];

    if (requests.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message">No requests found. Create one with /request [description]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const row = `<tr class="request-row">
            <td class="name-cell">
              <div class="user-info">
                <div class="user-details">
                  <span class="user-name">${getDisplayName(request.initiator)}</span>
                  ${request.initiator && request.initiator.username ? `<span class="user-handle">@${request.initiator.username}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="request-cell">
              <div class="request-info">
                <span class="request-title">${request.title}</span>
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="name-header" style="text-align: center;">${i18next.t('Person', { lng: language })}</th>
              <th class="request-header" style="text-align: center;">${i18next.t('Request', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/requests' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }

  async getOffersTable(offers, holonId) {
    const language = await this.settings.getLanguage(holonId);

    const rows = [];

    if (offers.length === 0) {
      // Handle empty case
      rows.push(`<tr class="empty-row">
        <td colspan="2" class="empty-cell">
          <div class="empty-message">No offers found. Create one with /offer [description]</div>
        </td>
      </tr>`);
    } else {
      for (let i = 0; i < offers.length; i++) {
        const offer = offers[i];
        const row = `<tr class="offer-row">
            <td class="name-cell">
              <div class="user-info">
                <div class="user-details">
                  <span class="user-name">${getDisplayName(offer.initiator)}</span>
                  ${offer.initiator && offer.initiator.username ? `<span class="user-handle">@${offer.initiator.username}</span>` : ''}
                </div>
              </div>
            </td>
            <td class="offer-cell">
              <div class="offer-info">
                <span class="offer-title">${offer.title}</span>
              </div>
            </td>
          </tr>`;

        rows.push(row);
      }
    }

    const element = `<div class="status-table-container">
      <div class="table-wrapper">
        <table class="status-table">
          <thead>
            <tr>
              <th class="name-header" style="text-align: center;">${i18next.t('Person', { lng: language })}</th>
              <th class="offer-header" style="text-align: center;">${i18next.t('Offer', { lng: language })}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;

    const path = './images/offers' + holonId + '.png';
    const html = await this.generateHtml(
      element,
      await this.settings.getTheme(holonId)
    );
    const _ssResult = await this.screenshotHtml(
      html,
      path,
      '.status-table-container'
    );
    return _ssResult !== null ? path : null;
  }

  async generateHtml(element, theme) {
    // Kill all motion at render time — themes are shared with the web UI, so
    // override here instead of editing them. Static screenshots don't need
    // transitions or keyframes, and zeroing them avoids paint churn.
    const killMotion = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    `;
    return (
      `<!DOCTYPE html>
      <html>
      <head>
      <style>` +
      theme +
      killMotion +
      `</style>
      </head>
      <body>` +
      element.toString() +
      `</body>
      </html>`
    );
  }

  async screenshotHtml(html, pathToSave, onElement) {
    if (!browserAvailable) {
      console.warn('Browser not available, skipping screenshot generation');
      return null;
    }

    if (!browser || !browser.connected) {
      console.log('Launching optimized browser instance...');
      // Drop any pages from a previous (dead) browser before relaunching.
      await closePagePool();
      browser = await puppeteer.launch(this.getPuppeteerLaunchOptions());
      browserAvailable = true;
    }

    // Puppeteer will not create parent dirs for `path:`. Different launchers
    // (root vs. package cwd) put `./images` in different places, so make it
    // here rather than relying on a checked-in folder.
    const lastSlash = pathToSave.lastIndexOf('/');
    if (lastSlash > 0) {
      try {
        fs.mkdirSync(pathToSave.slice(0, lastSlash), { recursive: true });
      } catch (e) {
        console.warn('Could not create screenshot directory:', e.message);
      }
    }

    const klass = viewportClassFor(onElement);
    const page = await acquirePage(klass);
    if (!page) return null;

    let pageBroken = false;

    try {
      // 1x DPR everywhere: 2x quadruples pixels, blowing PNG/JPEG encode time
      // past protocolTimeout on low-RAM hosts. Telegram resamples anyway.
      let initialViewport = { width: 1200, height: 800, deviceScaleFactor: 1 };

      if (klass === 'table') {
        initialViewport = { width: 1400, height: 1200, deviceScaleFactor: 1 };
      } else if (klass === 'quest-card') {
        initialViewport = { width: 800, height: 600, deviceScaleFactor: 1 };
      }

      page.setDefaultTimeout(5000);
      await page.setViewport(initialViewport);
      // Reset the frame tree before loading new content. Reused pages can
      // otherwise carry in-flight fetches, pending animation frames, or stale
      // compositor state from the previous screenshot, which is a known cause
      // of Page.captureScreenshot hanging until protocolTimeout.
      await page.goto('about:blank');
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      try {
        await page.waitForSelector(onElement, { timeout: 2000 });
      } catch {
        console.warn('Element wait timeout, proceeding anyway');
      }

      try {
        await page.evaluate(() =>
          Promise.all(
            Array.from(document.images).map(img => {
              if (img.complete && img.naturalWidth > 0)
                return Promise.resolve();
              const ready = img.decode
                ? img.decode().catch(() => {})
                : new Promise(res => {
                    img.addEventListener('load', res, { once: true });
                    img.addEventListener('error', res, { once: true });
                  });
              const timeout = new Promise(res => setTimeout(res, 1500));
              return Promise.race([ready, timeout]);
            })
          )
        );
      } catch {
        // best-effort: proceed even if some images fail to decode
      }

      // JPEG encodes far faster than PNG on large viewports. Quest cards and
      // tables are opaque, so transparency loss is irrelevant. Telegram sniffs
      // content from bytes, so the .png path on disk is harmless.
      const screenshotOptions = {
        path: pathToSave,
        type: 'jpeg',
        quality: 85,
        omitBackground: false,
        captureBeyondViewport: false,
      };

      try {
        const elementInfo = await page.evaluate(selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            x: Math.max(0, rect.left),
            y: Math.max(0, rect.top),
            width: rect.width,
            height: rect.height,
            scrollWidth: element.scrollWidth || rect.width,
            scrollHeight: element.scrollHeight || rect.height,
          };
        }, onElement);

        if (elementInfo && elementInfo.width > 0 && elementInfo.height > 0) {
          const shouldResize =
            elementInfo.scrollHeight > initialViewport.height ||
            elementInfo.scrollWidth > initialViewport.width;

          if (shouldResize) {
            const newViewport = {
              width: Math.max(
                initialViewport.width,
                Math.ceil(elementInfo.scrollWidth + 100)
              ),
              height: Math.max(
                initialViewport.height,
                Math.ceil(elementInfo.scrollHeight + 100)
              ),
            };

            const MAX_VIEWPORT_HEIGHT = 5000;
            const MAX_VIEWPORT_WIDTH = 5000;

            if (
              newViewport.height > MAX_VIEWPORT_HEIGHT ||
              newViewport.width > MAX_VIEWPORT_WIDTH
            ) {
              console.log(
                `Viewport too large (${newViewport.width}x${newViewport.height}), skipping image generation`
              );
              return null;
            }

            // Downscale large boards: it's a chat picture, and Telegram
            // recompresses anyway. Fewer pixels = faster raster + encode.
            // deviceScaleFactor only shrinks the output bitmap — layout and
            // clip coordinates stay in CSS pixels.
            const MAX_OUTPUT_PIXELS = 2_000_000;
            const outputPixels = newViewport.width * newViewport.height;
            newViewport.deviceScaleFactor =
              outputPixels > MAX_OUTPUT_PIXELS
                ? Math.max(0.5, Math.sqrt(MAX_OUTPUT_PIXELS / outputPixels))
                : 1;

            console.log(
              `Resizing viewport for ${onElement}: ${newViewport.width}x${newViewport.height} @${newViewport.deviceScaleFactor.toFixed(2)}x`
            );
            await page.setViewport(newViewport);
            await page.evaluate(
              () =>
                new Promise(res =>
                  requestAnimationFrame(() => requestAnimationFrame(res))
                )
            );

            const updatedElementInfo = await page.evaluate(selector => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return {
                x: Math.max(0, rect.left),
                y: Math.max(0, rect.top),
                width: rect.width,
                height: rect.height,
              };
            }, onElement);

            if (updatedElementInfo) {
              screenshotOptions.clip = {
                x: updatedElementInfo.x,
                y: updatedElementInfo.y,
                width: updatedElementInfo.width,
                height: updatedElementInfo.height,
              };
            }
          } else {
            screenshotOptions.clip = {
              x: elementInfo.x,
              y: elementInfo.y,
              width: elementInfo.width,
              height: elementInfo.height,
            };
          }
        }
      } catch (clipError) {
        // A protocol-level failure means the CDP connection is wedged; the
        // fallback full-page screenshot would just hang on the same
        // connection. Bail out so the outer handler restarts the browser.
        if (
          clipError.message?.includes('Protocol error') ||
          clipError.message?.includes('Connection closed') ||
          clipError.message?.includes('Target closed') ||
          clipError.message?.includes('timed out')
        ) {
          throw clipError;
        }
        console.warn(
          'Element clipping failed, using full page screenshot:',
          clipError.message
        );
      }

      await page.screenshot(screenshotOptions);
    } catch (error) {
      console.error('Screenshot error:', error);

      // Connection-level errors mean the browser/page is unusable.
      // Mark the page as broken so the pool will discard it, and tear
      // down the browser so the next call relaunches.
      if (
        error.message?.includes('Protocol error') ||
        error.message?.includes('Connection closed') ||
        error.message?.includes('Target closed') ||
        error.message?.includes('timed out')
      ) {
        pageBroken = true;
        console.log('Browser connection lost, attempting quick restart...');
        try {
          if (browser) await browser.close().catch(() => {});
        } catch (closeError) {
          console.error('Error closing browser:', closeError);
        }
        browser = null;
      }
      throw error;
    } finally {
      releasePage(klass, { discard: pageBroken });
    }
  }

  async getZoneDistributionChart(a, b, c, nzones = 6, holonId) {
    // Calculate zone weights and percentages
    let totalWeight = 0;
    const zoneData = [];
    let maxWeight = 0;

    for (let zone = 0; zone < nzones; zone++) {
      const weight = Math.max(0, a * zone * zone + b * zone + c);
      totalWeight += weight;
      maxWeight = Math.max(maxWeight, weight);
      zoneData.push({ zone, weight });
    }

    // Generate SVG chart
    const chartWidth = 1200;
    const chartHeight = 500;
    const padding = 80;
    const barWidth = ((chartWidth - 2 * padding) / nzones) * 0.8;
    const maxBarHeight = chartHeight - 2 * padding;

    // Generate bars and function curve
    const bars = [];
    const curvePoints = [];
    const labels = [];

    for (let i = 0; i < zoneData.length; i++) {
      const zoneInfo = zoneData[i];
      const percentage =
        totalWeight > 0
          ? ((zoneInfo.weight / totalWeight) * 100).toFixed(1)
          : '0.0';
      const barHeight =
        maxWeight > 0 ? (zoneInfo.weight / maxWeight) * maxBarHeight : 0;
      const x =
        padding +
        (i * (chartWidth - 2 * padding)) / nzones +
        (chartWidth - 2 * padding) / nzones / 2;
      const y = chartHeight - padding - barHeight;

      // Generate gradient colors
      const hue = 240 + (i / nzones) * 120; // Blue to cyan spectrum
      const saturation = 70 + (zoneInfo.weight / maxWeight) * 30;
      const lightness = 50 + (zoneInfo.weight / maxWeight) * 20;

      bars.push(`
        <rect x="${x - barWidth / 2}" y="${y}" width="${barWidth}" height="${barHeight}" 
              fill="hsl(${hue}, ${saturation}%, ${lightness}%)" 
              stroke="rgba(255,255,255,0.3)" stroke-width="1"
              rx="4" ry="4" class="bar-rect"/>
      `);

      // Function curve points
      const curveY =
        maxWeight > 0
          ? chartHeight - padding - (zoneInfo.weight / maxWeight) * maxBarHeight
          : chartHeight - padding;
      curvePoints.push(`${x},${curveY}`);

      // Labels
      labels.push(`
        <text x="${x}" y="${chartHeight - padding + 25}" text-anchor="middle" 
              fill="#e0e0e0" font-size="14" font-weight="bold">Zone ${zoneInfo.zone}</text>
        <text x="${x}" y="${chartHeight - padding + 45}" text-anchor="middle" 
              fill="#a0a0a0" font-size="12">${percentage}%</text>
      `);
    }

    // Generate smooth curve path
    const curvePath = `M ${curvePoints.join(' L ')}`;

    // Generate grid lines
    const gridLines = [];
    for (let i = 0; i <= 5; i++) {
      const y = padding + (maxBarHeight / 5) * i;
      const percentage = (((5 - i) / 5) * 100).toFixed(0);
      gridLines.push(`
        <line x1="${padding}" y1="${y}" x2="${chartWidth - padding}" y2="${y}" 
              stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="5,5"/>
        <text x="${padding - 10}" y="${y + 4}" text-anchor="end" fill="#808080" font-size="12">${percentage}%</text>
      `);
    }

    const formulaDisplay = `f(x) = ${a}x² + ${b}x + ${c}`;

    const element = `
      <div class="chart-container">
        <div class="header">
          <div class="formula">📐 ${formulaDisplay}</div>
        </div>
        
        <svg width="${chartWidth}" height="${chartHeight}" class="main-chart">
          <defs>
            <linearGradient id="curveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#ff6b6b;stop-opacity:0.8" />
              <stop offset="50%" style="stop-color:#4ecdc4;stop-opacity:0.8" />
              <stop offset="100%" style="stop-color:#45b7d1;stop-opacity:0.8" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge> 
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          <!-- Grid -->
          ${gridLines.join('')}
          
          <!-- Bars -->
          ${bars.join('')}
          
          <!-- Function curve -->
          <path d="${curvePath}" fill="none" stroke="url(#curveGradient)" 
                stroke-width="4" filter="url(#glow)"/>
          
          <!-- Curve points -->
          ${curvePoints
            .map((point, i) => {
              const [x, y] = point.split(',');
              return `<circle cx="${x}" cy="${y}" r="6" fill="#ffffff" stroke="url(#curveGradient)" 
                           stroke-width="3"/>`;
            })
            .join('')}
          
          <!-- Labels -->
          ${labels.join('')}
          
          <!-- Axis labels -->
          <text x="${chartWidth / 2}" y="${chartHeight - 15}" text-anchor="middle" 
                fill="#ffffff" font-size="16" font-weight="bold">Zone Index</text>
          <text x="25" y="${chartHeight / 2}" text-anchor="middle" 
                fill="#ffffff" font-size="16" font-weight="bold" transform="rotate(-90, 25, ${chartHeight / 2})">Reward Weight</text>
        </svg>
        
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value">${totalWeight}</div>
            <div class="stat-label">Total Weight</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${nzones}</div>
            <div class="stat-label">Zone Count</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${maxWeight}</div>
            <div class="stat-label">Max Weight</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${totalWeight > 0 ? ((maxWeight / totalWeight) * 100).toFixed(1) : 0}%</div>
            <div class="stat-label">Peak Share</div>
          </div>
        </div>
      </div>
    `;

    const chartTheme = `
      body {
        margin: 0;
        padding: 20px;
        background: linear-gradient(135deg, #0c0c0c 0%, #1a1a1a 50%, #2d2d2d 100%);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Inter', sans-serif;
      }
      
      .chart-container {
        max-width: 1300px;
        margin: 0 auto;
        padding: 30px;
        background: linear-gradient(145deg, #1e1e1e, #2a2a2a);
        border-radius: 20px;
        color: white;
        box-shadow: 
          0 20px 40px rgba(0,0,0,0.4),
          inset 0 1px 0 rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.1);
      }
      
      .header {
        text-align: center;
        margin-bottom: 20px;
      }
      
      .formula {
        font-size: 20px;
        font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
        padding: 15px 25px;
        background: linear-gradient(135deg, rgba(255,107,107,0.1), rgba(78,205,196,0.1));
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 12px;
        font-weight: 600;
        letter-spacing: 0.5px;
        display: inline-block;
      }
      
      .main-chart {
        display: block;
        margin: 20px auto;
        background: rgba(0,0,0,0.3);
        border-radius: 15px;
        padding: 10px;
        border: 1px solid rgba(255,255,255,0.1);
      }
      
             .stats-grid {
         display: grid;
         grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
         gap: 20px;
         margin-top: 30px;
       }
       
       .stat-card {
         background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05));
         border: 1px solid rgba(255,255,255,0.2);
         border-radius: 15px;
         padding: 20px;
         text-align: center;
         backdrop-filter: blur(10px);
       }
      
      .stat-value {
        font-size: 24px;
        font-weight: 700;
        color: #4ecdc4;
        margin-bottom: 8px;
      }
      
      .stat-label {
        font-size: 14px;
        color: #a0a0a0;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      
    `;

    const path = `./images/zone_distribution_${holonId}.png`;
    const html = await this.generateHtml(element, chartTheme);

    // Retry logic for screenshot generation
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const _ssResult = await this.screenshotHtml(
          html,
          path,
          '.chart-container'
        );
        return _ssResult !== null ? path : null;
      } catch (error) {
        lastError = error;
        console.error(
          `Screenshot attempt ${attempt}/${maxRetries} failed:`,
          error.message
        );

        if (attempt < maxRetries) {
          console.log(`Retrying in 2 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    throw new Error(
      `Failed to generate chart after ${maxRetries} attempts: ${lastError.message}`
    );
  }

  // ==================== Event Rendering Methods ====================

  /**
   * Create text message for an event.
   * @param {Object} event - The event object
   * @param {string} language - Language code
   * @returns {Promise<string>} Formatted event message
   */
  async createEventMessage(event, language) {
    const lines = [
      `| ${i18next.t('Event', { lng: language, defaultValue: 'Event' })}${event.recurringTaskId ? ' 🔄' : ''}: ${event.title.padEnd(200)}`,
      `| 💡 ${i18next.t('by', { lng: language, defaultValue: 'by' })}: ${getDisplayName(event.initiator)}`,
    ];

    if (event.description) lines.push(`| 📝 ${event.description}`);
    if (event.frequency)
      lines.push(
        `| 🔄 ${i18next.t('repeat', { lng: language, defaultValue: 'Repeat' })}: ${i18next.t(event.frequency, { lng: language, defaultValue: event.frequency })}`
      );

    if (event.participants?.length) {
      const names = event.participants.map(u => getDisplayName(u));
      lines.push(`| 🙋‍♂️: ${names.join(', ')}`);
    }

    if (event.appreciation?.length) {
      lines.push(
        `| 👍: ${event.appreciation.map(u => getDisplayName(u)).join(', ')}`
      );
    }

    // Event-specific date/time fields
    const eventHolon = event.holon || event.chat;
    for (const [field, emoji] of [
      ['when', '📅'],
      ['until', '🔚'],
    ]) {
      if (event[field]) {
        const date = new Date(event[field]);
        const timezone = (await this.settings.getTimezone(eventHolon)) || 'UTC';
        try {
          const dateStr = date.toLocaleDateString(language, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone,
            timeZoneName: 'short',
          });
          lines.push(`| ${emoji}: ${dateStr}`);
        } catch {
          lines.push(`| ${emoji}: Invalid Date`);
        }
      }
    }

    // Location
    if (event.where?.latitude) {
      const locationName =
        event.where.name || `${event.where.latitude}, ${event.where.longitude}`;
      lines.push(`| 📍: ${locationName}`);
    }

    lines.push(
      `| 🚥: ${i18next.t(event.status, { lng: language, defaultValue: event.status })}`
    );

    if (event.published)
      lines.push(
        `| 📢 ${i18next.t('published', { lng: language, defaultValue: 'Published' })}`
      );

    return lines.join('\n') + '\n';
  }

  /**
   * Display event board - list of upcoming events.
   * @param {Object} ctx - Telegraf context
   */
  async eventboard(ctx) {
    if (!this.db) return;

    try {
      const holonId = ctx.message.chat.id;
      const language = await this.settings.getLanguage(holonId);
      const isTopic = ctx.message.is_topic_message;
      const threadId = isTopic ? ctx.message.message_thread_id : null;

      // Get events from events collection
      let events =
        (await this.db.holosphere.getAll(holonId.toString(), 'events')) || [];

      // Filter for ongoing/scheduled events
      events = events.filter(event => {
        const eventHolonId = event.holon || event.chat;
        return (
          (event.status === 'ongoing' || event.status === 'scheduled') &&
          (!eventHolonId || eventHolonId.toString() === holonId.toString())
        );
      });

      // If in a topic, filter by message_thread_id
      if (isTopic && threadId) {
        events = events.filter(event => event.message_thread_id === threadId);
      }

      // Sort by when date if available
      events.sort((a, b) => {
        if (a.when && b.when) return new Date(a.when) - new Date(b.when);
        if (a.when) return -1;
        if (b.when) return 1;
        return 0;
      });

      if (!events || events.length === 0) {
        await ctx.reply(
          i18next.t('noevents', {
            lng: language,
            defaultValue: 'No upcoming events.',
          })
        );
        return;
      }

      // Create inline keyboard buttons
      const inline_keyboard_buttons = events.map(event => {
        const title =
          typeof event.title === 'string'
            ? event.title.substring(0, 50)
            : 'Untitled Event';
        const sourceHolon = event.holon || event.chat || holonId;
        const dateStr = event.when
          ? ` (${new Date(event.when).toLocaleDateString()})`
          : '';
        return [
          Markup.button.callback(
            title + dateStr,
            'view_event_' + sourceHolon + '_' + event.id
          ),
        ];
      });

      inline_keyboard_buttons.push([
        Markup.button.url(
          i18next.t('Open Dashboard', { lng: language }),
          `${DASHBOARD_ADDRESS}/${holonId}/events`
        ),
      ]);

      await ctx.reply(
        i18next.t('eventboard', {
          lng: language,
          defaultValue: 'Upcoming Events:',
        }),
        Markup.inlineKeyboard(inline_keyboard_buttons)
      );
    } catch (err) {
      console.error('Error in eventboard:', err);
      const language = await this.settings
        .getLanguage(ctx.message.chat.id)
        .catch(() => 'en');
      ctx.reply(
        i18next.t('eventboardgenerror', {
          lng: language,
          defaultValue: 'Could not display event board.',
        })
      );
    }
  }

  // Clean up expired holon name cache entries
  cleanupHolonNameCache() {
    const now = Date.now();
    for (const [key, value] of this.holonNameCache.entries()) {
      if (value.expires < now) {
        this.holonNameCache.delete(key);
      }
    }
  }

  // Stop cache cleanup interval (call on shutdown)
  stopCacheCleanup() {
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }

  /**
   * Shutdown the UI module and clean up all resources
   * This should be called when the bot is shutting down
   */
  async shutdown() {
    // Stop the cache cleanup interval
    this.stopCacheCleanup();

    // Clear the holon name cache
    this.holonNameCache.clear();

    // Close the browser
    await this.closeBrowser();

    console.log('UI module shut down successfully');
  }
}

export default UI;
