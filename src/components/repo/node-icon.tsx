import {
  FileDirectoryFillIcon,
  FileDirectoryOpenFillIcon,
  FileIcon,
  FileSubmoduleIcon,
  FileSymlinkFileIcon,
  RepoIcon,
} from "@primer/octicons-react";

import type { TreeNode } from "@/lib/types";

export function NodeIcon({ node, expanded = false, size = 16 }: { node: TreeNode; expanded?: boolean; size?: number }) {
  if (node.path === "") return <RepoIcon size={size} className="shrink-0 text-fg-muted" />;
  switch (node.type) {
    case "dir":
      return expanded ? (
        <FileDirectoryOpenFillIcon size={size} className="shrink-0 text-dir-icon" />
      ) : (
        <FileDirectoryFillIcon size={size} className="shrink-0 text-dir-icon" />
      );
    case "submodule":
      return <FileSubmoduleIcon size={size} className="shrink-0 text-dir-icon" />;
    case "symlink":
      return <FileSymlinkFileIcon size={size} className="shrink-0 text-fg-muted" />;
    default:
      return <FileIcon size={size} className="shrink-0 text-fg-muted" />;
  }
}
