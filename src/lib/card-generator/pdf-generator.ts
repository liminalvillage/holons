import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import QRCode from 'qrcode';
import type { Card, DeckConfig, PDFGeneratorOptions } from './types';
import { renderCardFront, renderCardBack, CARD_WIDTH_PX, CARD_HEIGHT_PX } from './CardRenderer';

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

export function buildQRUrl(card: Card, config: DeckConfig): string {
	const params = new URLSearchParams({
		cardId: card.id,
		deckId: config.deckId,
		title: card.title,
		type: card.type
	});
	return `https://dashboard.holons.io/qr?${params.toString()}`;
}

export async function generateQRDataUrl(url: string): Promise<string> {
	return await QRCode.toDataURL(url, {
		width: 400,
		margin: 1,
		errorCorrectionLevel: 'M'
	});
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

	const images = container.querySelectorAll('img');
	await Promise.all(Array.from(images).map(img => {
		if (img.complete) return Promise.resolve();
		return new Promise(resolve => {
			img.onload = resolve;
			img.onerror = resolve;
		});
	}));

	await new Promise(r => setTimeout(r, 100));

	const canvas = await html2canvas(container.firstElementChild as HTMLElement, {
		scale: 2,
		useCORS: true,
		allowTaint: true,
		backgroundColor: '#ffffff',
	});

	document.body.removeChild(container);
	return canvas;
}

export async function generatePDF(options: PDFGeneratorOptions): Promise<Blob> {
	const { cards, config, onProgress } = options;

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
			const qrUrl = buildQRUrl(card, config);
			const qrDataUrl = await generateQRDataUrl(qrUrl);
			backHTMLs.push(renderCardBack(qrDataUrl, config.cardStyle, config.backgroundImage));
			frontHTMLs.push(renderCardFront(card, config.cardStyle, config.foregroundImage));
		}

		if (pageGroup > 0) pdf.addPage();
		const backPageHTML = createPageHTML(backHTMLs, false);
		const backCanvas = await renderPageToCanvas(backPageHTML);
		pdf.addImage(backCanvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);

		currentStep++;
		onProgress?.(currentStep, totalSteps);

		pdf.addPage();
		const frontPageHTML = createPageHTML(frontHTMLs, true);
		const frontCanvas = await renderPageToCanvas(frontPageHTML);
		pdf.addImage(frontCanvas.toDataURL('image/png'), 'PNG', 0, 0, 297, 210);

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
