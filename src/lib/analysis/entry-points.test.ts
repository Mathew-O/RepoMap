import { describe, expect, it } from "vitest";

import { detectEntryPoints, planEntryPointReads, rankSignals } from "@/lib/analysis/entry-points";
import {
  cargoTomlSignals,
  composeSignals,
  dockerfileSignals,
  packageJsonSignals,
  procfileSignals,
  pyprojectSignals,
  readmeSignals,
  setupCfgSignals,
  setupPySignals,
  workflowSignals,
} from "@/lib/analysis/manifests";
import { type GitTreeEntry, buildTree } from "@/lib/github/build-tree";

function treeOf(paths: string[], sizes: Record<string, number> = {}) {
  const entries: GitTreeEntry[] = paths.map((path) => ({
    path,
    mode: "100644",
    type: "blob",
    sha: `sha-${path}`,
    size: sizes[path] ?? 100,
  }));
  return buildTree(entries, { maxNodes: 10_000, truncatedByGitHub: false }).nodes;
}

const detect = (paths: string[], files: Record<string, string> = {}) =>
  detectEntryPoints(treeOf(paths), new Map(Object.entries(files)));

const pathsOf = (points: { path: string }[]) => points.map((p) => p.path);

// ─── Manifest parsers ────────────────────────────────────────────────────

describe("packageJsonSignals", () => {
  const nodes = treeOf(["src/index.ts", "src/cli.ts", "bin/run.js", "server.js", "packages/ui/src/index.tsx"]);
  const ctx = { nodes, rootScripts: {} };

  it("reads bin (string and map), main, module and exports", () => {
    const signals = packageJsonSignals(
      "package.json",
      JSON.stringify({
        bin: { tool: "./dist/cli.js", run: "bin/run.js" },
        main: "./dist/index.cjs",
        exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./cli": "./dist/cli.js" },
      }),
      ctx,
    );
    expect(signals).toContainEqual({ path: "src/cli.ts", weight: 0.85, reason: 'package.json "bin: tool" → dist/cli.js' });
    expect(signals).toContainEqual({ path: "bin/run.js", weight: 0.85, reason: 'package.json "bin: run"' });
    expect(signals).toContainEqual({ path: "src/index.ts", weight: 0.7, reason: 'package.json "exports" → dist/index.js' });
    // "main" names the same file as "exports": one piece of evidence, counted once.
    expect(signals.filter((s) => s.path === "src/index.ts")).toHaveLength(1);
  });

  it("falls back to index.js when there's no main or exports, like Node does", () => {
    const withIndex = { nodes: treeOf(["index.js", "lib/express.js"]), rootScripts: {} };
    expect(packageJsonSignals("package.json", JSON.stringify({ name: "express" }), withIndex)).toEqual([
      { path: "index.js", weight: 0.7, reason: 'package.json (default "main": index.js)' },
    ]);
  });

  it("follows start/dev scripts", () => {
    const signals = packageJsonSignals("package.json", JSON.stringify({ scripts: { start: "node server.js", test: "vitest" } }), ctx);
    expect(signals).toEqual([{ path: "server.js", weight: 0.6, reason: '"start" script in package.json' }]);
  });

  it("weights nested packages lower and names them", () => {
    const signals = packageJsonSignals("packages/ui/package.json", JSON.stringify({ main: "dist/index.js" }), ctx);
    expect(signals).toEqual([
      { path: "packages/ui/src/index.tsx", weight: 0.55, reason: 'packages/ui/package.json "main" → dist/index.js' },
    ]);
  });

  it("ignores invalid JSON", () => {
    expect(packageJsonSignals("package.json", "{ nope", ctx)).toEqual([]);
  });
});

describe("Python manifests", () => {
  const nodes = treeOf(["src/flask/cli.py", "src/flask/__init__.py", "tool/main.py", "scripts/run-thing"]);
  const ctx = { nodes, rootScripts: {} };

  it("pyproject [project.scripts] and poetry tables", () => {
    const toml = [
      "[project]",
      'name = "flask"',
      "[project.scripts]",
      'flask = "flask.cli:main"',
      "[tool.poetry.scripts]",
      'tool = { callable = "tool.main:run" }',
      "[tool.other]",
      'x = "flask.cli:nope"',
    ].join("\n");
    expect(pyprojectSignals("pyproject.toml", toml, ctx)).toEqual([
      { path: "src/flask/cli.py", weight: 0.85, reason: 'pyproject.toml script "flask"' },
      { path: "tool/main.py", weight: 0.85, reason: 'pyproject.toml script "tool"' },
    ]);
  });

  it("setup.py console_scripts and scripts=[]", () => {
    const py = `setup(entry_points={"console_scripts": ["flask = flask.cli:main"]}, scripts=["scripts/run-thing"])`;
    expect(setupPySignals("setup.py", py, ctx)).toEqual([
      { path: "src/flask/cli.py", weight: 0.85, reason: 'setup.py console script "flask"' },
      { path: "scripts/run-thing", weight: 0.7, reason: 'setup.py "scripts"' },
    ]);
  });

  it("setup.cfg [options.entry_points]", () => {
    const cfg = "[metadata]\nname = x\n\n[options.entry_points]\nconsole_scripts =\n    flask = flask.cli:main\n\n[flake8]\nx = y\n";
    expect(setupCfgSignals("setup.cfg", cfg, ctx)).toEqual([
      { path: "src/flask/cli.py", weight: 0.85, reason: 'setup.cfg console script "flask"' },
    ]);
  });
});

