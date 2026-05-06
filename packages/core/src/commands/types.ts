// @holons/core/commands — types
//
// Abstract command/intent layer shared by all UIs (web buttons, telegram slash
// commands, text-ui CLI, ai-ui Claude tools). Each UI translates its surface
// (a click, a `/cmd`, a typed line, a tool-use call) into a CoreCommand
// invocation, then renders the CommandResult in its own idiom.

/**
 * Optional ambient context passed to every command. Fields are intentionally
 * loose so each UI can populate what it has without forcing all UIs to provide
 * everything.
 */
export interface CommandContext {
	/** Identifier of the invoking user (e.g. telegram user id, web auth uid). */
	userId?: string;
	/** Optional human-readable name for the invoking user. */
	userName?: string;
	/** Holon/community scope for the command, when relevant. */
	holonId?: string;
	/** UI surface that originated the command. */
	source?: 'web' | 'telegram' | 'text' | 'ai' | string;
	/** Optional holosphere instance (or any storage/transport handle). */
	holosphere?: unknown;
	/** Optional structured logger; defaults to a no-op when omitted. */
	logger?: CommandLogger;
	/** Free-form extension bag for UI-specific context. */
	extra?: Record<string, unknown>;
}

export interface CommandLogger {
	debug?: (msg: string, meta?: Record<string, unknown>) => void;
	info?: (msg: string, meta?: Record<string, unknown>) => void;
	warn?: (msg: string, meta?: Record<string, unknown>) => void;
	error?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Discriminated union returned by the executor. */
export type CommandResult<TData = unknown> =
	| {
			ok: true;
			command: string;
			data: TData;
	  }
	| {
			ok: false;
			command: string;
			error: CommandError;
	  };

export interface CommandError {
	/** Stable machine-readable code. */
	code:
		| 'unknown_command'
		| 'invalid_params'
		| 'missing_dependency'
		| 'execution_failed'
		| string;
	message: string;
	/** Optional details (e.g. zod-style issues, original error). */
	details?: unknown;
}

/**
 * A typed command. Implementations declare a `name`, an optional
 * `validate(params)` hook (returning `true` for ok or a `CommandError` for
 * failure), and an `execute(params, ctx)` that performs the work.
 *
 * Note: parameter validation is intentionally lightweight — we accept any
 * `unknown` and rely on the command's own `validate` to narrow. This keeps the
 * registry usable from JS UIs (telegram-ui) without forcing schema deps.
 */
export interface CoreCommand<TParams = unknown, TResult = unknown> {
	/** Unique command name (e.g. `createTask`). */
	readonly name: string;
	/** One-line human description, surfaced by help/listing UIs. */
	readonly description?: string;
	/** Best-effort JSON-Schema-ish description of params for AI/help UIs. */
	readonly paramsSchema?: Record<string, unknown>;
	/**
	 * Optional pre-execute validation. Return `true` (or `void`) if valid; or a
	 * `CommandError` describing the failure. Throwing is also acceptable and
	 * will be normalised to `invalid_params` by the executor.
	 */
	validate?: (params: unknown) => true | void | CommandError;
	/** Run the command. May throw; the executor wraps thrown errors. */
	execute: (params: TParams, ctx: CommandContext) => Promise<TResult> | TResult;
}
