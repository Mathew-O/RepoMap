"use client";

import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  LinkIcon,
  MarkGithubIcon,
  RocketIcon,
  SkipIcon,
  SparkleFillIcon,
} from "@primer/octicons-react";
import { useEffect, useId, useMemo, useState } from "react";

import { KIND_LABEL, KIND_ORDER, SKIP_LABEL, kindColor } from "@/components/repo/kind";
import { NodeIcon } from "@/components/repo/node-icon";
import { SummarySection } from "@/components/ai/summary-section";
import { Breadcrumbs } from "@/components/panel/breadcrumbs";
import { INCOMPLETE_ENTRY_POINTS_NOTE } from "@/components/repo/start-here-bar";
import { formatBytes, formatNumber } from "@/lib/format";
import { explorerPath } from "@/lib/github/parse-url";
import { childCounts, descendantKindCounts, entryPointsUnder, githubUrl } from "@/lib/tree-utils";
import type { EntryPoint, RepoTree, TreeNode } from "@/lib/types";

const CONTENTS_PREVIEW = 12;

const TYPE_LABEL: Record<TreeNode["type"], string> = {
  dir: "Folder",
  file: "File",
  submodule: "Git submodule",
  symlink: "Symbolic link",
};

/** Facts about the selected file or folder. AI summaries plug in here in milestone 4. */
export function DetailsPanel({
  tree,
  path,
  entryPoints,
  onSelect,
}: {
  tree: RepoTree;
  path: string;
  entryPoints: EntryPoint[];
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const node = tree.nodes[path];
  if (!node) return null;
  const isRoot = path === "";
  const isDir = node.type === "dir";
  const entry = entryPoints.find((p) => p.path === path);

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-2">
        <Breadcrumbs tree={tree} path={path} onSelect={(p) => onSelect(p, { reveal: true })} />
        <div className="flex items-start gap-2">
          <span className="mt-1">
            <NodeIcon node={node} expanded={false} size={20} />
          </span>
          <h2 className="min-w-0 text-xl font-semibold break-words">{isRoot ? tree.meta.fullName : node.name}</h2>
        </div>
        {isRoot && tree.meta.description && <p className="text-sm text-fg-muted">{tree.meta.description}</p>}
      </div>

      {!isRoot && <SummarySection key={path} tree={tree} node={node} />}
      {entry && <WhyStartHere entry={entry} />}
      {isDir && <StartHereList tree={tree} dir={path} points={entryPoints} onSelect={onSelect} />}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-y border-border py-3 text-sm">
        <dt className="text-fg-muted">Type</dt>
        <dd>{isRoot ? "Repository" : TYPE_LABEL[node.type]}</dd>

        {!isRoot && (
          <>
            <dt className="text-fg-muted">Category</dt>
            <dd className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: kindColor(node.kind) }} />
              {KIND_LABEL[node.kind]}
            </dd>
          </>
        )}

        {isDir ? <FolderSizeFacts node={node} tree={tree} /> : null}
        {node.size !== undefined && (
          <>
            <dt className="text-fg-muted">Size</dt>
            <dd>{formatBytes(node.size)}</dd>
          </>
        )}

        {node.type === "file" && (
          <>
            <dt className="text-fg-muted">AI analysis</dt>
            <dd>
              {node.skip ? (
                <span className="inline-flex items-center gap-1 text-fg-muted">
                  <SkipIcon size={14} />
                  Skipped: {SKIP_LABEL[node.skip].label}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-fg">
                  <SparkleFillIcon size={14} className="text-done" />
                  Included
                </span>
              )}
            </dd>
          </>
        )}

        {!isRoot && (
          <>
            <dt className="text-fg-muted">Path</dt>
            <dd className="font-mono text-xs leading-5 break-all">{node.path}</dd>
          </>
        )}
      </dl>

      {isDir && <KindBreakdown node={node} tree={tree} />}
      {isDir && <Contents node={node} tree={tree} onSelect={onSelect} />}

      <Actions tree={tree} node={node} />
    </div>
  );
}

