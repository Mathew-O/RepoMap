import type { FileKind, SkipReason } from "@/lib/types";

export const KIND_ORDER: FileKind[] = ["source", "test", "config", "docs", "build", "asset", "other"];

export const KIND_LABEL: Record<FileKind, string> = {
  source: "Source",
  test: "Tests",
  config: "Config",
  docs: "Docs",
  build: "Build/CI",
  asset: "Assets",
  other: "Other",
};

/** CSS custom property for a kind's color (defined in globals.css). */
export function kindColor(kind: FileKind): string {
  return `var(--kind-${kind})`;
}

export const SKIP_LABEL: Record<SkipReason, { label: string; title: string }> = {
  binary: { label: "binary", title: "Binary file, which isn't analyzed" },
  asset: { label: "asset", title: "Image or media asset, which isn't analyzed" },
  lockfile: { label: "lockfile", title: "Dependency lockfile, which isn't analyzed" },
  vendored: { label: "vendored", title: "Third-party code vendored into the repo, which isn't analyzed" },
  generated: { label: "generated", title: "Generated or build output, which isn't analyzed" },
  "too-large": { label: "too large", title: "Too large to analyze" },
};
