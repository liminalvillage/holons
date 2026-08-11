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
