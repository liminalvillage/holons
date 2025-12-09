import { writable } from 'svelte/store';

// Language store
export const language = writable('en');

// Router state (simplified)
export const route = writable({
  path: '/',
  params: {},
  query: {}
});

// Parse URL and update route
export function parseRoute() {
  const path = window.location.pathname;
  const searchParams = new URLSearchParams(window.location.search);
  const query = Object.fromEntries(searchParams.entries());

  // Parse path patterns: /:org/:repo, /:org/:repo/:file*, /:address
  const parts = path.split('/').filter(Boolean);
  let params = {};

  if (parts.length >= 2) {
    params.org = parts[0];
    params.repo = parts[1];
    if (parts.length > 2) {
      params.file = parts.slice(2).join('/');
    }
  } else if (parts.length === 1) {
    params.address = parts[0];
  }

  route.set({ path, params, query });
}

// Navigate to a new path
export function navigate(newPath) {
  window.history.pushState({}, '', newPath);
  parseRoute();
}

// Initialize router
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', parseRoute);
  parseRoute();
}
