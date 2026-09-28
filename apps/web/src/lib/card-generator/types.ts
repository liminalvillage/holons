export type CardType =
  | "action"
  | "task"
  | "event"
  | "role"
  | "badge"
  | "resource"
  | "vibe";

export interface Card {
  id: string;
  title: string;
  type: CardType;
  description: string;
  imageUrl?: string;
  /**
   * Storage key of an existing holon item this card targets. When set, scanning
   * the card joins that specific item (adds the scanner to its participants /
   * assigns the role) instead of creating a new one. Populated when cards are
   * generated from the holon's current tasks/roles/events.
   */
  itemId?: string;
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

export interface DeckConfig {
  deckId: string;
  holonId: string;
  qrBaseUrl?: string; // Custom base URL for QR codes (default: VITE_QR_BASE_URL env variable)
  backgroundImage?: string;
  foregroundImage?: string;
  cardStyle: CardStyle;
}

export interface ParsedCSVResult {
  cards: Card[];
  errors: string[];
}

export interface PDFGeneratorOptions {
  cards: Card[];
  config: DeckConfig;
  onProgress?: (current: number, total: number) => void;
}

export const DEFAULT_CARD_STYLE: CardStyle = {
  typeBadge: {
    fontSize: 16,
    fontFamily: "Arial, sans-serif",
    color: "", // empty means use type color
    top: 8,
    backgroundColor: "", // empty means use type color
  },
  title: {
    fontSize: 20,
    fontFamily: "Arial, sans-serif",
    color: "#1a1a1a",
    top: 70,
  },
  description: {
    fontSize: 14,
    fontFamily: "Arial, sans-serif",
    color: "#666666",
    top: 82,
  },
  qrCode: {
    size: 70,
    top: 50,
    transparentBackground: false,
  },
  cardImage: {
    size: 60,
    top: 50,
    left: 50,
  },
  margin: 20,
};

export const CARD_TYPE_COLORS: Record<CardType, { bg: string; text: string }> =
  {
    action: { bg: "#f97316", text: "#ffffff" },
    task: { bg: "#f97316", text: "#ffffff" },
    event: { bg: "#8b5cf6", text: "#ffffff" },
    role: { bg: "#22c55e", text: "#ffffff" },
    badge: { bg: "#eab308", text: "#000000" },
    resource: { bg: "#3b82f6", text: "#ffffff" },
    vibe: { bg: "#ec4899", text: "#ffffff" },
  };

export const FONT_OPTIONS = [
  "Arial, sans-serif",
  "Georgia, serif",
  "Courier New, monospace",
  "Verdana, sans-serif",
  "Times New Roman, serif",
  "Trebuchet MS, sans-serif",
];
