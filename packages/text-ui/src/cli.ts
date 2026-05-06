#!/usr/bin/env node
// Bin entry for the `holons` CLI.
//
// Modes:
//   holons                          → REPL
//   holons --help                   → list commands
//   holons <command> --help         → command-specific help
//   holons <command> [--k=v ...]    → execute and render the result

import { createInterface } from 'node:readline';
import { parseArgv, parseLine, type ParsedCommand } from './parser.js';
import { defaultRenderer, type CommandResult, type Renderer } from './renderer.js';
import { loadRegistry, type CommandRegistry, type CoreCommand } from './commands.js';

async function main(argv: string[]): Promise<number> {
  const registry = await loadRegistry();
  const renderer = defaultRenderer;
  const args = argv.slice(2);

  // No args → REPL.
  if (args.length === 0) {
    return runRepl(registry, renderer);
  }

  // Top-level help.
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printHelp(registry);
    return 0;
  }

  return runOnce(args, registry, renderer);
}

async function runOnce(
  argv: readonly string[],
  registry: CommandRegistry,
  renderer: Renderer,
): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed) {
    printHelp(registry);
    return 1;
  }
  return dispatch(parsed, registry, renderer);
}

async function dispatch(
  parsed: ParsedCommand,
  registry: CommandRegistry,
  renderer: Renderer,
): Promise<number> {
  const cmd = registry.get(parsed.command);
  if (!cmd) {
    renderer.error(`unknown command: ${parsed.command}`);
    printHelp(registry);
    return 1;
  }

  if (parsed.params.help === true) {
    printCommandHelp(cmd);
    return 0;
  }

  const missing = cmd.params
    .filter((p) => p.required && parsed.params[p.name] === undefined)
    .map((p) => p.name);
  if (missing.length > 0) {
    renderer.error(`missing required params: ${missing.join(', ')}`);
    printCommandHelp(cmd);
    return 1;
  }

  try {
    const raw = await cmd.execute(parsed.params);
    const result: CommandResult = { ok: raw.ok, message: raw.message, data: raw.data };
    renderer.render(result);
    return raw.ok ? 0 : 1;
  } catch (err) {
    renderer.error(err);
    return 1;
  }
}

async function runRepl(registry: CommandRegistry, renderer: Renderer): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = 'holons> ';
  process.stdout.write(`holons REPL — type "help" or a command, "exit" to quit\n`);
  rl.setPrompt(prompt);
  rl.prompt();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '' ) {
      rl.prompt();
      continue;
    }
    if (trimmed === 'exit' || trimmed === 'quit') break;
    if (trimmed === 'help' || trimmed === '--help') {
      printHelp(registry);
      rl.prompt();
      continue;
    }
    const parsed = parseLine(trimmed);
    if (parsed) await dispatch(parsed, registry, renderer);
    rl.prompt();
  }
  rl.close();
  return 0;
}

function printHelp(registry: CommandRegistry): void {
  const out = process.stdout;
  out.write('holons — Holons text UI\n\n');
  out.write('Usage:\n');
  out.write('  holons                       Start interactive REPL\n');
  out.write('  holons <command> [--k=v]     Run a command\n');
  out.write('  holons <command> --help      Show command help\n\n');
  out.write('Commands:\n');
  const commands = registry.list();
  if (commands.length === 0) {
    out.write('  (no commands registered)\n');
    return;
  }
  const width = Math.max(...commands.map((c) => c.name.length));
  for (const c of commands) {
    out.write(`  ${c.name.padEnd(width)}  ${c.description}\n`);
  }
}

function printCommandHelp(cmd: CoreCommand): void {
  const out = process.stdout;
  out.write(`holons ${cmd.name} — ${cmd.description}\n\n`);
  if (cmd.params.length === 0) {
    out.write('  (no parameters)\n');
    return;
  }
  out.write('Parameters:\n');
  const width = Math.max(...cmd.params.map((p) => p.name.length));
  for (const p of cmd.params) {
    const req = p.required ? ' (required)' : '';
    out.write(`  --${p.name.padEnd(width)}  [${p.type}]${req}  ${p.description}\n`);
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    defaultRenderer.error(err);
    process.exit(1);
  },
);
