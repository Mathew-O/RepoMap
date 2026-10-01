import { MAX_ANALYZABLE_FILE_BYTES } from "@/lib/config";
import type { FileKind, SkipReason } from "@/lib/types";

/**
 * Path-based heuristics for (a) the color-coded kind of each node and
 * (b) whether a file should be excluded from AI analysis. Pure and
 * synchronous; runs once per tree entry when the tree is built.
 */

export interface FileClassification {
  kind: FileKind;
  skip?: SkipReason;
}

export interface DirClassification {
  /** Only set when the directory name alone is a strong signal. */
  kind?: FileKind;
  /** Applies to everything beneath this directory. */
  skip?: Extract<SkipReason, "vendored" | "generated">;
}

// ─── Skip rules ──────────────────────────────────────────────────────────

const LOCKFILES = new Set([
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
  "bun.lockb", "bun.lock", "deno.lock", "cargo.lock", "gemfile.lock",
  "poetry.lock", "pipfile.lock", "uv.lock", "pdm.lock", "composer.lock",
  "go.sum", "go.work.sum", "mix.lock", "podfile.lock", "package.resolved",
  "packages.lock.json", "pubspec.lock", "gradle.lockfile", "flake.lock",
  "conda-lock.yml", "paket.lock", "shard.lock", "manifest.toml",
]);

const ASSET_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "icns", "webp", "avif", "tif",
  "tiff", "psd", "ai", "sketch", "fig", "xcf", "svg", "woff", "woff2", "ttf",
  "otf", "eot", "mp3", "mp4", "m4a", "aac", "wav", "ogg", "oga", "flac",
  "webm", "mov", "avi", "mkv",
]);

const BINARY_EXT = new Set([
  "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "war",
  "ear", "aar", "apk", "ipa", "dmg", "iso", "exe", "msi", "dll", "so",
  "dylib", "a", "lib", "o", "obj", "bin", "wasm", "class", "pyc", "pyo",
  "pyd", "pdb", "node", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "odt", "sqlite", "sqlite3", "db", "mdb", "dat", "pak", "pkl", "pickle",
  "npy", "npz", "h5", "hdf5", "onnx", "pt", "pth", "ckpt", "safetensors",
  "parquet", "avro", "keystore", "jks", "p12", "pfx", "ttc",
]);

const VENDORED_DIRS = new Set([
  "node_modules", "vendor", "vendors", "third_party", "third-party",
  "thirdparty", "bower_components", "jspm_packages", "pods", "carthage",
  ".yarn", ".pnpm-store", "site-packages", ".venv", "venv", ".bundle",
]);

const GENERATED_DIRS = new Set([
  "dist", ".next", ".nuxt", ".svelte-kit", ".output", ".turbo", ".vercel",
  ".parcel-cache", ".cache", ".angular", "coverage", ".nyc_output",
  "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
  ".gradle", "target", "__generated__", ".docusaurus", "storybook-static",
]);

const GENERATED_FILE_PATTERNS = [
  /\.min\.(m?js|css)$/i,
  /\.(js|css)\.map$/i,
  /[.-]bundle\.m?js$/i,
  /\.pb(\.gw)?\.(go|cc|h|swift|dart)$/i,
  /_grpc\.pb\.go$/i,
  /_pb2(_grpc)?\.pyi?$/i,
  /(^|\/)zz_generated[^/]*\.go$/i,
  /_generated\.(go|ts|js|rs|py|dart)$/i,
  /\.generated\.[a-z0-9]+$/i,
  /\.g\.dart$/i,
  /\.freezed\.dart$/i,
  /\.designer\.cs$/i,
  /\.snap$/i,
];

// ─── Kind rules ──────────────────────────────────────────────────────────

const TEST_DIRS = new Set([
  "test", "tests", "__tests__", "__test__", "spec", "specs", "testing",
  "e2e", "testdata", "test-data", "test_data", "fixtures", "__fixtures__",
  "__mocks__", "__snapshots__", "cypress", "playwright", "integration-tests",
  "test-d",
]);

const DOCS_DIRS = new Set(["docs", "doc", "documentation", "man", "manual", "guides"]);

const BUILD_DIRS = new Set([".circleci", ".buildkite", ".gitlab", ".azure-pipelines", ".ci", "ci"]);

