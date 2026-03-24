import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import QRCode from 'qrcode';
import JSZip from 'jszip';
import type { Card, DeckConfig, PDFGeneratorOptions } from './types';
import { renderCardFront, renderCardBack, CARD_WIDTH_PX, CARD_HEIGHT_PX } from './CardRenderer';
import type { QRCapabilityToken } from '$lib/capabilities/qrCapability';
import { encodeCapabilityForUrl } from '$lib/capabilities/qrCapability';
import { shortenUrl } from '../../utils/url-shortener';

// A4 dimensions in pixels at 96 DPI (landscape orientation)
const A4_WIDTH_PX = 1123;
const A4_HEIGHT_PX = 794;

// Card layout: 4 columns x 2 rows (landscape page with portrait cards)
const CARDS_PER_PAGE = 8;
const COLS = 4;
const ROWS = 2;

// Card slot dimensions - portrait cards directly without rotation
const CARD_SLOT_WIDTH_PX = 265;
const CARD_SLOT_HEIGHT_PX = 370;

// Margins
const MARGIN_X_PX = (A4_WIDTH_PX - COLS * CARD_SLOT_WIDTH_PX) / 2;
const MARGIN_Y_PX = (A4_HEIGHT_PX - ROWS * CARD_SLOT_HEIGHT_PX) / 2;

// QR Base URL from environment
const QR_BASE_URL = import.meta.env.VITE_QR_BASE_URL || 'https://dashboard.holons.io/qr';

export function buildQRUrl(card: Card, config: DeckConfig, capability?: QRCapabilityToken): string {
	const params = new URLSearchParams({
		cardId: card.id,
		deckId: config.deckId,
		holonID: config.holonId,
		title: card.title,
		desc: card.description,
		action: card.type
	});

	// Embed capability token if provided
	if (capability) {
		params.set('cap', encodeCapabilityForUrl(capability));
	}

	const baseUrl = config.qrBaseUrl || QR_BASE_URL;
	return `${baseUrl}?${params.toString()}`;
}

export async function generateQRDataUrl(
	url: string,
	transparent: boolean = false,
	width: number = 400
): Promise<string> {
	return await QRCode.toDataURL(url, {
		width,
		margin: 1,
		errorCorrectionLevel: 'M',
		color: transparent ? {
			dark: '#000000',
			light: '#00000000' // Transparent background
		} : undefined
	});
}

/**
 * Convert a data URL to a Blob
 */
function dataUrlToBlob(dataUrl: string): Blob {
	const parts = dataUrl.split(',');
	const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
	const bstr = atob(parts[1]);
	const n = bstr.length;
	const u8arr = new Uint8Array(n);
	for (let i = 0; i < n; i++) {
		u8arr[i] = bstr.charCodeAt(i);
	}
	return new Blob([u8arr], { type: mime });
}

/**
 * Sanitize a filename by removing/replacing invalid characters
 */
function sanitizeFilename(name: string): string {
	return name
		.replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
		.replace(/\s+/g, '_') // Replace spaces with underscores
		.replace(/_+/g, '_') // Collapse multiple underscores
		.replace(/^_|_$/g, '') // Remove leading/trailing underscores
		.substring(0, 100); // Limit length
}

export interface QRZipOptions {
	cards: Card[];
	config: DeckConfig;
	/** Optional map of cardId -> capability token */
	capabilities?: Map<string, QRCapabilityToken>;
	onProgress?: (current: number, total: number) => void;
}

/**
 * Generate a zip file containing transparent PNG QR codes for all cards
 */
export async function generateQRZip(options: QRZipOptions): Promise<Blob> {
	const { cards, config, capabilities, onProgress } = options;
	const zip = new JSZip();

	for (let i = 0; i < cards.length; i++) {
		const card = cards[i];
		const capability = capabilities?.get(card.id);
		const qrUrl = buildQRUrl(card, config, capability);
		const shortUrl = await shortenUrl(qrUrl);
		const qrDataUrl = await generateQRDataUrl(shortUrl, true, 800);
		const qrBlob = dataUrlToBlob(qrDataUrl);

		// Create filename from card title
		const filename = `${sanitizeFilename(card.title)}.png`;
		zip.file(filename, qrBlob);

		onProgress?.(i + 1, cards.length);
	}

	return await zip.generateAsync({ type: 'blob' });
}

/**
 * Download a zip file
 */