function WhyStartHere({ entry }: { entry: EntryPoint }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-md border border-border bg-canvas-subtle p-3">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
        <span className="StartHere">
          <RocketIcon size={12} />
          Start here
        </span>
        Why this is a good first read
      </h3>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm break-words">
        {entry.reasons.map((reason, i) => (
          <li key={reason}>
            {reason}
            {i === 0 && entry.source === "llm" && <span className="ml-1.5 text-xs text-fg-muted">(AI overview)</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The repo's (or a folder's) "Start here" files, each with its strongest reason. */
function StartHereList({
  tree,
  dir,
  points: allPoints,
  onSelect,
}: {
  tree: RepoTree;
  dir: string;
  points: EntryPoint[];
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const headingId = useId();
  const points = entryPointsUnder(dir, allPoints).filter((p) => p.path !== dir);
  if (points.length === 0) return null;
  const isRoot = dir === "";

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
        <RocketIcon size={16} className="text-success" />
        {isRoot ? "Start here" : "Start here in this folder"}
      </h3>
      <ul className="Box divide-y divide-border-muted overflow-hidden text-sm">
        {points.map((point) => {
          const node = tree.nodes[point.path];
          if (!node) return null;
          return (
            <li key={point.path}>
              <button
                type="button"
                onClick={() => onSelect(point.path, { reveal: true })}
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left hover:bg-row-hover"
              >
                <span className="mt-0.5">
                  <NodeIcon node={node} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{isRoot ? point.path : point.path.slice(dir.length + 1)}</span>
                  <span className="block truncate text-xs text-fg-muted">{point.reasons[0]}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {isRoot && tree.entryPoints.incomplete && (
        <p className="flex items-start gap-1.5 text-xs text-fg-muted">
          <AlertIcon size={12} className="mt-0.5 shrink-0 text-attention" />
          {INCOMPLETE_ENTRY_POINTS_NOTE}
        </p>
      )}
      {isRoot && (
        <p className="text-xs text-fg-muted">
          {points.some((p) => p.source === "llm")
            ? "Picked by the AI overview and checked against the repository’s manifests, configs and file names."
            : "Found from the repository’s manifests, configs and file names."}
        </p>
      )}
    </section>
  );
}

function FolderSizeFacts({ node, tree }: { node: TreeNode; tree: RepoTree }) {
  const { dirs, files } = childCounts(node, tree.nodes);
  return (
    <>
      <dt className="text-fg-muted">Contains</dt>
      <dd>
        {formatNumber(dirs)} {dirs === 1 ? "folder" : "folders"}, {formatNumber(files)} {files === 1 ? "file" : "files"}
        {node.hiddenChildren ? <span className="text-attention"> (+{formatNumber(node.hiddenChildren)} not loaded)</span> : null}
      </dd>
      <dt className="text-fg-muted">All files</dt>
      <dd>{formatNumber(node.fileCount ?? 0)}</dd>
    </>
  );
}

/** GitHub "Languages"-style stacked bar of file categories beneath a folder. */
function KindBreakdown({ node, tree }: { node: TreeNode; tree: RepoTree }) {
  const counts = useMemo(
    () => (node.path === "" ? tree.stats.byKind : descendantKindCounts(node.path, tree.nodes)),
    [node.path, tree],
  );
  const headingId = useId();
  const total = KIND_ORDER.reduce((sum, k) => sum + counts[k], 0);
  if (total === 0) return null;
  const kinds = KIND_ORDER.filter((k) => counts[k] > 0);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        File types
      </h3>
      <div className="flex h-2 overflow-hidden rounded-full bg-neutral-muted" aria-hidden="true">
        {kinds.map((k) => (
          <span
            key={k}
            style={{ width: `${(counts[k] / total) * 100}%`, background: kindColor(k) }}
            className="border-r-2 border-canvas last:border-r-0"
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {kinds.map((k) => (
          <li key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: kindColor(k) }} />
            <span className="font-semibold">{KIND_LABEL[k]}</span>
            <span className="text-fg-muted">{((counts[k] / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Contents({
  node,
  tree,
  onSelect,
}: {
  node: TreeNode;
  tree: RepoTree;
  onSelect: (path: string, options?: { reveal?: boolean }) => void;
}) {
  const headingId = useId();
  const children = node.children ?? [];
  if (children.length === 0) return null;
  const shown = children.slice(0, CONTENTS_PREVIEW);

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        Contents
      </h3>
      <ul className="Box divide-y divide-border-muted overflow-hidden text-sm">
        {shown.map((childPath) => {
          const child = tree.nodes[childPath];
          if (!child) return null;
          return (
            <li key={childPath}>
              <button
                type="button"
                onClick={() => onSelect(childPath, { reveal: true })}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left hover:bg-row-hover"
              >
                <NodeIcon node={child} />
                <span className="min-w-0 flex-1 truncate">{child.name}</span>
                <span className="size-2 shrink-0 rounded-full" style={{ background: kindColor(child.kind) }} />
              </button>
            </li>
          );
        })}
      </ul>
      {children.length > shown.length && (
        <p className="text-xs text-fg-muted">
          +{formatNumber(children.length - shown.length)} more on the map
        </p>
      )}
    </section>
  );
}

function Actions({ tree, node }: { tree: RepoTree; node: TreeNode }) {
  const { meta } = tree;
  const [copied, setCopied] = useState<"path" | "link" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copy(kind: "path" | "link") {
    const text =
      kind === "path"
        ? node.path
        : window.location.origin +
          explorerPath({
            owner: meta.owner,
            repo: meta.repo,
            ...(node.path
              ? { view: node.type === "dir" ? "tree" : "blob", treeish: `${meta.ref}/${node.path}` }
              : {}),
          });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      // Clipboard can be blocked (permissions, insecure context); nothing useful to show.
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={githubUrl(meta, node.path, node.type === "file" || node.type === "symlink" ? "blob" : "tree")}
        target="_blank"
        rel="noreferrer"
        className="btn btn-sm"
      >
        <MarkGithubIcon />
        View on GitHub
      </a>
      <button type="button" className="btn btn-sm" onClick={() => copy("link")}>
        {copied === "link" ? <CheckIcon className="text-success!" /> : <LinkIcon />}
        {copied === "link" ? "Copied" : "Copy link"}
      </button>
      {node.path && (
        <button type="button" className="btn btn-sm" onClick={() => copy("path")}>
          {copied === "path" ? <CheckIcon className="text-success!" /> : <CopyIcon />}
          {copied === "path" ? "Copied" : "Copy path"}
        </button>
      )}
    </div>
  );
}
