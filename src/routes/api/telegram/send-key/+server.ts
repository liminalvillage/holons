import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Get the Telegram bot token from environment
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM || import.meta.env.VITE_TELEGRAM_BOT_TOKEN;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { telegramUserId, privateKey, publicKey } = await request.json();

		if (!telegramUserId || !privateKey) {
			return json({ error: 'Missing required fields' }, { status: 400 });
		}

		if (!TELEGRAM_BOT_TOKEN) {
			console.error('Telegram bot token not configured');
			return json({ error: 'Telegram not configured' }, { status: 500 });
		}

		// Format the message with the key
		const message = `🔐 *Your Harvest Identity Key*

⚠️ *IMPORTANT: Keep this key secret and safe!*

Your private key has been generated for Harvest. This key gives you full access to your data and identity.

\`\`\`
${privateKey}
\`\`\`

📍 *Public Key:*
\`${publicKey}\`

━━━━━━━━━━━━━━━━━━━━━━━━

🔒 *Security Tips:*
• Never share your private key with anyone
• Store it in a secure password manager
• This message will remain in your chat history

If you lose this key, you will not be able to recover your data.`;

		// Send message via Telegram Bot API
		const telegramResponse = await fetch(
			`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					chat_id: telegramUserId,
					text: message,
					parse_mode: 'Markdown',
					disable_web_page_preview: true
				})
			}
		);

		const result = await telegramResponse.json();

		if (!result.ok) {
			console.error('Telegram API error:', result);
			return json({ error: 'Failed to send message' }, { status: 500 });
		}

		return json({ success: true });
	} catch (error) {
		console.error('Error sending key via Telegram:', error);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
