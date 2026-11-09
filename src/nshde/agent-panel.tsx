import { batch, effect, platform, Scroll, signal, Text, token, View } from "nsh";
import { Button, Input, Menu, MenuItem, TextView } from "nsh/base";
import { AGENTS, type AgentDefinition, type AgentEvent, type AgentId, type AgentMessage } from "../lib/agents";
import { listAgents, streamAgent } from "./api";
import { isPhoneWidth } from "./phone";
import { handleComponentWritten, patchSession, refreshServices, refreshTree, sessions } from "./store";

const PROMPTS = [
  { label: "Todo list", text: "Build a todo list module" },
  { label: "Metrics chart", text: "Create a metrics chart" },
  { label: "Status card", text: "Create a status card with a title and a metric" },
] as const;

const catalog = signal<AgentDefinition[]>([]);
let catalogStarted = false;

function readInput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "value" in value) {
    const next = (value as { value?: unknown }).value;
    return typeof next === "string" ? next : "";
  }
  return "";
}

/** One line for a codex tool call, such as `call_function nshde.component.write`. */
function toolLine(name: string, input: unknown): string {
  const detail =
    input && typeof input === "object"
      ? ((input as { name?: unknown; query?: unknown }).name ?? (input as { query?: unknown }).query)
      : undefined;
  return typeof detail === "string" ? `\`${name}\` ${detail}` : `\`${name}\``;
}

function clipTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function Spinner() {
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: token("border"),
        borderTopColor: token("brand"),
        animationName: "spin",
        animationDuration: 800,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
      }}
    />
  );
}

function Avatar() {
  return (
    <View class="size-[26px] items-center justify-center rounded-lg border border-border bg-raised">
      <Text class="text-[13px] text-brand">✦</Text>
    </View>
  );
}

export function AgentPanelView(props: { sessionId: string }) {
  const session = () => sessions().find((item) => item.id === props.sessionId);
  return (
    <If when={session()} else={<View class="flex-1 bg-background" />}>
      {() => <Conversation sessionId={props.sessionId} />}
    </If>
  );
}

