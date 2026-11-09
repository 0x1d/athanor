import { batch, effect, signal } from "nsh";
import type { DockAreaLayout, DockAreaRef } from "nsh/base";
import type { AgentMessage } from "../lib/agents";
import type { ServiceInfo } from "../lib/services/registry";
import type { StorageBackend } from "../lib/storage/types";
import {
  listServices,
  loadConfig,
  loadTree,
  previewUrl,
  publishService,
  readFile,
  setBackend,
  writeFile,
  type TreeNode,
} from "./api";
import {
  activatePanel,
  activeFilePath,
  addFileTab,
  agentPanelId,
  defaultDockPanels,
  DEFAULT_SESSION_ID,
  filePanelId,
  initialIdeLayout,
  openAgentTab,
  openSettingsTab,
  panelClosable,
  pathFromFilePanel,
  removePanelFromLayout,
  SETTINGS_PANEL,
} from "./dock-layout";
import { isPhoneWidth } from "./phone";

const WELCOME = "components/welcome.nsh.tsx";

export interface AgentSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  loading: boolean;
  /** Sidecar session to resume on the next turn. */
  agentSessionId?: string;
}

function blankSession(id: string, title = "New agent"): AgentSession {
  return { id, title, messages: [], loading: false };
}

export const sessions = signal<AgentSession[]>([blankSession(DEFAULT_SESSION_ID)]);
export const tree = signal<TreeNode[]>([]);
export const dockLayout = signal<DockAreaLayout>(initialIdeLayout(WELCOME));
export const dockPanels = signal(defaultDockPanels(WELCOME));
export const selectedPath = signal<string | null>(WELCOME);
export const editorValue = signal("");
export const dirty = signal(false);
export const loadingFile = signal(false);
export const runtimePath = signal<string | null>(WELCOME);
export const runtimeRevision = signal(0);
export const backend = signal<StorageBackend>("fs");
export const previewSrc = signal("http://127.0.0.1:43123/preview/blank");
export const bootError = signal<string | null>(null);
/** Alchemist services (read-only), or null when nshde has no alchemist checkout configured. */
export const services = signal<ServiceInfo[] | null>(null);
export const servicesBusy = signal<string | null>(null);

export type PhonePane = "editor" | "agents" | "explorer" | "runtime";
/** Which full-screen section the phone shell shows. The wide layout ignores it. */
export const phonePane = signal<PhonePane>("editor");
/** Agents on a phone: the session list, or the open conversation. */
export const phoneAgentsPage = signal<"list" | "chat">("list");

const editorCache = signal<Record<string, { value: string; dirty: boolean; mountKey: number }>>({});
/** Bumps when a file is loaded from outside the editor. Typing does not touch it, so the editor is not rebuilt on each key. */
export const editorEpoch = signal<Record<string, number>>({});
export { editorCache };

let dockArea: DockAreaRef | undefined;

export function bindDockArea(area: DockAreaRef) {
  dockArea = area;
}

function ensureDockPanel(id: string) {
  const list = dockPanels();
  if (list.some((p) => p.id === id)) return;
  dockPanels.set([...list, { id, closable: panelClosable(id) }]);
}

export function patchSession(id: string, patch: Partial<AgentSession>) {
  sessions.set(sessions().map((session) => (session.id === id ? { ...session, ...patch } : session)));
}

export function createAgentSession() {
  const id = crypto.randomUUID();
  const panelId = agentPanelId(id);
  batch(() => {
    sessions.set([blankSession(id), ...sessions()]);
    ensureDockPanel(panelId);
    dockLayout.set(openAgentTab(dockLayout(), panelId));
    if (isPhoneWidth()) {
      phonePane.set("agents");
      phoneAgentsPage.set("chat");
    }
  });
}

export function focusAgentSession(id: string) {
  ensureDockPanel(agentPanelId(id));
  dockLayout.set(openAgentTab(dockLayout(), agentPanelId(id)));
  if (isPhoneWidth()) {
    phonePane.set("agents");
    phoneAgentsPage.set("chat");
  }
}

function stashCurrentEditor() {
  const path = selectedPath();
  if (!path) return;
  const prev = editorCache()[path];
  editorCache.set({
    ...editorCache(),
    [path]: { value: editorValue(), dirty: dirty(), mountKey: prev?.mountKey ?? 0 },
  });
}

export async function refreshTree() {
  try {
    bootError.set(null);
    const data = await loadTree();
    tree.set(data.tree ?? []);
    backend.set(data.backend);
  } catch (e) {
    bootError.set(e instanceof Error ? e.message : "Failed to load object tree");
  }
}

export async function refreshServices() {
  try {
    const data = await listServices();
    services.set(data.configured ? data.services : null);
  } catch {
    services.set(null);
  }
}

export async function setServicePublished(slug: string, published: boolean) {
  servicesBusy.set(slug);
  try {
    bootError.set(null);
    await publishService(slug, published);
    await refreshServices();
    await refreshTree();
    // A mounted component may call this service; give it a fresh token.
    if (runtimePath()) runtimeRevision.update((r) => r + 1);
  } catch (e) {
    bootError.set(e instanceof Error ? e.message : `Failed to publish ${slug}`);
  } finally {
    servicesBusy.set(null);
  }
}

/** The agent wrote a component: load it, open it, and hot-mount it in the preview. */
export async function handleComponentWritten(path: string) {
  try {
    const source = await readFile(path);
    handleModuleGenerated(path, source);
  } catch (e) {
    bootError.set(e instanceof Error ? e.message : `Failed to open ${path}`);
  }
}

