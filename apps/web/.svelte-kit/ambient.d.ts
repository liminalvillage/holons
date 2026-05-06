
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/private';
 * 
 * console.log(ENVIRONMENT); // => "production"
 * console.log(PUBLIC_BASE_URL); // => throws error during build
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/private' {
	export const SHOW_QUESTS_AS_IMAGES: string;
	export const ADAM_AUTH: string;
	export const HOLOSPHERE_PRIVATE_KEY: string;
	export const CHAINID: string;
	export const NETWORK: string;
	export const WEB3KEY: string;
	export const WEB3PROVIDERAPPNAME: string;
	export const HOLOSPHERE_KEY: string;
	export const BOT_TOKEN: string;
	export const TELEGRAM: string;
	export const DISCORD: string;
	export const OPENAI: string;
	export const PREFIX: string;
	export const WEB3PROVIDER: string;
	export const AIASSISTANT: string;
	export const MODE: string;
	export const NODE_ENV: string;
	export const LOG_LEVEL: string;
	export const I18N_DEBUG: string;
	export const BOT_TIMEOUT: string;
	export const DB_TIMEOUT: string;
	export const API_TIMEOUT: string;
	export const SIGNAL_DEBUG: string;
	export const SIGNAL_ALERT_ADMIN: string;
	export const ADMIN_CHAT_ID: string;
	export const ADMIN_IDS: string;
	export const DASHBOARD_ADDRESS: string;
	export const MATTERMOST_URL: string;
	export const MATTERMOST_TOKEN: string;
	export const VITE_HOLOSPHERE_PRIVATE_KEY: string;
	export const VITE_OPENAI_API_KEY: string;
	export const VITE_TELEGRAM_BOT_TOKEN: string;
	export const VITE_TELEGRAM_BOT_USERNAME: string;
	export const VITE_DEV_TELEGRAM_USER_ID: string;
	export const VITE_DEV_TELEGRAM_USER_NAME: string;
	export const VITE_BOT_API_URL: string;
	export const VITE_LLM_PROVIDER: string;
	export const VITE_LLM_MODEL: string;
	export const VITE_LLM_MAX_TOKENS: string;
	export const VITE_LLM_TEMPERATURE: string;
	export const VITE_ANTHROPIC_API_KEY: string;
	export const VITE_GROQ_API_KEY: string;
	export const VITE_QR_BASE_URL: string;
	export const VITE_MAPBOX_TOKEN: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const TERM_PROGRAM: string;
	export const VSCODE_GIT_IPC_AUTH_TOKEN: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const SHELL: string;
	export const TERM: string;
	export const TMPDIR: string;
	export const TERM_PROGRAM_VERSION: string;
	export const MallocNanoZone: string;
	export const ZDOTDIR: string;
	export const PNPM_HOME: string;
	export const AI_AGENT: string;
	export const GIT_EDITOR: string;
	export const USER: string;
	export const COMMAND_MODE: string;
	export const SSH_AUTH_SOCK: string;
	export const CLAUDE_CODE_SSE_PORT: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const VSCODE_PROFILE_INITIALIZED: string;
	export const npm_config_verify_deps_before_run: string;
	export const PATH: string;
	export const LaunchInstanceID: string;
	export const __CFBundleIdentifier: string;
	export const USER_ZDOTDIR: string;
	export const npm_command: string;
	export const PWD: string;
	export const OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
	export const LANG: string;
	export const NODE_PATH: string;
	export const XPC_FLAGS: string;
	export const VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
	export const pnpm_config_verify_deps_before_run: string;
	export const XPC_SERVICE_NAME: string;
	export const VSCODE_INJECTION: string;
	export const HOME: string;
	export const SHLVL: string;
	export const VSCODE_GIT_ASKPASS_MAIN: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const LOGNAME: string;
	export const PNPM_PACKAGE_NAME: string;
	export const VSCODE_GIT_IPC_HANDLE: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const npm_config_user_agent: string;
	export const GIT_ASKPASS: string;
	export const VSCODE_GIT_ASKPASS_NODE: string;
	export const OSLogRateLimit: string;
	export const SECURITYSESSIONID: string;
	export const CLAUDECODE: string;
	export const COLORTERM: string;
	export const VITE_USER_NODE_ENV: string;
}

/**
 * This module provides access to environment variables that are injected _statically_ into your bundle at build time and are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Static environment variables are [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env` at build time and then statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * For example, given the following build time environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { ENVIRONMENT, PUBLIC_BASE_URL } from '$env/static/public';
 * 
 * console.log(ENVIRONMENT); // => throws error during build
 * console.log(PUBLIC_BASE_URL); // => "http://site.com"
 * ```
 * 
 * The above values will be the same _even if_ different values for `ENVIRONMENT` or `PUBLIC_BASE_URL` are set at runtime, as they are statically replaced in your code with their build time values.
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are limited to _private_ access.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Private_ access:**
 * 
 * - This module cannot be imported into client-side code
 * - This module includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://svelte.dev/docs/kit/configuration#env) (if configured)
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://site.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * 
 * console.log(env.ENVIRONMENT); // => "production"
 * console.log(env.PUBLIC_BASE_URL); // => undefined
 * ```
 */
