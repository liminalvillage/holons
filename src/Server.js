/**
 * @fileoverview Express HTTP/HTTPS server with security middleware and file endpoints.
 * @module src/Server
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { log } from '../utils/logger.js';

/**
 * Express server for serving static files, avatars, and images.
 *
 * @class Server
 * @description Manages an Express HTTP/HTTPS server with comprehensive security
 * middleware including rate limiting, security headers, and input validation.
 * Provides endpoints for avatars, files, and images from Telegram.
 *
 * @property {Object} bot - Telegraf bot instance for Telegram API access
 * @property {Object} serverInstance - The HTTP/HTTPS server instance
 * @property {boolean} isRunning - Whether the server is currently running
 * @property {Map} requestCounts - Rate limiting tracker per IP
 * @property {string} avatarsDir - Directory path for cached avatars
 * @property {string} filesDir - Directory path for cached files
 * @property {string} imagesDir - Directory path for cached images
 *
 * @example
 * const server = new Server(bot);
 * // Server automatically starts on construction
 * console.log(server.getServerStatus());
 */
class Server {
  constructor(bot, services = {}) {
    this.bot = bot;
    this.services = services;
    this.serverInstance = null;
    this.isRunning = false;
    this.requestCounts = new Map(); // For rate limiting
    this.maxRateLimitEntries = 10000; // Maximum IPs to track
    this.rateLimitCleanupInterval = null;
    this.signalHandlersSet = false; // Prevent duplicate signal handlers
    this.refreshTimers = new Map(); // Per-(kind,holon,id) debounce timers
    this.refreshDebounceMs = 300;
    this.setupServer();
  }

  setupServer() {
    if (this.serverInstance) {
      console.log('Server is already running');
      return;
    }

    const app = express();
    const isDebug = process.env.NODE_ENV === 'development';
    const port = process.env.PORT || (isDebug ? 8080 : 443);

    // Security middleware
    this.setupSecurityMiddleware(app);

    // Setup static file serving with security
    app.use(express.static('public', {
      dotfiles: 'deny',
      index: false,
      maxAge: '1h'
    }));

    // Setup avatar endpoints
    this.setupAvatarEndpoints(app);

    // Setup file endpoints
    this.setupFileEndpoints(app);

    // Setup image endpoints (isolated)
    this.setupImageEndpoints(app);

    // Setup refresh endpoints (harvest → telegram message edits)
    this.setupRefreshEndpoints(app);

    // Global error handler
    this.setupGlobalErrorHandler(app);

    // Create server (HTTP for debug, HTTPS for production)
    try {
      if (isDebug) {
        this.serverInstance = app.listen(port, () => {
          console.log(`HTTP Server running on port ${port} (debug mode)`);
          this.isRunning = true;
        });
      } else {
        // SSL certificate configuration with error handling
        const sslOptions = this.getSSLOptions();
        if (!sslOptions) {
          log.warn('SSL certificates not found, server will not start in production mode');
          return;
        }

        this.serverInstance = https.createServer(sslOptions, app)
          .listen(port, () => {
            console.log(`HTTPS Server running on port ${port}`);
            this.isRunning = true;
          });
      }

      this.serverInstance.on('error', (error) => {
        this.handleServerError(error, port, isDebug);
      });

      this.serverInstance.on('listening', () => {
        console.log(`Server successfully started on port ${port}`);
        this.isRunning = true;
      });

    } catch (error) {
      console.error('Failed to create server instance:', error.message);
      this.isRunning = false;
    }
  }