describe("cargoTomlSignals", () => {
  it("reads explicit [[bin]] paths and [lib]", () => {
    const nodes = treeOf(["crates/core/main.rs", "crates/core/lib.rs", "src/bin/extra.rs"]);
    const toml = [
      "[package]",
      'name = "ripgrep"',
      "[[bin]]",
      'name = "rg"',
      'path = "crates/core/main.rs"',
      "[[bin]]",
      'name = "extra"',
      "[lib]",
      'path = "crates/core/lib.rs"',
    ].join("\n");
    // "extra" has no path, so it's the default src/bin/extra.rs, which the path conventions already score.
    expect(cargoTomlSignals("Cargo.toml", toml, { nodes, rootScripts: {} })).toEqual([
      { path: "crates/core/main.rs", weight: 0.85, reason: 'Cargo.toml [[bin]] "rg"' },
      { path: "crates/core/lib.rs", weight: 0.55, reason: "Cargo.toml [lib]" },
    ]);
  });
});

describe("container, process and CI configs", () => {
  const nodes = treeOf(["app.py", "worker.py", "api/server.js", "cmd/api/main.go"]);
  const ctx = { nodes, rootScripts: { start: "node api/server.js" } };

  it("Dockerfile CMD/ENTRYPOINT in exec and shell form, across line continuations", () => {
    const dockerfile = 'FROM python:3.12\nWORKDIR /app\nENTRYPOINT ["python"]\nCMD ["app.py"]\n';
    expect(dockerfileSignals("Dockerfile", dockerfile, ctx)).toEqual([
      { path: "app.py", weight: 0.6, reason: "Run by Dockerfile CMD" },
    ]);
    const shell = "FROM node\nCMD npm \\\n  start\n";
    expect(dockerfileSignals("Dockerfile", shell, ctx)).toEqual([
      { path: "api/server.js", weight: 0.6, reason: "Run by Dockerfile CMD" },
    ]);
  });

  it("docker compose command:", () => {
    const yml = "services:\n  worker:\n    command: python worker.py\n  api:\n    command: [\"go\", \"run\", \"./cmd/api\"]\n";
    expect(composeSignals("docker-compose.yml", yml, ctx)).toEqual([
      { path: "worker.py", weight: 0.5, reason: "Run by docker-compose.yml command" },
      { path: "cmd/api/main.go", weight: 0.5, reason: "Run by docker-compose.yml command" },
    ]);
  });

  it("Procfile weights the web process highest", () => {
    expect(procfileSignals("Procfile", "web: gunicorn app:app\nworker: python worker.py\n", ctx)).toEqual([
      { path: "app.py", weight: 0.7, reason: 'Procfile "web" process' },
      { path: "worker.py", weight: 0.5, reason: 'Procfile "worker" process' },
    ]);
  });

  it("GitHub Actions run: steps, inline and block", () => {
    const yml = [
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: go build ./cmd/api",
      "      - name: smoke",
      "        run: |",
      "          python app.py --check",
      "          echo ok",
      "      - uses: actions/checkout@v4",
    ].join("\n");
    expect(workflowSignals(".github/workflows/ci.yml", yml, ctx)).toEqual([
      { path: "cmd/api/main.go", weight: 0.25, reason: "Run in CI (ci.yml)" },
      { path: "app.py", weight: 0.25, reason: "Run in CI (ci.yml)" },
    ]);
  });
});

