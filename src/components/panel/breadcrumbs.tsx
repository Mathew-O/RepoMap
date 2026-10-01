import { RepoIcon } from "@primer/octicons-react";

import { pathChain } from "@/lib/tree-utils";
import type { RepoTree } from "@/lib/types";

/** repo / src / lib / file.ts, where every segment selects that folder. */
export function Breadcrumbs({
  tree,
  path,
  onSelect,
}: {
  tree: RepoTree;
  path: string;
  onSelect: (path: string) => void;
}) {
  const chain = pathChain(path, tree.nodes);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
        {chain.map((node, i) => {
          const last = i === chain.length - 1;
          const label = node.path === "" ? tree.meta.repo : node.name;
          return (
            <li key={node.path} className="flex min-w-0 items-center gap-1">
              {i > 0 && <span className="text-fg-muted">/</span>}
              {last ? (
                <span aria-current="location" className="truncate font-semibold text-fg">
                  {label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect(node.path)}
                  className="Link inline-flex max-w-[160px] cursor-pointer items-center gap-1 truncate"
                >
                  {node.path === "" && <RepoIcon size={14} className="shrink-0 text-fg-muted" />}
                  <span className="truncate">{label}</span>
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