  setupSecurityMiddleware(app) {
    const isDebug = process.env.NODE_ENV === 'development';

    // CORS — required so browsers can preflight POST /refresh/* from harvest.
    // In debug, allow any origin; in production, restrict via CORS_ORIGIN.
    app.use(cors({
      origin: isDebug ? true : (process.env.CORS_ORIGIN || 'https://dashboard.holons.io'),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // Start periodic cleanup of rate limiting cache to prevent memory leaks
    this.startRateLimitCleanup();

    // Rate limiting middleware
    app.use((req, res, next) => {
      const clientIP = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const windowMs = 1 * 60 * 1000; // 1 minute
      const maxRequests = 100; // Max requests per window

      if (!this.requestCounts.has(clientIP)) {
        // LRU eviction: remove oldest entries if we exceed the limit
        if (this.requestCounts.size >= this.maxRateLimitEntries) {
          const oldestKey = this.requestCounts.keys().next().value;
          this.requestCounts.delete(oldestKey);
        }
        this.requestCounts.set(clientIP, { count: 0, resetTime: now + windowMs });
      }

      const clientData = this.requestCounts.get(clientIP);

      if (now > clientData.resetTime) {
        clientData.count = 0;
        clientData.resetTime = now + windowMs;
      }

      clientData.count++;

      if (clientData.count > maxRequests) {
        return res.status(429).json({ error: 'Too many requests' });
      }

      next();
    });

    // Security headers
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Content-Security-Policy', "default-src 'self'");
      next();
    });

    // Request size limiting
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  }

  setupGlobalErrorHandler(app) {
    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Global error handler
    app.use((error, req, res, next) => {
      console.error('Unhandled error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Graceful shutdown handling - only set up once to prevent duplicate handlers
    if (!this.signalHandlersSet) {
      this.signalHandlersSet = true;

      const shutdownHandler = (signal) => {
        console.log(`${signal} received, shutting down gracefully`);
        this.stopServer();
      };

      process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
      process.once('SIGINT', () => shutdownHandler('SIGINT'));
    }
  }

  /**
   * Start periodic cleanup of expired rate limit entries
   */
  startRateLimitCleanup() {
    // Clear any existing interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
    }

    // Clean up expired entries every minute
    this.rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.requestCounts.entries()) {
        if (now > data.resetTime + 60000) { // Keep entries for 1 extra minute after expiry
          this.requestCounts.delete(ip);
        }
      }
    }, 60000);
  }

