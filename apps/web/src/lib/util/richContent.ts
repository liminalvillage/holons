// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Rich-content rendering helpers for sidebar descriptions.
 *
 * Items imported from KML or pasted from the web often carry HTML bodies with
 * inline images, links, and `<iframe>` embeds. Rendering that raw is unsafe
 * (`{@html ...}` happily executes script tags) — and rendering it as text
 * leaves users staring at "&lt;img src=…&gt;" gibberish.
 *
 * Policy:
 *   - Links stay as links: anchors are NOT converted to embeds. Clicking a
 *     YouTube link goes to YouTube; we don't second-guess the author.
 *   - Real `<iframe>` markup in the source IS rendered, sanitized to a
 *     small allowlist of well-known embed origins (YouTube, Vimeo, Loom,
 *     SoundCloud, Spotify). Anything else gets stripped.
 *   - DOMPurify enforces an attribute allowlist on top of that so script
 *     attributes, javascript: URLs, etc. never reach the DOM.
 *
 * The output is safe to drop into a Svelte `{@html …}` block.
 */

import DOMPurify from 'dompurify';

// Origins we trust to host iframe embeds the author intentionally pasted.
// Each entry is a string prefix that the iframe `src` must start with;
// anything else is dropped by the DOMPurify hook below.
const ALLOWED_IFRAME_SRC_PREFIXES = [
	'https://www.youtube.com/embed/',
	'https://youtube.com/embed/',
	'https://www.youtube-nocookie.com/embed/',
	'https://youtube-nocookie.com/embed/',
	'https://player.vimeo.com/video/',
	'https://www.loom.com/embed/',
	'https://w.soundcloud.com/player/',
	'https://open.spotify.com/embed/'
];

function isAllowedIframeSrc(src: string): boolean {
	return ALLOWED_IFRAME_SRC_PREFIXES.some((p) => src.startsWith(p));
}

// DOMPurify hook: allow `<iframe>` only when `src` matches the embed
// allowlist. Installed once at module-load so it's active for every call.
let hookInstalled = false;
function installPurifyHook(): void {
	if (hookInstalled || typeof window === 'undefined') return;
	DOMPurify.addHook('uponSanitizeElement', (node, data) => {
		if (data.tagName !== 'iframe') return;
		const src = (node as Element).getAttribute('src') ?? '';
		if (!isAllowedIframeSrc(src)) (node as Element).parentNode?.removeChild(node);
	});
	hookInstalled = true;
}

const PURIFY_CONFIG = {
	ALLOWED_TAGS: [
		'a', 'b', 'br', 'div', 'em', 'i', 'img', 'iframe', 'li', 'ol',
		'p', 'pre', 'span', 'strong', 'u', 'ul'
	],
	ALLOWED_ATTR: [
		'href', 'target', 'rel',
		'src', 'alt', 'title', 'width', 'height',
		'allow', 'allowfullscreen', 'frameborder', 'loading',
		'class'
	]
};

/**
 * Sanitize `html` into a string safe for `{@html …}`. Returns an empty
 * string for nullish / non-string input. Server-side this is a no-op
 * (DOMPurify is a DOM-based library), and the result is also empty so
 * server-rendered output doesn't leak unsanitized markup.
 */
