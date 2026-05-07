// Text-only renderer for CommandResult values.
//
// Renderers translate domain results into output bytes. The default
// implementation prints to stdout/stderr as plain text. Other UIs
// (web, telegram) can implement Renderer differently against the same
// CommandResult shape.

export interface CommandResult {
  ok: boolean;
  /** Short status line. */
  message?: string;
  /** Tabular data — first row is headers if `headers` omitted. */
  table?: { headers?: string[]; rows: ReadonlyArray<ReadonlyArray<unknown>> };
  /** Bullet list items. */
  list?: ReadonlyArray<string>;
  /** Free-form data appended as JSON for debugging. */
  data?: unknown;
}

export interface Renderer {
  render(result: CommandResult): void;
  error(err: unknown): void;
}

/**
 * Format a CommandResult as a plain-text string. Pure — no I/O.
 * The default renderer wraps this and writes to stdout.
 */
export function formatResult(result: CommandResult): string {
  const lines: string[] = [];
  const prefix = result.ok ? 'ok' : 'error';
  if (result.message) {
    lines.push(`[${prefix}] ${result.message}`);
  } else {
    lines.push(`[${prefix}]`);
  }

  if (result.list && result.list.length > 0) {
    for (const item of result.list) lines.push(`  - ${item}`);
  }

  if (result.table && result.table.rows.length > 0) {
    lines.push(formatTable(result.table.headers, result.table.rows));
  }

  if (result.data !== undefined) {
    lines.push(JSON.stringify(result.data, null, 2));
  }

  return lines.join('\n');
}

function formatTable(
  headers: string[] | undefined,
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  const allRows: string[][] = [];
  if (headers) allRows.push(headers);
  for (const r of rows) allRows.push(r.map((v) => String(v ?? '')));
  if (allRows.length === 0) return '';

  const widths = allRows[0].map((_, col) =>
    Math.max(...allRows.map((r) => (r[col] ?? '').length)),
  );
  const fmt = (r: string[]) =>
    r.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  const out: string[] = [fmt(allRows[0])];
  if (headers) out.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (let i = 1; i < allRows.length; i++) out.push(fmt(allRows[i]));
  return out.join('\n');
}

/** Default text renderer — writes formatted output to stdout/stderr. */
export class TextRenderer implements Renderer {
  constructor(
    private readonly out: NodeJS.WritableStream = process.stdout,
    private readonly err: NodeJS.WritableStream = process.stderr,
  ) {}

  render(result: CommandResult): void {
    this.out.write(formatResult(result) + '\n');
  }

  error(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.err.write(`[error] ${msg}\n`);
  }
}

export const defaultRenderer = new TextRenderer();
