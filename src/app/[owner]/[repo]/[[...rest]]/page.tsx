import type { Metadata } from "next";

import { RepoExplorer } from "@/components/repo/repo-explorer";

type Params = Promise<{ owner: string; repo: string; rest?: string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `${decode(owner)}/${decode(repo)}` };
}

/** Mirrors github.com paths: /owner/repo, /owner/repo/tree/<ref>/<path>, /owner/repo/blob/… */
export default async function RepoPage({ params }: { params: Params }) {
  const { owner, repo, rest = [] } = await params;
  const input = [owner, repo, ...rest].map(decode).join("/");
  return <RepoExplorer input={input} />;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
