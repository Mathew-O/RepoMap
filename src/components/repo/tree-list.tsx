"use client";

import { ChevronRightIcon, FoldIcon, InfoIcon, RocketIcon } from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useSummary } from "@/components/ai/summary-context";
import { KIND_LABEL, KIND_ORDER, SKIP_LABEL, kindColor } from "@/components/repo/kind";
import { NodeIcon } from "@/components/repo/node-icon";
import { TREE_LIST_PAGE_SIZE } from "@/lib/config";
import { formatBytes, formatNumber } from "@/lib/format";
import { type EntryIndex, githubUrl } from "@/lib/tree-utils";
import type { RepoTree, TreeNode } from "@/lib/types";

type Row =
  | { type: "node"; node: TreeNode }
  | { type: "more"; parent: string; depth: number; remaining: number }
  | { type: "hidden"; parent: string; depth: number; count: number };

const INDENT_PX = 20;
const BASE_PAD_PX = 12;

interface TreeListProps {
  tree: RepoTree;
  entryIndex: EntryIndex;
  expanded: ReadonlySet<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onCollapseAll: () => void;
}

/**
 * GitHub-style file browser: the accessible, list-shaped alternative to the
 * map. Shares expand/collapse and selection state with the graph.
 */
export function TreeList({ tree, entryIndex, expanded, selectedPath, onToggle, onSelect, onCollapseAll }: TreeListProps) {
  const { nodes, meta, stats } = tree;
  const [pageLimits, setPageLimits] = useState<Record<string, number>>({});
  const selectedRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(nodes, expanded, pageLimits), [nodes, expanded, pageLimits]);

  // Bring the selection into view when switching to this tab or when it's revealed from elsewhere.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedPath]);

  function showMore(parent: string) {
    setPageLimits((prev) => ({ ...prev, [parent]: (prev[parent] ?? TREE_LIST_PAGE_SIZE) + TREE_LIST_PAGE_SIZE }));
  }

  const legend = KIND_ORDER.filter((k) => stats.byKind[k] > 0);

  return (
    <section aria-label="Files" className="Box overflow-hidden">
      <div className="Box-header flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5!">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" aria-label="File types">
          {legend.map((kind) => (
            <li key={kind} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: kindColor(kind) }} />
              <span className="font-semibold text-fg">{KIND_LABEL[kind]}</span>
              {formatNumber(stats.byKind[kind])}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="btn btn-sm btn-invisible ml-auto text-fg-muted!"
          onClick={onCollapseAll}
          disabled={expanded.size === 0}
        >
          <FoldIcon />
          Collapse all
        </button>
      </div>

      <div role="tree" aria-label={`${meta.fullName} files`}>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-fg-muted">This tree has no files.</p>
        ) : (
          rows.map((row) =>
            row.type === "node" ? (
              <NodeRow
                key={row.node.path}
                node={row.node}
                expanded={expanded.has(row.node.path)}
                selected={row.node.path === selectedPath}
                startHere={entryIndex.byPath.has(row.node.path)}
                containsStartHere={entryIndex.containers.has(row.node.path)}
                rowRef={row.node.path === selectedPath ? selectedRef : undefined}
                onActivate={() => {
                  onSelect(row.node.path);
                  if (row.node.type === "dir") onToggle(row.node.path);
                }}
              />
            ) : row.type === "more" ? (
              <div key={`more:${row.parent}`} className="border-t border-border-muted py-1.5" style={{ paddingLeft: pad(row.depth) + 20 }}>
                <button type="button" className="Link cursor-pointer text-sm" onClick={() => showMore(row.parent)}>
                  Show {formatNumber(Math.min(row.remaining, TREE_LIST_PAGE_SIZE))} more
                  <span className="text-fg-muted"> ({formatNumber(row.remaining)} remaining)</span>
                </button>
              </div>
            ) : (
              <div
                key={`hidden:${row.parent}`}
                className="flex items-center gap-2 border-t border-border-muted py-1.5 text-sm text-fg-muted"
                style={{ paddingLeft: pad(row.depth) + 20 }}
              >
                <InfoIcon size={14} />
                <span>
                  {formatNumber(row.count)} more {row.count === 1 ? "item" : "items"} not loaded (repository too large).{" "}
                  <a href={githubUrl(meta, row.parent, "tree")} target="_blank" rel="noreferrer" className="Link">
                    View on GitHub
                  </a>
                </span>
              </div>
            ),
          )
        )}
      </div>
    </section>
  );
}

