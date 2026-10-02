/**
 * In-flight work shared between requests on this server instance, keyed by
 * cache key. If the prefetch batch and a click ask for the same summary at
 * once, the model is called once and both streams get every delta (late
 * joiners get a replay first). A subscriber disconnecting doesn't cancel the
 * job; its result still lands in the cache for the next request.
 */

interface Job<T, E> {
  events: E[];
  listeners: Set<(event: E) => void>;
  promise: Promise<T>;
}

// Survives Next.js dev hot reloads, like the cache singleton.
const registry = globalThis as unknown as { __repomapJobs?: Map<string, Job<unknown, unknown>> };
const jobs = (registry.__repomapJobs ??= new Map());

export function runShared<T, E>(
  key: string,
  start: (emit: (event: E) => void) => Promise<T>,
  onEvent: (event: E) => void,
): Promise<T> {
  let job = jobs.get(key) as Job<T, E> | undefined;
  if (!job) {
    const created: Job<T, E> = { events: [], listeners: new Set(), promise: Promise.resolve() as Promise<T> };
    const emit = (event: E) => {
      created.events.push(event);
      for (const listener of created.listeners) listener(event);
    };
    created.promise = start(emit).finally(() => jobs.delete(key));
    jobs.set(key, created as Job<unknown, unknown>);
    job = created;
  }

  for (const event of job.events) onEvent(event);
  job.listeners.add(onEvent);
  const current = job;
  return current.promise.finally(() => current.listeners.delete(onEvent));
}

/** Same sharing for plain promises with no events (e.g. resolving a repo). */
export function dedupe<T>(key: string, start: () => Promise<T>): Promise<T> {
  return runShared<T, never>(key, () => start(), () => {});
}

/** For tests. */
export function activeJobCount(): number {
  return jobs.size;
}