export async function loadFile(path: string) {
  const cached = editorCache()[path];
  if (cached && !cached.dirty) {
    batch(() => {
      selectedPath.set(path);
      editorValue.set(cached.value);
      dirty.set(false);
      loadingFile.set(false);
      if ((editorEpoch()[path] ?? 0) === 0) editorEpoch.set({ ...editorEpoch(), [path]: 1 });
    });
    return;
  }
  try {
    bootError.set(null);
    const content = cached?.value ?? (await readFile(path));
    const mountKey = (editorEpoch()[path] ?? 0) + 1;
    batch(() => {
      editorValue.set(content);
      selectedPath.set(path);
      dirty.set(cached?.dirty ?? false);
      editorEpoch.set({ ...editorEpoch(), [path]: mountKey });
      editorCache.set({
        ...editorCache(),
        [path]: { value: content, dirty: cached?.dirty ?? false, mountKey },
      });
    });
  } catch (e) {
    bootError.set(e instanceof Error ? e.message : `Failed to open ${path}`);
  } finally {
    loadingFile.set(false);
  }
}

export function openFileInEditor(path: string) {
  const id = filePanelId(path);
  stashCurrentEditor();
  ensureDockPanel(id);
  if (dockArea && !isPhoneWidth()) dockArea.addPanel(id, "center");
  else dockLayout.set(addFileTab(dockLayout(), path));
  if (isPhoneWidth()) phonePane.set("editor");
  void loadFile(path);
}

export function openSettingsInEditor() {
  ensureDockPanel(SETTINGS_PANEL);
  dockLayout.set(openSettingsTab(dockLayout()));
  if (isPhoneWidth()) phonePane.set("editor");
}

export function selectEditorTab(id: string) {
  const next = activatePanel(dockLayout(), id);
  dockLayout.set(next);
  syncActiveEditorFromLayout(next);
}

/** Removes a panel from the layout the phone shell owns. The wide dock closes through its ref. */
export function dismissPanel(id: string) {
  const next = removePanelFromLayout(dockLayout(), id);
  dockLayout.set(next);
  const path = activeFilePath(next);
  if (!path) {
    selectedPath.set(null);
    return;
  }
  syncActiveEditorFromLayout(next);
}

export function isPathDirty(path: string): boolean {
  if (selectedPath() === path) return dirty();
  return editorCache()[path]?.dirty ?? false;
}

export function syncActiveEditorFromLayout(layout: DockAreaLayout | undefined) {
  if (!layout?.center) return;
  const path = activeFilePath(layout);
  if (!path || path === selectedPath()) return;
  stashCurrentEditor();
  void loadFile(path);
}

export async function saveFile(path?: string) {
  const target = path ?? selectedPath();
  if (!target || target.endsWith(".wasm")) return;
  const content = editorCache()[target]?.value ?? (target === selectedPath() ? editorValue() : null);
  if (content == null) return;
  await writeFile(target, content);
  batch(() => {
    if (target === selectedPath()) dirty.set(false);
    const prev = editorCache()[target];
    editorCache.set({
      ...editorCache(),
      [target]: { value: content, dirty: false, mountKey: prev?.mountKey ?? editorEpoch()[target] ?? 0 },
    });
  });
  if (runtimePath() === target) {
    runtimeRevision.update((r) => r + 1);
  }
  await refreshTree();
}

export function handleModuleGenerated(path: string, source: string) {
  void refreshTree();
  const id = filePanelId(path);
  batch(() => {
    ensureDockPanel(id);
    selectedPath.set(path);
    editorValue.set(source);
    dirty.set(false);
    runtimePath.set(path);
    runtimeRevision.update((r) => r + 1);
    const mountKey = (editorEpoch()[path] ?? 0) + 1;
    editorEpoch.set({ ...editorEpoch(), [path]: mountKey });
    editorCache.set({
      ...editorCache(),
      [path]: { value: source, dirty: false, mountKey },
    });
    if (!dockArea || isPhoneWidth()) dockLayout.set(addFileTab(dockLayout(), path));
    if (isPhoneWidth()) phonePane.set("editor");
  });
  if (dockArea && !isPhoneWidth()) dockArea.addPanel(id, "center");
}

export async function changeBackend(next: StorageBackend) {
  await setBackend(next);
  backend.set(next);
  await refreshTree();
  const path = selectedPath();
  if (path) await loadFile(path);
}

export function mountRuntime(path: string) {
  runtimePath.set(path);
  runtimeRevision.update((r) => r + 1);
  if (isPhoneWidth()) phonePane.set("runtime");
}

export function onEditorValueChange(path: string, value: string) {
  const prev = editorCache()[path];
  if (prev?.value === value) return;
  batch(() => {
    selectedPath.set(path);
    editorValue.set(value);
    dirty.set(true);
    editorCache.set({
      ...editorCache(),
      [path]: { value, dirty: true, mountKey: prev?.mountKey ?? editorEpoch()[path] ?? 0 },
    });
  });
}

let booted = false;
export function bootIdeData() {
  if (booted) return;
  booted = true;
  effect(() => {
    void loadConfig().then((c) => backend.set(c.backend));
    void refreshTree().then(() => void loadFile(WELCOME));
    void refreshServices();
  });
  effect(() => {
    const path = runtimePath();
    const rev = runtimeRevision();
    void previewUrl(path, rev).then((url) => previewSrc.set(url));
  });
}

export function languageForPath(path: string | null): "typescript" | "json" | "plaintext" {
  if (!path) return "typescript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".wasm")) return "plaintext";
  return "typescript";
}

export function isFilePanel(id: string): boolean {
  return pathFromFilePanel(id) !== null;
}

export { filePanelId, pathFromFilePanel };