  getSSLOptions() {
    try {
      const keyPath = process.env.SSL_KEY_PATH || 'certs/private.key';
      const certPath = process.env.SSL_CERT_PATH || 'certs/certificate.crt';

      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        // SSL certs not needed in development mode
        return null;
      }

      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
    } catch (error) {
      console.error('Error loading SSL certificates:', error.message);
      return null;
    }
  }

  handleServerError(error, port, isDebug) {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n🚫 Port ${port} is already in use. Server will not start.`);
      console.error(`\nPossible solutions:`);
      console.error(`  • Stop the process using port ${port}:`);
      console.error(`    - On macOS/Linux: lsof -ti:${port} | xargs kill -9`);
      console.error(`    - On Windows: netstat -ano | findstr :${port}`);
      console.error(`  • Use a different port:`);
      console.error(`    - Set PORT environment variable: PORT=3000 node your-app.js`);
      console.error(`    - Or modify the default port in the code`);
      console.error(`  • Wait for the port to become available`);
      console.error(`\nServer startup aborted.\n`);
    } else if (error.code === 'EACCES') {
      console.error(`\n🚫 Permission denied. Cannot bind to port ${port}.`);
      console.error(`\nPossible solutions:`);
      console.error(`  • Use a port above 1024 (ports below 1024 require root privileges)`);
      console.error(`  • Run with sudo (not recommended for production)`);
      console.error(`  • Set PORT environment variable to a higher port number`);
      console.error(`\nServer startup aborted.\n`);
    } else {
      console.error(`\n🚫 Failed to start ${isDebug ? 'HTTP' : 'HTTPS'} server:`, error.message);
      console.error(`\nServer startup aborted.\n`);
    }
    this.serverInstance = null;
    this.isRunning = false;
  }

  // Method to check if server is running
  isServerRunning() {
    return this.isRunning && this.serverInstance !== null;
  }

  // Method to get server status
  getServerStatus() {
    return {
      isRunning: this.isRunning,
      hasInstance: this.serverInstance !== null,
      port: process.env.PORT || (process.env.NODE_ENV === 'development' ? 80 : 443)
    };
  }

  // Method to gracefully stop the server
  stopServer() {
    // Clear the rate limit cleanup interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }

    // Clear the rate limit cache
    this.requestCounts.clear();

    if (this.serverInstance && this.isRunning) {
      this.serverInstance.close(() => {
        console.log('Server stopped gracefully');
        this.isRunning = false;
        this.serverInstance = null;
      });
    } else {
      console.log('Server is not running');
    }
  }

  // Security: Validate and sanitize file paths
  sanitizePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
      return null;
    }
    
    // Remove any path traversal attempts
    const sanitized = inputPath.replace(/\.\./g, '').replace(/\/\//g, '/');
    
    // Ensure path is within allowed directories
    const resolvedPath = path.resolve(sanitized);
    const publicDir = path.resolve(process.cwd(), 'public');
    
    if (!resolvedPath.startsWith(publicDir)) {
      return null;
    }
    
    return resolvedPath;
  }


  // Security: Validate file ID format
  validateFileId(fileId) {
    if (!fileId || typeof fileId !== 'string') {
      return false;
    }
    
    // Telegram file IDs are typically alphanumeric and may contain underscores
    const fileIdPattern = /^[a-zA-Z0-9_-]+$/;
    return fileIdPattern.test(fileId) && fileId.length <= 255;
  }

  // Security: Validate user ID format
  validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
      return false;
    }
    
    // Telegram user IDs are numeric
    const userIdPattern = /^\d+$/;
    return userIdPattern.test(userId) && userId.length <= 20;
  }

  setupAvatarEndpoints(app) {
    try {
      this.avatarsDir = path.join(process.cwd(), 'public', 'avatars');
      if (!fs.existsSync(this.avatarsDir)) {
        fs.mkdirSync(this.avatarsDir, { recursive: true });
      }

      this.defaultAvatarPath = path.join(process.cwd(), 'public', 'default-avatar.png');
      if (!fs.existsSync(this.defaultAvatarPath)) {
        const defaultTemplate = path.join(process.cwd(), 'templates', 'default-avatar.png');
        if (fs.existsSync(defaultTemplate)) {
          fs.copyFileSync(defaultTemplate, this.defaultAvatarPath);
        }
      }

      app.get('/getavatar', async (req, res) => {
        try {
          const userId = String(req.query.user_id || '');

          if (!userId || !this.validateUserId(userId)) {
            return res.sendFile(this.defaultAvatarPath);
          }

          const localAvatarPath = path.join(this.avatarsDir, `${userId}.jpg`);
          const sanitizedPath = this.sanitizePath(localAvatarPath);
          
          if (!sanitizedPath) {
            return res.sendFile(this.defaultAvatarPath);
          }

          if (fs.existsSync(sanitizedPath)) {
            return res.sendFile(sanitizedPath);
          }

          const fileUrl = await this.getUserPicture(userId);
          if (fileUrl) {
            await this.downloadAndSaveAvatar(fileUrl, userId);
            res.sendFile(sanitizedPath);
          } else {
            res.sendFile(this.defaultAvatarPath);
          }
        } catch (error) {
          console.error('Error in getavatar endpoint:', error);
          res.sendFile(this.defaultAvatarPath);
        }
      });
    } catch (error) {
      console.error('Error setting up avatar endpoints:', error);
    }
  }

  setupFileEndpoints(app) {
    try {
      this.filesDir = path.join(process.cwd(), 'public', 'files');
      if (!fs.existsSync(this.filesDir)) {
        fs.mkdirSync(this.filesDir, { recursive: true });
      }

      // Endpoint to get any file by file_id
      app.get('/getfile', async (req, res) => {
        try {
          const fileId = req.query.file_id;
          const fileName = req.query.file_name || 'file';

          if (!fileId || !this.validateFileId(fileId)) {
            return res.status(400).json({ error: 'Invalid file_id parameter' });
          }

          const filePath = await this.getTelegramFile(fileId, fileName);
          if (filePath) {
            const sanitizedPath = this.sanitizePath(filePath);
            if (sanitizedPath && fs.existsSync(sanitizedPath)) {
              res.sendFile(sanitizedPath);
            } else {
              res.status(404).json({ error: 'File not found' });
            }
          } else {
            res.status(404).json({ error: 'File not found' });
          }
        } catch (error) {
          console.error('Error in getfile endpoint:', error);
          res.status(500).json({ error: 'Failed to retrieve file' });
        }
      });

      // Endpoint to get file info without downloading
      app.get('/fileinfo', async (req, res) => {
        try {
          const fileId = req.query.file_id;

          if (!fileId || !this.validateFileId(fileId)) {
            return res.status(400).json({ error: 'Invalid file_id parameter' });
          }

          const fileInfo = await this.getFileInfo(fileId);
          if (fileInfo) {
            res.json(fileInfo);
          } else {
            res.status(404).json({ error: 'File not found' });
          }
        } catch (error) {
          console.error('Error in fileinfo endpoint:', error);
          res.status(500).json({ error: 'Failed to retrieve file info' });
        }
      });

      // Endpoint to get photo by file_id (optimized for images)
      app.get('/getphoto', async (req, res) => {
        try {
          const fileId = req.query.file_id;
          const quality = req.query.quality || 'high';

          if (!fileId || !this.validateFileId(fileId)) {
            return res.status(400).json({ error: 'Invalid file_id parameter' });
          }

          const filePath = await this.getTelegramPhoto(fileId, quality);
          if (filePath) {
            const sanitizedPath = this.sanitizePath(filePath);
            if (sanitizedPath && fs.existsSync(sanitizedPath)) {
              res.sendFile(sanitizedPath);
            } else {
              res.status(404).json({ error: 'Photo not found' });
            }
          } else {
            res.status(404).json({ error: 'Photo not found' });
          }
        } catch (error) {
          console.error('Error in getphoto endpoint:', error);
          res.status(500).json({ error: 'Failed to retrieve photo' });
        }
      });
    } catch (error) {
      console.error('Error setting up file endpoints:', error);
    }
  }

  setupImageEndpoints(app) {
    try {
      // Dedicated images directory
      this.imagesDir = path.join(process.cwd(), 'public', 'images');
      if (!fs.existsSync(this.imagesDir)) {
        fs.mkdirSync(this.imagesDir, { recursive: true });
      }

      // Default image for fallback
      this.defaultImagePath = path.join(process.cwd(), 'public', 'default-image.png');
      if (!fs.existsSync(this.defaultImagePath)) {
        const defaultTemplate = path.join(process.cwd(), 'templates', 'default-image.png');
        if (fs.existsSync(defaultTemplate)) {
          fs.copyFileSync(defaultTemplate, this.defaultImagePath);
        }
      }

      // Isolated getimage endpoint
      app.get('/getimage', async (req, res) => {
        try {
          const fileId = req.query.file_id;
          const size = req.query.size || 'original';
          const format = req.query.format || 'auto';

          if (!fileId || !this.validateFileId(fileId)) {
            return res.status(400).json({ error: 'Invalid file_id parameter' });
          }

          const imagePath = await this.getTelegramImage(fileId, size, format);
          if (imagePath) {
            const sanitizedPath = this.sanitizePath(imagePath);
            if (sanitizedPath && fs.existsSync(sanitizedPath)) {
              res.setHeader('Cache-Control', 'public, max-age=31536000');
              res.setHeader('Content-Type', this.getImageContentType(sanitizedPath));
              res.sendFile(sanitizedPath);
            } else {
              this.sendDefaultImage(res);
            }
          } else {
            this.sendDefaultImage(res);
          }
        } catch (error) {
          console.error('Error in getimage endpoint:', error);
          this.sendDefaultImage(res);
        }
      });

      // Image info endpoint
      app.get('/imageinfo', async (req, res) => {
        try {
          const fileId = req.query.file_id;

          if (!fileId || !this.validateFileId(fileId)) {
            return res.status(400).json({ error: 'Invalid file_id parameter' });
          }

          const imageInfo = await this.getImageInfo(fileId);
          if (imageInfo) {
            res.json(imageInfo);
          } else {
            res.status(404).json({ error: 'Image not found' });
          }
        } catch (error) {
          console.error('Error in imageinfo endpoint:', error);
          res.status(500).json({ error: 'Failed to retrieve image info' });
        }
      });
    } catch (error) {
      console.error('Error setting up image endpoints:', error);
    }
  }

  setupRefreshEndpoints(app) {
    // Unauthenticated; protected by IP rate limit only. See TODO.md
    // ("Telegram-login verification for /refresh endpoints") for the planned
    // upgrade to per-user authentication.
    app.post('/refresh/quest', (req, res) => {
      const { chatId, questId } = req.body || {};
      if (!chatId || questId === undefined || questId === null) {
        return res.status(400).json({ error: 'chatId and questId required' });
      }
      this.scheduleRefresh('quest', String(chatId), String(questId));
      res.status(202).json({ scheduled: true });
    });

    app.post('/refresh/expense', (req, res) => {
      const { chatId, expenseId } = req.body || {};
      if (!chatId || expenseId === undefined || expenseId === null) {
        return res.status(400).json({ error: 'chatId and expenseId required' });
      }
      this.scheduleRefresh('expense', String(chatId), String(expenseId));
      res.status(202).json({ scheduled: true });
    });

    app.post('/refresh/event', (req, res) => {
      const { chatId, eventId } = req.body || {};
      if (!chatId || eventId === undefined || eventId === null) {
        return res.status(400).json({ error: 'chatId and eventId required' });
      }
      this.scheduleRefresh('event', String(chatId), String(eventId));
      res.status(202).json({ scheduled: true });
    });
  }

  scheduleRefresh(kind, holon, id) {
    const key = `${kind}:${holon}:${id}`;
    if (this.refreshTimers.has(key)) clearTimeout(this.refreshTimers.get(key));
    const timer = setTimeout(async () => {
      this.refreshTimers.delete(key);
      try {
        if (kind === 'quest') await this.refreshQuestMessage(holon, id);
        else if (kind === 'expense') await this.refreshExpenseMessage(holon, id);
        else if (kind === 'event') await this.refreshEventMessage(holon, id);
      } catch (err) {
        log.warn(`refresh ${kind} ${holon}/${id} failed: ${err?.message || err}`);
      }
    }, this.refreshDebounceMs);
    this.refreshTimers.set(key, timer);
  }

  async refreshQuestMessage(holon, questId) {
    const { quests, settings } = this.services;
    if (!quests) throw new Error('quests service not available');

    const language = (await settings?.getLanguage(holon).catch(() => null)) || 'en';
    const holonDB = await quests.getHolonDB(holon);
    let quest = await holonDB.get(holon, 'quests', questId);
    if (!quest) {
      log.info(`refresh: quest ${questId} not found in holon ${holon}`);
      return;
    }

    // Quest IDs from harvest are opaque strings, so we can't blindly do
    // Number(questId). ensureMainTelegramMessage resolves the message_id via
    // activeHolograms (legacy bot-native quests fall through to a numeric
    // quest.id) — and creates a fresh Telegram message in the home holon if
    // none exists yet. That makes /refresh/quest the canonical way for
    // harvest to bootstrap a Telegram representation for a brand-new task.
    const markupConfig = quests.markup(quest, language);
    const messageId = await quests.ensureMainTelegramMessage(quest, holon, language, markupConfig);
    if (messageId == null) {
      log.info(`refresh: could not create or resolve Telegram message for quest ${questId} in holon ${holon}`);
      return;
    }
    const fakeCtx = { telegram: this.bot.telegram };
    const updatedMessages = new Set();
    await quests.updateQuestMessage(fakeCtx, quest, holon, messageId, language, markupConfig);
    updatedMessages.add(`${holon}_${messageId}`);

    // Bootstrap Telegram messages for federated holons that don't have one
    // yet — mirrors step 4 of Quests.handleQuestUpdate. Reads
    // _meta.activeHolograms (HoloSphere propagation) and sends new messages
    // to any numeric chat ID without one, pushing them into
    // quest.activeHolograms.
    await quests.handleFederatedMessages(fakeCtx, quest, language).catch((err) => {
      log.warn(`refresh: handleFederatedMessages failed for quest ${questId} in ${holon}: ${err?.message || err}`);
    });

    // Re-read so we pick up any entries handleFederatedMessages just added
    // (it mutates a re-fetched copy and persists with autoPropagate:false).
    quest = (await holonDB.get(holon, 'quests', questId)) || quest;

    // Fan out to every Telegram copy tracked in quest.activeHolograms (home
    // main + personal holograms + federated). updatedMessages dedupes the
    // home main we already edited above.
    const hologramsToUpdate = quest.activeHolograms || [];
    log.info(`refresh: quest ${questId} in ${holon} → main + ${hologramsToUpdate.length} holograms (already edited: ${updatedMessages.size})`);
    if (hologramsToUpdate.length > 0) {
      await quests.updateHolograms(fakeCtx, quest, language, markupConfig, hologramsToUpdate, updatedMessages);
    }
  }

  async refreshEventMessage(holon, eventId) {
    const { events, settings, database } = this.services;
    if (!events || !database) throw new Error('events/database service not available');

    const language = (await settings?.getLanguage(holon).catch(() => null)) || 'en';
    const event = await database.get(holon, 'events', eventId);
    if (!event) {
      log.info(`refresh: event ${eventId} not found in holon ${holon}`);
      return;
    }

    const markupConfig = events.markup(event, language);
    const messageId = await events.ensureMainTelegramMessage(event, holon, language, markupConfig);
    if (messageId == null) {
      log.info(`refresh: could not create or resolve Telegram message for event ${eventId} in holon ${holon}`);
      return;
    }
    const fakeCtx = { telegram: this.bot.telegram };
    const updatedMessages = new Set();
    await events.updateEventMessage(fakeCtx, event, holon, messageId, language, markupConfig);
    updatedMessages.add(`${holon}_${messageId}`);
    // Fan out to federated copies tracked in _meta.activeHolograms (HoloSphere propagation).
    const metaHolograms = event._meta?.activeHolograms || [];
    if (metaHolograms.length > 0) {
      await events.updateHologramsFromMeta(fakeCtx, event, language, markupConfig, metaHolograms, updatedMessages);
    }
  }

  async refreshExpenseMessage(holon, expenseId) {
    const { expenses, database } = this.services;
    if (!expenses || !database) throw new Error('expenses/database service not available');

    const expense = await database.get(holon, 'expenses', expenseId);
    if (!expense) {
      log.info(`refresh: expense ${expenseId} not found in holon ${holon}`);
      return;
    }

    const text = await expenses.createMessage(holon, expense);
    const reply_markup = {
      inline_keyboard: [
        [{ text: '🔀 Split', callback_data: `split:${expense.id}` },
         { text: '🔀 Split All', callback_data: `splitall:${expense.id}` }],
        [{ text: '👥 Select participants', callback_data: `select_participants:${expense.id}` }],
      ],
    };
    const messageId = Number(expenseId);
    const editor = expense.picture
      ? this.bot.telegram.editMessageCaption.bind(this.bot.telegram)
      : this.bot.telegram.editMessageText.bind(this.bot.telegram);
    try {
      await editor(holon, messageId, undefined, text, { reply_markup });
    } catch (err) {
      if (/message is not modified/i.test(err?.message || '')) return;
      throw err;
    }
  }

  async downloadAndSaveAvatar(fileUrl, userId) {
    try {
      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 10000, // 10 second timeout
        maxContentLength: 10 * 1024 * 1024 // 10MB limit
      });

      const filePath = path.join(this.avatarsDir, `${String(userId)}.jpg`);
      const sanitizedPath = this.sanitizePath(filePath);
      
      if (!sanitizedPath) {
        throw new Error('Invalid file path');
      }
      
      const writer = fs.createWriteStream(sanitizedPath);
      
      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', () => resolve(sanitizedPath));
        writer.on('error', reject);
        response.data.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading avatar:', error);
      throw error;
    }
  }

  async getUserPicture(userID) {
    try {
      const userIdString = String(userID);
      if (!this.validateUserId(userIdString)) {
        return '';
      }

      const photos = await this.bot.telegram.getUserProfilePhotos(userIdString);

      if (photos.total_count > 0) {
        const photo = photos.photos[0].pop();
        const fileId = photo.file_id;
        const fileUrl = await this.bot.telegram.getFileLink(fileId);

        return fileUrl.href || '';
      }
    } catch (error) {
      console.error('Error retrieving the profile photo:', error);
      return ''; 
    }
  }

  async getTelegramFile(fileId, fileName) {
    try {
      if (!this.validateFileId(fileId)) {
        return null;
      }

      const fileInfo = await this.bot.telegram.getFile(fileId);
      if (!fileInfo) {
        return null;
      }

      const fileExtension = this.getFileExtension(fileInfo.file_path || fileName);
      const uniqueFileName = `${fileId}_${this.sanitizeFileName(fileName)}${fileExtension}`;
      const localFilePath = path.join(this.filesDir, uniqueFileName);
      const sanitizedPath = this.sanitizePath(localFilePath);

      if (!sanitizedPath) {
        return null;
      }

      if (fs.existsSync(sanitizedPath)) {
        return sanitizedPath;
      }

      const fileUrl = await this.bot.telegram.getFileLink(fileId);
      if (!fileUrl) {
        return null;
      }

      await this.downloadAndSaveFile(fileUrl.href, sanitizedPath);
      return sanitizedPath;
    } catch (error) {
      console.error('Error retrieving Telegram file:', error);
      return null;
    }
  }

  async getTelegramPhoto(fileId, quality = 'high') {
    try {
      if (!this.validateFileId(fileId)) {
        return null;
      }

      const fileInfo = await this.bot.telegram.getFile(fileId);
      if (!fileInfo) {
        return null;
      }

      const fileExtension = this.getFileExtension(fileInfo.file_path || 'photo');
      const uniqueFileName = `${fileId}_photo${fileExtension}`;
      const localFilePath = path.join(this.filesDir, uniqueFileName);
      const sanitizedPath = this.sanitizePath(localFilePath);

      if (!sanitizedPath) {
        return null;
      }

      if (fs.existsSync(sanitizedPath)) {
        return sanitizedPath;
      }

      const fileUrl = await this.bot.telegram.getFileLink(fileId);
      if (!fileUrl) {
        return null;
      }

      await this.downloadAndSaveFile(fileUrl.href, sanitizedPath);
      return sanitizedPath;
    } catch (error) {
      console.error('Error retrieving Telegram photo:', error);
      return null;
    }
  }

  async getTelegramImage(fileId, size = 'original', format = 'auto') {
    try {
      if (!this.validateFileId(fileId)) {
        return null;
      }

      const fileInfo = await this.bot.telegram.getFile(fileId);
      if (!fileInfo) {
        return null;
      }

      const fileExtension = this.getFileExtension(fileInfo.file_path || '');
      if (!this.isImageFile(fileExtension)) {
        console.error('File is not an image:', fileExtension);
        return null;
      }

      const imageFileName = this.generateImageFileName(fileId, size, format, fileExtension);
      const localImagePath = path.join(this.imagesDir, imageFileName);
      const sanitizedPath = this.sanitizePath(localImagePath);

      if (!sanitizedPath) {
        return null;
      }

      if (fs.existsSync(sanitizedPath)) {
        return sanitizedPath;
      }

      const fileUrl = await this.bot.telegram.getFileLink(fileId);
      if (!fileUrl) {
        return null;
      }

      await this.downloadAndSaveImage(fileUrl.href, sanitizedPath);
      return sanitizedPath;
    } catch (error) {
      console.error('Error retrieving Telegram image:', error);
      return null;
    }
  }

  async getImageInfo(fileId) {
    try {
      if (!this.validateFileId(fileId)) {
        return null;
      }

      const fileInfo = await this.bot.telegram.getFile(fileId);
      if (!fileInfo) {
        return null;
      }

      const fileExtension = this.getFileExtension(fileInfo.file_path || '');
      if (!this.isImageFile(fileExtension)) {
        return { error: 'File is not an image' };
      }

      return {
        file_id: fileInfo.file_id,
        file_unique_id: fileInfo.file_unique_id,
        file_size: fileInfo.file_size,
        file_path: fileInfo.file_path,
        file_extension: fileExtension,
        mime_type: this.getImageMimeType(fileExtension),
        is_image: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error retrieving image info:', error);
      return null;
    }
  }

  async getFileInfo(fileId) {
    try {
      if (!this.validateFileId(fileId)) {
        return null;
      }

      const fileInfo = await this.bot.telegram.getFile(fileId);
      if (!fileInfo) {
        return null;
      }

      return {
        file_id: fileInfo.file_id,
        file_unique_id: fileInfo.file_unique_id,
        file_size: fileInfo.file_size,
        file_path: fileInfo.file_path,
        file_extension: this.getFileExtension(fileInfo.file_path || ''),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error retrieving file info:', error);
      return null;
    }
  }

  async downloadAndSaveFile(fileUrl, filePath) {
    try {
      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000, // 30 second timeout
        maxContentLength: 100 * 1024 * 1024 // 100MB limit
      });
      
      const writer = fs.createWriteStream(filePath);
      
      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', () => resolve(filePath));
        writer.on('error', reject);
        response.data.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      throw error;
    }
  }

  async downloadAndSaveImage(fileUrl, imagePath) {
    try {
      const response = await axios({
        url: fileUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000, // 30 second timeout
        maxContentLength: 50 * 1024 * 1024 // 50MB limit for images
      });
      
      const writer = fs.createWriteStream(imagePath);
      
      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', () => resolve(imagePath));
        writer.on('error', reject);
        response.data.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading image:', error);
      throw error;
    }
  }

  getFileExtension(filePath) {
    if (!filePath) return '';
    const ext = path.extname(filePath).toLowerCase();
    return ext || '';
  }

  isImageFile(extension) {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tga'];
    return imageExtensions.includes(extension.toLowerCase());
  }

  // Used as the fallback for /getimage when the requested file_id resolves
  // to a non-image, an invalid id, or anything else that fails. The default
  // image is optional — if it isn't on disk, return 404 instead of letting
  // res.sendFile throw ENOENT into the global error handler.
  sendDefaultImage(res) {
    if (this.defaultImagePath && fs.existsSync(this.defaultImagePath)) {
      res.sendFile(this.defaultImagePath);
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  }

  generateImageFileName(fileId, size, format, originalExtension) {
    const timestamp = Date.now();
    const sizeSuffix = size !== 'original' ? `_${size}` : '';
    const formatSuffix = format !== 'auto' ? `_${format}` : '';
    return `${fileId}${sizeSuffix}${formatSuffix}_${timestamp}${originalExtension}`;
  }

  sanitizeFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') {
      return 'file';
    }
    
    // Remove any potentially dangerous characters
    return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
  }

  getImageContentType(imagePath) {
    const extension = this.getFileExtension(imagePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.tiff': 'image/tiff',
      '.tga': 'image/tga'
    };
    return mimeTypes[extension] || 'image/jpeg';
  }

  getImageMimeType(extension) {
    return this.getImageContentType(`dummy${extension}`);
  }
}

export default Server; 