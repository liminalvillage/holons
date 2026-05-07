// @holons/core/calendar — calendar / RSVP / iCal layer.
// Subpath import: `import { generateICalFeed, toggleRSVP } from '@holons/core/calendar'`.
// `.js` extensions match TS ESM emit output; the package `exports` map points
// at compiled `dist/` for runtime consumers and at `src/` for typecheck.

export * from './ical.js';
export * from './rsvp.js';