function Conversation(props: { sessionId: string }) {
  const current = () => sessions().find((item) => item.id === props.sessionId)!;
  const activeAgent = signal<AgentId>("implementer");
  const prompt = signal("");
  const inputHeight = signal(20);

  effect(() => {
    if (catalogStarted) return;
    catalogStarted = true;
    void listAgents()
      .then((list) => catalog.set(list))
      .catch(() => catalog.set([]));
  });

  const roles = () => (catalog().length > 0 ? catalog() : AGENTS);
  const activeMeta = () => roles().find((agent) => agent.id === activeAgent());
  const canSend = () => !!(prompt() ?? "").trim() && !current().loading;

  async function submit(raw?: string) {
    const session = current();
    const text = (raw ?? prompt() ?? "").trim();
    if (!text || session.loading) return;
    const userMsg: AgentMessage = {
      id: crypto.randomUUID(),
      agentId: activeAgent(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    batch(() => {
      patchSession(props.sessionId, {
        messages: [...session.messages, userMsg],
        title: session.messages.length === 0 ? clipTitle(text) : session.title,
        loading: true,
      });
      prompt.set("");
      inputHeight.set(20);
    });

    const agentId = activeAgent();
    const latest = () => sessions().find((item) => item.id === props.sessionId);
    const append = (message: AgentMessage) =>
      patchSession(props.sessionId, { messages: [...(latest()?.messages ?? []), message] });
    const say = (role: AgentMessage["role"], content: string, id: string = crypto.randomUUID()) =>
      append({ id, agentId, role, content, timestamp: new Date().toISOString() });

    const onEvent = (event: AgentEvent) => {
      switch (event.type) {
        case "session":
          patchSession(props.sessionId, { agentSessionId: event.sessionId });
          break;
        case "text":
          say("assistant", event.text);
          break;
        case "tool":
          say("system", toolLine(event.name, event.input), `tool:${event.id}`);
          break;
        case "tool_result": {
          const id = `tool:${event.id}`;
          patchSession(props.sessionId, {
            messages: (latest()?.messages ?? []).map((msg) =>
              msg.id === id ? { ...msg, content: `${msg.content} ${event.ok ? "✓" : `✕ ${(event.error ?? "").slice(0, 160)}`}`.trim() } : msg,
            ),
          });
          break;
        }
        case "component":
          void handleComponentWritten(event.path);
          break;
        case "error":
          say("assistant", `**Error:** ${event.message}`);
          break;
        case "done":
          break;
      }
    };

    try {
      await streamAgent({ prompt: text, agentId, sessionId: session.agentSessionId }, onEvent);
    } catch (error) {
      say("assistant", error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      patchSession(props.sessionId, { loading: false });
      // The agent may have defined services or written files outside a component event.
      void refreshServices();
      void refreshTree();
    }
  }

  const messages = () => current().messages;
  const loading = () => current().loading;

  return (
    <View class="flex-1 bg-background">
      <View class="min-h-0 flex-1">
        <If
          when={messages().length === 0}
          else={
            <Scroll class="flex-1" contentClass="pb-2">
              <Each of={messages()}>
                {(msg) => (
                  <MessageRow
                    msg={msg()}
                    agentName={catalog().find((agent) => agent.id === msg().agentId)?.name ?? msg().agentId}
                  />
                )}
              </Each>
              <If when={loading()}>
                <View class="gap-3 px-4 pb-1 pt-2">
                  <View class="h-[26px] flex-row items-center gap-2">
                    <Avatar />
                    <Text class="flex-1 text-[13px] font-semibold text-muted-foreground">
                      {activeMeta()?.name ?? "Agent"}
                    </Text>
                  </View>
                  <View class="h-[22px] flex-row items-center gap-2">
                    <Spinner />
                    <Text class="text-[13px] text-muted-foreground">Working…</Text>
                  </View>
                </View>
              </If>
            </Scroll>
          }
        >
          <View class="flex-1 items-center justify-center gap-2 px-4 py-6">
            <View class="size-10 items-center justify-center rounded-xl border border-border bg-raised">
              <Text class="text-lg text-brand">✦</Text>
            </View>
            <Text class="text-lg font-semibold text-foreground">How can I help?</Text>
            <Text class="text-center text-[13px] leading-5 text-muted-foreground">
              Describe a component and the service behind it. The agent writes both and mounts the component.
            </Text>
          </View>
        </If>
      </View>

      <If when={messages().length === 0}>
        <View class="flex-row flex-wrap gap-2 px-3 py-2">
          <Each of={PROMPTS}>
            {(chip) => (
              <Button
                onPress={() => void submit(chip().text)}
                disabled={loading()}
                accessibilityLabel={chip().label}
                class={`${isPhoneWidth() ? "h-11" : "h-8"} justify-center rounded-full border border-border bg-card px-3 active:opacity-80 disabled:opacity-40`}
              >
                <Text class="text-[13px] font-medium text-foreground">{chip().label}</Text>
              </Button>
            )}
          </Each>
        </View>
      </If>

      <View class="gap-2 px-3 pb-3 pt-1">
        <View class="gap-1.5 rounded-2xl border border-border bg-card p-1.5">
          <Input
            value={prompt()}
            onChange={(value) => prompt.set(readInput(value))}
            multiline
            submitBehavior={platform.desktop ? "submit" : "newline"}
            onSubmit={() => {
              if (!loading()) void submit();
            }}
            placeholder={`Message ${activeMeta()?.name ?? "the agent"}`}
            accessibilityLabel="Agent prompt"
            onContentSizeChange={(size) => {
              const height = size && typeof size === "object" && "height" in size ? size.height : 20;
              inputHeight.set(Math.min(100, Math.max(20, height)));
            }}
            class="px-2.5 py-2 text-[13px] leading-5 text-foreground placeholder:text-muted-foreground"
            style={{ height: inputHeight() + 16 }}
          />
          <View class="flex-row items-center gap-1 px-0.5">
            <Menu
              placement="top"
              align="start"
              offset={6}
              popupClass="min-w-[180px] rounded-lg border border-border bg-popover p-1 shadow-md"
              trigger={
                <View
                  accessibilityLabel="Agent role"
                  class={`${isPhoneWidth() ? "h-11" : "h-7"} flex-row items-center gap-1 rounded-md px-2 hover:bg-hover active:opacity-80`}
                >
                  <Text class="text-[12px] font-medium text-foreground">{activeMeta()?.name ?? "Implementer"}</Text>
                  <Text class="text-[10px] text-muted-foreground">▾</Text>
                </View>
              }
            >
              <Each of={roles()}>
                {(agent) => (
                  <MenuItem
                    onSelect={() => activeAgent.set(agent().id)}
                    accessibilityLabel={agent().name}
                    class="h-8 flex-row items-center rounded-md px-2 hover:bg-hover"
                  >
                    <Text class="text-[13px] text-foreground">{agent().name}</Text>
                  </MenuItem>
                )}
              </Each>
            </Menu>
            <View class="flex-1" />
            <Button
              onPress={() => void submit()}
              disabled={!canSend()}
              accessibilityLabel="Send"
              class={`${isPhoneWidth() ? "size-11 shrink-0" : "size-8"} items-center justify-center rounded-full bg-brand disabled:opacity-35 active:opacity-90`}
            >
              <Text class="text-sm font-semibold text-background">↑</Text>
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
}

function MessageRow(props: { msg: AgentMessage; agentName?: string }) {
  if (props.msg.role === "system") {
    return (
      <View class="px-4 py-0.5 pl-[50px]">
        <TextView
          markdown={props.msg.content}
          selectable
          styles={{
            root: { fontSize: 12, lineHeight: 18, color: token("muted-foreground") },
            code: { color: token("code") },
          }}
        />
      </View>
    );
  }

  if (props.msg.role === "user") {
    return (
      <View class="items-end px-4 py-2">
        <View class="max-w-[82%] rounded-[18px] rounded-br-md border border-border bg-raised px-3 py-2">
          <Text class="text-[13px] leading-5 text-foreground">{props.msg.content}</Text>
        </View>
      </View>
    );
  }

  const name = props.agentName ?? props.msg.agentId;
  return (
    <View class="gap-2 px-4 pb-1 pt-2">
      <View class="h-[26px] flex-row items-center gap-2">
        <Avatar />
        <Text class="flex-1 text-[13px] font-semibold text-muted-foreground">{name}</Text>
      </View>
      <TextView
        markdown={props.msg.content}
        selectable
        styles={{
          root: { gap: 12, fontSize: 13, lineHeight: 20, color: token("foreground") },
          heading1: { fontSize: 18, lineHeight: 24 },
          heading2: { fontSize: 16, lineHeight: 22 },
          heading3: { fontSize: 14, lineHeight: 20 },
          code: { color: token("code") },
          codeBlockCode: { color: token("code") },
          link: { color: token("brand") },
        }}
      />
    </View>
  );
}
