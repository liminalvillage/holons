import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { body, validationResult } from 'express-validator';
import { log } from './logger.js';
import { config } from './config.js';
import ErrorHandler, { ValidationError } from './errorHandler.js';

/**
 * Enhanced security middleware for Express applications
 */
export class SecurityMiddleware {
  /**
   * Setup comprehensive security middleware
   */
  static setup(app) {
    // Compression middleware for better performance
    app.use(compression());

    // Helmet for security headers
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Allow for Telegram web apps
    }));

    // CORS configuration
    app.use(cors({
      origin: config.isDevelopment ? '*' : config.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.rateLimitWindowMs,
      max: config.rateLimitMax,
      message: {
        error: 'Too many requests, please try again later.',
        retryAfter: Math.ceil(config.rateLimitWindowMs / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        log.security('Rate limit exceeded', req.ip, req.ip, {
          userAgent: req.get('User-Agent'),
          url: req.url,
        });
        res.status(429).json({
          error: 'Too many requests, please try again later.',
          retryAfter: Math.ceil(config.rateLimitWindowMs / 1000),
        });
      },
    });

    app.use(limiter);

    // Stricter rate limiting for authentication endpoints
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per window
      message: { error: 'Too many authentication attempts, please try again later.' },
      skipSuccessfulRequests: true,
    });

    // Apply stricter rate limiting to auth routes
    app.use('/auth/*', authLimiter);
    app.use('/login', authLimiter);
    app.use('/register', authLimiter);

    // Request logging middleware
    app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        log.info('HTTP Request', {
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          contentLength: res.get('content-length'),
        });
      });

      next();
    });

    // Body parsing with size limits
    app.use(express.json({ 
      limit: config.maxFileSize,
      verify: (req, res, buf) => {
        // Store raw body for webhook verification if needed
        req.rawBody = buf;
      }
    }));
    
    app.use(express.urlencoded({ 
      extended: true, 
      limit: config.maxFileSize 
    }));

    // Input sanitization middleware
    app.use(this.sanitizeInput);

    // Security headers middleware
    app.use(this.securityHeaders);
  }

  /**
   * Input sanitization middleware
   */
  static sanitizeInput(req, res, next) {
    // Sanitize query parameters
    if (req.query) {
      for (const key in req.query) {
        if (typeof req.query[key] === 'string') {
          req.query[key] = req.query[key].trim();
        }
      }
    }

    // Sanitize body parameters
    if (req.body && typeof req.body === 'object') {
      for (const key in req.body) {
        if (typeof req.body[key] === 'string') {
          req.body[key] = req.body[key].trim();
        }
      }
    }

    next();
  }

  /**
   * Additional security headers
   */
  static securityHeaders(req, res, next) {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // HSTS (only in production with HTTPS)
    if (config.isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    next();
  }

  /**
   * File upload security middleware
   */
  static fileUploadSecurity(allowedMimeTypes = [], maxFileSize = null) {
    const maxSize = maxFileSize || config.maxFileSize;
    
    return (req, res, next) => {
      if (req.file) {
        // Check file size
        if (req.file.size > maxSize) {
          return res.status(413).json({
            error: `File too large. Maximum size: ${Math.ceil(maxSize / (1024 * 1024))}MB`
          });
        }

        // Check MIME type
        if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(req.file.mimetype)) {
          return res.status(415).json({
            error: `File type not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`
          });
        }

        // Log file upload
        log.info('File Upload', {
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          ip: req.ip,
        });
      }

      next();
    };
  }

  /**
   * Validation error handler
   */
  static validationErrorHandler(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      log.warn('Validation errors', {
        errors: errors.array(),
        url: req.url,
        method: req.method,
        ip: req.ip,
      });

      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array(),
      });
    }
    next();
  }

  /**
   * Create validation chain for common inputs
   */
  static validators = {
    telegramUserId: body('userId')
      .isInt({ min: 1 })
      .withMessage('User ID must be a positive integer'),
    
    telegramholonId: body('holonId')
      .isInt()
      .withMessage('Holon ID must be an integer'),
    
    questId: body('questId')
      .isLength({ min: 1, max: 100 })
      .trim()
      .escape()
      .withMessage('Quest ID must be 1-100 characters'),
    
    message: body('message')
      .isLength({ min: 1, max: 4096 })
      .trim()
      .withMessage('Message must be 1-4096 characters'),
    
    email: body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Must be a valid email address'),
    
    url: body('url')
      .isURL({ protocols: ['http', 'https'] })
      .withMessage('Must be a valid HTTP/HTTPS URL'),
  };

  /**
   * API key authentication middleware
   */
  static apiKeyAuth(req, res, next) {
    const apiKey = req.get('X-API-Key') || req.query.apiKey;
    const validApiKey = config.getString('API_KEY');

    if (!validApiKey) {
      log.warn('API key authentication attempted but no key configured');
      return res.status(500).json({ error: 'API authentication not configured' });
    }

    if (!apiKey || apiKey !== validApiKey) {
      log.security('Invalid API key attempt', null, req.ip, {
        providedKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none',
        userAgent: req.get('User-Agent'),
      });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    next();
  }

  /**
   * Telegram webhook verification
   */
  static verifyTelegramWebhook(req, res, next) {
    const token = config.botToken;
    const secretPath = `/webhook_${crypto.createHash('sha256').update(token).digest('hex')}`;
    
    if (req.path !== secretPath) {
      log.security('Invalid webhook path accessed', null, req.ip, {
        path: req.path,
        userAgent: req.get('User-Agent'),
      });
      return res.status(404).json({ error: 'Not found' });
    }

    next();
  }

  /**
   * IP whitelist middleware
   */
  static ipWhitelist(allowedIPs = []) {
    return (req, res, next) => {
      const clientIP = req.ip || req.connection.remoteAddress;
      
      if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
        log.security('IP not in whitelist', null, clientIP, {
          userAgent: req.get('User-Agent'),
          url: req.url,
        });
        return res.status(403).json({ error: 'Access denied' });
      }

      next();
    };
  }
}

export default SecurityMiddleware;