export function downloadZip(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}



function createPageHTML(cardHTMLs: string[], mirrored: boolean = false): string {
	let gridHTML = '';

	for (let row = 0; row < ROWS; row++) {
		for (let col = 0; col < COLS; col++) {
			const index = row * COLS + col;
			const actualCol = mirrored ? (COLS - 1 - col) : col;
			const cardHTML = cardHTMLs[index] || '';

			const left = MARGIN_X_PX + actualCol * CARD_SLOT_WIDTH_PX;
			const top = MARGIN_Y_PX + row * CARD_SLOT_HEIGHT_PX;

			gridHTML += `
				<div style="
					position: absolute;
					left: ${left}px;
					top: ${top}px;
					width: ${CARD_SLOT_WIDTH_PX}px;
					height: ${CARD_SLOT_HEIGHT_PX}px;
					display: flex;
					align-items: center;
					justify-content: center;
					border: 1px dashed #ccc;
					box-sizing: border-box;
				">
					${cardHTML}
				</div>
			`;
		}
	}

	return `
		<div style="
			width: ${A4_WIDTH_PX}px;
			height: ${A4_HEIGHT_PX}px;
			background: white;
			position: relative;
		">
			${gridHTML}
		</div>
	`;
}

async function renderPageToCanvas(pageHTML: string): Promise<HTMLCanvasElement> {
	const container = document.createElement('div');
	container.style.position = 'absolute';
	container.style.left = '-9999px';
	container.style.top = '-9999px';
	container.innerHTML = pageHTML;
	document.body.appendChild(container);

	// Wait for all fonts to be loaded
	if (document.fonts && document.fonts.ready) {
		await document.fonts.ready;
	}

	const images = container.querySelectorAll('img');
	await Promise.all(Array.from(images).map(img => {
		if (img.complete) return Promise.resolve();
		return new Promise(resolve => {
			img.onload = resolve;
			img.onerror = resolve;
		});
	}));

	// Give browser time to apply fonts and layout
	await new Promise(r => setTimeout(r, 200));

	const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
		scale: 2,
		useCORS: true,
		allowTaint: true,
		backgroundColor: '#ffffff',
		logging: false,
	});

	document.body.removeChild(container);
	return canvas;
}

export async function generatePDF(options: PDFGeneratorOptions): Promise<Blob> {
	const { cards, config, capabilities, onProgress } = options;

	const pdf = new jsPDF({
		orientation: 'landscape',
		unit: 'mm',
		format: 'a4'
	});

	const pageGroups = Math.ceil(cards.length / CARDS_PER_PAGE);
	const totalSteps = pageGroups * 2;
	let currentStep = 0;

	for (let pageGroup = 0; pageGroup < pageGroups; pageGroup++) {
		const startIndex = pageGroup * CARDS_PER_PAGE;
		const endIndex = Math.min(startIndex + CARDS_PER_PAGE, cards.length);
		const pageCards = cards.slice(startIndex, endIndex);

		const backHTMLs: string[] = [];
		const frontHTMLs: string[] = [];

		for (const card of pageCards) {
			const capability = capabilities?.get(card.id);
			const qrUrl = buildQRUrl(card, config, capability);
			const shortUrl = await shortenUrl(qrUrl);
			const useTransparentQR = config.cardStyle.qrCode.transparentBackground;
			const qrDataUrl = await generateQRDataUrl(shortUrl, useTransparentQR);
			backHTMLs.push(renderCardBack(qrDataUrl, config.cardStyle, config.backgroundImage));
			frontHTMLs.push(renderCardFront(card, config.cardStyle, config.foregroundImage, true));
		}

		// Page 1: fronts (normal order)
		if (pageGroup > 0) pdf.addPage();
		const frontPageHTML = createPageHTML(frontHTMLs, false);
		const frontCanvas = await renderPageToCanvas(frontPageHTML);
		pdf.addImage(frontCanvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);

		currentStep++;
		onProgress?.(currentStep, totalSteps);

		// Page 2: backs (mirrored so they align when paper is flipped)
		pdf.addPage();
		const backPageHTML = createPageHTML(backHTMLs, true);
		const backCanvas = await renderPageToCanvas(backPageHTML);
		pdf.addImage(backCanvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);

		currentStep++;
		onProgress?.(currentStep, totalSteps);
	}

	return pdf.output('blob');
}

export function downloadPDF(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
