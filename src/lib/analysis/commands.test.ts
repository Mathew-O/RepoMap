import { describe, expect, it } from "vitest";

import { resolveCommand, tokenize } from "@/lib/analysis/commands";
import { joinPath, resolveJsTarget, resolvePathToken, resolvePyModule } from "@/lib/analysis/resolve";
import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";

function treeOf(paths: string[]) {
  const entries: GitTreeEntry[] = paths.map((path) => ({ path, mode: "100644", type: "blob", sha: `sha-${path}`, size: 100 }));
  return buildTree(entries, { maxNodes: 10_000, truncatedByGitHub: false }).nodes;
}

const nodes = treeOf([
  "server.js",
  "src/index.ts",
  "src/cli.ts",
  "src/server.ts",
  "app/main.py",
  "src/mypkg/__init__.py",
  "src/mypkg/__main__.py",
  "src/mypkg/cli.py",
  "wsgi.py",
  "cmd/api/main.go",
  "cmd/worker/main.go",
  "main.go",
  "src/main.rs",
  "src/bin/tool.rs",
  "Cargo.toml",
  "gunicorn.conf.py",
  "scripts/start.sh",
  "packages/core/src/index.ts",
]);

describe("joinPath", () => {
  it("resolves . and .. and refuses to escape the repo", () => {
    expect(joinPath("a/b", "../c/./d")).toBe("a/c/d");
    expect(joinPath("", "./x")).toBe("x");
    expect(joinPath("a", "../../x")).toBeNull();
  });
});

describe("resolveJsTarget", () => {
  it("returns committed files as-is", () => {
    expect(resolveJsTarget("./server.js", "", nodes)).toEqual({ path: "server.js", mapped: false });
  });

  it("maps build output back to source", () => {
    expect(resolveJsTarget("./dist/index.js", "", nodes)).toEqual({ path: "src/index.ts", mapped: true });
    expect(resolveJsTarget("dist/cjs/cli.cjs", "", nodes)).toEqual({ path: "src/cli.ts", mapped: true });
    expect(resolveJsTarget("./dist/index.d.ts", "packages/core", nodes)?.path).toBe("packages/core/src/index.ts");
  });

  it("resolves folders to their index file", () => {
    expect(resolveJsTarget("src", "", nodes)?.path).toBe("src/index.ts");
  });

  it("returns null for targets that don't exist", () => {
    expect(resolveJsTarget("./dist/missing.js", "", nodes)).toBeNull();
    expect(resolveJsTarget("../../outside.js", "", nodes)).toBeNull();
  });
});

describe("resolvePyModule", () => {
  it("finds modules at the root and in the src/ layout", () => {
    expect(resolvePyModule("app.main", "", nodes)).toBe("app/main.py");
    expect(resolvePyModule("mypkg.cli", "", nodes)).toBe("src/mypkg/cli.py");
    expect(resolvePyModule("mypkg", "", nodes)).toBe("src/mypkg/__init__.py");
  });

  it("prefers __main__.py for python -m", () => {
    expect(resolvePyModule("mypkg", "", nodes, true)).toBe("src/mypkg/__main__.py");
  });

  it("rejects things that aren't module names", () => {
    expect(resolvePyModule("localhost:3000", "", nodes)).toBeNull();
    expect(resolvePyModule("nope.missing", "", nodes)).toBeNull();
  });
});

describe("resolvePathToken", () => {
  it("strips container WORKDIR prefixes", () => {
    expect(resolvePathToken("/app/server.js", "", nodes)).toBe("server.js");
    // Build output under the WORKDIR maps to source before falling back to a same-named root file.
    expect(resolvePathToken("/usr/src/app/dist/server.js", "", nodes)).toBe("src/server.ts");
  });

  it("maps relative build output to source", () => {
    expect(resolvePathToken("dist/server.js", "", nodes)).toBe("src/server.ts");
  });

  it("ignores flags, URLs, variables and bare words", () => {
    for (const token of ["--port", "http://x.io/a.js", "$ENTRY", "serve"]) {
      expect(resolvePathToken(token, "", nodes)).toBeNull();
    }
  });
});

describe("tokenize", () => {
  it("keeps quoted arguments together", () => {
    expect(tokenize(`node "my file.js" --port 3000`)).toEqual(["node", "my file.js", "--port", "3000"]);
  });
});

describe("resolveCommand", () => {
  const ctx = { nodes, baseDir: "" };

  it.each([
    ["node server.js", ["server.js"]],
    ["NODE_ENV=production node --enable-source-maps dist/server.js", ["src/server.ts"]],
    ["python -m mypkg", ["src/mypkg/__main__.py"]],
    ["uv run python -m mypkg --help", ["src/mypkg/__main__.py"]],
    ["gunicorn -c gunicorn.conf.py -w 4 wsgi:app", ["wsgi.py"]],
    ["uvicorn app.main:app --reload", ["app/main.py"]],
    ["go run ./cmd/api", ["cmd/api/main.go"]],
    ["go build -o bin/worker ./cmd/worker/...", ["cmd/worker/main.go"]],
    ["go run .", ["main.go"]],
    ["cargo run", ["src/main.rs"]],
    ["cargo run --release --bin tool", ["src/bin/tool.rs"]],
    ["bash ./scripts/start.sh && echo done", ["scripts/start.sh"]],
    ["exec tini -- node server.js", ["server.js"]],
  ])("%s", (command, expected) => {
    expect(resolveCommand(command, ctx)).toEqual(expected);
  });

  it("follows package-manager scripts", () => {
    const scripts = { start: "node server.js", dev: "tsx watch src/index.ts", serve: "npm run start" };
    const withScripts = { ...ctx, scripts };
    expect(resolveCommand("npm start", withScripts)).toEqual(["server.js"]);
    expect(resolveCommand("pnpm dev", withScripts)).toEqual(["src/index.ts"]);
    expect(resolveCommand("yarn run serve", withScripts)).toEqual(["server.js"]);
    // npm only runs scripts by bare name via `npm run`.
    expect(resolveCommand("npm dev", withScripts)).toEqual([]);
  });

  it("doesn't loop on self-referencing scripts", () => {
    expect(resolveCommand("npm start", { ...ctx, scripts: { start: "npm start" } })).toEqual([]);
  });

  it("only reports source files", () => {
    expect(resolveCommand("cat Cargo.toml", ctx)).toEqual([]);
  });
});
