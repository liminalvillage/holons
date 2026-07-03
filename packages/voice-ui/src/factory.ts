// Provider selection: map the per-leg config (api|local) to concrete providers.
// API is the default leg; local swaps in OpenAI-compatible LLM + whisper.cpp + kokoro.

import {
  AnthropicProvider,
  OpenAICompatProvider,
  type LLMProvider,
} from '@holons/ai-ui';
import type { VoiceConfig } from './config.js';
import type { STTProvider } from './providers/stt/types.js';
import type { TTSProvider } from './providers/tts/types.js';
import { OpenAISTTProvider } from './providers/stt/openai.js';
import { WhisperCppSTTProvider } from './providers/stt/whispercpp.js';
import { OpenAITTSProvider } from './providers/tts/openai.js';
import { KokoroTTSProvider } from './providers/tts/kokoro.js';

export function makeLLM(config: VoiceConfig): LLMProvider {
  if (config.llm === 'local') {
    return new OpenAICompatProvider({
      baseUrl: config.llmBaseUrl,
      apiKey: config.llmApiKey,
      model: config.llmModel,
    });
  }
  return new AnthropicProvider({ model: config.anthropicModel });
}

export function makeSTT(config: VoiceConfig): STTProvider {
  if (config.stt === 'local') {
    return new WhisperCppSTTProvider({ model: config.sttModel });
  }
  return new OpenAISTTProvider({
    apiKey: config.openaiApiKey,
    model: config.sttModel,
  });
}

export function makeTTS(config: VoiceConfig): TTSProvider {
  if (config.tts === 'local') {
    return new KokoroTTSProvider({ model: config.ttsModel, voice: config.ttsVoice });
  }
  return new OpenAITTSProvider({
    apiKey: config.openaiApiKey,
    model: config.ttsModel,
    voice: config.ttsVoice,
  });
}
