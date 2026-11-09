export type AgentId = "architect" | "implementer" | "reviewer";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  role: string;
  accent: string;
}

export const AGENTS: AgentDefinition[] = [
  {
    id: "architect",
    name: "Architect",
    role: "Plans module structure and NSH component boundaries",
    accent: "text-violet-400",
  },
  {
    id: "implementer",
    name: "Implementer",
    role: "Writes TSX shell components and wires runtime hooks",
    accent: "text-emerald-400",
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Checks types, capabilities, and integration safety",
    accent: "text-amber-400",
  },
];

export interface AgentMessage {
  id: string;
  agentId: AgentId;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

/**
 * Events streamed from the agent sidecar (alchemist `hosts/nshde/sidecar.ts`)
 * through `POST /api/agents`, one per SSE message.
 */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; ok: boolean; error?: string }
  | { type: "component"; path: string }
  | { type: "done"; result?: string; costUsd?: number }
  | { type: "error"; message: string };

/** Parses complete SSE messages from `buffer` and returns the unparsed rest. */
export function parseAgentEvents(buffer: string): { events: AgentEvent[]; rest: string } {
  const events: AgentEvent[] = [];
  const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as AgentEvent);
    } catch {
      /* skip a malformed message */
    }
  }
  return { events, rest };
}
