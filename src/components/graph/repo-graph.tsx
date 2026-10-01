"use client";

import "@xyflow/react/dist/style.css";

import { AlertIcon, FoldIcon, ScreenFullIcon } from "@primer/octicons-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { type EntryFlowNode, type MoreFlowNode, nodeTypes } from "@/components/graph/graph-nodes";
import { KIND_LABEL, KIND_ORDER, kindColor } from "@/components/repo/kind";
import { GRAPH_PAGE_SIZE, LARGE_GRAPH_THRESHOLD } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { NODE_HEIGHT, NODE_WIDTH, ROOT_WIDTH, entryId, layoutTree } from "@/lib/graph/layout";
import type { EntryIndex } from "@/lib/tree-utils";
import type { RepoTree } from "@/lib/types";

export interface RevealRequest {
  path: string;
  /** Bumped on every request so revealing the same path twice still re-centers. */
  nonce: number;
}

interface RepoGraphProps {
  tree: RepoTree;
  entryIndex: EntryIndex;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  reveal: RevealRequest | null;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  onCollapseAll: () => void;
}

export function RepoGraph(props: RepoGraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}

function GraphCanvas({
  tree,
  entryIndex,
  expanded,
  selectedPath,
  reveal,
  onSelect,
  onToggle,
  onCollapseAll,
}: RepoGraphProps) {
  const { nodes: treeNodes, meta, stats } = tree;
  const [pageLimits, setPageLimits] = useState<Record<string, number>>({});
  /** React Flow knows its pane size only after init; centering earlier lands in the wrong place. */
  const [ready, setReady] = useState(false);
  const { setCenter, getZoom, fitView, getViewport, setViewport } = useReactFlow();
  /** Node to keep still on screen while the layout reflows after a click. */
  const anchor = useRef<{ id: string; x: number; y: number } | null>(null);

  const layout = useMemo(
    () => layoutTree(treeNodes, expanded, pageLimits, GRAPH_PAGE_SIZE),
    [treeNodes, expanded, pageLimits],
  );

  // Selected node plus its ancestors, for highlighting the path from the root.
  const onPath = useMemo(() => {
    const set = new Set<string>();
    let current = selectedPath !== null ? treeNodes[selectedPath] : undefined;
    while (current) {
      set.add(current.path);
      current = current.parent !== null ? treeNodes[current.parent] : undefined;
    }
    return set;
  }, [selectedPath, treeNodes]);

  const flowNodes = useMemo<Node[]>(
    () =>
      layout.items.map((item): EntryFlowNode | MoreFlowNode => {
        if (item.item.type === "entry") {
          const node = treeNodes[item.item.path]!;
          const isRoot = node.path === "";
          return {
            id: item.id,
            type: "entry",
            position: { x: isRoot ? item.x - (ROOT_WIDTH - NODE_WIDTH) : item.x, y: item.y },
            width: isRoot ? ROOT_WIDTH : NODE_WIDTH,
            height: NODE_HEIGHT,
            selected: node.path === selectedPath,
            data: {
              node,
              label: isRoot ? meta.fullName : node.name,
              expanded: isRoot || expanded.has(node.path),
              onPath: onPath.has(node.path) && node.path !== selectedPath,
              startHere: entryIndex.byPath.get(node.path) ?? null,
              containsStartHere: entryIndex.containers.has(node.path),
            },
          };
        }
        return {
          id: item.id,
          type: "more",
          position: { x: item.x, y: item.y },
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          selectable: item.item.type === "more",
          data: {
            variant: item.item.type,
            count: item.item.type === "more" ? item.item.remaining : item.item.count,
          },
        };
      }),
    [layout, treeNodes, selectedPath, expanded, onPath, meta.fullName, entryIndex],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      layout.edges.map((edge) => {
        const targetPath = edge.target.startsWith("n:") ? edge.target.slice(2) : null;
        const highlighted = targetPath !== null && onPath.has(targetPath);
        return {
          ...edge,
          type: "smoothstep",
          pathOptions: { borderRadius: 10 },
          focusable: false,
          className: highlighted ? "repomap-edge-active" : undefined,
          zIndex: highlighted ? 1 : 0,
        };
      }),
    [layout, onPath],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      if (node.type === "more") {
        if (!node.id.startsWith("more:")) return;
        const parent = node.id.slice("more:".length);
        const parentItem = layout.items.find((i) => i.id === entryId(parent));
        if (parentItem) anchor.current = { id: parentItem.id, x: parentItem.x, y: parentItem.y };
        setPageLimits((prev) => ({ ...prev, [parent]: (prev[parent] ?? GRAPH_PAGE_SIZE) + GRAPH_PAGE_SIZE }));
        return;
      }
      const path = node.id.slice(2);
      const treeNode = treeNodes[path];
      if (!treeNode) return;
      onSelect(path);
      if (treeNode.type === "dir" && path !== "") {
        anchor.current = { id: node.id, x: node.position.x, y: node.position.y };
        onToggle(path);
      }
    },
    [onSelect, onToggle, treeNodes, layout],
  );

  // Expanding a folder reflows the tidy tree. Shift the viewport by however
  // much the clicked node moved so it stays under the pointer.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const item = layout.items.find((i) => i.id === a.id);
    if (!item) return;
    const dx = item.x - a.x;
    const dy = item.y - a.y;
    if (dx === 0 && dy === 0) return;
    const { x, y, zoom } = getViewport();
    setViewport({ x: x - dx * zoom, y: y - dy * zoom, zoom });
  }, [layout, getViewport, setViewport]);

  const collapseAll = useCallback(() => {
    onCollapseAll();
    window.setTimeout(() => fitView({ padding: 0.12, duration: 300, maxZoom: 1, minZoom: 0.5 }), 30);
  }, [onCollapseAll, fitView]);

  // Center on externally requested paths (deep links, breadcrumbs, Files list)
  // once the layout contains them.
  const handledReveal = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !reveal || handledReveal.current === reveal.nonce) return;
    const item = layout.items.find((i) => i.id === entryId(reveal.path));
    if (!item) return;
    handledReveal.current = reveal.nonce;
    const frame = requestAnimationFrame(() => {
      setCenter(item.x + NODE_WIDTH / 2, item.y + NODE_HEIGHT / 2, {
        zoom: Math.max(getZoom(), 0.85),
        duration: 400,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, reveal, layout, setCenter, getZoom]);

  const visibleCount = layout.items.length;
  const legend = KIND_ORDER.filter((k) => stats.byKind[k] > 0);

  return (
    <div className="repomap-flow h-full w-full">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onInit={() => setReady(true)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        colorMode="system"
        minZoom={0.08}
        maxZoom={2}
        fitView={!reveal}
        fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.5 }}
        onlyRenderVisibleElements={visibleCount > 300}
        aria-label={`Map of ${meta.fullName}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          className="max-md:hidden!"
          nodeColor={(n) =>
            n.type !== "entry"
              ? "var(--gh-border)"
              : (n as EntryFlowNode).data.node.path === ""
                ? "var(--gh-fg-muted)"
                : kindColor((n as EntryFlowNode).data.node.kind)
          }
          nodeBorderRadius={4}
          ariaLabel="Minimap"
        />

        <Panel position="top-left" className="m-3!">
          <ul
            className="hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-canvas/90 px-3 py-1.5 text-xs text-fg-muted shadow-sm backdrop-blur sm:flex"
            aria-label="Colors"
          >
            {legend.map((kind) => (
              <li key={kind} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: kindColor(kind) }} />
                {KIND_LABEL[kind]}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel position="top-right" className="m-3! flex items-center gap-2">
          <span className="hidden rounded-md bg-canvas/90 px-2 py-1 text-xs text-fg-muted backdrop-blur md:inline">
            {formatNumber(visibleCount)} nodes shown
          </span>
          <button type="button" className="btn btn-sm" onClick={() => fitView({ padding: 0.12, duration: 300, maxZoom: 1 })}>
            <ScreenFullIcon />
            <span className="hidden sm:inline">Fit</span>
          </button>
          <button type="button" className="btn btn-sm" onClick={collapseAll} disabled={expanded.size === 0}>
            <FoldIcon />
            <span className="hidden sm:inline">Collapse all</span>
          </button>
        </Panel>

        {visibleCount > LARGE_GRAPH_THRESHOLD && (
          <Panel position="top-center" className="mt-14!">
            <div className="flash flash-warn px-3! py-2! text-xs shadow-sm" role="status">
              <AlertIcon size={14} />
              <span>
                {formatNumber(visibleCount)} nodes are open, which may feel slow. Collapse some folders to keep things smooth.
              </span>
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
