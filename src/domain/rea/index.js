/**
 * REA (Resource-Event-Agent) Accounting Module
 *
 * Exports all REA domain components for use throughout the application.
 */

export { REAEventStore } from './REAEventStore.js';
export { REAEventFactory } from './REAEventFactory.js';
export { REAAggregator } from './REAAggregator.js';

// Re-export for convenience
export { default as REAEventStoreDefault } from './REAEventStore.js';
export { default as REAEventFactoryDefault } from './REAEventFactory.js';
export { default as REAAggregatorDefault } from './REAAggregator.js';