describe("readmeSignals", () => {
  const nodes = treeOf(["src/core/engine.ts", "src/index.ts", "LICENSE", "docs/guide.md", "server.js"]);
  const ctx = { nodes, rootScripts: { start: "node server.js" } };

  it("weights mentions near start-here wording higher and ignores docs", () => {
    const md = [
      "# Project",
      "See [the guide](docs/guide.md) and [license](./LICENSE).",
      "The engine is in `src/core/engine.ts`.",
      "## Architecture",
      "Everything starts at [src/index.ts](https://github.com/o/r/blob/main/src/index.ts#L1).",
    ].join("\n");
    const signals = readmeSignals("README.md", md, ctx);
    expect(signals).toEqual([
      { path: "src/core/engine.ts", weight: 0.2, reason: "Mentioned in the README" },
      { path: "src/index.ts", weight: 0.3, reason: "Mentioned in the README" },
    ]);
  });

  it("resolves usage commands in shell fences and inline code", () => {
    const md = "## Usage\n\n```bash\n$ npm install\n$ npm start\n```\n\nOr run `node src/index.ts` directly.\n```js\nnode notACommand.js\n```\n";
    const paths = readmeSignals("README.md", md, ctx).map((s) => [s.path, s.reason]);
    expect(paths).toEqual([
      ["server.js", "Run by a README usage command"],
      ["src/index.ts", "Run by a README usage command"],
    ]);
  });
});

// ─── Ranking ─────────────────────────────────────────────────────────────

describe("rankSignals", () => {
  const nodes = treeOf(["a.ts", "b.ts", "c.ts", "examples/demo/main.ts", "test/main.test.ts", "dist/x.min.js"]);

  it("combines independent signals so corroboration raises the score", () => {
    const [top] = rankSignals(
      [
        { path: "a.ts", weight: 0.5, reason: "one" },
        { path: "a.ts", weight: 0.5, reason: "two" },
        { path: "a.ts", weight: 0.4, reason: "two" },
      ],
      nodes,
    );
    expect(top).toEqual({ path: "a.ts", reasons: ["one", "two"], source: "heuristic", score: 0.75 });
  });

  it("halves examples and drops tests and skipped files", () => {
    const ranked = rankSignals(
      [
        { path: "examples/demo/main.ts", weight: 0.8, reason: "x" },
        { path: "test/main.test.ts", weight: 0.9, reason: "x" },
        { path: "dist/x.min.js", weight: 0.9, reason: "x" },
        { path: "a.ts", weight: 0.6, reason: "x" },
      ],
      nodes,
    );
    expect(ranked.map((e) => [e.path, e.score])).toEqual([["a.ts", 0.6]]);
  });

  it("falls back to the best weak candidates when nothing is strong", () => {
    const ranked = rankSignals(
      [
        { path: "a.ts", weight: 0.3, reason: "x" },
        { path: "b.ts", weight: 0.35, reason: "x" },
        { path: "c.ts", weight: 0.1, reason: "x" },
      ],
      nodes,
    );
    expect(pathsOf(ranked)).toEqual(["b.ts", "a.ts"]);
  });
});

// ─── End to end on realistic layouts ─────────────────────────────────────

