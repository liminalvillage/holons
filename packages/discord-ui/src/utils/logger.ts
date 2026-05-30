/**
 * Structured logger for the Discord UI. Mirrors the telegram-ui logger shape
 * (a `log` helper with level methods) so service code reads the same in both
 * bots, but is TypeScript and console-only by default.
 */
import winston from 'winston';

const logLevels = { error: 0, warn: 1, info: 2, debug: 3 } as const;

const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
      delete (meta as Record<string, unknown>).timestamp;
      delete (meta as Record<string, unknown>).level;
      delete (meta as Record<string, unknown>).message;
      let line = `${timestamp} [${level}]: ${message}`;
      if (stack) line += `\n${stack}`;
      const keys = Object.keys(meta);
      if (keys.length > 0) line += ` ${JSON.stringify(meta)}`;
      return line;
    })
  ),
  transports: [
    new winston.transports.Console({
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    }),
  ],
});

type Meta = Record<string, unknown>;

export const log = {
  error: (message: string, meta: Meta = {}) => logger.error(message, meta),
  warn: (message: string, meta: Meta = {}) => logger.warn(message, meta),
  info: (message: string, meta: Meta = {}) => logger.info(message, meta),
  debug: (message: string, meta: Meta = {}) => logger.debug(message, meta),
};

export default logger;
