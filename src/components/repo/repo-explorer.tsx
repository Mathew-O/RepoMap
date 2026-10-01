"use client";

import {
  AlertIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  InfoIcon,
  RocketIcon,
  SkipIcon,
} from "@primer/octicons-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";

import type { RevealRequest } from "@/components/graph/repo-graph";
import { BottomSheet } from "@/components/panel/bottom-sheet";
import { DetailsPanel } from "@/components/panel/details-panel";
import { ErrorState } from "@/components/repo/error-state";
import { kindColor } from "@/components/repo/kind";
import { NodeIcon } from "@/components/repo/node-icon";
import { RepoHeader, type RepoView } from "@/components/repo/repo-header";
import { RepoSkeleton } from "@/components/repo/repo-skeleton";
import { StartHereBar } from "@/components/repo/start-here-bar";
import { TreeList } from "@/components/repo/tree-list";
import { useRepoTree } from "@/hooks/use-repo-tree";
import { formatBytes, formatNumber, shortSha } from "@/lib/format";
import { ancestorsOf, githubUrl, indexEntryPoints } from "@/lib/tree-utils";
import type { RepoTree } from "@/lib/types";

// React Flow measures the DOM, so it only renders in the browser.
const RepoGraph = dynamic(() => import("@/components/graph/repo-graph").then((m) => m.RepoGraph), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full rounded-none!" aria-label="Loading map" />,
});

export function RepoExplorer({ input }: { input: string }) {
  const { state, retry } = useRepoTree(input);

  if (state.status === "loading") return <RepoSkeleton />;
  if (state.status === "error") return <ErrorState error={state.error} input={input} onRetry={retry} />;
  // Re-key per commit + URL so view state resets when navigating to another repo or ref.
  return <RepoWorkspace key={`${input}@${state.data.meta.commitSha}`} tree={state.data} />;
}

type SelectOptions = { reveal?: boolean };

function RepoWorkspace({ tree }: { tree: RepoTree }) {
  const { nodes, meta } = tree;
  const focus = meta.focusPath;

  const [view, setView] = useState<RepoView>("map");
  const [selectedPath, setSelectedPath] = useState<string>(focus ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set(ancestorsOf(focus, nodes));
    if (focus && nodes[focus]?.type === "dir") initial.add(focus);
    return initial;
  });
  const [reveal, setReveal] = useState<RevealRequest | null>(focus ? { path: focus, nonce: 1 } : null);
  // Mobile sheet starts as a peek so a deep link still shows the map; tapping a file opens it.
  const [sheetOpen, setSheetOpen] = useState(false);
  const nonce = useRef(1);
  const entryIndex = useMemo(() => indexEntryPoints(tree.entryPoints.points, nodes), [tree, nodes]);

  const select = useCallback(
    (path: string, options?: SelectOptions) => {
      setSelectedPath(path);
      if (nodes[path]?.type !== "dir" && path !== "") setSheetOpen(true);
      if (options?.reveal) {
        const ancestors = ancestorsOf(path, nodes);
        if (ancestors.length) {
          setExpanded((prev) => {
            if (ancestors.every((a) => prev.has(a))) return prev;
            const next = new Set(prev);
            for (const a of ancestors) next.add(a);
            return next;
          });
        }
        nonce.current += 1;
        setReveal({ path, nonce: nonce.current });
      }
    },
    [nodes],
  );

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  const selectedNode = nodes[selectedPath];
  const showSheet = selectedPath !== "" && selectedNode !== undefined;

  return (
    <>
      <RepoHeader tree={tree} view={view} onViewChange={setView} />
      <div className="mx-auto w-full max-w-[1280px] space-y-4 px-4 py-6 md:px-6 lg:px-8">
        <Toolbar tree={tree} />
        <TruncationNotice tree={tree} />
        <StartHereBar tree={tree} selectedPath={selectedPath} onSelect={select} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {view === "map" ? (
              <div className="Box h-[60dvh] min-h-[340px] overflow-hidden lg:h-[calc(100dvh-180px)] lg:max-h-[880px] lg:min-h-[520px]">
                <RepoGraph
                  tree={tree}
                  entryIndex={entryIndex}
                  expanded={expanded}
                  selectedPath={selectedPath}
                  reveal={reveal}
                  onSelect={select}
                  onToggle={toggle}
                  onCollapseAll={collapseAll}
                />
              </div>
            ) : (
              <TreeList
                tree={tree}
                entryIndex={entryIndex}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={toggle}
                onSelect={select}
                onCollapseAll={collapseAll}
              />
            )}
          </div>

          <aside aria-label="Details" className="hidden lg:block">
            <div className="Box sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto p-4">
              <DetailsPanel tree={tree} path={selectedPath} onSelect={select} />
            </div>
          </aside>
        </div>

        {/* Room for the mobile bottom sheet so it never hides the end of the page. */}
        {showSheet && <div className="h-20 lg:hidden" aria-hidden="true" />}
      </div>

      {showSheet && (
        <BottomSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onClose={() => {
            setSelectedPath("");
            setSheetOpen(false);
          }}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <NodeIcon node={selectedNode} expanded={expanded.has(selectedPath)} />
              <span className="truncate font-semibold">{selectedNode.name}</span>
              <span className="size-2 shrink-0 rounded-full" style={{ background: kindColor(selectedNode.kind) }} />
              {entryIndex.byPath.has(selectedPath) && (
                <span className="StartHere shrink-0">
                  <RocketIcon size={12} />
                  Start here
                </span>
              )}
            </span>
          }
        >
          <DetailsPanel tree={tree} path={selectedPath} onSelect={select} />
        </BottomSheet>
      )}
    </>
  );
}

