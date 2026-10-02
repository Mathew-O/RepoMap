import { Fragment } from "react";

/** Model text with `backtick` spans rendered as code, plus a blinking caret while it streams. */
export function SummaryText({ text, streaming = false, className = "" }: { text: string; streaming?: boolean; className?: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <p className={`text-sm leading-6 break-words ${className}`}>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded-md bg-neutral-muted px-1 py-px font-mono text-[12px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
      {streaming && <span className="streaming-caret" aria-hidden="true" />}
    </p>
  );
}

/** Two shimmering lines while a summary is queued or the model hasn't written anything yet. */
export function SummarySkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-busy="true">
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-3/4" />
      <p className="text-xs text-fg-muted">{label}</p>
    </div>
  );
}
