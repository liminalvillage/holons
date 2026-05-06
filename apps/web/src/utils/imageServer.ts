const PROD_HOST = 'https://telegram.holons.io';
const DEV_HOST = 'http://localhost:8080';

export function imageServerBase(): string {
  if (typeof window === 'undefined') return PROD_HOST;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return DEV_HOST;
  return PROD_HOST;
}

export function resolveImage(src: string | null | undefined): string {
  if (!src) return '';
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  return `${imageServerBase()}/getimage?file_id=${encodeURIComponent(src)}`;
}
