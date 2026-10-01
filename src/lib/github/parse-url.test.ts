import { describe, expect, it } from "vitest";

import { explorerPath, parseRepoUrl } from "@/lib/github/parse-url";

function ok(input: string) {
  const result = parseRepoUrl(input);
  if (!result.ok) throw new Error(`expected ok for ${input}: ${result.error}`);
  return result.value;
}

function err(input: string) {
  const result = parseRepoUrl(input);
  if (result.ok) throw new Error(`expected error for ${input}`);
  return result.error;
}

describe("parseRepoUrl", () => {
  it.each([
    "https://github.com/vercel/next.js",
    "http://github.com/vercel/next.js",
    "https://www.github.com/vercel/next.js/",
    "github.com/vercel/next.js",
    "vercel/next.js",
    "  vercel/next.js  ",
    "https://github.com/vercel/next.js.git",
    "git@github.com:vercel/next.js.git",
    "ssh://git@github.com/vercel/next.js.git",
    "https://github.com/vercel/next.js?tab=readme-ov-file#getting-started",
    "https://github.com/vercel/next.js/issues/123",
    "https://github.com/vercel/next.js/pulls",
  ])("parses %s", (input) => {
    expect(ok(input)).toEqual({ owner: "vercel", repo: "next.js" });
  });

  it("keeps tree refs (which may contain slashes) for the server to split", () => {
    expect(ok("https://github.com/o/r/tree/feature/login/src/app")).toEqual({
      owner: "o",
      repo: "r",
      view: "tree",
      treeish: "feature/login/src/app",
    });
  });

  it("handles blob and commit links", () => {
    expect(ok("github.com/o/r/blob/main/src/index.ts")).toMatchObject({ view: "blob", treeish: "main/src/index.ts" });
    expect(ok("github.com/o/r/commit/abc1234")).toMatchObject({ view: "commit", treeish: "abc1234" });
  });

  it("decodes percent-encoded segments", () => {
    expect(ok("https://github.com/o/r/tree/main/my%20folder").treeish).toBe("main/my folder");
  });

  it("ignores /tree with no ref", () => {
    expect(ok("github.com/o/r/tree")).toEqual({ owner: "o", repo: "r" });
  });

  it.each([
    ["", /Paste a GitHub repository URL/],
    ["https://gitlab.com/o/r", /only works with GitHub/],
    ["gitlab.com/o/r", /only works with GitHub/],
    ["https://gist.github.com/o/abc", /gist\.github\.com links aren't supported/],
    ["https://github.com/torvalds", /user or organization/],
    ["https://github.com/", /doesn't include a repository/],
    ["https://github.com/orgs/vercel", /GitHub page/],
    ["https://github.com/-bad/repo", /isn't a valid GitHub user/],
    ["owner/re po", /doesn't look like a repository/],
    ["o/..", /isn't a valid repository name/],
    ["https://github.com/o/..", /doesn't include a repository/],
  ])("rejects %j", (input, message) => {
    expect(err(input)).toMatch(message);
  });
});

describe("explorerPath", () => {
  it("mirrors github.com paths", () => {
    expect(explorerPath({ owner: "o", repo: "r" })).toBe("/o/r");
    expect(explorerPath({ owner: "o", repo: "r", view: "tree", treeish: "feat/x/my dir" })).toBe(
      "/o/r/tree/feat/x/my%20dir",
    );
  });
});
