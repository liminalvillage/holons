// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	interface Window {
		Telegram?: {
			WebApp: {
				initData: string;
				initDataUnsafe: {
					user?: {
						id: number;
						first_name: string;
						last_name?: string;
						username?: string;
						photo_url?: string;
					};
				};
				ready(): void;
				close(): void;
				expand(): void;
				isExpanded: boolean;
				MainButton: {
					text: string;
					color: string;
					textColor: string;
					isVisible: boolean;
					isActive: boolean;
					show(): void;
					hide(): void;
					enable(): void;
					disable(): void;
					onClick(callback: () => void): void;
				};
			};
		};
		ethereum?: {
			request: (args: { method: string; params?: any[] }) => Promise<any>;
			on?: (event: string, handler: (...args: any[]) => void) => void;
			removeListener?: (event: string, handler: (...args: any[]) => void) => void;
		};
	}
}

export {};

/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_LOCAL_MODE: string;
	readonly VITE_OPENAI_API_KEY: string;
	readonly VITE_ANTHROPIC_API_KEY: string;
	readonly VITE_GROQ_API_KEY: string;
	readonly VITE_LLM_PROVIDER: string;
	readonly VITE_LLM_MODEL: string;
	readonly VITE_LLM_MAX_TOKENS: string;
	readonly VITE_LLM_TEMPERATURE: string;
	readonly VITE_SERVICE_KEY: string; // Service key for QR code actions (hex format private key)
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
