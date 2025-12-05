import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Telegram WebApp types
export interface TelegramUser {
	id: number;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
	is_premium?: boolean;
	photo_url?: string;
}

export interface TelegramWebApp {
	initData: string;
	initDataUnsafe: {
		query_id?: string;
		user?: TelegramUser;
		auth_date?: number;
		hash?: string;
		start_param?: string;
	};
	version: string;
	platform: string;
	colorScheme: 'light' | 'dark';
	themeParams: Record<string, string>;
	isExpanded: boolean;
	viewportHeight: number;
	viewportStableHeight: number;
	headerColor: string;
	backgroundColor: string;
	isClosingConfirmationEnabled: boolean;
	ready: () => void;
	expand: () => void;
	close: () => void;
	enableClosingConfirmation: () => void;
	disableClosingConfirmation: () => void;
	MainButton: {
		text: string;
		color: string;
		textColor: string;
		isVisible: boolean;
		isActive: boolean;
		isProgressVisible: boolean;
		setText: (text: string) => void;
		onClick: (callback: () => void) => void;
		offClick: (callback: () => void) => void;
		show: () => void;
		hide: () => void;
		enable: () => void;
		disable: () => void;
		showProgress: (leaveActive?: boolean) => void;
		hideProgress: () => void;
	};
	BackButton: {
		isVisible: boolean;
		onClick: (callback: () => void) => void;
		offClick: (callback: () => void) => void;
		show: () => void;
		hide: () => void;
	};
	HapticFeedback: {
		impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
		notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
		selectionChanged: () => void;
	};
}

// Telegram WebApp is declared on window by the SDK script

// Authentication state
interface TelegramAuthState {
	isAuthenticated: boolean;
	user: TelegramUser | null;
	isTelegramWebApp: boolean;
	isLoading: boolean;
	error: string | null;
}

const initialState: TelegramAuthState = {
	isAuthenticated: false,
	user: null,
	isTelegramWebApp: false,
	isLoading: true,
	error: null
};

// Create the store
function createTelegramStore() {
	const { subscribe, set, update } = writable<TelegramAuthState>(initialState);

	return {
		subscribe,

		// Initialize - check if running in Telegram WebApp
		init: () => {
			if (!browser) return;

			update((state) => ({ ...state, isLoading: true }));

			// Check if Telegram WebApp is available
			const win = window as any;
			const telegram = win.Telegram?.WebApp as TelegramWebApp | undefined;

			if (telegram && telegram.initDataUnsafe?.user) {
				// We're inside Telegram WebApp
				const user = telegram.initDataUnsafe.user;

				// Notify Telegram that the app is ready
				telegram.ready();

				// Expand the app to full height
				telegram.expand();

				update((state) => ({
					...state,
					isAuthenticated: true,
					user,
					isTelegramWebApp: true,
					isLoading: false,
					error: null
				}));

				// Store in localStorage for persistence
				localStorage.setItem('telegram_user', JSON.stringify(user));

				console.log('Telegram WebApp user:', user);
			} else {
				// Check if we're actually inside Telegram WebApp (initData is non-empty)
				// The SDK loads on regular web too, but initData is empty outside Telegram
				const isActuallyInTelegram = telegram && telegram.initData && telegram.initData.length > 0;

				// Check if we have a stored user from previous login
				const storedUser = localStorage.getItem('telegram_user');
				if (storedUser) {
					try {
						const user = JSON.parse(storedUser);
						update((state) => ({
							...state,
							isAuthenticated: true,
							user,
							isTelegramWebApp: isActuallyInTelegram,
							isLoading: false,
							error: null
						}));
					} catch {
						update((state) => ({
							...state,
							isAuthenticated: false,
							user: null,
							isTelegramWebApp: isActuallyInTelegram,
							isLoading: false,
							error: null
						}));
					}
				} else {
					update((state) => ({
						...state,
						isAuthenticated: false,
						user: null,
						isTelegramWebApp: isActuallyInTelegram,
						isLoading: false,
						error: null
					}));
				}
			}
		},

		// Handle Telegram Login Widget callback
		loginWithWidget: (user: TelegramUser) => {
			localStorage.setItem('telegram_user', JSON.stringify(user));
			update((state) => ({
				...state,
				isAuthenticated: true,
				user,
				isLoading: false,
				error: null
			}));
		},

		// Logout
		logout: () => {
			localStorage.removeItem('telegram_user');
			set({
				...initialState,
				isLoading: false
			});
		},

		// Set error
		setError: (error: string) => {
			update((state) => ({
				...state,
				error,
				isLoading: false
			}));
		},

		// Get Telegram WebApp instance
		getWebApp: (): TelegramWebApp | null => {
			if (!browser) return null;
			const win = window as any;
			return win.Telegram?.WebApp || null;
		}
	};
}

export const telegramStore = createTelegramStore();

// Derived stores for convenience
export const isAuthenticated = derived(telegramStore, ($store) => $store.isAuthenticated);
export const telegramUser = derived(telegramStore, ($store) => $store.user);
export const isTelegramWebApp = derived(telegramStore, ($store) => $store.isTelegramWebApp);
export const isLoading = derived(telegramStore, ($store) => $store.isLoading);
