<script lang="ts">
	import { onMount } from 'svelte';
	import { shortenUrl } from '../utils/url-shortener';

	const QR_BASE_URL = import.meta.env.VITE_QR_BASE_URL || 'https://dashboard.holons.io/qr';

	export let action: string = '';
	export let title: string = '';
	export let holonID: string = '';
	export let deckId: string = '';
	export let cardId: string = '';
	export let desc: string = '';

	let qrContainer: HTMLDivElement;
	let qrCode: string = '';

	onMount(() => {
		generateQRCode();
	});

	async function generateQRCode() {
		if (!action || !title || !holonID) {
			console.error('Missing required parameters for QR code generation');
			return;
		}

		// Normalize action type - treat 'action' as 'task'
		const normalizedAction = action.toLowerCase() === 'action' ? 'task' : action;

		// Create the URL that the QR code should point to
		const qrUrl = `${QR_BASE_URL}?action=${encodeURIComponent(normalizedAction)}&title=${encodeURIComponent(title)}&desc=${encodeURIComponent(desc)}&holonID=${encodeURIComponent(holonID)}&deckId=${encodeURIComponent(deckId)}&cardId=${encodeURIComponent(cardId)}`;

		// Shorten the URL so the QR code is simpler and easier to scan
		const shortUrl = await shortenUrl(qrUrl);

		// Generate SVG QR code using a reliable service
		qrCode = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&format=svg&data=${encodeURIComponent(shortUrl)}&margin=10`;
	}

	function downloadQRCode() {
		if (!qrCode || !title) return;
		
		// Create a temporary link element to trigger download
		const link = document.createElement('a');
		link.href = qrCode;
		
		// Create filename from title, sanitized for file system
		const sanitizedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
		link.download = `${sanitizedTitle}.svg`;
		
		// Trigger download
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}

	$: if (action && title && holonID) {
		generateQRCode();
	}
</script>

<div class="role-card">
	<!-- Title Section -->
	<div class="card-title">
		<span class="title-text">{(action.toLowerCase() === 'action' ? 'TASK' : action.toUpperCase())}</span>
	</div>
	
	<!-- Icon/QR Code Section -->
	<div class="card-icon-section">
		<div class="icon-background">
			<div class="circuit-pattern"></div>
			{#if qrCode}
				<img 
					src={qrCode} 
					alt="QR Code for {title}" 
					class="qr-icon"
					width="200" 
					height="200"
				/>
			{:else}
				<div class="qr-placeholder">
					<div class="loading-spinner"></div>
				</div>
			{/if}
		</div>
	</div>
	
	<!-- Description Section -->
	<div class="card-description">
		<h3 class="role-name">{title}</h3>
		<p class="role-desc">{desc || `QR Code for ${title} badge`}</p>
		
		<!-- Action Info -->
		<div class="action-info">
			<p><strong>Action:</strong> {action.toLowerCase() === 'action' ? 'task' : action}</p>
			<p><strong>Holon ID:</strong> {holonID}</p>
			{#if deckId}
				<p><strong>Deck ID:</strong> {deckId}</p>
			{/if}
			{#if cardId}
				<p><strong>Card ID:</strong> {cardId}</p>
			{/if}
		</div>
		
		<!-- Download Button -->
		<button 
			on:click={downloadQRCode}
			class="download-btn"
			disabled={!qrCode}
		>
			📥 Download QR Code
		</button>
	</div>
</div>

<style lang="scss">
	.role-card {
		background: linear-gradient(135deg, #4ade80 0%, #22c55e 50%, #16a34a 100%);
		border-radius: 1rem;
		padding: 1.5rem;
		width: 320px;
		height: 420px;
		display: flex;
		flex-direction: column;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.2);
		position: relative;
		overflow: hidden;
	}

	.card-title {
		text-align: center;
		margin-bottom: 1rem;
	}

	.title-text {
		background: rgba(255, 255, 255, 0.9);
		color: #16a34a;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.card-icon-section {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 1rem;
	}

	.icon-background {
		position: relative;
		width: 200px;
		height: 200px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 1rem;
		box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
		overflow: hidden;
	}

	.circuit-pattern {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background-image: 
			linear-gradient(90deg, rgba(34, 197, 94, 0.1) 1px, transparent 1px),
			linear-gradient(rgba(34, 197, 94, 0.1) 1px, transparent 1px);
		background-size: 20px 20px;
		opacity: 0.3;
	}

	.qr-icon {
		position: relative;
		z-index: 2;
		border-radius: 0.5rem;
		background: white;
		padding: 0.5rem;
	}

	.qr-placeholder {
		position: relative;
		z-index: 2;
		width: 100px;
		height: 100px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(34, 197, 94, 0.1);
		border-radius: 0.5rem;
	}

	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 3px solid rgba(34, 197, 94, 0.3);
		border-top: 3px solid #16a34a;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}

	.card-description {
		text-align: center;
		color: white;
	}

	.role-name {
		font-size: 1.125rem;
		font-weight: 700;
		margin-bottom: 0.5rem;
		line-height: 1.3;
	}

	.role-desc {
		font-size: 0.875rem;
		line-height: 1.4;
		margin-bottom: 1rem;
		opacity: 0.95;
	}

	.action-info {
		background: rgba(255, 255, 255, 0.15);
		padding: 0.75rem;
		border-radius: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.75rem;
		backdrop-filter: blur(10px);
		
		p {
			margin: 0.25rem 0;
			line-height: 1.3;
		}
	}

	.download-btn {
		background: rgba(255, 255, 255, 0.2);
		color: white;
		border: 1px solid rgba(255, 255, 255, 0.3);
		padding: 0.75rem 1.5rem;
		border-radius: 0.5rem;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		backdrop-filter: blur(10px);
		width: 100%;

		&:hover:not(:disabled) {
			background: rgba(255, 255, 255, 0.3);
			transform: translateY(-1px);
		}

		&:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	}
</style> 