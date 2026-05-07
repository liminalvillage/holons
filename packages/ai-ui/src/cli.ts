#!/usr/bin/env node
// Bin entry for the `holons-ai` CLI.
//
// Reads a natural-language prompt from argv (joined) or stdin, then runs the
// agent loop and prints its final text response.

import { runAgent } from './agent.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function printHelp(): void {
  process.stdout.write(
    [
      'holons-ai — Natural-language Holons interpreter (Claude tool-use)',
      '',
      'Usage:',
      '  holons-ai "<prompt>"            Run agent on a single prompt',
      '  echo "<prompt>" | holons-ai     Read prompt from stdin',
      '  holons-ai --help                Show this help',
      '',
      'Environment:',
      '  ANTHROPIC_API_KEY               Required for live calls',
      '  HOLONS_AI_MODEL                 Override the default model',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  const argPrompt = args.join(' ').trim();
  const prompt = argPrompt !== '' ? argPrompt : await readStdin();
  if (prompt === '') {
    printHelp();
    return 1;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('error: ANTHROPIC_API_KEY is not set\n');
    return 2;
  }

  const result = await runAgent(prompt, {
    model: process.env.HOLONS_AI_MODEL,
  });
  process.stdout.write(result.text + '\n');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  },
);
