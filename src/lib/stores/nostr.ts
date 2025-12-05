import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'nostr_private_key';

export interface NostrKeyState {
	privateKey: string | null;
	publicKey: string | null;
	isLoading: boolean;
	isNewKey: boolean; // True if key was just generated (needs backup)
}

const initialState: NostrKeyState = {
	privateKey: null,
	publicKey: null,
	isLoading: true,
	isNewKey: false
};

function createNostrStore() {
	const { subscribe, set, update } = writable<NostrKeyState>(initialState);

	return {
		subscribe,

		// Initialize - check localStorage for existing key
		init: async () => {
			if (!browser) return;

			update((state) => ({ ...state, isLoading: true }));

			try {
				const storedKey = localStorage.getItem(STORAGE_KEY);
				if (storedKey) {
					const publicKey = await derivePublicKey(storedKey);
					update((state) => ({
						...state,
						privateKey: storedKey,
						publicKey,
						isLoading: false,
						isNewKey: false
					}));
					console.log('Nostr key loaded from localStorage');
				} else {
					update((state) => ({
						...state,
						isLoading: false
					}));
				}
			} catch (error) {
				console.error('Error loading Nostr key:', error);
				update((state) => ({
					...state,
					isLoading: false
				}));
			}
		},

		// Generate a new keypair
		generateKey: async () => {
			if (!browser) return;

			update((state) => ({ ...state, isLoading: true }));

			try {
				// Generate 32 random bytes for private key
				const privateKeyBytes = new Uint8Array(32);
				crypto.getRandomValues(privateKeyBytes);
				const privateKey = bytesToHex(privateKeyBytes);

				// Derive public key
				const publicKey = await derivePublicKey(privateKey);

				// Store in localStorage
				localStorage.setItem(STORAGE_KEY, privateKey);

				update((state) => ({
					...state,
					privateKey,
					publicKey,
					isLoading: false,
					isNewKey: true // Mark as new for backup prompt
				}));

				console.log('New Nostr keypair generated');
				return { privateKey, publicKey };
			} catch (error) {
				console.error('Error generating Nostr key:', error);
				update((state) => ({
					...state,
					isLoading: false
				}));
				throw error;
			}
		},

		// Import an existing private key
		importKey: async (privateKey: string) => {
			if (!browser) return;

			// Validate key format (64 hex characters)
			if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) {
				throw new Error('Invalid private key format. Must be 64 hex characters.');
			}

			update((state) => ({ ...state, isLoading: true }));

			try {
				// Derive public key to validate
				const publicKey = await derivePublicKey(privateKey);

				// Store in localStorage
				localStorage.setItem(STORAGE_KEY, privateKey.toLowerCase());

				update((state) => ({
					...state,
					privateKey: privateKey.toLowerCase(),
					publicKey,
					isLoading: false,
					isNewKey: false
				}));

				console.log('Nostr key imported successfully');
				return { privateKey: privateKey.toLowerCase(), publicKey };
			} catch (error) {
				console.error('Error importing Nostr key:', error);
				update((state) => ({
					...state,
					isLoading: false
				}));
				throw error;
			}
		},

		// Mark key as backed up (no longer new)
		markBackedUp: () => {
			update((state) => ({
				...state,
				isNewKey: false
			}));
		},

		// Clear the key (logout)
		clearKey: () => {
			if (browser) {
				localStorage.removeItem(STORAGE_KEY);
			}
			set({
				...initialState,
				isLoading: false
			});
		},

		// Get current state synchronously
		getState: (): NostrKeyState => {
			return get({ subscribe });
		}
	};
}

// Helper: Convert bytes to hex string
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// Helper: Convert hex string to bytes
function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
	}
	return bytes;
}

// Derive public key from private key using nostr-tools or secp256k1
async function derivePublicKey(privateKeyHex: string): Promise<string> {
	try {
		// Try to use nostr-tools if available
		const nostrTools = await import('nostr-tools');
		const publicKey = nostrTools.getPublicKey(hexToBytes(privateKeyHex));
		return publicKey;
	} catch (error) {
		console.warn('nostr-tools not available, using fallback');
		// Fallback: just return a placeholder (in production, nostr-tools should be available)
		// The actual public key derivation requires secp256k1
		throw new Error('Could not derive public key. nostr-tools not available.');
	}
}

export const nostrStore = createNostrStore();

// Derived stores for convenience
export const hasNostrKey = derived(nostrStore, ($store) => !!$store.privateKey);
export const nostrPublicKey = derived(nostrStore, ($store) => $store.publicKey);
export const nostrPrivateKey = derived(nostrStore, ($store) => $store.privateKey);
export const isNostrLoading = derived(nostrStore, ($store) => $store.isLoading);
export const isNewNostrKey = derived(nostrStore, ($store) => $store.isNewKey);
