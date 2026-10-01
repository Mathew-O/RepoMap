"use client";

import {
  ChevronRightIcon,
  FileDirectoryFillIcon,
  FileDirectoryOpenFillIcon,
  FileIcon,
  FileSubmoduleIcon,
  FileSymlinkFileIcon,
  FoldIcon,
  InfoIcon,
} from "@primer/octicons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { KIND_LABEL, KIND_ORDER, SKIP_LABEL, kindColor } from "@/components/repo/kind";
import { TREE_LIST_PAGE_SIZE } from "@/lib/config";
import { formatBytes, formatNumber } from "@/lib/format";
import type { RepoMeta, RepoTree, TreeNode } from "@/lib/types";

type Row =
  | { type: "node"; node: TreeNode }
  | { type: "more"; parent: string; depth: number; remaining: number }
  | { type: "hidden"; parent: string; depth: number; count: number };

const INDENT_PX = 20;
const BASE_PAD_PX = 12;

/**
 * GitHub-style file browser. Folders start collapsed and expand on click.
 * Large folders are paged so huge repos stay responsive. (The graph view in
 * milestone 2 will reuse the same tree data.)
 */
export function TreeList({ tree }: { tree: RepoTree }) {
  const { nodes, meta, stats } = tree;
  const [expanded, setExpanded] = useState<Set<string>>(() => ancestorsOf(meta.focusPath, nodes));
  const [pageLimits, setPageLimits] = useState<Record<string, number>>({});
  const focusRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(nodes, expanded, pageLimits), [nodes, expanded, pageLimits]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, []);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function showMore(parent: string) {
    setPageLimits((prev) => ({ ...prev, [parent]: (prev[parent] ?? TREE_LIST_PAGE_SIZE) + TREE_LIST_PAGE_SIZE }));
  }

  const legend = KIND_ORDER.filter((k) => stats.byKind[k] > 0);

  return (
    <section id="files" aria-label="Files" className="Box overflow-hidden">
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
          onClick={() => setExpanded(new Set())}
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
                meta={meta}
                expanded={expanded.has(row.node.path)}
                focused={row.node.path === meta.focusPath}
                rowRef={row.node.path === meta.focusPath ? focusRef : undefined}
                onToggle={toggle}
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
  meta,
  expanded,
  focused,
  rowRef,
  onToggle,
}: {
  node: TreeNode;
  meta: RepoMeta;
  expanded: boolean;
  focused: boolean;
  rowRef?: React.Ref<HTMLDivElement>;
  onToggle: (path: string) => void;
}) {
  const isDir = node.type === "dir";
  const rowClass = `group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pr-4 text-sm md:grid-cols-[minmax(0,1fr)_150px_96px] ${
    focused ? "bg-row-selected" : "hover:bg-row-hover"
  }`;

  const nameCell = (
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
      {node.hiddenChildren ? <span className="Label shrink-0">partial</span> : null}
    </span>
  );

  const trailing = (
    <>
      <span className="flex items-center justify-end gap-2 md:justify-start">
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" title={`${KIND_LABEL[node.kind]}`}>
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
    </>
  );

  if (isDir) {
    return (
      <div ref={rowRef} className="border-t border-border-muted first:border-t-0" role="treeitem" aria-level={node.depth} aria-expanded={expanded} aria-selected={focused}>
        <button type="button" onClick={() => onToggle(node.path)} className={`${rowClass} w-full cursor-pointer text-left`}>
          {nameCell}
          {trailing}
        </button>
      </div>
    );
  }

  return (
    <div ref={rowRef} className="border-t border-border-muted first:border-t-0" role="treeitem" aria-level={node.depth} aria-selected={focused}>
      <a
        href={githubUrl(meta, node.path, node.type === "submodule" ? "tree" : "blob")}
        target="_blank"
        rel="noreferrer"
        className={rowClass}
        title={`Open ${node.path} on GitHub`}
      >
        {nameCell}
        {trailing}
      </a>
    </div>
  );
}

function NodeIcon({ node, expanded }: { node: TreeNode; expanded: boolean }) {
  switch (node.type) {
    case "dir":
      return expanded ? (
        <FileDirectoryOpenFillIcon size={16} className="shrink-0 text-dir-icon" />
      ) : (
        <FileDirectoryFillIcon size={16} className="shrink-0 text-dir-icon" />
      );
    case "submodule":
      return <FileSubmoduleIcon size={16} className="shrink-0 text-dir-icon" />;
    case "symlink":
      return <FileSymlinkFileIcon size={16} className="shrink-0 text-fg-muted" />;
    default:
      return <FileIcon size={16} className="shrink-0 text-fg-muted" />;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function visibleRows(
  nodes: Record<string, TreeNode>,
  expanded: Set<string>,
  pageLimits: Record<string, number>,
): Row[] {
  const rows: Row[] = [];
  const walk = (dirPath: string) => {
    const dir = nodes[dirPath];
    if (!dir?.children) return;
    const limit = pageLimits[dirPath] ?? TREE_LIST_PAGE_SIZE;
    const shown = dir.children.slice(0, limit);
    for (const childPath of shown) {
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

/** Expand every folder on the way to (and including) the focused path. */
function ancestorsOf(path: string | null, nodes: Record<string, TreeNode>): Set<string> {
  const set = new Set<string>();
  let current = path ? nodes[path] : undefined;
  if (current?.type === "dir") set.add(current.path);
  while (current?.parent) {
    set.add(current.parent);
    current = nodes[current.parent];
  }
  return set;
}

function sizeText(node: TreeNode): string {
  if (node.type === "dir") return `${formatNumber(node.fileCount ?? 0)} ${node.fileCount === 1 ? "file" : "files"}`;
  if (node.type === "submodule") return "submodule";
  return node.size !== undefined ? formatBytes(node.size) : "";
}

function pad(depth: number): number {
  return BASE_PAD_PX + (depth - 1) * INDENT_PX;
}

export function githubUrl(meta: RepoMeta, path: string, view: "tree" | "blob"): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return path ? `${meta.htmlUrl}/${view}/${meta.commitSha}/${encoded}` : `${meta.htmlUrl}/tree/${meta.commitSha}`;
}