function Toolbar({ tree }: { tree: RepoTree }) {
  const { meta, stats } = tree;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={`${meta.htmlUrl}/tree/${encodeURIComponent(meta.ref)}`}
        target="_blank"
        rel="noreferrer"
        className="btn max-w-[240px]"
        title={meta.refIsDefault ? `${meta.ref} (default branch)` : meta.ref}
      >
        <GitBranchIcon />
        <span className="truncate font-semibold">{meta.ref}</span>
        {meta.refIsDefault && <span className="Label hidden sm:inline-flex">default</span>}
      </a>
      <a
        href={`${meta.htmlUrl}/commit/${meta.commitSha}`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-invisible text-fg-muted!"
        title={meta.commitSha}
      >
        <GitCommitIcon />
        <span className="font-mono text-xs">{shortSha(meta.commitSha)}</span>
      </a>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted sm:ml-auto">
        <li className="inline-flex items-center gap-1">
          <FileDirectoryIcon size={16} />
          <strong className="font-semibold text-fg">{formatNumber(stats.dirs)}</strong> folders
        </li>
        <li className="inline-flex items-center gap-1">
          <FileIcon size={16} />
          <strong className="font-semibold text-fg">{formatNumber(stats.files)}</strong> files
          <span className="text-fg-subtle">· {formatBytes(stats.totalBytes)}</span>
        </li>
        {stats.skipped > 0 && (
          <li
            className="inline-flex items-center gap-1"
            title="Binaries, lockfiles, vendored or generated code and very large files are shown on the map but not sent to the AI."
          >
            <SkipIcon size={16} />
            <strong className="font-semibold text-fg">{formatNumber(stats.skipped)}</strong> skipped for analysis
          </li>
        )}
        {tree.cached && (
          <li className="inline-flex items-center gap-1" title="This commit's tree was served from RepoMap's cache.">
            <DatabaseIcon size={16} />
            cached
          </li>
        )}
      </ul>
    </div>
  );
}

function TruncationNotice({ tree }: { tree: RepoTree }) {
  const { truncation, meta } = tree;
  const focusMissing = meta.requestedPath !== null && meta.focusPath === null;

  if (!truncation.github && !truncation.capped && !focusMissing) return null;

  return (
    <div className="space-y-2">
      {(truncation.github || truncation.capped) && (
        <div className="flash flash-warn" role="status">
          <AlertIcon size={16} />
          <div className="text-sm">
            <p className="font-semibold">This is a very large repository, so only part of it is shown.</p>
            <p className="mt-0.5 text-fg-muted">
              {truncation.github &&
                "GitHub returned a partial file list because the repository is too big to list in one request. "}
              {truncation.capped &&
                `RepoMap is showing ${formatNumber(truncation.returnedEntries)} of ${formatNumber(truncation.totalEntries)} entries, keeping the shallowest so the top-level structure is complete. `}
              Folders marked <span className="Label">partial</span> have contents you can{" "}
              <a href={githubUrl(meta, "", "tree")} target="_blank" rel="noreferrer" className="Link">
                browse on GitHub
              </a>
              .
            </p>
          </div>
        </div>
      )}
      {focusMissing && (
        <div className="flash flash-info" role="status">
          <InfoIcon size={16} />
          <p className="text-sm">
            <code className="font-mono">{meta.requestedPath}</code> wasn&apos;t found at this commit, so the whole
            repository is shown.
          </p>
        </div>
      )}
    </div>
  );
}
