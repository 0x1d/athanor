import type { JSX } from "nsh";
import { Scroll, signal, Text, token, View } from "nsh";
import { Button, Collapsible } from "nsh/base";
import type { ServiceInfo } from "../lib/services/registry";
import type { TreeNode } from "./api";
import { IconButton, IconChevron, IconLive, IconPlay } from "./icons";
import { isPhoneWidth } from "./phone";
import {
  isPathDirty,
  mountRuntime,
  openFileInEditor,
  runtimePath,
  selectedPath,
  services,
  servicesBusy,
  setServicePublished,
  tree,
} from "./store";

function TreeRow(props: {
  node: TreeNode;
  depth: number;
  open?: boolean;
  onPress: () => void;
  trailing?: JSX.Element;
}) {
  const isDir = props.node.kind === "directory";
  const isSelected = () => !isDir && selectedPath() === props.node.path;
  const dirty = () => !isDir && isPathDirty(props.node.path);
  return (
    <View
      class={`${isPhoneWidth() ? "min-h-11 active:opacity-80" : "h-6"} flex-row items-center gap-1 rounded-sm pr-1 ${isSelected() ? "bg-accent" : "hover:bg-hover"}`}
      style={{ paddingLeft: 4 + props.depth * 12 }}
    >
      <Button
        onPress={props.onPress}
        accessibilityLabel={props.node.name}
        accessibilityState={isDir ? { expanded: !!props.open } : undefined}
        class={
          isPhoneWidth()
            ? "min-w-0 flex-1 flex-row items-center gap-1.5 self-stretch px-0 hover:bg-transparent"
            : "min-w-0 flex-1 flex-row items-center gap-1.5 px-0 hover:bg-transparent"
        }
      >
        <If when={isDir} else={<View class="w-3.5" />}>
          <IconChevron open={props.open} />
        </If>
        <Text numberOfLines={1} class="flex-1 font-mono text-[13px] text-foreground">
          {props.node.name}
        </Text>
        <If when={dirty()}>
          <View class="size-1.5 rounded-full" style={{ backgroundColor: token("warn") }} />
        </If>
      </Button>
      {props.trailing}
    </View>
  );
}

function TreeItem(props: { node: TreeNode; depth: number }) {
  const open = signal(props.node.kind === "directory" && props.depth < 1);
  const isDir = props.node.kind === "directory";
  const runnable =
    !isDir && (props.node.path.endsWith(".nsh.tsx") || props.node.path.endsWith(".wasm"));
  const isLive = () => runtimePath() === props.node.path;

  const trailing = runnable ? (
    <IconButton
      label={isLive() ? "Module is live" : "Mount at runtime"}
      selected={isLive()}
      onPress={() => mountRuntime(props.node.path)}
    >
      <If when={isLive()} else={<IconPlay />}>
        <IconLive active />
      </If>
    </IconButton>
  ) : undefined;

  if (!isDir) {
    return (
      <TreeRow
        node={props.node}
        depth={props.depth}
        onPress={() => openFileInEditor(props.node.path)}
        trailing={trailing}
      />
    );
  }

  return (
    <Collapsible
      open={open()}
      content={
        <View>
          <Each of={props.node.children ?? []}>
            {(child) => <TreeItem node={child()} depth={props.depth + 1} />}
          </Each>
        </View>
      }
    >
      <TreeRow node={props.node} depth={props.depth} open={open()} onPress={() => open.set(!open())} />
    </Collapsible>
  );
}

function serviceState(service: ServiceInfo): { label: string; color: "muted-foreground" | "warn" | "brand" } {
  if (!service.valid) return { label: "no schema", color: "muted-foreground" };
  if (service.stale) return { label: "changed", color: "warn" };
  if (service.published) return { label: "published", color: "brand" };
  return { label: "draft", color: "muted-foreground" };
}

/** A service from the alchemist tree. Its source is not editable here; Publish is the one action. */
function ServiceRow(props: { service: ServiceInfo }) {
  const state = () => serviceState(props.service);
  const busy = () => servicesBusy() === props.service.slug;
  const action = () => (props.service.published && !props.service.stale ? "Unpublish" : "Publish");
  return (
    <View
      class={`${isPhoneWidth() ? "min-h-11" : "min-h-6"} flex-row items-center gap-2 rounded-sm px-1 hover:bg-hover`}
      style={{ paddingLeft: 16 }}
    >
      <View class="min-w-0 flex-1">
        <Text numberOfLines={1} class="font-mono text-[13px] text-foreground">
          {props.service.slug}
        </Text>
      </View>
      <Text class="text-[11px]" style={{ color: token(state().color) }}>
        {state().label}
      </Text>
      <Button
        onPress={() => void setServicePublished(props.service.slug, action() === "Publish")}
        disabled={busy() || !props.service.valid}
        accessibilityLabel={`${action()} ${props.service.slug}`}
        class={`${isPhoneWidth() ? "h-11" : "h-5"} justify-center rounded-md border border-border px-2 hover:bg-foreground/10 disabled:opacity-40`}
      >
        <Text class="text-[11px] text-foreground">{action()}</Text>
      </Button>
    </View>
  );
}

function ServicesSection(props: { list: ServiceInfo[] }) {
  const open = signal(true);
  return (
    <Collapsible
      open={open()}
      content={
        <View>
          <If when={props.list.length === 0}>
            <Text class="px-4 py-1 text-[12px] text-muted-foreground">No services yet. Ask an agent for one.</Text>
          </If>
          <Each of={props.list}>{(service) => <ServiceRow service={service()} />}</Each>
        </View>
      }
    >
      <TreeRow
        node={{ path: "services", name: "services", kind: "directory" }}
        depth={0}
        open={open()}
        onPress={() => open.set(!open())}
      />
    </Collapsible>
  );
}

export function ObjectTreePanelView() {
  return (
    <Scroll class="flex-1 bg-inset">
      <View class="gap-px py-1">
        <If when={tree().length === 0}>
          <Text class="px-3 py-2 text-[13px] text-muted-foreground">No components yet. Ask an agent to build one.</Text>
        </If>
        <Each of={tree()}>{(node) => <TreeItem node={node()} depth={0} />}</Each>
        <If when={services()}>{() => <ServicesSection list={services() ?? []} />}</If>
      </View>
    </Scroll>
  );
}
