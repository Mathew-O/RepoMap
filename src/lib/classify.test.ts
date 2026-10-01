import { describe, expect, it } from "vitest";

import { classifyDir, classifyFile } from "@/lib/classify";
import { MAX_ANALYZABLE_FILE_BYTES } from "@/lib/config";

describe("classifyFile kind", () => {
  it.each([
    ["src/index.ts", "source"],
    ["cmd/server/main.go", "source"],
    ["bin/cli", "source"],
    ["lib/foo.test.ts", "test"],
    ["pkg/http/client_test.go", "test"],
    ["tests/test_app.py", "test"],
    ["src/__tests__/a.tsx", "test"],
    ["src/main/java/AppTest.java", "test"],
    ["conftest.py", "test"],
    ["README.md", "docs"],
    ["LICENSE", "docs"],
    ["docs/guide/intro.md", "docs"],
    ["CHANGELOG.md", "docs"],
    ["package.json", "config"],
    ["tsconfig.base.json", "config"],
    ["tsconfig.test.json", "config"],
    ["test-d/index.test-d.ts", "test"],
    ["pyproject.toml", "config"],
    [".eslintrc.cjs", "config"],
    ["eslint.config.mjs", "config"],
    [".gitignore", "config"],
    [".github/dependabot.yml", "config"],
    ["Dockerfile", "build"],
    ["docker/api.Dockerfile", "build"],
    ["docker-compose.prod.yml", "build"],
    [".github/workflows/ci.yml", "build"],
    ["Makefile", "build"],
    ["vite.config.ts", "build"],
    ["CMakeLists.txt", "build"],
    ["public/logo.png", "asset"],
    ["assets/icon.svg", "asset"],
    ["data/dump.bin", "other"],
  ])("%s → %s", (path, kind) => {
    expect(classifyFile(path).kind).toBe(kind);
  });
});

describe("classifyFile skip", () => {
  it.each([
    ["package-lock.json", "lockfile"],
    ["Cargo.lock", "lockfile"],
    ["go.sum", "lockfile"],
    ["img/a.png", "binary"],
    ["fonts/x.woff2", "binary"],
    ["logo.svg", "asset"],
    ["dist/app.min.js", "generated"],
    ["api/v1/service.pb.go", "generated"],
    ["proto/msg_pb2.py", "generated"],
    ["src/__snapshots__/a.test.ts.snap", "generated"],
  ])("%s → %s", (path, skip) => {
    expect(classifyFile(path).skip).toBe(skip);
  });

  it("skips files over the size limit", () => {
    expect(classifyFile("src/big.ts", MAX_ANALYZABLE_FILE_BYTES + 1).skip).toBe("too-large");
    expect(classifyFile("src/ok.ts", 1000).skip).toBeUndefined();
  });
});

describe("classifyDir", () => {
  it("flags vendored and generated directories", () => {
    expect(classifyDir("node_modules", "node_modules")).toEqual({ skip: "vendored" });
    expect(classifyDir("vendor", "vendor")).toEqual({ skip: "vendored" });
    expect(classifyDir("dist", "packages/a/dist")).toEqual({ skip: "generated" });
  });

  it("names strong-signal folders", () => {
    expect(classifyDir("tests", "tests").kind).toBe("test");
    expect(classifyDir("docs", "docs").kind).toBe("docs");
    expect(classifyDir("workflows", ".github/workflows").kind).toBe("build");
    expect(classifyDir(".github", ".github").kind).toBe("build");
    expect(classifyDir("src", "src")).toEqual({});
  });
});
