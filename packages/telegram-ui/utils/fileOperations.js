import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { log } from './logger.js';
import { validateFilePath } from './validation.js';

/**
 * Async file operations utilities to replace synchronous file operations
 */

// Promisify common fs operations
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

/**
 * Safely read a file asynchronously with error handling
 */
export const safeReadFile = async (filePath, options = {}) => {
  try {
    validateFilePath(filePath);

    const data = await readFile(filePath, options.encoding || 'utf8');

    log.debug('File read successfully', { filePath });
    return data;
  } catch (error) {
    log.error('Error reading file', { filePath, error: error.message });

    if (options.defaultValue !== undefined) {
      return options.defaultValue;
    }

    throw error;
  }
};

/**
 * Safely write a file asynchronously with error handling
 */
export const safeWriteFile = async (filePath, data, options = {}) => {
  try {
    validateFilePath(filePath);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await ensureDirectoryExists(dir);

    await writeFile(filePath, data, options.encoding || 'utf8');

    log.debug('File written successfully', { filePath, size: data.length });
    return true;
  } catch (error) {
    log.error('Error writing file', { filePath, error: error.message });
    throw error;
  }
};

/**
 * Check if a file exists asynchronously
 */
export const fileExists = async filePath => {
  try {
    await access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * Ensure a directory exists, create it if it doesn't
 */
export const ensureDirectoryExists = async dirPath => {
  try {
    await access(dirPath, fs.constants.F_OK);
    return true;
  } catch {
    try {
      await mkdir(dirPath, { recursive: true });
      log.debug('Directory created', { dirPath });
      return true;
    } catch (error) {
      log.error('Error creating directory', { dirPath, error: error.message });
      throw error;
    }
  }
};

/**
 * Get file stats asynchronously
 */
export const getFileStats = async filePath => {
  try {
    const stats = await stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    log.error('Error getting file stats', { filePath, error: error.message });
    throw error;
  }
};

/**
 * List directory contents asynchronously
 */
export const listDirectory = async (dirPath, options = {}) => {
  try {
    const items = await readdir(dirPath);

    if (options.withStats) {
      const itemsWithStats = await Promise.all(
        items.map(async item => {
          const fullPath = path.join(dirPath, item);
          try {
            const stats = await getFileStats(fullPath);
            return { name: item, path: fullPath, ...stats };
          } catch {
            return { name: item, path: fullPath, error: true };
          }
        })
      );
      return itemsWithStats;
    }

    return items.map(item => path.join(dirPath, item));
  } catch (error) {
    log.error('Error listing directory', { dirPath, error: error.message });
    throw error;
  }
};

/**
 * Safely delete a file
 */
export const safeDeleteFile = async filePath => {
  try {
    validateFilePath(filePath);

    if (await fileExists(filePath)) {
      await unlink(filePath);
      log.debug('File deleted successfully', { filePath });
      return true;
    }

    log.warn('File does not exist for deletion', { filePath });
    return false;
  } catch (error) {
    log.error('Error deleting file', { filePath, error: error.message });
    throw error;
  }
};

/**
 * Read JSON file asynchronously with parsing
 */
export const readJSONFile = async (filePath, defaultValue = {}) => {
  try {
    const data = await safeReadFile(filePath);
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      log.debug('JSON file not found, using default value', { filePath });
      return defaultValue;
    }

    if (error instanceof SyntaxError) {
      log.error('Invalid JSON in file', { filePath, error: error.message });
      throw new Error(`Invalid JSON in file ${filePath}: ${error.message}`);
    }

    throw error;
  }
};

/**
 * Write JSON file asynchronously with formatting
 */
export const writeJSONFile = async (filePath, data, options = {}) => {
  try {
    const jsonString = JSON.stringify(data, null, options.spaces || 2);
    await safeWriteFile(filePath, jsonString);
    return true;
  } catch (error) {
    log.error('Error writing JSON file', { filePath, error: error.message });
    throw error;
  }
};

/**
 * Copy file asynchronously
 */
export const copyFile = async (sourcePath, destPath) => {
  try {
    validateFilePath(sourcePath);
    validateFilePath(destPath);

    const data = await readFile(sourcePath);

    // Ensure destination directory exists
    const destDir = path.dirname(destPath);
    await ensureDirectoryExists(destDir);

    await writeFile(destPath, data);

    log.debug('File copied successfully', { sourcePath, destPath });
    return true;
  } catch (error) {
    log.error('Error copying file', {
      sourcePath,
      destPath,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Move file asynchronously (copy and delete)
 */
export const moveFile = async (sourcePath, destPath) => {
  try {
    await copyFile(sourcePath, destPath);
    await safeDeleteFile(sourcePath);

    log.debug('File moved successfully', { sourcePath, destPath });
    return true;
  } catch (error) {
    log.error('Error moving file', {
      sourcePath,
      destPath,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Read file with timeout to prevent hanging operations
 */
export const readFileWithTimeout = async (
  filePath,
  timeoutMs = 5000,
  options = {}
) => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`File read timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    (async () => {
      try {
        const result = await safeReadFile(filePath, options);
        clearTimeout(timeout);
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    })();
  });
};

/**
 * Batch file operations with concurrency control
 */
export const batchFileOperations = async (operations, concurrency = 5) => {
  const results = [];
  const executing = [];

  for (const operation of operations) {
    const promise = operation().then(result => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });

    results.push(promise);
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
};

/**
 * Watch file for changes (simplified wrapper around fs.watch)
 */
export const watchFile = (filePath, callback) => {
  try {
    const watcher = fs.watch(filePath, (eventType, filename) => {
      log.debug('File change detected', { filePath, eventType, filename });
      callback(eventType, filename);
    });

    return watcher;
  } catch (error) {
    log.error('Error setting up file watcher', {
      filePath,
      error: error.message,
    });
    throw error;
  }
};

export default {
  safeReadFile,
  safeWriteFile,
  fileExists,
  ensureDirectoryExists,
  getFileStats,
  listDirectory,
  safeDeleteFile,
  readJSONFile,
  writeJSONFile,
  copyFile,
  moveFile,
  readFileWithTimeout,
  batchFileOperations,
  watchFile,
};
