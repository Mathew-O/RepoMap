"use client";

import { AlertIcon, RocketIcon } from "@primer/octicons-react";

import { NodeIcon } from "@/components/repo/node-icon";
import { shortLabel } from "@/lib/tree-utils";
import type { EntryPoint, RepoTree, TreeNode } from "@/lib/types";

export const INCOMPLETE_ENTRY_POINTS_NOTE =
  "Some config files couldn't be read (GitHub rate limit or timeout), so this list may be missing entries. Reload in a few minutes to retry.";

/**
 * One-line strip of "Start here" files above the map. Visible at every
 * width, so phones (where the repo-level panel is hidden) get it too.
 */
export function StartHereBar({
  tree,
  points,
  selectedPath,
  onSelect,
}: {
  tree: RepoTree;
  /** Heuristic entry points, refined by the AI overview once it arrives. */
  points: EntryPoint[];
  selectedPath: string;
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const { incomplete } = tree.entryPoints;
  const paths = points.map((p) => p.path);
  const readme = points.length === 0 ? findReadme(tree) : null;

  return (
    <section aria-labelledby="start-here-heading" className="flex min-w-0 items-center gap-3">
      <h2 id="start-here-heading" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold">
        <RocketIcon size={16} className="text-success" />
        Start here
      </h2>

      {points.length > 0 ? (
        <ul className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1 [scrollbar-width:thin]">
          {points.map((point) => {
            const node = tree.nodes[point.path];
            if (!node) return null;
            const selected = point.path === selectedPath;
            return (
              <li key={point.path} className="shrink-0">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(point.path, { reveal: true })}
                  title={`${point.path}\n${point.reasons.join("\n")}`}
                  className={`btn btn-sm max-w-[240px] ${selected ? "border-accent-emphasis! bg-row-selected!" : ""}`}
                >
                  <NodeIcon node={node} />
                  <span className="truncate">{shortLabel(point.path, paths)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          No clear entry point found.
          {readme && (
            <>
              <span>The README is a good place to begin:</span>
              <ReadmeButton node={readme} onSelect={onSelect} />
            </>
          )}
        </p>
      )}

      {incomplete && (
        <span className="inline-flex shrink-0 text-attention" title={INCOMPLETE_ENTRY_POINTS_NOTE}>
          <AlertIcon size={16} aria-label={INCOMPLETE_ENTRY_POINTS_NOTE} />
        </span>
      )}
    </section>
  );
}

function ReadmeButton({ node, onSelect }: { node: TreeNode; onSelect: (path: string, options?: { reveal?: boolean }) => void }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => onSelect(node.path, { reveal: true })}>
      <NodeIcon node={node} />
      {node.name}
    </button>
  );
}

export function findReadme(tree: RepoTree): TreeNode | null {
  const children = (tree.nodes[""]?.children ?? []).map((p) => tree.nodes[p]!).filter(Boolean);
  return (
    children.find((n) => n.type === "file" && /^readme\.md$/i.test(n.name)) ??
    children.find((n) => n.type === "file" && /^readme(\.|$)/i.test(n.name)) ??
    null
  );
}
