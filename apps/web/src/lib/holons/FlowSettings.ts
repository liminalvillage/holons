// Thin re-export. The implementation now lives in `@holons/core/settings`
// so the Telegram bot and Harvest web app share a single settings layer.
// Existing imports from `./FlowSettings` keep working unchanged.

export {
  AVAILABLE_LENSES,
  FlowSettings,
  addFederationLink,
  getDefaultHolonSettings,
  getLensDescription,
  loadSettings,
  parseHolonSettings,
  removeFederationLink,
  saveSettings,
} from "@holons/core/settings";

export type {
  FederationLink,
  FlowEdge,
  FlowMetrics,
  FlowNode,
  FlowVisualizationData,
  HolonSettings,
  LensConfig,
  LensType,
} from "@holons/core/settings";
