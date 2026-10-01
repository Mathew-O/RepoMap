"use client";

import { ChevronUpIcon, XIcon } from "@primer/octicons-react";
import type { ReactNode } from "react";

/**
 * Mobile panel: docked to the bottom of the screen under the map.
 * "peek" shows just the title row so the map stays usable; "open" shows everything.
 */
export function BottomSheet({
  title,
  open,
  onOpenChange,
  onClose,
  children,
}: {
  title: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label="Details"
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[72dvh] flex-col rounded-t-xl border-t border-border bg-canvas-overlay pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(1,4,9,0.25)] lg:hidden"
    >
      <div className="flex items-center gap-2 px-4 pt-2 pb-2">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-stretch gap-2 text-left"
        >
          <span aria-hidden="true" className="mx-auto h-1 w-10 rounded-full bg-border" />
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1">{title}</span>
            <ChevronUpIcon className={`shrink-0 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="sr-only">{open ? "Collapse details" : "Expand details"}</span>
          </span>
        </button>
        <button type="button" onClick={onClose} className="btn btn-sm btn-invisible mt-3 self-start px-1.5!" aria-label="Close details">
          <XIcon />
        </button>
      </div>
      {open && <div className="overflow-y-auto overscroll-contain border-t border-border px-4 py-4">{children}</div>}
    </div>
  );
}
