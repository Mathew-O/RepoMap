import {
  ArchiveIcon,
  CodeIcon,
  LawIcon,
  LinkIcon,
  LockIcon,
  MarkGithubIcon,
  RepoForkedIcon,
  RepoIcon,
  StarIcon,
} from "@primer/octicons-react";

import { formatCount, formatNumber } from "@/lib/format";
import { languageColor } from "@/lib/language-colors";
import type { RepoTree } from "@/lib/types";

/** GitHub-style repository header: title, visibility, counters, description, topics, tabs. */
export function RepoHeader({ tree }: { tree: RepoTree }) {
  const { meta, stats } = tree;
  const ownerUrl = meta.htmlUrl.slice(0, meta.htmlUrl.lastIndexOf("/"));

  return (
    <div className="border-b border-border bg-canvas-subtle/60 pt-4">
      <div className="mx-auto max-w-[1280px] px-4 md:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <div className="flex min-w-0 items-center gap-2 text-xl">
            {meta.isPrivate ? (
              <LockIcon size={16} className="shrink-0 text-fg-muted" />
            ) : (
              <RepoIcon size={16} className="shrink-0 text-fg-muted" />
            )}
            <a href={ownerUrl} target="_blank" rel="noreferrer" className="Link truncate">
              {meta.owner}
            </a>
            <span className="text-fg-muted">/</span>
            <a href={meta.htmlUrl} target="_blank" rel="noreferrer" className="Link truncate font-semibold">
              {meta.repo}
            </a>
            <span className="Label ml-1">{meta.isPrivate ? "Private" : "Public"}</span>
            {meta.isArchived && <span className="Label Label--attention">Archived</span>}
            {meta.isFork && <span className="Label">Fork</span>}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <a href={`${meta.htmlUrl}/stargazers`} target="_blank" rel="noreferrer" className="btn btn-sm" title={`${formatNumber(meta.stars)} stars`}>
              <StarIcon />
              Stars <span className="Counter">{formatCount(meta.stars)}</span>
            </a>
            <a href={`${meta.htmlUrl}/forks`} target="_blank" rel="noreferrer" className="btn btn-sm" title={`${formatNumber(meta.forks)} forks`}>
              <RepoForkedIcon />
              Forks <span className="Counter">{formatCount(meta.forks)}</span>
            </a>
            <a href={meta.htmlUrl} target="_blank" rel="noreferrer" className="btn btn-sm">
              <MarkGithubIcon />
              View on GitHub
            </a>
          </div>
        </div>

        {(meta.description || meta.homepage || meta.topics.length > 0 || meta.license || meta.language) && (
          <div className="mt-3 max-w-[860px] space-y-3">
            {meta.description && <p className="text-base text-fg">{meta.description}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
              {meta.homepage && (
                <a href={meta.homepage} target="_blank" rel="noreferrer" className="Link inline-flex items-center gap-1 font-semibold">
                  <LinkIcon size={16} className="text-fg-muted" />
                  {meta.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </a>
              )}
              {meta.language && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-3 rounded-full border border-border" style={{ background: languageColor(meta.language) }} />
                  {meta.language}
                </span>
              )}
              {meta.license && (
                <span className="inline-flex items-center gap-1">
                  <LawIcon size={16} />
                  {meta.license}
                </span>
              )}
              {meta.isArchived && (
                <span className="inline-flex items-center gap-1 text-attention">
                  <ArchiveIcon size={16} />
                  Read-only archive
                </span>
              )}
            </div>
            {meta.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {meta.topics.map((topic) => (
                  <a key={topic} href={`https://github.com/topics/${topic}`} target="_blank" rel="noreferrer" className="topic-tag">
                    {topic}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <nav aria-label="Repository" className="mt-4 flex gap-2 overflow-x-auto pb-2">
          <a href="#files" aria-current="page" className="UnderlineNav-item">
            <CodeIcon />
            Files
            <span className="Counter">{formatCount(stats.files)}</span>
          </a>
        </nav>
      </div>
    </div>
  );
}
