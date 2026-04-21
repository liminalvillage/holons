import { error, type RequestHandler } from '@sveltejs/kit';

// Server-side proxy for iCal feeds. Needed because most calendar providers
// (Google Calendar, Apple iCloud) do not send CORS headers, so the browser
// can't fetch them directly.
export const GET: RequestHandler = async ({ url, fetch }) => {
	const target = url.searchParams.get('url');
	if (!target) throw error(400, 'Missing url query parameter');

	// Accept http/https/webcal only; convert webcal→https.
	let fetchUrl: URL;
	try {
		fetchUrl = new URL(target);
	} catch {
		throw error(400, 'Invalid url');
	}
	if (fetchUrl.protocol === 'webcal:') {
		fetchUrl.protocol = 'https:';
	}
	if (fetchUrl.protocol !== 'http:' && fetchUrl.protocol !== 'https:') {
		throw error(400, 'Only http/https/webcal URLs are allowed');
	}

	let upstream: Response;
	try {
		upstream = await fetch(fetchUrl.toString(), {
			headers: { Accept: 'text/calendar, text/plain, */*' }
		});
	} catch (e: any) {
		throw error(502, `Upstream fetch failed: ${e?.message ?? 'unknown'}`);
	}

	if (!upstream.ok) {
		throw error(upstream.status, `Upstream responded ${upstream.status} ${upstream.statusText}`);
	}

	const body = await upstream.text();
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			// Cache briefly so rapid reloads don't hammer upstream.
			'cache-control': 'public, max-age=300'
		}
	});
};
