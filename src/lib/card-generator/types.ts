import type { CapabilityExpiration, QRCapabilityToken } from '$lib/capabilities/qrCapability';

export type CardType = 'action' | 'task' | 'event' | 'role' | 'badge' | 'resource' | 'vibe';

export interface Card {
	id: string;
	title: string;
	type: CardType;
	description: string;
	imageUrl?: string;
}

export interface TextStyle {
	fontSize: number;
	fontFamily: string;
	color: string;
	top: number; // percentage from top
	backgroundColor?: string; // for badge background
}

export interface QRStyle {
	size: number; // percentage of card width
	top: number; // percentage from top
	transparentBackground: boolean; // hide white background behind QR
}

export interface ImageStyle {
	size: number; // percentage of card width
	top: number; // percentage from top (0-100)
	left: number; // percentage from left (0-100)
}

export interface CardStyle {
	typeBadge: TextStyle;
	title: TextStyle;
	description: TextStyle;
	qrCode: QRStyle;
	cardImage: ImageStyle;
	margin: number; // card content margin in pixels
}

export interface CapabilityOptions {
	/** Enable capability tokens for QR codes */
	enabled: boolean;
	/** Expiration preset for capabilities */
	expiration: CapabilityExpiration;
	/** Custom expiration timestamp (ms) - used when expiration is 'custom' */
	customExpiresAt?: number;
	/** Maximum uses per capability (null = unlimited) */
	maxUses: number | null;
	/** Restrict each card to its specific item title */
	restrictToItem: boolean;
}

export interface DeckConfig {
	deckId: string;
	holonId: string;
	qrBaseUrl?: string; // Custom base URL for QR codes (default: VITE_QR_BASE_URL env variable)
	backgroundImage?: string;
	foregroundImage?: string;
	cardStyle: CardStyle;
	/** Capability options for securing QR codes */
	capabilityOptions?: CapabilityOptions;
}

export interface ParsedCSVResult {
	cards: Card[];
	errors: string[];
}

export interface PDFGeneratorOptions {
	cards: Card[];
	config: DeckConfig;
	/** Optional map of cardId -> capability token */
	capabilities?: Map<string, QRCapabilityToken>;
	onProgress?: (current: number, total: number) => void;
}

export const DEFAULT_CARD_STYLE: CardStyle = {
	typeBadge: {
		fontSize: 16,
		fontFamily: 'Arial, sans-serif',
		color: '', // empty means use type color
		top: 8,
		backgroundColor: '' // empty means use type color
	},
	title: {
		fontSize: 20,
		fontFamily: 'Arial, sans-serif',
		color: '#1a1a1a',
		top: 70
	},
	description: {
		fontSize: 14,
		fontFamily: 'Arial, sans-serif',
		color: '#666666',
		top: 82
	},
	qrCode: {
		size: 70,
		top: 50,
		transparentBackground: false
	},
	cardImage: {
		size: 60,
		top: 50,
		left: 50
	},
	margin: 20
};

export const DEFAULT_CAPABILITY_OPTIONS: CapabilityOptions = {
	enabled: true,
	expiration: '30d',
	maxUses: null,
	restrictToItem: true
};

export const CARD_TYPE_COLORS: Record<CardType, { bg: string; text: string }> = {
	action: { bg: '#f97316', text: '#ffffff' },
	task: { bg: '#f97316', text: '#ffffff' },
	event: { bg: '#8b5cf6', text: '#ffffff' },
	role: { bg: '#22c55e', text: '#ffffff' },
	badge: { bg: '#eab308', text: '#000000' },
	resource: { bg: '#3b82f6', text: '#ffffff' },
	vibe: { bg: '#ec4899', text: '#ffffff' }
};

export const FONT_OPTIONS = [
	'Arial, sans-serif',
	'Georgia, serif',
	'Courier New, monospace',
	'Verdana, sans-serif',
	'Times New Roman, serif',
	'Trebuchet MS, sans-serif'
];
