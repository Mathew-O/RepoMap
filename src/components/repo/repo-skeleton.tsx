const ROW_WIDTHS = ["w-28", "w-40", "w-24", "w-36", "w-20", "w-44", "w-32", "w-28", "w-24", "w-36"];

/** Loading placeholder shaped like the repo header + file list. */
export function RepoSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading repository">
      <div className="border-b border-border bg-canvas-subtle/60 pt-4">
        <div className="mx-auto max-w-[1280px] px-4 md:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="skeleton h-6 w-64" />
            <div className="skeleton h-5 w-14 rounded-full!" />
            <div className="ml-auto flex gap-2">
              <div className="skeleton h-7 w-24" />
              <div className="skeleton h-7 w-24" />
              <div className="skeleton h-7 w-32" />
            </div>
          </div>
          <div className="skeleton mt-4 h-5 w-full max-w-[560px]" />
          <div className="mt-3 flex gap-1.5">
            <div className="skeleton h-[22px] w-16 rounded-full!" />
            <div className="skeleton h-[22px] w-20 rounded-full!" />
            <div className="skeleton h-[22px] w-14 rounded-full!" />
          </div>
          <div className="skeleton mt-5 mb-2 h-8 w-24" />
        </div>
      </div>

      <div className="mx-auto max-w-[1280px] space-y-4 px-4 py-6 md:px-6 lg:px-8">
        <div className="flex gap-2">
          <div className="skeleton h-8 w-32" />
          <div className="skeleton h-8 w-48" />
        </div>
        <div className="Box overflow-hidden">
          <div className="Box-header">
            <div className="skeleton h-4 w-72 max-w-full" />
          </div>
          {ROW_WIDTHS.map((w, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-border-muted px-4 py-2.5 first:border-t-0">
              <div className="skeleton size-4 shrink-0" />
              <div className={`skeleton h-3.5 ${w}`} />
              <div className="skeleton ml-auto hidden h-3.5 w-16 md:block" />
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-fg-muted">Fetching the file tree from GitHub…</p>
      </div>
    </div>
  );
}
