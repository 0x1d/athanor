import { afterAll, expect, test } from "bun:test";
import { handleAgentsPost } from "@/lib/api/http";
import { parseAgentEvents, type AgentEvent } from "@/lib/agents";

let received: unknown;
const sidecar = Bun.serve({
  port: 0,
  async fetch(req) {
    received = { path: new URL(req.url).pathname, body: await req.json() };
    const events: AgentEvent[] = [
      { type: "session", sessionId: "s1" },
      { type: "text", text: "Writing." },
      { type: "component", path: "components/greeting.nsh.tsx" },
      { type: "done", result: "Done." },
    ];
    return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  },
});
afterAll(() => sidecar.stop(true));

function post(body: unknown) {
  return new Request("http://ide/api/agents", { method: "POST", body: JSON.stringify(body) });
}

test("needs NSHDE_AGENT_URL", async () => {
  delete process.env.NSHDE_AGENT_URL;
  const res = await handleAgentsPost(post({ prompt: "hi" }));
  expect(res.status).toBe(503);
});

test("proxies a turn to the sidecar and streams its events", async () => {
  process.env.NSHDE_AGENT_URL = `${sidecar.url.origin}/`;
  expect((await handleAgentsPost(post({ prompt: " " }))).status).toBe(400);

  const res = await handleAgentsPost(post({ prompt: "Build a greeting", agentId: "reviewer", sessionId: "s0" }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  expect(received).toEqual({
    path: "/sessions",
    body: {
      prompt: "Build a greeting",
      sessionId: "s0",
      agent: { id: "reviewer", name: "Reviewer", role: "Checks types, capabilities, and integration safety" },
    },
  });
  const { events, rest } = parseAgentEvents(await res.text());
  expect(rest).toBe("");
  expect(events.map((e) => e.type)).toEqual(["session", "text", "component", "done"]);
});

test("reports an unreachable sidecar", async () => {
  process.env.NSHDE_AGENT_URL = "http://127.0.0.1:9";
  expect((await handleAgentsPost(post({ prompt: "hi" }))).status).toBe(502);
});

test("parses SSE split across chunks", () => {
  const first = parseAgentEvents('event: text\ndata: {"type":"text","text":"a"}\n\nevent: done\ndata: {"ty');
  expect(first.events).toEqual([{ type: "text", text: "a" }]);
  const second = parseAgentEvents(`${first.rest}pe":"done"}\n\n`);
  expect(second.events).toEqual([{ type: "done" }]);
});