const CONFIG_DIRS = new Set([
  ".vscode", ".idea", ".devcontainer", ".husky", ".config", ".changeset",
  ".storybook", "config", "configs", "conf",
]);

const BUILD_FILES = new Set([
  "dockerfile", "containerfile", "makefile", "gnumakefile", "jenkinsfile",
  "procfile", "vagrantfile", "earthfile", "justfile", "rakefile",
  "taskfile.yml", "taskfile.yaml", "cmakelists.txt", "build.gradle",
  "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradlew",
  "gradlew.bat", "pom.xml", "build.xml", "build.sbt", "build.zig",
  "meson.build", "build", "build.bazel", "workspace", "workspace.bazel",
  "module.bazel", ".bazelrc", "sconstruct", ".gitlab-ci.yml", ".travis.yml",
  "azure-pipelines.yml", "appveyor.yml", ".drone.yml", "cloudbuild.yaml",
  "netlify.toml", "vercel.json", "fly.toml", "render.yaml", "skaffold.yaml",
  ".goreleaser.yml", ".goreleaser.yaml", "compose.yml", "compose.yaml",
  ".dockerignore", "build.rs", "turbo.json", "nx.json", "lerna.json",
  "action.yml", "action.yaml", "gulpfile.js", "gruntfile.js",
]);

const BUILD_PATTERNS = [
  /^dockerfile/i,
  /\.dockerfile$/i,
  /^docker-compose.*\.ya?ml$/i,
  /\.(cmake|bzl|mk|mak)$/i,
  /^(webpack|rollup|vite|esbuild|tsup|rspack|parcel|rolldown)\.config\./i,
];

const DOCS_NAME_PATTERNS = [
  /^(readme|changelog|changes|history|license|licence|copying|contributing|code_of_conduct|security|authors|contributors|notice|maintainers|governance|support|funding|citation)(\.|$)/i,
];

const DOCS_EXT = new Set(["md", "mdx", "markdown", "rst", "adoc", "asciidoc", "org", "pdf", "doc", "docx"]);

const CONFIG_FILES = new Set([
  "package.json", "jsconfig.json", "pyproject.toml", "setup.cfg", "setup.py",
  "pipfile", "cargo.toml", "go.mod", "go.work", "gemfile", "composer.json",
  "mix.exs", "pubspec.yaml", "deno.json", "deno.jsonc", "bunfig.toml",
  "codeowners", "biome.json", "biome.jsonc", "renovate.json", "tox.ini",
  "pytest.ini", "mypy.ini", "rustfmt.toml", "clippy.toml", "requirements.txt",
  "makefile.toml", "directory.build.props", "global.json", "nuget.config",
]);

const CONFIG_PATTERNS = [
  /^tsconfig.*\.json$/i,
  /^\.[\w.-]*rc(\.[a-z0-9]+)?$/i,
  /^requirements[\w.-]*\.(txt|in)$/i,
  /\.config\.[cm]?[jt]s$/i,
  /\.config\.json$/i,
  /\.(csproj|fsproj|vbproj|vcxproj|sln|gemspec|cabal)$/i,
  /^\.env(\..+)?$/i,
];

const CONFIG_EXT = new Set([
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "properties", "plist", "xml", "editorconfig", "env", "lock",
]);

const SOURCE_EXT = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "py", "pyi", "go",
  "rs", "java", "kt", "kts", "scala", "sc", "groovy", "swift", "m", "mm", "c",
  "h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "inl", "cs", "fs", "fsx",
  "vb", "rb", "php", "pl", "pm", "lua", "r", "jl", "dart", "ex", "exs",
  "erl", "hrl", "hs", "elm", "clj", "cljs", "cljc", "edn", "ml", "mli", "nim",
  "zig", "v", "sol", "vue", "svelte", "astro", "sh", "bash", "zsh", "fish",
  "ps1", "psm1", "bat", "cmd", "sql", "graphql", "gql", "proto", "html",
  "htm", "css", "scss", "sass", "less", "styl", "wgsl", "glsl", "hlsl",
  "cu", "f90", "cob", "asm", "s", "tf", "hcl", "nix", "cr", "gleam", "odin",
  "mojo", "re", "res", "purs", "ipynb", "rkt", "lisp", "el", "vim", "tsv",
]);