declare module '$env/dynamic/private' {
	export const env: {
		SHOW_QUESTS_AS_IMAGES: string;
		ADAM_AUTH: string;
		HOLOSPHERE_PRIVATE_KEY: string;
		CHAINID: string;
		NETWORK: string;
		WEB3KEY: string;
		WEB3PROVIDERAPPNAME: string;
		HOLOSPHERE_KEY: string;
		BOT_TOKEN: string;
		TELEGRAM: string;
		DISCORD: string;
		OPENAI: string;
		PREFIX: string;
		WEB3PROVIDER: string;
		AIASSISTANT: string;
		MODE: string;
		NODE_ENV: string;
		LOG_LEVEL: string;
		I18N_DEBUG: string;
		BOT_TIMEOUT: string;
		DB_TIMEOUT: string;
		API_TIMEOUT: string;
		SIGNAL_DEBUG: string;
		SIGNAL_ALERT_ADMIN: string;
		ADMIN_CHAT_ID: string;
		ADMIN_IDS: string;
		DASHBOARD_ADDRESS: string;
		MATTERMOST_URL: string;
		MATTERMOST_TOKEN: string;
		VITE_HOLOSPHERE_PRIVATE_KEY: string;
		VITE_OPENAI_API_KEY: string;
		VITE_TELEGRAM_BOT_TOKEN: string;
		VITE_TELEGRAM_BOT_USERNAME: string;
		VITE_DEV_TELEGRAM_USER_ID: string;
		VITE_DEV_TELEGRAM_USER_NAME: string;
		VITE_BOT_API_URL: string;
		VITE_LLM_PROVIDER: string;
		VITE_LLM_MODEL: string;
		VITE_LLM_MAX_TOKENS: string;
		VITE_LLM_TEMPERATURE: string;
		VITE_ANTHROPIC_API_KEY: string;
		VITE_GROQ_API_KEY: string;
		VITE_QR_BASE_URL: string;
		VITE_MAPBOX_TOKEN: string;
		NoDefaultCurrentDirectoryInExePath: string;
		TERM_PROGRAM: string;
		VSCODE_GIT_IPC_AUTH_TOKEN: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		SHELL: string;
		TERM: string;
		TMPDIR: string;
		TERM_PROGRAM_VERSION: string;
		MallocNanoZone: string;
		ZDOTDIR: string;
		PNPM_HOME: string;
		AI_AGENT: string;
		GIT_EDITOR: string;
		USER: string;
		COMMAND_MODE: string;
		SSH_AUTH_SOCK: string;
		CLAUDE_CODE_SSE_PORT: string;
		__CF_USER_TEXT_ENCODING: string;
		VSCODE_PROFILE_INITIALIZED: string;
		npm_config_verify_deps_before_run: string;
		PATH: string;
		LaunchInstanceID: string;
		__CFBundleIdentifier: string;
		USER_ZDOTDIR: string;
		npm_command: string;
		PWD: string;
		OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: string;
		LANG: string;
		NODE_PATH: string;
		XPC_FLAGS: string;
		VSCODE_GIT_ASKPASS_EXTRA_ARGS: string;
		pnpm_config_verify_deps_before_run: string;
		XPC_SERVICE_NAME: string;
		VSCODE_INJECTION: string;
		HOME: string;
		SHLVL: string;
		VSCODE_GIT_ASKPASS_MAIN: string;
		CLAUDE_CODE_EXECPATH: string;
		LOGNAME: string;
		PNPM_PACKAGE_NAME: string;
		VSCODE_GIT_IPC_HANDLE: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		npm_config_user_agent: string;
		GIT_ASKPASS: string;
		VSCODE_GIT_ASKPASS_NODE: string;
		OSLogRateLimit: string;
		SECURITYSESSIONID: string;
		CLAUDECODE: string;
		COLORTERM: string;
		VITE_USER_NODE_ENV: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * This module provides access to environment variables set _dynamically_ at runtime and that are _publicly_ accessible.
 * 
 * |         | Runtime                                                                    | Build time                                                               |
 * | ------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
 * | Private | [`$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private) | [`$env/static/private`](https://svelte.dev/docs/kit/$env-static-private) |
 * | Public  | [`$env/dynamic/public`](https://svelte.dev/docs/kit/$env-dynamic-public)   | [`$env/static/public`](https://svelte.dev/docs/kit/$env-static-public)   |
 * 
 * Dynamic environment variables are defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://svelte.dev/docs/kit/cli)), this is equivalent to `process.env`.
 * 
 * **_Public_ access:**
 * 
 * - This module _can_ be imported into client-side code
 * - **Only** variables that begin with [`config.kit.env.publicPrefix`](https://svelte.dev/docs/kit/configuration#env) (which defaults to `PUBLIC_`) are included
 * 
 * > [!NOTE] In `dev`, `$env/dynamic` includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 * 
 * > [!NOTE] To get correct types, environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * >
 * > ```env
 * > MY_FEATURE_FLAG=
 * > ```
 * >
 * > You can override `.env` values from the command line like so:
 * >
 * > ```sh
 * > MY_FEATURE_FLAG="enabled" npm run dev
 * > ```
 * 
 * For example, given the following runtime environment:
 * 
 * ```env
 * ENVIRONMENT=production
 * PUBLIC_BASE_URL=http://example.com
 * ```
 * 
 * With the default `publicPrefix` and `privatePrefix`:
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.ENVIRONMENT); // => undefined, not public
 * console.log(env.PUBLIC_BASE_URL); // => "http://example.com"
 * ```
 * 
 * ```
 * 
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
