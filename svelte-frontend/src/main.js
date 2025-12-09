import App from './App.svelte';
import { parseRoute } from './stores/app.js';

// Parse initial route
parseRoute();

// Create the Svelte app
const app = new App({
  target: document.getElementById('app')
});

export default app;
