import type { AgentProvider } from './types';
import { createMockProvider } from './providers/mock';
import { createOpenAICompatibleProvider } from './providers/openaiCompatible';
import type { AgentSettings } from './settings';

/** Provider list derived from agent settings; order = selector display order. */
export function buildProviders(settings: AgentSettings): AgentProvider[] {
  return [
    createMockProvider(),
    createOpenAICompatibleProvider(() => settings.openai),
  ];
}
