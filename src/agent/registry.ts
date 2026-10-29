import type { AgentProvider } from './types';
import { createMockProvider } from './providers/mock';

const providers: AgentProvider[] = [createMockProvider()];

/** Registered providers, in selector display order. */
export function getProviders(): AgentProvider[] {
  return [...providers];
}

export function getProvider(id: string): AgentProvider | undefined {
  return providers.find((provider) => provider.id === id);
}
