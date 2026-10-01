import { type Nodes, baseName, isDir, isFile, joinPath, resolvePathToken, resolvePyModule } from "@/lib/analysis/resolve";

export interface CommandContext {
  nodes: Nodes;
  /** Folder the command runs from (the Dockerfile's, package.json's, …). */
  baseDir: string;
  /** package.json scripts or deno.json tasks, so `npm start` can be followed. */
  scripts?: Readonly<Record<string, string>>;
}

const SEPARATOR_RE = /\s*(?:&&|\|\||;|\|)\s*/;
const TOKEN_RE = /"([^"]*)"|'([^']*)'|(\S+)/g;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_]\w*=/;
/** Wrappers that run the rest of the line as a command. */
const PREFIXES = new Set(["sudo", "exec", "time", "env", "nohup", "$", ">", "#", "dumb-init", "tini", "--"]);
/** Tools that run another command: `uv run python x.py`, `bundle exec rails s`. */
const RUNNERS: Record<string, string> = { uv: "run", poetry: "run", pipenv: "run", pdm: "run", hatch: "run", rye: "run", bundle: "exec" };
/** `python -m pkg`, `uvicorn app.main:app`, `gunicorn -w 4 wsgi:app`. */
const PY_ATTR_RE = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*):[A-Za-z_][\w.]*(?:\(.*\))?$/;
/** Flags whose value is a config or env file, not the program. */
const VALUE_FLAGS = new Set(["-c", "--config", "--config-file", "-e", "--env-file", "--env", "-r", "--require", "--import", "--loader"]);
const MAX_SCRIPT_DEPTH = 2;

/**
 * Finds the repo files a shell command runs: `node server.js`, `python -m app`,
 * `go run ./cmd/api`, `npm start` (via the scripts map), `gunicorn app:app`, …
 * Only paths that exist in the tree come back, and only source files or
 * folders, so arbitrary arguments can't produce false hits on config files.
 */
export function resolveCommand(command: string, ctx: CommandContext, depth = 0): string[] {
  const found = new Set<string>();

  for (const part of command.split(SEPARATOR_RE)) {
    const tokens = tokenize(part);
    while (tokens.length && (PREFIXES.has(tokens[0]!) || ENV_ASSIGNMENT_RE.test(tokens[0]!))) tokens.shift();
    if (!tokens.length) continue;

    const bin = baseName(tokens[0]!).toLowerCase();
    const args = tokens.slice(1);

    const runner = RUNNERS[bin];
    if (runner && args[0] === runner) {
      for (const p of resolveCommand(args.slice(1).join(" "), ctx, depth)) found.add(p);
      continue;
    }

    const script = scriptName(bin, args, ctx.scripts);
    if (script !== undefined) {
      const body = ctx.scripts?.[script];
      if (body && depth < MAX_SCRIPT_DEPTH) for (const p of resolveCommand(body, ctx, depth + 1)) found.add(p);
      continue;
    }

    if (/^python[\d.]*$|^py$/.test(bin)) {
      const m = args.indexOf("-m");
      if (m !== -1 && args[m + 1]) {
        const path = resolvePyModule(args[m + 1]!, ctx.baseDir, ctx.nodes, true);
        if (path) found.add(path);
        continue;
      }
    }

    if (bin === "go" && (args[0] === "run" || args[0] === "build" || args[0] === "install")) {
      for (const p of goTargets(args.slice(1), ctx)) found.add(p);
      continue;
    }

    if (bin === "cargo" && args[0] === "run") {
      const path = cargoRunTarget(args.slice(1), ctx);
      if (path) found.add(path);
      continue;
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (VALUE_FLAGS.has(token)) {
        i++;
        continue;
      }
      if (token.startsWith("-")) continue;
      const attr = PY_ATTR_RE.exec(token);
      if (attr) {
        const path = resolvePyModule(attr[1]!, ctx.baseDir, ctx.nodes);
        if (path) found.add(path);
        continue;
      }
      const path = resolvePathToken(token, ctx.baseDir, ctx.nodes);
      if (path && ctx.nodes[path]?.kind === "source") found.add(path);
    }
  }

  return [...found];
}

export function tokenize(command: string): string[] {
  const tokens: string[] = [];
  for (const m of command.matchAll(TOKEN_RE)) tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  return tokens.filter(Boolean);
}

/** `npm start`, `npm run dev`, `yarn dev`, `pnpm serve`, `bun run x`, `deno task x` → the script name. */
function scriptName(bin: string, args: string[], scripts?: Readonly<Record<string, string>>): string | undefined {
  const first = args[0];
  if (!first) return undefined;
  if (bin === "deno") return first === "task" ? args[1] : undefined;
  if (bin !== "npm" && bin !== "pnpm" && bin !== "yarn" && bin !== "bun") return undefined;
  if (first === "run" || first === "run-script") return args[1];
  if (first === "start" || first === "test") return first;
  // yarn/pnpm/bun run scripts by bare name; npm doesn't.
  if (bin !== "npm" && scripts && Object.hasOwn(scripts, first)) return first;
  return undefined;
}

/** `go run ./cmd/api`, `go build -o bin/x ./cmd/x/...`, `go run .`, `go run main.go`. */
function goTargets(args: string[], ctx: CommandContext): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-o" || arg === "-ldflags" || arg === "-tags" || arg === "-gcflags") {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    if (!(arg === "." || arg.startsWith("./") || arg.startsWith("../") || arg.endsWith(".go"))) continue;
    const path = joinPath(ctx.baseDir, arg.replace(/\/\.\.\.$/, ""));
    if (path === null) continue;
    if (isFile(ctx.nodes, path) && path.endsWith(".go")) out.push(path);
    else if (isDir(ctx.nodes, path)) {
      const main = path ? `${path}/main.go` : "main.go";
      out.push(isFile(ctx.nodes, main) ? main : path);
    }
  }
  // `go run .` at the root resolves to "" (the repo itself), which isn't a useful entry point.
  return out.filter(Boolean);
}

/** `cargo run` → src/main.rs; `cargo run --bin x` → src/bin/x.rs. */
function cargoRunTarget(args: string[], ctx: CommandContext): string | null {
  const binFlag = args.indexOf("--bin");
  const name = binFlag !== -1 ? args[binFlag + 1] : undefined;
  const candidates = name ? [`src/bin/${name}.rs`, `src/bin/${name}/main.rs`] : ["src/main.rs"];
  for (const candidate of candidates) {
    const path = joinPath(ctx.baseDir, candidate);
    if (isFile(ctx.nodes, path)) return path;
  }
  return null;
}
