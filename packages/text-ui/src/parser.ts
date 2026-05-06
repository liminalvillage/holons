// Slash-command parser for the Holons text UI.
//
// Surface:
//   parseArgv(argv)  — parse process.argv-style tokens
//   parseLine(line)  — parse a single REPL line (shlex-lite: handles quoted args)
//
// Grammar:
//   <command> [--key=value] [--key value] [--flag] [positional...]
// Bare `--key` is a boolean flag (true). `--no-key` sets the flag to false.

export interface ParsedCommand {
  command: string;
  params: Record<string, unknown>;
  positional: string[];
}

/** Parse a process.argv-style token array (already split by the shell). */
export function parseArgv(argv: readonly string[]): ParsedCommand | null {
  if (argv.length === 0) return null;
  const [command, ...rest] = argv;
  return { command, ...parseTokens(rest) };
}

/** Parse a single REPL input line (handles single + double quotes). */
export function parseLine(line: string): ParsedCommand | null {
  const tokens = tokenize(line);
  return parseArgv(tokens);
}

function parseTokens(tokens: readonly string[]): {
  params: Record<string, unknown>;
  positional: string[];
} {
  const params: Record<string, unknown> = {};
  const positional: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok.startsWith('--')) {
      positional.push(tok);
      continue;
    }
    const body = tok.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      const key = body.slice(0, eq);
      const value = body.slice(eq + 1);
      params[key] = coerce(value);
      continue;
    }
    // --no-foo → foo=false
    if (body.startsWith('no-')) {
      params[body.slice(3)] = false;
      continue;
    }
    // Look ahead — `--key value` if next token isn't another flag.
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      params[body] = coerce(next);
      i++;
    } else {
      params[body] = true;
    }
  }

  return { params, positional };
}

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !isNaN(Number(value))) return Number(value);
  return value;
}

function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (buf !== '') {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf !== '') out.push(buf);
  return out;
}
