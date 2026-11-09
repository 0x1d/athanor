import { AGENTS, type AgentId } from "./index";

/**
 * The agent is the alchemist Claude host, a separate Node process
 * (`hosts/nshde/sidecar.ts` in alchemist). `NSHDE_AGENT_URL` is its base URL.
 */
export function agentSidecarUrl(env: Record<string, string | undefined> = process.env): string | null {
  const url = env.NSHDE_AGENT_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

export interface AgentTurn {
  prompt: string;
  agentId?: AgentId;
  sessionId?: string;
}

/** Opens one sidecar session turn and returns its SSE response. */
export async function openSidecarStream(base: string, turn: AgentTurn, signal?: AbortSignal): Promise<Response> {
  const agent = AGENTS.find((item) => item.id === turn.agentId) ?? AGENTS.find((item) => item.id === "implementer");
  return fetch(`${base}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      prompt: turn.prompt,
      ...(turn.sessionId ? { sessionId: turn.sessionId } : {}),
      ...(agent ? { agent: { id: agent.id, name: agent.name, role: agent.role } } : {}),
    }),
    signal,
  });
}
