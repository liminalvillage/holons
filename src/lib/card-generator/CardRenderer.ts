import type { Card, CardStyle } from './types';
import { CARD_TYPE_COLORS } from './types';

// Card dimensions in pixels (portrait orientation)
export const CARD_WIDTH_PX = 265;
export const CARD_HEIGHT_PX = 370;

/**
 * Renders the front of a card as HTML with inline styles.
 * Uses flexbox layout for reliable rendering in html2canvas.
 */
export function renderCardFront(
	card: Card,
	style: CardStyle,
	foregroundImage?: string
): string {
	const colors = CARD_TYPE_COLORS[card.type];
	const desc = card.description || '';
	const truncatedDesc = desc.length > 100 ? desc.substring(0, 97) + '...' : desc;

	const bgStyle = foregroundImage
		? `background-image: url('${foregroundImage}'); background-size: cover; background-position: center;`
		: 'background: white;';

	// Use type color if no custom color/background specified for badge
	const badgeColor = style.typeBadge.color || colors.text;
	const badgeBg = style.typeBadge.backgroundColor || colors.bg;
	const margin = style.margin ?? 20;

	// Calculate spacing based on style positions
	// Badge area: from top to badge position + some space for badge
	const badgeAreaHeight = Math.round((style.typeBadge.top / 100) * CARD_HEIGHT_PX + 60);
	// Content area: title + description at bottom
	const contentAreaHeight = CARD_HEIGHT_PX - badgeAreaHeight - margin;
	// Title takes about 30% of content area, description the rest
	const titleHeight = Math.round(contentAreaHeight * 0.35);
	const descHeight = contentAreaHeight - titleHeight;

	// Card image overlay (from CSV imageUrl field)
	const cardImageOverlay = card.imageUrl
		? `<img src="${card.imageUrl}" style="
				position: absolute;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				max-width: 60%;
				max-height: 40%;
				object-fit: contain;
				z-index: 1;
			" crossorigin="anonymous" />`
		: '';

	return `
		<div style="
			width: ${CARD_WIDTH_PX}px;
			height: ${CARD_HEIGHT_PX}px;
			${bgStyle}
			border-radius: 16px;
			overflow: hidden;
			box-sizing: border-box;
			display: flex;
			flex-direction: column;
			position: relative;
		">
			${cardImageOverlay}
			<!-- Top spacer with badge -->
			<div style="
				height: ${badgeAreaHeight}px;
				display: flex;
				align-items: flex-start;
				justify-content: center;
				padding-top: ${Math.round((style.typeBadge.top / 100) * CARD_HEIGHT_PX)}px;
				flex-shrink: 0;
				position: relative;
				z-index: 2;
			">
				<div style="
					background: ${badgeBg};
					color: ${badgeColor};
					padding: 10px 24px;
					border-radius: 24px;
					font-size: ${style.typeBadge.fontSize}px;
					font-family: ${style.typeBadge.fontFamily};
					font-weight: bold;
					text-transform: uppercase;
					letter-spacing: 1px;
					white-space: nowrap;
				">${card.type}</div>
			</div>

			<!-- Content area: title + description -->
			<div style="
				flex: 1;
				display: flex;
				flex-direction: column;
				justify-content: flex-end;
				padding: 0 ${margin}px ${margin}px ${margin}px;
				overflow: hidden;
				position: relative;
				z-index: 2;
			">
				<!-- Title -->
				<div style="
					height: ${titleHeight}px;
					overflow: hidden;
				">
					<div style="
						height: 100%;
						display: flex;
						align-items: center;
						justify-content: center;
					">
						<span style="
							text-align: center;
							font-size: ${style.title.fontSize}px;
							font-family: ${style.title.fontFamily};
							font-weight: bold;
							color: ${style.title.color};
							line-height: 1.2;
							word-wrap: break-word;
							overflow-wrap: break-word;
						">${card.title}</span>
					</div>
				</div>

				<!-- Description -->
				<div style="
					height: ${descHeight}px;
					overflow: hidden;
				">
					<div style="
						text-align: center;
						font-size: ${style.description.fontSize}px;
						font-family: ${style.description.fontFamily};
						color: ${style.description.color};
						line-height: 1.4;
						word-wrap: break-word;
						overflow-wrap: break-word;
					">${truncatedDesc}</div>
				</div>
			</div>
		</div>
	`;
}

