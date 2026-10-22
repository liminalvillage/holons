// @holons/core/settings — shared holon settings layer.
//
// One place for `loadSettings` / `saveSettings`, the `FlowSettings` class,
// federation link helpers, and (eventually, via core/scoring) equation
// persistence. Web and Telegram UIs both import from here so settings
// changes propagate identically across surfaces.

export {
  AVAILABLE_LENSES,
  FlowSettings,
  getDefaultHolonSettings,
  getLensDescription,
  loadSettings,
  parseHolonSettings,
  saveSettings,
} from './flow-settings.js';

// The safe replacement for the `getAll(holonId, 'settings')[0]` idiom — see the
// doc comment for why position is never a valid way to find the settings doc.
export { readHolonSettings } from './persistence.js';

// The one colour algorithm (hash a seed into a palette, caretaker `color`
// override) that every surface tints a holon with — card glow, board wash,
// dock orb, map hexagon — and that the kiosk colours its post-it cards with.
export {
  COLOR_KEY,
  colorHash,
  holonColor,
  normalizeHolonColor,
  pickColor,
  readHolonColor,
  saveHolonColor,
} from './color.js';

export type {
  FederationPartnerView,
  FlowEdge,
  FlowMetrics,
  FlowNode,
  FlowVisualizationData,
  HolonSettings,
  LensConfig,
  LensType,
} from './flow-settings.js';

// Federation links moved OFF the settings lens: the native federation record
// is the single store — see `@holons/core/federation` (`setFederationPartner`,
// `removeFederationPartner`, `getFederationSnapshot`,
// `migrateLegacyFederationLinks`).

// Re-export the equation barrel so callers can `import { ... } from
// '@holons/core/settings'` once Unit 1 (core/scoring) populates it.
export * from './equation.js';