export function sanitizeRichDescription(html: string | null | undefined): string {
	if (!html || typeof html !== 'string') return '';
	if (typeof window === 'undefined') return '';

	installPurifyHook();

	const cleaned = DOMPurify.sanitize(html, PURIFY_CONFIG);

	// Post-sanitization pass:
	//   - Linkify any bare `http(s)://…` URL that appears in plain text but
	//     wasn't already inside an anchor. Without this, descriptions like
	//     "see https://example.org for more" render the URL as inert text.
	//   - Force every anchor to `target="_blank" rel="noopener noreferrer"`
	//     so the system browser opens them in a new tab/window and the new
	//     context can't reach back into our window.
	//   - Wrap surviving iframes in a 16:9 responsive box + `loading="lazy"`.
	try {
		const doc = new DOMParser().parseFromString(`<div id="r">${cleaned}</div>`, 'text/html');
		const root = doc.getElementById('r');
		if (root) {
			linkifyTextNodes(root, doc);

			for (const a of Array.from(root.querySelectorAll('a'))) {
				a.setAttribute('target', '_blank');
				a.setAttribute('rel', 'noopener noreferrer');
			}
			for (const f of Array.from(root.querySelectorAll('iframe'))) {
				if (!f.hasAttribute('loading')) f.setAttribute('loading', 'lazy');
				// Wrap each iframe in a 16:9 responsive box so it scales with
				// the sidebar width. Idempotent: skip if already wrapped.
				if (f.parentElement?.classList.contains('rich-embed')) continue;
				const wrap = doc.createElement('div');
				wrap.className = 'rich-embed';
				f.replaceWith(wrap);
				wrap.appendChild(f);
			}
			return root.innerHTML;
		}
	} catch {
		// Best effort — fall back to the cleaned string as-is.
	}
	return cleaned;
}

// Match a bare http/https URL inside a text node. We exclude common trailing
// punctuation (`.,;:!?)`) so "see https://example.org." doesn't link the
// trailing period. The non-greedy character class also stops at whitespace
// and angle/quote chars — which TreeWalker text nodes won't contain anyway,
// but keeps the regex defensive if invoked elsewhere.
const BARE_URL_RE = /(https?:\/\/[^\s<>"]+?)(?=[.,;:!?)]?(?:\s|$))/g;

function linkifyTextNodes(root: Element, doc: Document): void {
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	let node: Node | null = walker.nextNode();
	while (node) {
		textNodes.push(node as Text);
		node = walker.nextNode();
	}

	for (const textNode of textNodes) {
		// Don't double-link content already inside an anchor.
		if (textNode.parentElement?.closest('a')) continue;
		const content = textNode.textContent ?? '';
		if (!content.includes('http')) continue;

		BARE_URL_RE.lastIndex = 0;
		let match = BARE_URL_RE.exec(content);
		if (!match) continue;

		const frag = doc.createDocumentFragment();
		let cursor = 0;
		while (match) {
			const url = match[1];
			if (match.index > cursor) {
				frag.appendChild(doc.createTextNode(content.slice(cursor, match.index)));
			}
			const a = doc.createElement('a');
			a.setAttribute('href', url);
			a.setAttribute('target', '_blank');
			a.setAttribute('rel', 'noopener noreferrer');
			a.textContent = url;
			frag.appendChild(a);
			cursor = match.index + url.length;
			match = BARE_URL_RE.exec(content);
		}
		if (cursor < content.length) {
			frag.appendChild(doc.createTextNode(content.slice(cursor)));
		}
		textNode.parentNode?.replaceChild(frag, textNode);
	}
}

/** True when `html` looks like it contains any HTML markup at all. */
export function looksLikeHtml(html: string | null | undefined): boolean {
	if (!html) return false;
	return /<[a-zA-Z][^>]*>/.test(html);
}

// Capture the 11-char video id from any common YouTube URL shape — used by
// RichDescription to detect YouTube anchors (so a click can swap them for
// an inline player) and by the in-map browser window to rewrite watch /
// share URLs into embed URLs that actually play inside an iframe.
const YT_URL_RE =
	/(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s"']*&)?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/** Returns the 11-char video id from any common YouTube URL shape, or null. */
export function extractYoutubeId(url: string | null | undefined): string | null {
	if (!url) return null;
	const m = url.match(YT_URL_RE);
	return m?.[1] ?? null;
}

/**
 * Rewrite a URL so it loads inside an iframe.
 *
 * Most sites set `X-Frame-Options: DENY` and refuse to load in iframes; for
 * those we just hand back the original URL and let the in-map window show
 * its "Open externally" fallback. For YouTube specifically we can swap
 * `/watch?v=ID` (or any other shape) into `/embed/ID`, which IS framable
 * and gives users inline playback inside the draggable window.
 */
export function toEmbeddableUrl(url: string): string {
	const id = extractYoutubeId(url);
	if (id) return `https://www.youtube.com/embed/${id}`;
	return url;
}