describe("detectEntryPoints", () => {
  it("npm CLI library: bin and exports beat incidental index files", () => {
    const points = detect(
      ["package.json", "README.md", "source/index.ts", "source/cli.ts", "source/utils/index.ts", "test/index.ts", "media/logo.svg"],
      {
        "package.json": JSON.stringify({ bin: "./distribution/cli.js", exports: "./distribution/index.js" }),
      },
    );
    expect(pathsOf(points)).toEqual(["source/cli.ts", "source/index.ts"]);
    expect(points[0]!.reasons[0]).toBe('package.json "bin" → distribution/cli.js');
  });

  it("Python src layout: console script + __main__.py", () => {
    const points = detect(
      ["pyproject.toml", "src/flask/__init__.py", "src/flask/__main__.py", "src/flask/cli.py", "src/flask/app.py", "tests/conftest.py"],
      { "pyproject.toml": '[project.scripts]\nflask = "flask.cli:main"\n' },
    );
    expect(pathsOf(points)).toEqual(["src/flask/cli.py", "src/flask/__main__.py"]);
    expect(points[1]!.reasons).toEqual(["Runs with python -m flask"]);
  });

  it("Go repo with several commands under cmd/: tooling commands rank below the product", () => {
    const points = detect(
      ["go.mod", "cmd/gh/main.go", "cmd/gen-docs/main.go", "internal/run/run.go", "pkg/cmd/root/root.go", ".github/workflows/deploy.yml"],
      { ".github/workflows/deploy.yml": "jobs:\n  x:\n    steps:\n      - run: go run ./cmd/gen-docs --website\n" },
    );
    expect(pathsOf(points)).toEqual(["cmd/gh/main.go", "cmd/gen-docs/main.go"]);
    expect(points[0]!.reasons).toEqual(['Go command "gh" (cmd/)']);
  });

  it("Rust workspace: crate roots only count next to a Cargo.toml; member libraries and fuzz targets rank low", () => {
    const paths = [
      "Cargo.toml",
      "src/main.rs",
      "src/lib.rs",
      "crates/cli/Cargo.toml",
      "crates/cli/src/lib.rs",
      "fuzz/Cargo.toml",
      "fuzz/fuzz_targets/glob.rs",
      "vendor/src/main.rs",
      "notacrate/src/main.rs",
    ];
    const points = detect(paths, { "fuzz/Cargo.toml": '[[bin]]\nname = "glob"\npath = "fuzz_targets/glob.rs"\n' });
    expect(pathsOf(points)).toEqual(["src/main.rs", "src/lib.rs"]);
  });

  it("Dockerized web app: CMD target corroborates the conventional name", () => {
    const points = detect(["Dockerfile", "app.py", "models.py", "requirements.txt"], {
      Dockerfile: 'FROM python\nCMD ["gunicorn", "app:app"]\n',
    });
    expect(points.map((p) => [p.path, p.score])).toEqual([
      ["app.py", 0.78],
      ["Dockerfile", 0.5],
    ]);
  });

  it("monorepo: the package named after the repo outranks tooling crates and other packages", () => {
    const paths = [
      "package.json",
      "packages/next/package.json",
      "packages/next/src/bin/next.ts",
      "packages/next/src/server/next.ts",
      "packages/font/package.json",
      "packages/font/src/index.ts",
      "crates/next-build-test/Cargo.toml",
      "crates/next-build-test/src/main.rs",
      "crates/next-core/Cargo.toml",
      "crates/next-core/src/main.rs",
      "examples/blog/pages/index.tsx",
    ];
    const files = {
      "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
      "packages/next/package.json": JSON.stringify({ bin: { next: "./dist/bin/next" }, main: "./dist/server/next.js" }),
      "packages/font/package.json": JSON.stringify({ main: "dist/index.js" }),
    };
    const points = detectEntryPoints(treeOf(paths), new Map(Object.entries(files)), { repoName: "next.js" });
    expect(points.map((p) => [p.path, p.score])).toEqual([
      ["packages/next/src/bin/next.ts", 0.81],
      ["packages/next/src/server/next.ts", 0.71],
      ["crates/next-core/src/main.rs", 0.6],
      ["packages/font/src/index.ts", 0.55],
    ]);
    expect(points[0]!.reasons).toEqual([
      'packages/next/package.json "bin: next" → dist/bin/next',
      "In packages/next/, named after the repository",
    ]);
  });

  it("reads the main package's manifests first", () => {
    const nodes = treeOf([
      "crates/a/Cargo.toml",
      "crates/b/Cargo.toml",
      "packages/next/package.json",
      "crates/next-fuzz/Cargo.toml",
    ]);
    expect(planEntryPointReads(nodes, { repoName: "next.js" })).toEqual([
      "packages/next/package.json",
      "crates/a/Cargo.toml",
      "crates/b/Cargo.toml",
    ]);
  });

  it("Next.js routes count only in an app with a next.config (not in Next's own source)", () => {
    const points = detect([
      "next.config.mjs",
      "app/layout.tsx",
      "app/(marketing)/page.tsx",
      "app/blog/page.tsx",
      "packages/next/src/pages/_app.tsx",
    ]);
    expect(pathsOf(points)).toEqual(["app/layout.tsx", "app/(marketing)/page.tsx"]);
  });

  it("docs-only repos get the best weak candidates, or nothing", () => {
    expect(detect(["README.md", "docs/a.md", "LICENSE"])).toEqual([]);
    expect(pathsOf(detect(["README.md", "Makefile", "docs/a.md"]))).toEqual(["Makefile"]);
  });
});

describe("planEntryPointReads", () => {
  it("orders root manifests, Dockerfiles, README, nested manifests, then CI", () => {
    const nodes = treeOf(
      [
        "package.json",
        "Dockerfile",
        "README.md",
        "readme.txt",
        "docker-compose.yml",
        "web/package.json",
        "packages/a/package.json",
        "packages/b/Cargo.toml",
        "examples/x/package.json",
        "node_modules/y/package.json",
        "test/package.json",
        ".github/workflows/test.yml",
        ".github/workflows/release.yml",
        ".github/workflows/lint.yml",
        "huge/package.json",
      ],
      { "huge/package.json": 10_000_000 },
    );
    expect(planEntryPointReads(nodes)).toEqual([
      "package.json",
      "Dockerfile",
      "docker-compose.yml",
      "README.md",
      "web/package.json",
      "packages/a/package.json",
      "packages/b/Cargo.toml",
      ".github/workflows/release.yml",
      ".github/workflows/lint.yml",
    ]);
  });

  it("respects the read cap", () => {
    const nodes = treeOf(Array.from({ length: 30 }, (_, i) => `pkg${i}/package.json`));
    expect(planEntryPointReads(nodes, {}, 5)).toHaveLength(5);
  });
});