/**
 * Renders the back of a card (with QR code) as HTML with inline styles.
 * This is the single source of truth for card back rendering.
 */
export function renderCardBack(
	qrDataUrl: string,
	style: CardStyle,
	backgroundImage?: string
): string {
	const bgStyle = backgroundImage
		? `background-image: url('${backgroundImage}'); background-size: cover; background-position: center;`
		: 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';

	// Scale QR based on card width (smaller dimension) to ensure it fits
	const qrSize = (style.qrCode.size / 100) * CARD_WIDTH_PX;
	const qrBgStyle = style.qrCode.transparentBackground
		? ''
		: 'background: white; padding: 16px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.2);';

	return `
		<div style="
			width: ${CARD_WIDTH_PX}px;
			height: ${CARD_HEIGHT_PX}px;
			${bgStyle}
			border-radius: 16px;
			position: relative;
			overflow: hidden;
			box-sizing: border-box;
		">
			<div style="
				position: absolute;
				top: ${style.qrCode.top}%;
				left: 50%;
				transform: translate(-50%, -50%);
				${qrBgStyle}
			">
				<img src="${qrDataUrl}" style="
					width: ${qrSize}px;
					height: ${qrSize}px;
					max-width: ${qrSize}px;
					max-height: ${qrSize}px;
					object-fit: contain;
					display: block;
				" />
			</div>
		</div>
	`;
}

/**
 * Renders the back of a card with a placeholder QR code (for preview).
 * Uses an SVG placeholder instead of an actual QR image.
 */
export function renderCardBackPlaceholder(
	style: CardStyle,
	backgroundImage?: string
): string {
	const bgStyle = backgroundImage
		? `background-image: url('${backgroundImage}'); background-size: cover; background-position: center;`
		: 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);';

	// Scale QR based on card width (smaller dimension) to ensure it fits
	const qrSize = (style.qrCode.size / 100) * CARD_WIDTH_PX;
	const qrBgStyle = style.qrCode.transparentBackground
		? ''
		: 'background: white; padding: 16px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.2);';

	// SVG QR placeholder
	const qrPlaceholder = `
		<svg viewBox="0 0 24 24" style="width: ${qrSize}px; height: ${qrSize}px; display: block;">
			<rect width="24" height="24" fill="${style.qrCode.transparentBackground ? 'transparent' : '#f3f4f6'}"/>
			<path fill="${style.qrCode.transparentBackground ? '#ffffff' : '#6b7280'}" d="M3 3h6v6H3V3zm2 2v2h2V5H5zm8-2h6v6h-6V3zm2 2v2h2V5h-2zM3 13h6v6H3v-6zm2 2v2h2v-2H5zm8-2h2v2h-2v-2zm4 0h2v2h-2v-2zm-4 4h2v2h-2v-2zm4 0h2v2h-2v-2zm-2-2h2v2h-2v-2z"/>
		</svg>
	`;

	return `
		<div style="
			width: ${CARD_WIDTH_PX}px;
			height: ${CARD_HEIGHT_PX}px;
			${bgStyle}
			border-radius: 16px;
			position: relative;
			overflow: hidden;
			box-sizing: border-box;
		">
			<div style="
				position: absolute;
				top: ${style.qrCode.top}%;
				left: 50%;
				transform: translate(-50%, -50%);
				${qrBgStyle}
			">
				${qrPlaceholder}
			</div>
		</div>
	`;
}
