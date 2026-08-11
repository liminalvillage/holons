// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  OPENAI_API_BASE,
  VOICE_PROXY_BASE,
  pickVoiceMode,
  pickVoiceTransport,
  type VoiceModeInputs,
} from "./transport";

describe("pickVoiceTransport", () => {
  it("uses a client-held key directly against OpenAI", () => {
    expect(pickVoiceTransport("sk-test", true)).toEqual({
      baseUrl: OPENAI_API_BASE,
      apiKey: "sk-test",
    });
  });

  it("prefers the client key even when the server is also configured", () => {
    expect(pickVoiceTransport("sk-test", true)?.baseUrl).toBe(OPENAI_API_BASE);
  });

  it("falls back to the deploy's relay when only the server holds a key", () => {
    expect(pickVoiceTransport(null, true)).toEqual({
      baseUrl: VOICE_PROXY_BASE,
    });
  });

  it("returns null when no key exists anywhere", () => {
    expect(pickVoiceTransport(null, false)).toBeNull();
  });
});

const base: VoiceModeInputs = {
  modeEnv: undefined,
  deviceKey: false,
  wsUrl: false,
  clientKey: false,
  serverConfigured: false,
};

describe("pickVoiceMode", () => {
  it("honours an explicit VITE_VOICE_MODE over everything", () => {
    expect(
      pickVoiceMode({
        ...base,
        modeEnv: "ws",
        deviceKey: true,
        clientKey: true,
      }),
    ).toBe("ws");
    expect(pickVoiceMode({ ...base, modeEnv: "direct", wsUrl: true })).toBe(
      "direct",
    );
  });

  it("lets a Settings-pasted device key outrank a baked-in WS URL", () => {
    expect(
      pickVoiceMode({ ...base, deviceKey: true, clientKey: true, wsUrl: true }),
    ).toBe("direct");
  });

  it("keeps ws when a WS URL is configured and no device key was pasted", () => {
    expect(
      pickVoiceMode({ ...base, wsUrl: true, serverConfigured: true }),
    ).toBe("ws");
  });

  it("goes direct on a dev env key", () => {
    expect(pickVoiceMode({ ...base, clientKey: true })).toBe("direct");
  });

  it("goes direct when only the deploy's server key is configured", () => {
    expect(pickVoiceMode({ ...base, serverConfigured: true })).toBe("direct");
  });

  it("falls back to the ws localhost probe with nothing configured", () => {
    expect(pickVoiceMode(base)).toBe("ws");
  });
});