// ─── Public API ──────────────────────────────────────────────────────────

export function classifyDir(name: string, path: string): DirClassification {
  const lower = name.toLowerCase();
  if (VENDORED_DIRS.has(lower)) return { skip: "vendored" };
  if (GENERATED_DIRS.has(lower)) return { skip: "generated" };
  if (TEST_DIRS.has(lower)) return { kind: "test" };
  if (DOCS_DIRS.has(lower)) return { kind: "docs" };
  if (BUILD_DIRS.has(lower) || /^\.github(\/(workflows|actions))?$/i.test(path)) {
    return { kind: "build" };
  }
  if (CONFIG_DIRS.has(lower)) return { kind: "config" };
  return {};
}

export function classifyFile(path: string, size?: number): FileClassification {
  const segments = path.split("/");
  const name = segments[segments.length - 1] ?? path;
  const dirs = segments.slice(0, -1).map((s) => s.toLowerCase());
  const lower = name.toLowerCase();
  const ext = extensionOf(lower);

  const kind = fileKind(path, lower, ext, dirs);
  const skip = skipReason(path, lower, ext, size);
  return skip ? { kind, skip } : { kind };
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

// ─── Internals ───────────────────────────────────────────────────────────

function skipReason(path: string, lower: string, ext: string, size?: number): SkipReason | undefined {
  if (LOCKFILES.has(lower)) return "lockfile";
  if (ASSET_EXT.has(ext)) return ext === "svg" ? "asset" : "binary";
  if (BINARY_EXT.has(ext)) return "binary";
  if (GENERATED_FILE_PATTERNS.some((re) => re.test(path))) return "generated";
  if (size !== undefined && size > MAX_ANALYZABLE_FILE_BYTES) return "too-large";
  return undefined;
}

function fileKind(path: string, lower: string, ext: string, dirs: string[]): FileKind {
  // Build / CI: Docker, CI pipelines, build systems, bundler configs.
  if (
    BUILD_FILES.has(lower) ||
    BUILD_PATTERNS.some((re) => re.test(lower)) ||
    /^\.github\/(workflows|actions)\//i.test(path) ||
    dirs.some((d) => BUILD_DIRS.has(d))
  ) {
    return "build";
  }

  // Well-known config names win over test naming (tsconfig.test.json is config).
  if (
    CONFIG_FILES.has(lower) ||
    CONFIG_PATTERNS.some((re) => re.test(lower)) ||
    LOCKFILES.has(lower)
  ) {
    return "config";
  }

  // Tests: test directories or test-file naming conventions.
  if (dirs.some((d) => TEST_DIRS.has(d)) || isTestFileName(lower, path)) return "test";

  if (DOCS_NAME_PATTERNS.some((re) => re.test(lower))) return "docs";

  if (DOCS_EXT.has(ext) || (dirs.some((d) => DOCS_DIRS.has(d)) && !ASSET_EXT.has(ext))) {
    return "docs";
  }

  if (ASSET_EXT.has(ext)) return "asset";
  if (SOURCE_EXT.has(ext)) return "source";

  if (
    CONFIG_EXT.has(ext) ||
    lower.startsWith(".") ||
    /rc$/.test(lower) ||
    dirs.some((d) => CONFIG_DIRS.has(d)) ||
    dirs[0] === ".github"
  ) {
    return "config";
  }

  // Extensionless executables in bin/ or scripts/ are almost always source.
  if (!ext && dirs.some((d) => d === "bin" || d === "scripts" || d === "script")) return "source";

  return "other";
}

function isTestFileName(lower: string, path: string): boolean {
  const original = path.slice(path.lastIndexOf("/") + 1);
  return (
    /\.(test|spec|e2e|cy)\.[a-z0-9]+$/.test(lower) ||
    /_(test|spec)\.(go|py|rb|exs|ex|dart|rs|c|cc|cpp)$/.test(lower) ||
    /^test_.*\.py$/.test(lower) ||
    lower === "conftest.py" ||
    /^(jest|vitest)\.setup\./.test(lower) ||
    /(Test|Tests|Spec|IT)\.(java|kt|scala|cs|swift|groovy|php)$/.test(original)
  );
}
