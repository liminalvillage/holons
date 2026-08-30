// Thin re-export. The implementation now lives in `@holons/core/settings`
// so the Telegram bot and Holons web app share a single settings layer.
// Existing imports from `./FlowSettings` keep working unchanged.
//
// NOTE: federation link helpers are gone from the settings layer — the native
// federation record is the single store; use `@holons/core/federation`
// (`setFederationPartner` / `removeFederationPartner` / `getFederationSnapshot`).

export {
  AVAILABLE_LENSES,
  FlowSettings,
  getDefaultHolonSettings,
  getLensDescription,
  loadSettings,
  parseHolonSettings,
  saveSettings,
} from "@holons/core/settings";

export type {
  FederationPartnerView,
  FlowEdge,
  FlowMetrics,
  FlowNode,
  FlowVisualizationData,
  HolonSettings,
  LensConfig,
  LensType,
} from "@holons/core/settings";
