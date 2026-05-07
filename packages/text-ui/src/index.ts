// @holons/text-ui — framework-agnostic CLI/REPL renderer for Holons.
// Re-exports parser + renderer so the package is also embeddable
// (the bin entry lives in ./cli.ts and is wired via package.json).

export { parseArgv, parseLine, type ParsedCommand } from './parser.js';
export {
  TextRenderer,
  defaultRenderer,
  formatResult,
  type Renderer,
  type CommandResult,
} from './renderer.js';