function NodeRow({
  node,
  expanded,
  selected,
  startHere,
  containsStartHere,
  rowRef,
  onActivate,
}: {
  node: TreeNode;
  expanded: boolean;
  selected: boolean;
  startHere: boolean;
  containsStartHere: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onActivate: () => void;
}) {
  const isDir = node.type === "dir";

  return (
    <div
      ref={rowRef}
      className="border-t border-border-muted first:border-t-0"
      role="treeitem"
      aria-level={node.depth}
      aria-expanded={isDir ? expanded : undefined}
      aria-selected={selected}
    >
      <button
        type="button"
        onClick={onActivate}
        className={`group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pr-4 text-left text-sm md:grid-cols-[minmax(0,1fr)_150px_96px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px_88px] ${
          selected ? "bg-row-selected" : "hover:bg-row-hover"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2 py-[7px]" style={{ paddingLeft: pad(node.depth) }}>
          {isDir ? (
            <ChevronRightIcon
              size={16}
              className={`shrink-0 text-fg-muted transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
            />
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <NodeIcon node={node} expanded={expanded} />
          <span className={`truncate ${isDir ? "text-fg" : "text-fg group-hover:text-accent group-hover:underline"}`}>
            {node.name}
          </span>
          {startHere && (
            <span className="StartHere shrink-0">
              <RocketIcon size={12} />
              Start here
            </span>
          )}
          {containsStartHere && !startHere && (
            <span className="inline-flex shrink-0 text-success" title="Contains a Start here file">
              <RocketIcon size={14} aria-label="Contains a Start here file" />
            </span>
          )}
          {node.hiddenChildren ? <span className="Label shrink-0">partial</span> : null}
        </span>
        <RowSummary path={node.path} />
        <span className="flex items-center justify-end gap-2 md:justify-start">
          <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" title={KIND_LABEL[node.kind]}>
            <span className="size-2 shrink-0 rounded-full" style={{ background: kindColor(node.kind) }} />
            <span className="hidden md:inline">{KIND_LABEL[node.kind]}</span>
          </span>
          {node.skip && (
            <span className="Label py-0! text-[11px]! leading-4!" title={SKIP_LABEL[node.skip].title}>
              {SKIP_LABEL[node.skip].label}
            </span>
          )}
        </span>
        <span className="hidden text-right text-xs text-fg-muted tabular-nums md:block">{sizeText(node)}</span>
      </button>
    </div>
  );
}

/** The AI summary in the column where GitHub shows the last commit message. */
function RowSummary({ path }: { path: string }) {
  const entry = useSummary(path);
  const text = entry?.status === "done" ? entry.summary.text : entry?.status === "streaming" ? entry.text : "";
  const plain = text.replace(/`/g, "");
  return (
    <span className="hidden truncate text-xs text-fg-muted lg:block" title={plain || undefined}>
      {plain}
    </span>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function visibleRows(
  nodes: Record<string, TreeNode>,
  expanded: ReadonlySet<string>,
  pageLimits: Record<string, number>,
): Row[] {
  const rows: Row[] = [];
  const walk = (dirPath: string) => {
    const dir = nodes[dirPath];
    if (!dir?.children) return;
    const limit = pageLimits[dirPath] ?? TREE_LIST_PAGE_SIZE;
    for (const childPath of dir.children.slice(0, limit)) {
      const child = nodes[childPath];
      if (!child) continue;
      rows.push({ type: "node", node: child });
      if (child.type === "dir" && expanded.has(childPath)) walk(childPath);
    }
    if (dir.children.length > limit) {
      rows.push({ type: "more", parent: dirPath, depth: dir.depth + 1, remaining: dir.children.length - limit });
    }
    if (dir.hiddenChildren) {
      rows.push({ type: "hidden", parent: dirPath, depth: dir.depth + 1, count: dir.hiddenChildren });
    }
  };
  walk("");
  return rows;
}

function sizeText(node: TreeNode): string {
  if (node.type === "dir") return `${formatNumber(node.fileCount ?? 0)} ${node.fileCount === 1 ? "file" : "files"}`;
  if (node.type === "submodule") return "submodule";
  return node.size !== undefined ? formatBytes(node.size) : "";
}

function pad(depth: number): number {
  return BASE_PAD_PX + (depth - 1) * INDENT_PX;
}
