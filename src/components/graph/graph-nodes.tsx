"use client";

import { ChevronRightIcon, InfoIcon, KebabHorizontalIcon, RocketIcon } from "@primer/octicons-react";
import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { KIND_LABEL, SKIP_LABEL, kindColor } from "@/components/repo/kind";
import { NodeIcon } from "@/components/repo/node-icon";
import { formatBytes, formatNumber } from "@/lib/format";
import type { EntryPoint, TreeNode } from "@/lib/types";

export type EntryNodeData = {
  node: TreeNode;
  label: string;
  expanded: boolean;
  /** An ancestor of the selected node: drawn with an accent outline. */
  onPath: boolean;
  /** Set if this node is a "Start here" entry point. */
  startHere: EntryPoint | null;
  /** A folder with a "Start here" entry somewhere inside. */
  containsStartHere: boolean;
};

export type MoreNodeData = {
  variant: "more" | "hidden";
  count: number;
};

export type EntryFlowNode = Node<EntryNodeData, "entry">;
export type MoreFlowNode = Node<MoreNodeData, "more">;

const hiddenHandle = "!pointer-events-none !size-px !min-h-0 !min-w-0 !border-0 !bg-transparent";

function EntryNodeComponent({ data, selected }: NodeProps<EntryFlowNode>) {
  const { node, label, expanded, onPath, startHere, containsStartHere } = data;
  const isRoot = node.path === "";
  const isDir = node.type === "dir";
  const muted = Boolean(node.skip);

  const ring = selected
    ? "border-accent-emphasis shadow-[0_0_0_3px_color-mix(in_srgb,var(--gh-accent-emphasis)_30%,transparent)]"
    : onPath
      ? "border-[color-mix(in_srgb,var(--gh-accent-emphasis)_60%,var(--gh-border))]"
      : "border-border hover:border-fg-subtle";

  return (
    <div
      className={`group relative flex h-full w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md border bg-canvas pr-2.5 pl-3.5 text-[13px] transition-[border-color,box-shadow] duration-100 ${ring} ${
        isRoot ? "bg-canvas-subtle font-semibold" : ""
      } ${muted ? "border-dashed" : ""}`}
      title={nodeTitle(data)}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className={hiddenHandle} />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: isRoot ? "var(--gh-fg-muted)" : kindColor(node.kind), opacity: muted ? 0.5 : 1 }}
      />
      <NodeIcon node={node} expanded={expanded} />
      <span className={`min-w-0 flex-1 truncate ${muted ? "text-fg-muted" : "text-fg"}`}>{label}</span>
      {startHere && (
        <span className="StartHere shrink-0">
          <RocketIcon size={12} />
          Start here
        </span>
      )}
      {isDir && !isRoot ? (
        <span className="flex shrink-0 items-center gap-1 text-fg-muted">
          {containsStartHere && !startHere && <RocketIcon size={14} className="text-success" aria-hidden="true" />}
          {!startHere && <span className="Counter px-1.5! text-[11px]!">{formatNumber(node.fileCount ?? 0)}</span>}
          <ChevronRightIcon size={14} className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
        </span>
      ) : !isDir && !startHere && node.size !== undefined ? (
        <span className="shrink-0 text-[11px] text-fg-subtle tabular-nums">{formatBytes(node.size)}</span>
      ) : null}
      <span className="sr-only">
        {KIND_LABEL[node.kind]}
        {isDir ? (expanded ? ", expanded" : ", collapsed") : ""}
        {containsStartHere ? ", contains a Start here file" : ""}
      </span>
      <Handle type="source" position={Position.Right} isConnectable={false} className={hiddenHandle} />
    </div>
  );
}

function nodeTitle({ node, label, startHere, containsStartHere }: EntryNodeData): string {
  const lines = [node.path || label];
  if (node.skip) lines.push(SKIP_LABEL[node.skip].title);
  if (startHere) lines.push(`Start here: ${startHere.reasons.join("; ")}`);
  else if (containsStartHere) lines.push("Contains a Start here file");
  return lines.join("\n");
}

function MoreNodeComponent({ data }: NodeProps<MoreFlowNode>) {
  const isMore = data.variant === "more";
  return (
    <div
      className={`flex h-full w-full items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs text-fg-muted ${
        isMore ? "cursor-pointer bg-canvas hover:border-accent-emphasis hover:text-accent" : "cursor-default bg-canvas-subtle"
      }`}
      title={isMore ? "Show more" : "This repository is too large to list everything here. Browse the rest on GitHub."}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className={hiddenHandle} />
      {isMore ? <KebabHorizontalIcon size={14} /> : <InfoIcon size={14} />}
      <span className="truncate">
        {isMore ? `+${formatNumber(data.count)} more` : `${formatNumber(data.count)} not loaded`}
      </span>
    </div>
  );
}

export const nodeTypes = {
  entry: memo(EntryNodeComponent),
  more: memo(MoreNodeComponent),
};
