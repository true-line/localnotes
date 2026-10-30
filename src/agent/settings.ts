import { getRepository } from '../storage';

const SETTINGS_KEY = 'agent';

export interface AgentSettings {
  providerId: string;
  openai: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  providerId: 'mock',
  openai: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3:30b-a3b',
    apiKey: '',
  },
};

function isAgentSettings(value: unknown): value is AgentSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const openai = v.openai as Record<string, unknown> | undefined;
  return (
    (v.providerId === 'mock' || v.providerId === 'openai') &&
    !!openai &&
    typeof openai.baseUrl === 'string' &&
    typeof openai.model === 'string' &&
    typeof openai.apiKey === 'string'
  );
}

export async function loadAgentSettings(): Promise<AgentSettings> {
  try {
    const stored = await getRepository().then((r) => r.getSetting<unknown>(SETTINGS_KEY));
    if (isAgentSettings(stored)) return stored;
  } catch (error) {
    console.error('localnotes: failed to load agent settings', error);
  }
  return { ...DEFAULT_AGENT_SETTINGS, openai: { ...DEFAULT_AGENT_SETTINGS.openai } };
}

export async function saveAgentSettings(settings: AgentSettings): Promise<void> {
  await getRepository().then((r) => r.putSetting(SETTINGS_KEY, settings));
}
