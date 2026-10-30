import { getRepository } from '../storage';
import type { AgentAuditEntry } from './types';

export { AGENT_AUDIT_CAP } from '../storage';

/**
 * Thin facade over the audit store so UI and session code never touch
 * IndexedDB directly. Recording never throws into a running turn: callers
 * fire-and-forget with the returned promise caught.
 */
export async function recordAgentAudit(entry: AgentAuditEntry): Promise<void> {
  const repo = await getRepository();
  await repo.appendAgentAudit(entry);
}

/** Newest-first, at most `limit` entries. */
export async function listAgentAudit(limit = 50): Promise<AgentAuditEntry[]> {
  const repo = await getRepository();
  return repo.listAgentAudit(limit);
}

export async function clearAgentAudit(): Promise<void> {
  const repo = await getRepository();
  await repo.clearAgentAudit();
}
