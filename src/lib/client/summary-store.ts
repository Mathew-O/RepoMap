import { toApiError } from "@/lib/client/api";
import type { CommitTarget } from "@/lib/client/ai";
import type { ApiError, Summary, SummaryEvent } from "@/lib/types";

export type SummaryEntry =
  | { status: "queued" }
  | { status: "streaming"; text: string }
  | { status: "done"; summary: Summary }
  | { status: "error"; error: ApiError };

export type SummaryFetcher = (
  target: CommitTarget,
  paths: string[],
  onEvent: (event: SummaryEvent) => void,
  signal: AbortSignal,
) => Promise<void>;

const BATCH_SIZE = 8;
const MAX_ACTIVE_REQUESTS = 2;
/** After one of these, every later request would fail the same way. */
const FATAL = new Set<ApiError["code"]>(["AI_UNAVAILABLE", "AI_RATE_LIMITED", "RATE_LIMITED", "BAD_TOKEN", "PRIVATE_REPO", "FORBIDDEN"]);

/**
 * Client-side state for one commit's summaries, shared by the details panel,
 * the Files list and the map. Paths queue up and go out in batches of 8, two
 * requests at a time; a click jumps the queue. Each update replaces that
 * path's entry object, so useSyncExternalStore subscribers re-render only
 * when their own path changes.
 */
export class SummaryStore {
  private readonly entries = new Map<string, SummaryEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Set<AbortController>();
  private queue: string[] = [];
  private active = 0;
  private disposed = false;
  /** Set when a request failed in a way that stops all AI work (shown once, not per file). */
  fatal: ApiError | null = null;

  constructor(
    private readonly target: CommitTarget,
    private readonly fetcher: SummaryFetcher,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get = (path: string): SummaryEntry | undefined => this.entries.get(path);

  /** Queues paths that aren't loaded or loading. `urgent` puts them first (a click). */
  request(paths: string[], options: { urgent?: boolean } = {}) {
    if (this.disposed || this.fatal) return;
    const fresh: string[] = [];
    for (const path of paths) {
      const entry = this.entries.get(path);
      if (entry?.status === "queued" && options.urgent) {
        this.queue = this.queue.filter((p) => p !== path);
        fresh.push(path);
      } else if (!entry || entry.status === "error") {
        this.entries.set(path, { status: "queued" });
        fresh.push(path);
      }
    }
    if (!fresh.length) return;
    this.queue = options.urgent ? [...fresh, ...this.queue] : [...this.queue, ...fresh];
    this.notify();
    this.pump();
  }

  /** Tries a failed path again; also clears a fatal error so a later retry can succeed. */
  retry(path: string) {
    this.fatal = null;
    this.request([path], { urgent: true });
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.listeners.clear();
  }

  private pump() {
    while (!this.disposed && !this.fatal && this.active < MAX_ACTIVE_REQUESTS && this.queue.length) {
      void this.run(this.queue.splice(0, BATCH_SIZE));
    }
  }

  private async run(batch: string[]) {
    this.active++;
    const controller = new AbortController();
    this.controllers.add(controller);
    const pending = new Set(batch);
    for (const path of batch) this.entries.set(path, { status: "streaming", text: "" });
    this.notify();

    try {
      await this.fetcher(this.target, batch, (event) => this.apply(event, pending), controller.signal);
      // The stream ended without an answer for some paths (shouldn't happen; don't leave them spinning).
      for (const path of pending) this.fail(path, { code: "AI_ERROR", message: "No summary came back.", hint: "Try again." });
    } catch (err) {
      if (controller.signal.aborted) return;
      const error = toApiError(err);
      for (const path of pending) this.fail(path, error);
    } finally {
      this.controllers.delete(controller);
      this.active--;
      if (!controller.signal.aborted) {
        this.notify();
        this.pump();
      }
    }
  }

  private apply(event: SummaryEvent, pending: Set<string>) {
    if (this.disposed) return;
    if (event.type === "delta") {
      const entry = this.entries.get(event.path);
      const text = entry?.status === "streaming" ? entry.text : "";
      this.entries.set(event.path, { status: "streaming", text: text + event.text });
    } else if (event.type === "summary") {
      pending.delete(event.summary.path);
      this.entries.set(event.summary.path, { status: "done", summary: event.summary });
    } else if (event.path !== null) {
      pending.delete(event.path);
      this.fail(event.path, event.error);
    } else {
      for (const path of pending) this.fail(path, event.error);
      pending.clear();
    }
    this.notify();
  }

  private fail(path: string, error: ApiError) {
    this.entries.set(path, { status: "error", error });
    if (FATAL.has(error.code) && !this.fatal) {
      this.fatal = error;
      // Nothing queued can succeed now; drop it so it doesn't look like it's loading.
      for (const queued of this.queue) this.entries.delete(queued);
      this.queue = [];
    }
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
