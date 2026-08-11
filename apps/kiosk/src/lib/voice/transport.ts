// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure resolution of where the kiosk's voice pipeline runs and how its OpenAI
// calls are authenticated — kept free of stores/DOM so the priority matrix is
// testable. Two decisions:
//
//   pickVoiceMode      ws (a @holons/voice-ui server) vs direct (browser-run
//                      pipeline) — the controller's backend choice
//   pickVoiceTransport for the direct pipeline, whether calls go straight to
//                      OpenAI with a client-held key or through this deploy's
//                      /api/ai/voice relay, which holds the same server-side
//                      key the AI-breakdown route uses

/** Where direct-mode OpenAI calls go and (for the direct case) the key. */
export interface VoiceTransport {
  /** Base URL incl. version segment, joined as `${baseUrl}/<endpoint>`. */
  baseUrl: string;
  /** Bearer key; absent when the server relay injects its own. */
  apiKey?: string;
}

/** OpenAI's CORS-enabled API host, used when a key lives on this device. */
export const OPENAI_API_BASE = "https://api.openai.com/v1";

/** This deploy's session-gated relay (routes/api/ai/voice). */
export const VOICE_PROXY_BASE = "/api/ai/voice";

/**
 * Resolve the direct pipeline's transport. A client-held key (pasted in
 * Settings or a dev VITE_OPENAI_API_KEY) is an explicit choice and wins;
 * otherwise a deploy whose serverless env holds the key — the same
 * OPENAI_API_KEY the breakdown feature uses — speaks through the relay.
 * Null: the direct mode cannot run.
 */
export function pickVoiceTransport(
  clientKey: string | null,
  serverConfigured: boolean,
): VoiceTransport | null {
  if (clientKey) return { baseUrl: OPENAI_API_BASE, apiKey: clientKey };
  if (serverConfigured) return { baseUrl: VOICE_PROXY_BASE };
  return null;
}

export interface VoiceModeInputs {
  /** VITE_VOICE_MODE, already trimmed/lowercased (undefined when unset). */
  modeEnv?: string;
  /** A caretaker pasted a key in Settings on THIS device. */
  deviceKey: boolean;
  /** VITE_VOICE_WS_URL is baked into the build. */
  wsUrl: boolean;
  /** Any client-held key (device key OR dev VITE_OPENAI_API_KEY). */
  clientKey: boolean;
  /** The deploy's /api/ai/voice relay probed as configured. */
  serverConfigured: boolean;
}

/**
 * Which pipeline the controller should run. Priority: an explicit
 * VITE_VOICE_MODE wins; a Settings-pasted key outranks a baked-in WS URL (a
 * dev machine's localhost URL means nothing on a kiosk device); then an
 * explicit WS URL; then any client key; then the server relay. The final ws
 * fallback probes localhost — the original dev default.
 */
export function pickVoiceMode(i: VoiceModeInputs): "ws" | "direct" {
  if (i.modeEnv === "ws" || i.modeEnv === "direct") return i.modeEnv;
  if (i.deviceKey) return "direct";
  if (i.wsUrl) return "ws";
  if (i.clientKey) return "direct";
  return i.serverConfigured ? "direct" : "ws";
}
