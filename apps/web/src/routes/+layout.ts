export const ssr = false;
export const prerender = false;

// Authentication is handled by the verified Telegram session (see
// $lib/server/telegramAuth + /api/auth/*). The old `?key=` private-key
// auto-auth was removed — keys are never accepted from the URL.
